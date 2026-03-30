#!/usr/bin/env node
/**
 * Manual Git Sync Script
 * Usage: pnpm sync
 */

import { GitTool } from '../src/tools/git.js';
import { loadConfig } from '../src/core/config.js';

async function main() {
  console.log('🔄 Syncing with GitHub...\n');
  
  const config = loadConfig();
  
  if (!config.githubRepo || !config.githubToken) {
    console.error('❌ GitHub sync not configured');
    console.error('Set GITHUB_REPO and GITHUB_TOKEN in .env');
    process.exit(1);
  }

  // Pull latest
  console.log('📥 Pulling latest from remote...');
  const pullResult = await GitTool.pull({}, config);
  if (pullResult.success) {
    console.log('✅ Pull successful');
  } else {
    console.warn('⚠️ Pull failed:', pullResult.error);
  }

  // Status
  console.log('\n📊 Checking status...');
  const status = await GitTool.status({}, config);
  if (status.dirty) {
    console.log('📝 Uncommitted changes:');
    status.files.forEach(f => console.log(`   ${f.status} ${f.path}`));
    
    // Auto-commit
    console.log('\n💾 Committing changes...');
    const commitResult = await GitTool.commit({ 
      message: 'sync: manual sync via pnpm sync',
      files: '.'
    }, config);
    
    if (commitResult.success && !commitResult.skipped) {
      console.log('✅ Committed:', commitResult.hash);
      
      // Push
      console.log('\n📤 Pushing to remote...');
      const pushResult = await GitTool.push({}, config);
      if (pushResult.success) {
        console.log('✅ Push successful');
      } else {
        console.error('❌ Push failed:', pushResult.error);
      }
    } else if (commitResult.skipped) {
      console.log('ℹ️ No changes to commit');
    } else {
      console.error('❌ Commit failed:', commitResult.error);
    }
  } else {
    console.log('✅ Working tree clean');
  }

  console.log('\n✅ Sync complete');
}

main().catch(e => {
  console.error('❌ Sync failed:', e.message);
  process.exit(1);
});
