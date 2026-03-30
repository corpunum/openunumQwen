#!/usr/bin/env node
/**
 * Health Check Script
 * Usage: pnpm health
 */

import { HealthTool } from '../src/tools/health.js';
import { loadConfig } from '../src/core/config.js';

async function main() {
  console.log('🏥 Running health check...\n');
  
  const config = loadConfig();
  const health = await HealthTool.check({}, config);

  const statusIcon = {
    healthy: '✅',
    degraded: '⚠️',
    unhealthy: '❌',
    critical: '🔴',
    warning: '⚠️',
    unknown: '❓'
  };

  console.log(`Overall Status: ${statusIcon[health.overall] || '❓'} ${health.overall.toUpperCase()}\n`);

  for (const [check, details] of Object.entries(health.checks)) {
    const icon = statusIcon[details.status] || '❓';
    console.log(`${icon} ${check.toUpperCase()}`);
    console.log(`   Status: ${details.status}`);
    if (details.model) console.log(`   Model: ${details.model}`);
    if (details.error) console.log(`   Error: ${details.error}`);
    if (details.percent !== undefined) console.log(`   Disk: ${details.percent}% used`);
    if (details.branch) console.log(`   Branch: ${details.branch}`);
    console.log('');
  }

  if (health.overall === 'unhealthy') {
    console.log('🔴 System is unhealthy. Take action!');
    process.exit(1);
  } else if (health.overall === 'degraded') {
    console.log('⚠️ System is degraded. Consider maintenance.');
  } else {
    console.log('✅ All systems operational');
  }
}

main().catch(e => {
  console.error('❌ Health check failed:', e.message);
  process.exit(1);
});
