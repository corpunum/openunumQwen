/**
 * File Operations Tool
 * Proper ESM, directory creation, safe paths
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';

const WORKSPACE_ROOT = resolve(process.cwd());

function safePath(userPath) {
  const resolved = resolve(userPath);
  if (!resolved.startsWith(WORKSPACE_ROOT)) {
    throw new Error(`Path outside workspace: ${userPath} (resolved: ${resolved})`);
  }
  return resolved;
}

export const FileTool = {
  read(args, config) {
    const { path, limit = 1000 } = args;

    if (!path) {
      throw new Error('Path required for file_read');
    }

    const safe = safePath(path);

    if (!existsSync(safe)) {
      throw new Error(`File not found: ${path}`);
    }

    const stats = statSync(safe);
    if (!stats.isFile()) {
      throw new Error(`Not a file: ${path}`);
    }

    if (stats.size > 10 * 1024 * 1024) {
      throw new Error(`File too large (>10MB): ${path}`);
    }

    const content = readFileSync(safe, 'utf-8');
    const lines = content.split('\n');
    const truncated = lines.length > limit ? lines.slice(0, limit).join('\n') + '\n... (truncated)' : content;

    return {
      success: true,
      path,
      content: truncated,
      size: stats.size,
      lines: lines.length,
      truncated: lines.length > limit
    };
  },

  write(args, config) {
    const { path, content, append = false } = args;

    if (!path || content === undefined) {
      throw new Error('Path and content required for file_write');
    }

    const safe = safePath(path);
    const dir = dirname(safe);

    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    if (append && existsSync(safe)) {
      const existing = readFileSync(safe, 'utf-8');
      writeFileSync(safe, existing + '\n' + content, 'utf-8');
    } else {
      writeFileSync(safe, content, 'utf-8');
    }

    return {
      success: true,
      path,
      written: true,
      size: content.length,
      timestamp: Date.now()
    };
  },

  list(args, config) {
    const { path = '.', recursive = false, maxDepth = 3 } = args;

    const safe = safePath(path);

    if (!existsSync(safe)) {
      throw new Error(`Path not found: ${path}`);
    }

    const stats = statSync(safe);
    if (!stats.isDirectory()) {
      throw new Error(`Not a directory: ${path}`);
    }

    const entries = [];

    function walk(dir, depth = 0) {
      if (depth > maxDepth) return;
      
      const items = readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        if (item.name.startsWith('.') && item.name !== '.git') continue;
        if (item.name === 'node_modules') continue;
        
        const fullPath = join(dir, item.name);
        const relPath = fullPath.substring(WORKSPACE_ROOT.length + 1);
        
        entries.push({
          name: item.name,
          path: relPath,
          isDirectory: item.isDirectory(),
          size: item.isFile() ? statSync(fullPath).size : null
        });

        if (recursive && item.isDirectory()) {
          walk(fullPath, depth + 1);
        }
      }
    }

    walk(safe);

    return {
      success: true,
      path,
      count: entries.length,
      entries
    };
  },

  exists(args, config) {
    const { path } = args;
    if (!path) {
      throw new Error('Path required for file_exists');
    }
    const safe = safePath(path);
    return {
      success: true,
      path,
      exists: existsSync(safe)
    };
  },

  delete(args, config) {
    const { path, recursive = false } = args;

    if (!path) {
      throw new Error('Path required for file_delete');
    }

    const safe = safePath(path);

    if (!existsSync(safe)) {
      return { success: true, path, deleted: false, reason: 'not_found' };
    }

    const stats = statSync(safe);
    if (stats.isDirectory() && !recursive) {
      throw new Error('Directory delete requires recursive=true');
    }

    // Use trash if available, otherwise unlink
    try {
      const { execSync } = require('node:child_process');
      execSync(`trash "${safe}"`, { stdio: 'ignore' });
      return { success: true, path, deleted: true, method: 'trash' };
    } catch (e) {
      const { unlinkSync, rmSync } = require('node:fs');
      if (stats.isDirectory()) {
        rmSync(safe, { recursive: true, force: true });
      } else {
        unlinkSync(safe);
      }
      return { success: true, path, deleted: true, method: 'force_delete' };
    }
  }
};
