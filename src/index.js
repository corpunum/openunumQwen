/**
 * OpenUnum Qwen - Main Entry Point
 * Autonomous agent with WebUI, self-healing, and git sync
 */

import { loadConfig, getConfig, ensureDirectories } from './core/config.js';
import { Agent } from './core/agent.js';
import { startServer } from './ui/server.js';
import { AutoSync } from './core/auto-sync.js';

console.log(`
⚡ OpenUnum Qwen v1.0.0
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The Ultimate Autonomous Assistant
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

async function main() {
  // Ensure all required directories exist
  ensureDirectories();

  // Load and validate configuration
  const config = loadConfig();
  console.log('[Init] Configuration loaded');
  console.log('  Provider:', config.provider);
  console.log('  Model:', config.model);
  console.log('  UI Port:', config.uiPort);
  console.log('  GitHub Sync:', config.githubRepo ? `✅ ${config.githubRepo}` : '❌ Not configured');

  // Initialize agent
  const agent = new Agent();
  await agent.initialize();
  console.log('[Init] Agent initialized');

  // Initialize auto-sync if configured
  let autoSync = null;
  if (config.githubRepo && config.githubToken) {
    autoSync = new AutoSync(config);
    await autoSync.initialize();
    console.log('[Init] Auto-sync enabled');
  }

  // Start WebUI server
  const server = await startServer(agent, config);
  console.log(`[Init] WebUI running at http://${config.uiHost}:${config.uiPort}`);

  // Handle graceful shutdown
  const shutdown = async (signal) => {
    console.log(`\n[Shutdown] Received ${signal}, cleaning up...`);
    await agent.memory.close();
    await server.close();
    if (autoSync) {
      await autoSync.stop();
    }
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Run startup health check
  console.log('\n[Init] Running startup health check...');
  const health = await agent.runHealthCheck();
  console.log('[Init] Provider status:', health ? '✅ Healthy' : '⚠️ Degraded');

  console.log('\n✅ OpenUnum Qwen is ready!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main().catch(e => {
  console.error('[Fatal] Startup failed:', e);
  process.exit(1);
});
