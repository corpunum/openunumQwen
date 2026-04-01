import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { loadConfig, updateConfig, saveConfig } from '../core/config.js';
import { buildModelCatalog, buildLegacyProviderModels, normalizeProviderId, PROVIDER_ORDER } from '../core/model-catalog.js';
import { getCapabilities } from '../core/capabilities.js';
import { MissionRunner } from '../core/missions.js';
import { UIEventBus } from '../core/ui-events.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

function getContentType(path) {
  const ext = extname(path).toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
  };
  return types[ext] || 'text/plain; charset=utf-8';
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
  });
  res.end(JSON.stringify(payload));
}

function normalizeModelForProvider(provider, model) {
  const p = normalizeProviderId(provider);
  const raw = String(model || '').trim();
  if (!raw) return '';
  if (/^(ollama|nvidia|openrouter|openai|generic)\//.test(raw)) return raw.replace(/^generic\//, 'openai/');
  return `${p}/${raw}`;
}

function providerFieldMap(provider) {
  if (provider === 'ollama') return { baseUrl: 'ollamaBaseUrl', apiKey: 'ollamaApiKey' };
  if (provider === 'nvidia') return { baseUrl: 'nvidiaBaseUrl', apiKey: 'nvidiaApiKey' };
  if (provider === 'openrouter') return { baseUrl: 'openrouterBaseUrl', apiKey: 'openrouterApiKey' };
  return { baseUrl: 'openaiBaseUrl', apiKey: 'openaiApiKey' };
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

export async function startServer(agent, config) {
  const eventBus = new UIEventBus(400);
  const missions = new MissionRunner({ agent, eventBus });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname.startsWith('/api/')) {
      try {
        if (url.pathname === '/api/health' && req.method === 'GET') {
          return sendJson(res, 200, {
            status: 'ok',
            app: 'openunumQwen',
            host: config.uiHost,
            port: config.uiPort,
            provider: agent.currentProvider,
            model: agent.currentModel,
            healthy: agent.providerHealthy,
            provider_order: [...PROVIDER_ORDER],
            runtime: {
              autonomy_mode: config.autonomyMode || 'autonomy-first',
              workspace_root: config.workspaceRoot,
              sessions_dir: config.sessionsDir,
            },
            timestamp: new Date().toISOString(),
          });
        }

        if (url.pathname === '/api/capabilities' && req.method === 'GET') {
          return sendJson(res, 200, getCapabilities({
            host: config.uiHost,
            port: config.uiPort,
            home: config.appHome,
            workspaceRoot: config.workspaceRoot,
          }));
        }

        if (url.pathname === '/api/model-catalog' && req.method === 'GET') {
          const catalog = await buildModelCatalog(config);
          return sendJson(res, 200, catalog);
        }

        if (url.pathname === '/api/models' && req.method === 'GET') {
          const provider = normalizeProviderId(url.searchParams.get('provider') || config.provider);
          const models = await buildLegacyProviderModels(config, provider);
          return sendJson(res, 200, { provider, models });
        }

        if (url.pathname === '/api/config' && req.method === 'GET') {
          const live = loadConfig();
          const catalog = await buildModelCatalog(live);
          return sendJson(res, 200, {
            app_id: 'openunum-qwen',
            providerConfig: {
              provider: live.provider,
              model: live.model,
              fallbackProvider: live.fallbackProvider,
              fallbackModel: live.fallbackModel,
              providerModels: live.providerModels,
              fallbackOrder: live.fallbackOrder,
              autonomyMode: live.autonomyMode || 'autonomy-first',
            },
            modelCatalog: catalog,
            capabilities: getCapabilities({ host: live.uiHost, port: live.uiPort, home: live.appHome, workspaceRoot: live.workspaceRoot }),
          });
        }

        if (url.pathname === '/api/config' && (req.method === 'POST' || req.method === 'PUT')) {
          const body = await readRequestBody(req);
          const live = loadConfig();
          const provider = normalizeProviderId(body?.providerConfig?.provider || live.provider);
          const model = normalizeModelForProvider(provider, body?.providerConfig?.model || live.model);
          const fallbackModelRaw = String(body?.providerConfig?.fallbackModel || live.fallbackModel || '').trim();
          const fallbackProvider = normalizeProviderId(body?.providerConfig?.fallbackProvider || fallbackModelRaw.split('/')[0] || live.fallbackProvider || 'nvidia');
          const fallbackModel = normalizeModelForProvider(fallbackProvider, fallbackModelRaw || live.providerModels?.[fallbackProvider]);

          const providerModels = { ...(live.providerModels || {}), ...(body?.providerConfig?.providerModels || {}) };
          providerModels[provider] = model;
          providerModels[fallbackProvider] = fallbackModel;

          const baseField = providerFieldMap(provider);
          const fallbackBaseField = providerFieldMap(fallbackProvider);

          const next = updateConfig({
            provider,
            model,
            fallbackProvider,
            fallbackModel,
            fallbackOrder: [...PROVIDER_ORDER],
            providerModels,
            baseUrl: live[baseField.baseUrl] || live.baseUrl,
            apiKey: live[baseField.apiKey] || live.apiKey,
            fallbackBaseUrl: live[fallbackBaseField.baseUrl] || live.fallbackBaseUrl,
            autonomyMode: String(body?.providerConfig?.autonomyMode || live.autonomyMode || 'autonomy-first'),
          });
          saveConfig(next);

          agent.config = next;
          agent.currentProvider = next.provider;
          agent.currentModel = next.model;
          agent.currentBaseUrl = next.baseUrl;
          await agent.runHealthCheck();
          eventBus.push('health.updated', { provider: next.provider, model: next.model, healthy: agent.providerHealthy });

          return sendJson(res, 200, {
            ok: true,
            providerConfig: {
              provider: next.provider,
              model: next.model,
              fallbackProvider: next.fallbackProvider,
              fallbackModel: next.fallbackModel,
              providerModels: next.providerModels,
              fallbackOrder: next.fallbackOrder,
              autonomyMode: next.autonomyMode || 'autonomy-first',
            },
          });
        }

        if (url.pathname === '/api/events' && req.method === 'GET') {
          const prefix = String(url.searchParams.get('prefix') || '').trim();
          const limit = Number(url.searchParams.get('limit') || 120);
          return sendJson(res, 200, { events: eventBus.list(prefix, limit) });
        }

        if (url.pathname === '/api/missions' && req.method === 'GET') {
          return sendJson(res, 200, { missions: missions.list() });
        }

        if (url.pathname === '/api/missions/start' && req.method === 'POST') {
          const body = await readRequestBody(req);
          const out = missions.start({
            goal: String(body?.goal || '').trim(),
            maxSteps: Number(body?.maxSteps || 1),
            continueUntilDone: body?.continueUntilDone !== false,
            intervalMs: Number(body?.intervalMs || 0),
          });
          return sendJson(res, 200, out);
        }

        if (url.pathname === '/api/missions/status' && req.method === 'GET') {
          const id = String(url.searchParams.get('id') || '').trim();
          const mission = missions.get(id);
          return sendJson(res, mission ? 200 : 404, mission ? { ok: true, mission } : { ok: false, error: 'mission_not_found' });
        }

        if (url.pathname === '/api/missions/stop' && req.method === 'POST') {
          const body = await readRequestBody(req);
          const out = missions.stop(String(body?.id || '').trim());
          return sendJson(res, out.ok ? 200 : 404, out);
        }

        if (url.pathname === '/api/sessions' && req.method === 'GET') {
          return sendJson(res, 200, { sessions: agent.listSessions(100) });
        }

        if (url.pathname === '/api/sessions' && req.method === 'POST') {
          const session = agent.createSession();
          eventBus.push('session.updated', { sessionId: session.id, action: 'create' });
          return sendJson(res, 200, { session });
        }

        if (url.pathname.match(/^\/api\/sessions\/[^/]+$/) && req.method === 'GET') {
          const id = url.pathname.split('/').pop();
          return sendJson(res, 200, { session: agent.loadSession(id) });
        }

        if (url.pathname.match(/^\/api\/sessions\/[^/]+$/) && req.method === 'DELETE') {
          const id = url.pathname.split('/').pop();
          const deleted = agent.deleteSession(id);
          eventBus.push('session.updated', { sessionId: id, action: 'delete', deleted });
          return sendJson(res, 200, { deleted });
        }

        if (url.pathname === '/api/chat' && req.method === 'POST') {
          const body = await readRequestBody(req);
          const task = String(body?.message || body?.task || '').trim();
          if (!task) return sendJson(res, 400, { ok: false, error: 'message_or_task_required' });

          if (body?.sessionId) {
            try { agent.loadSession(String(body.sessionId)); } catch {}
          }

          eventBus.push('chat.started', { sessionId: agent.getCurrentSession()?.id || null, provider: agent.currentProvider, model: agent.currentModel });
          try {
            const out = await agent.run(task);
            const reply = String(out.answer || out.response || '').trim() || 'Task processed.';
            eventBus.push('chat.completed', {
              sessionId: agent.getCurrentSession()?.id || null,
              provider: agent.currentProvider,
              model: agent.currentModel,
              response_chars: reply.length,
              actions: Array.isArray(out.results) ? out.results.length : 0,
            });
            return sendJson(res, 200, {
              sessionId: agent.getCurrentSession()?.id || null,
              answer: reply,
              response: reply,
              reply,
              actions: out.results || [],
              provider: agent.currentProvider,
              model: agent.currentModel,
              completed: Boolean(out.completed),
              proof: out.proof || '',
            });
          } catch (error) {
            const reply = `Provider execution failed: ${String(error.message || error)}`;
            eventBus.push('chat.error', { sessionId: agent.getCurrentSession()?.id || null, error: String(error.message || error) });
            return sendJson(res, 200, {
              sessionId: agent.getCurrentSession()?.id || null,
              answer: reply,
              response: reply,
              reply,
              actions: [],
              provider: agent.currentProvider,
              model: agent.currentModel,
              completed: false,
              proof: 'error',
            });
          }
        }

        return sendJson(res, 404, { error: 'Unknown API route' });
      } catch (e) {
        return sendJson(res, 500, { error: String(e.message || e) });
      }
    }

    const filePath = join(ROOT, 'ui', 'public', url.pathname === '/' ? 'index.html' : url.pathname);
    if (!existsSync(filePath)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    try {
      const content = readFileSync(filePath);
      res.writeHead(200, {
        'Content-Type': getContentType(filePath),
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      });
      res.end(content);
    } catch {
      res.writeHead(500);
      res.end('Error reading file');
    }
  });

  const wss = new WebSocketServer({ server, path: '/ws' });

  function broadcast(payload) {
    const text = JSON.stringify(payload);
    for (const ws of wss.clients) {
      if (ws.readyState === ws.OPEN) ws.send(text);
    }
  }

  eventBus.on('event', (event) => broadcast({ type: 'event', event }));

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'hello', app: 'openunumQwen', ts: new Date().toISOString() }));
    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(String(data || '{}'));
        if (msg.type === 'chat') {
          const out = await agent.run(String(msg.message || msg.task || ''));
          const reply = String(out.answer || out.response || '');
          ws.send(JSON.stringify({
            type: 'response',
            sessionId: agent.getCurrentSession()?.id || null,
            response: reply,
            answer: reply,
            actions: out.results || [],
            provider: agent.currentProvider,
            model: agent.currentModel,
          }));
        }
      } catch (e) {
        ws.send(JSON.stringify({ type: 'error', error: String(e.message || e) }));
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.listen(config.uiPort, config.uiHost, (err) => {
      if (err) reject(err);
      else resolve({
        close: () => {
          wss.close();
          return new Promise((r) => server.close(r));
        },
      });
    });
  });
}
