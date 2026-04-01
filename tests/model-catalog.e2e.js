import { spawn } from 'child_process';

const port = Number(process.env.TEST_PORT || 18881);
const base = `http://127.0.0.1:${port}`;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitForServer(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) return;
    } catch {}
    await sleep(500);
  }
  throw new Error('server did not start');
}

async function main() {
  const child = spawn('node', ['src/index.js'], {
    cwd: process.cwd(),
    env: { ...process.env, UI_PORT: String(port), UI_HOST: '127.0.0.1', OPENUNUM_QWEN_HOME: '/tmp/openunum-qwen-model-catalog' },
    stdio: 'ignore',
  });

  try {
    await waitForServer();

    const healthRes = await fetch(`${base}/api/health`);
    const health = await healthRes.json();
    if (health.host !== '127.0.0.1') throw new Error('health host mismatch');

    const capsRes = await fetch(`${base}/api/capabilities`);
    const caps = await capsRes.json();
    if ((caps.menu || []).join(',') !== 'chat,missions,trace,runtime,settings') throw new Error('capability menu mismatch');

    const catRes = await fetch(`${base}/api/model-catalog`);
    const cat = await catRes.json();

    const expected = ['ollama', 'nvidia', 'openrouter', 'openai'];
    if ((cat.provider_order || []).join(',') !== expected.join(',')) throw new Error('provider order mismatch');
    if (!Array.isArray(cat.providers) || cat.providers.length !== 4) throw new Error('providers length mismatch');

    for (const provider of cat.providers) {
      let prev = Number.POSITIVE_INFINITY;
      for (let i = 0; i < provider.models.length; i += 1) {
        const model = provider.models[i];
        if (model.rank !== i + 1) throw new Error(`rank mismatch ${provider.provider}`);
        if (model.capability_score > prev) throw new Error(`score ordering mismatch ${provider.provider}`);
        prev = model.capability_score;
      }
    }

    const cfgRes = await fetch(`${base}/api/config`);
    const cfg = await cfgRes.json();
    if (!cfg.providerConfig?.provider) throw new Error('missing providerConfig');

    console.log('PASS model-catalog e2e');
  } finally {
    child.kill('SIGTERM');
  }
}

main().catch((e) => {
  console.error('FAIL model-catalog e2e', e.message);
  process.exit(1);
});
