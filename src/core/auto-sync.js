/**
 * Auto-Sync Module - Git/GitHub Sync on Every Change
 * Watches workspace and auto-commits + pushes changes
 */

import { watch } from 'node:fs';
import { join } from 'node:path';
import { GitTool } from '../tools/git.js';

const DEBOUNCE_MS = 2000;
const WATCH_PATTERNS = [
  '*.js', '*.mjs', '*.ts', '*.json', '*.md', '*.html', '*.css',
  'src/**', 'docs/**', 'scripts/**', 'tests/**'
];
const IGNORE_PATTERNS = [
  'node_modules', 'dist', 'data', 'logs', 'cache', '.git',
  '*.log', '*.db', '*.sqlite', 'bm25_*.json'
];

export class AutoSync {
  constructor(config) {
    this.config = config;
    this.pendingChanges = new Set();
    this.debounceTimer = null;
    this.watcher = null;
    this.lastCommit = null;
    this.running = false;
  }

  async initialize() {
    // Initial sync: pull latest from remote
    try {
      const pullResult = await GitTool.pull({}, this.config);
      if (pullResult.success) {
        console.log('[AutoSync] Initial pull complete');
      }
    } catch (e) {
      console.warn('[AutoSync] Initial pull failed:', e.message);
    }

    // Start file watcher
    this.startWatching();
    this.running = true;
  }

  startWatching() {
    const root = process.cwd();
    console.log('[AutoSync] Watching for changes in', root);

    // Watch recursively with Node.js fs.watch (basic, but works)
    this.watcher = watch(root, { recursive: true }, async (eventType, filename) => {
      if (!filename || !this.running) return;

      // Check ignore patterns
      if (this.shouldIgnore(filename)) return;

      console.log('[AutoSync] Change detected:', eventType, filename);
      this.pendingChanges.add(filename);

      // Debounce commits
      clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => this.commitChanges(), DEBOUNCE_MS);
    });
  }

  shouldIgnore(filename) {
    return IGNORE_PATTERNS.some(pattern => {
      if (pattern.includes('*')) {
        const regex = new RegExp(pattern.replace('*', '.*'));
        return regex.test(filename);
      }
      return filename.includes(pattern) || filename.startsWith('.');
    });
  }

  async commitChanges() {
    if (this.pendingChanges.size === 0) return;

    const changes = Array.from(this.pendingChanges);
    this.pendingChanges.clear();

    console.log('[AutoSync] Committing changes:', changes.join(', '));

    try {
      // Add changed files
      await GitTool.add({ files: changes }, this.config);

      // Check status
      const status = await GitTool.status({}, this.config);
      if (!status.dirty) {
        console.log('[AutoSync] No changes to commit');
        return;
      }

      // Commit with auto-generated message
      const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
      const message = `auto: ${changes.length} file(s) updated at ${timestamp}`;
      
      const commitResult = await GitTool.commit({ message, files: changes }, this.config);
      
      if (commitResult.success && !commitResult.skipped) {
        this.lastCommit = commitResult.hash;
        console.log('[AutoSync] Committed:', commitResult.hash);

        // Auto-push
        const pushResult = await GitTool.push({}, this.config);
        if (pushResult.success) {
          console.log('[AutoSync] Pushed to remote');
        } else {
          console.warn('[AutoSync] Push failed:', pushResult.error);
        }
      } else if (commitResult.skipped) {
        console.log('[AutoSync] Nothing to commit');
      } else {
        console.warn('[AutoSync] Commit failed:', commitResult.error);
      }
    } catch (e) {
      console.error('[AutoSync] Commit failed:', e.message);
    }
  }

  async forceCommit(message) {
    console.log('[AutoSync] Force commit:', message);
    
    await GitTool.add({ files: '.' }, this.config);
    const result = await GitTool.commit({ message }, this.config);
    
    if (result.success && !result.skipped) {
      this.lastCommit = result.hash;
      await GitTool.push({}, this.config);
    }
    
    return result;
  }

  async stop() {
    this.running = false;
    clearTimeout(this.debounceTimer);
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    console.log('[AutoSync] Stopped watching');
  }

  getStatus() {
    return {
      running: this.running,
      pendingChanges: this.pendingChanges.size,
      lastCommit: this.lastCommit,
      config: {
        repo: this.config.githubRepo,
        branch: this.config.githubBranch
      }
    };
  }
}
