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

function expectIncludes(html, marker) {
  if (!html.includes(marker)) throw new Error(`missing marker: ${marker}`);
}

async function main() {
  const child = spawn('node', ['src/index.js'], {
    cwd: process.cwd(),
    env: { ...process.env, UI_PORT: String(port), UI_HOST: '127.0.0.1', OPENUNUM_QWEN_HOME: '/tmp/openunum-qwen-webui-contract' },
    stdio: 'ignore',
  });

  try {
    await waitForServer();

    const pageRes = await fetch(`${base}/`);
    const html = await pageRes.text();
    expectIncludes(html, 'data-testid="new-session"');
    expectIncludes(html, 'data-testid="session-search"');
    expectIncludes(html, 'data-testid="message-stream"');
    expectIncludes(html, 'data-testid="composer-input"');
    expectIncludes(html, 'data-testid="send-message"');
    expectIncludes(html, 'data-testid="provider-select"');
    expectIncludes(html, 'data-testid="model-select"');
    expectIncludes(html, 'data-testid="fallback-model-select"');
    expectIncludes(html, 'data-testid="autonomy-mode-select"');
    expectIncludes(html, 'data-testid="provider-health"');
    expectIncludes(html, 'data-testid="trace-panel"');
    expectIncludes(html, 'data-testid="status-bar"');

    const createRes = await fetch(`${base}/api/sessions`, { method: 'POST' });
    const create = await createRes.json();
    const sessionId = create.session?.id;
    if (!sessionId) throw new Error('session not created');

    const chatRes = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, message: 'Reply with exactly: E2E_UI_OK' }),
    });
    const chat = await chatRes.json();
    if (!chat.reply && !chat.response) throw new Error('chat response missing');

    const eventsRes = await fetch(`${base}/api/events?limit=10`);
    const events = await eventsRes.json();
    if (!Array.isArray(events.events)) throw new Error('events payload missing');

    console.log('PASS webui-contract e2e');
  } finally {
    child.kill('SIGTERM');
  }
}

main().catch((e) => {
  console.error('FAIL webui-contract e2e', e.message);
  process.exit(1);
});
