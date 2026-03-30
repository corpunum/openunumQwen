#!/usr/bin/env node
/**
 * Initialization Script
 * Sets up GitHub remote, initial commit, etc.
 * Usage: pnpm init
 */

import { existsSync, writeFileSync } from 'node:fs';
import { GitTool } from '../src/tools/git.js';
import { loadConfig } from '../src/core/config.js';

async function main() {
  console.log('⚡ Initializing OpenUnum Qwen...\n');

  const config = loadConfig();

  // Check if .env exists
  if (!existsSync('.env')) {
    console.log('📝 Creating .env from .env.example...');
    const { readFileSync } = await import('node:fs');
    const example = readFileSync('.env.example', 'utf-8');
    writeFileSync('.env', example);
    console.log('✅ .env created. Edit it with your settings.\n');
  }

  // Git setup
  console.log('📊 Checking git status...');
  const status = await GitTool.status({}, config);
  
  if (status.success) {
    console.log(`   Branch: ${status.branch}`);
    console.log(`   Dirty: ${status.dirty}`);
    
    if (status.dirty) {
      console.log('\n💾 Making initial commit...');
      const commitResult = await GitTool.commit({
        message: 'init: Initial commit - OpenUnum Qwen v1.0.0',
        files: '.'
      }, config);
      
      if (commitResult.success) {
        console.log('✅ Initial commit:', commitResult.hash);
      } else {
        console.warn('⚠️ Commit failed:', commitResult.error);
      }
    }
  } else {
    console.warn('⚠️ Git not initialized in this directory');
  }

  // GitHub remote setup
  if (config.githubRepo && config.githubToken) {
    console.log('\n🔗 Setting up GitHub remote...');
    const setupResult = await GitTool.setupRemote({
      repo: config.githubRepo,
      token: config.githubToken,
      branch: config.githubBranch
    }, config);
    
    if (setupResult.success) {
      console.log(`✅ Remote configured: ${config.githubRepo}`);
      console.log(`   Branch: ${config.githubBranch}`);
    } else {
      console.warn('⚠️ Remote setup failed:', setupResult.error);
      console.warn('   You can set it up manually later');
    }
  } else {
    console.log('\n⚠️ GitHub sync not configured');
    console.log('   Set GITHUB_REPO and GITHUB_TOKEN in .env to enable auto-sync');
  }

  console.log('\n✅ Initialization complete!');
  console.log('\nNext steps:');
  console.log('1. Edit .env with your model provider settings');
  console.log('2. Run: pnpm install');
  console.log('3. Run: pnpm start');
}

main().catch(e => {
  console.error('❌ Init failed:', e.message);
  process.exit(1);
});
