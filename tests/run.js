import { loadConfig, ensureDirectories } from '../src/core/config.js';
import { Agent } from '../src/core/agent.js';

async function main() {
  ensureDirectories();
  const config = loadConfig();

  if (config.uiPort !== 18881) {
    throw new Error(`Expected default uiPort 18881, got ${config.uiPort}`);
  }
  if (!String(config.appHome || '').includes('.openunum-qwen')) {
    throw new Error('appHome is not isolated to .openunum-qwen');
  }

  const agent = new Agent();
  await agent.initialize();
  const healthOk = await agent.runHealthCheck();

  console.log('config.appHome:', config.appHome);
  console.log('config.provider:', config.provider);
  console.log('health:', healthOk === false ? 'degraded' : 'ok');
  agent.memory.close();
  console.log('PASS');
}

main().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
