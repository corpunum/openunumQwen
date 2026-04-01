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
    env: { ...process.env, UI_PORT: String(port), OPENUNUM_QWEN_HOME: '/tmp/openunum-qwen-e2e' },
    stdio: 'ignore',
  });

  try {
    await waitForServer();

    const chatRes = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: 'Reply with exactly E2E_OK' }),
    });
    const chatJson = await chatRes.json();

    if (!chatJson || (!chatJson.answer && !chatJson.response)) {
      throw new Error('missing chat payload from /api/chat');
    }

    console.log('PASS webui chat e2e');
  } finally {
    child.kill('SIGTERM');
  }
}

main().catch((e) => {
  console.error('FAIL webui chat e2e', e.message);
  process.exit(1);
});
