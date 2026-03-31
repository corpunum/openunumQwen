/**
 * Lightweight WebUI Server
 * Fixes: No monolithic file, proper ESM, clean separation
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

function getContentType(path) {
  const ext = extname(path).toLowerCase();
  const types = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml'
  };
  return types[ext] || 'text/plain';
}

export async function startServer(agent, config) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    
    // API routes
    if (url.pathname.startsWith('/api/')) {
      try {
        const result = await handleApiRequest(url, req, agent, config);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // Static files
    let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
    filePath = join(ROOT, 'ui', 'public', filePath);

    if (!existsSync(filePath)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    try {
      const content = readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': getContentType(filePath) });
      res.end(content);
    } catch (e) {
      res.writeHead(500);
      res.end('Error reading file');
    }
  });

  // WebSocket for real-time chat
  const wss = new WebSocketServer({ server, path: '/ws' });
  
  wss.on('connection', (ws) => {
    console.log('[WS] Client connected');
    
    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data);
        console.log('[WS] Message:', message.type, message);
        
        if (message.type === 'chat') {
          // Support both 'task' and 'message' fields
          const task = message.task || message.message;
          
          if (!task) {
            ws.send(JSON.stringify({
              type: 'error',
              error: 'No task provided. Please send { type: "chat", task: "your task" }'
            }));
            return;
          }
          
          // Handle /new command
          if (task === '/new' || task === '/reset' || task === '/clear') {
            agent.clearHistory();
            ws.send(JSON.stringify({
              type: 'result',
              result: {
                answer: 'Chat cleared! Start fresh with a new task.',
                completed: true,
                proof: 'Reset command executed',
                results: []
              }
            }));
            return;
          }
          
          ws.send(JSON.stringify({ type: 'status', text: 'Thinking...' }));
          console.log('[WS] Running task:', task);
          
          const result = await agent.run(task, { stream: true });
          console.log('[WS] Result:', result.completed ? 'completed' : 'incomplete', result.answer ? 'has answer' : 'no answer');
          
          ws.send(JSON.stringify({
            type: 'result',
            result
          }));
        } else if (message.type === 'health') {
          const health = await agent.runHealthCheck();
          ws.send(JSON.stringify({ type: 'health', status: health }));
        }
      } catch (e) {
        console.error('[WS] Error:', e.message);
        ws.send(JSON.stringify({ type: 'error', error: e.message }));
      }
    });

    ws.on('close', () => {
      console.log('[WS] Client disconnected');
    });
  });

  return new Promise((resolve, reject) => {
    server.listen(config.uiPort, config.uiHost, (err) => {
      if (err) reject(err);
      else resolve({
        close: () => {
          wss.close();
          return new Promise(r => server.close(r));
        }
      });
    });
  });
}

async function handleApiRequest(url, req, agent, config) {
  const pathname = url.pathname;
  const method = req.method;

  if (pathname === '/api/chat' && method === 'POST') {
    const body = await readRequestBody(req);
    // Support both 'task' and 'message' fields for compatibility
    const task = body.task || body.message;
    
    // Handle /new command server-side
    if (task === '/new' || task === '/reset' || task === '/clear') {
      return {
        answer: 'Chat cleared! Start fresh with a new task.',
        completed: true,
        proof: 'Reset command executed',
        results: []
      };
    }
    
    if (!task) {
      return {
        answer: 'Please provide a task or message to execute.',
        completed: false,
        proof: 'No task provided',
        results: []
      };
    }
    
    const result = await agent.run(task);
    return result;
  }

  if (pathname === '/api/health' && method === 'GET') {
    const { HealthTool } = await import('../tools/health.js');
    return await HealthTool.check({}, config);
  }

  if (pathname === '/api/config' && method === 'GET') {
    const { loadConfig } = await import('../core/config.js');
    return await loadConfig();
  }

  if (pathname === '/api/config' && method === 'PUT') {
    const body = await readRequestBody(req);
    const { updateConfig } = await import('../core/config.js');
    return await updateConfig(body);
  }

  if (pathname === '/api/memory' && method === 'POST') {
    const body = await readRequestBody(req);
    const { MemoryTool } = await import('../tools/memory.js');
    return await MemoryTool.store(body);
  }

  if (pathname === '/api/memory' && method === 'GET') {
    const query = url.searchParams.get('q');
    const { MemoryTool } = await import('../tools/memory.js');
    return await MemoryTool.search({ query: query || '', topK: 10 });
  }

  if (pathname === '/api/git-status' && method === 'GET') {
    const { GitTool } = await import('../tools/git.js');
    const status = await GitTool.status();
    const log = await GitTool.log({ limit: 5 });
    return {
      branch: status.branch,
      ahead: status.ahead || 0,
      behind: status.behind || 0,
      modified: status.modified?.length || 0,
      staged: status.staged?.length || 0,
      untracked: status.untracked?.length || 0,
      recentCommits: log?.commits || []
    };
  }

  if (pathname === '/api/git-sync' && method === 'POST') {
    const { GitTool } = await import('../tools/git.js');
    const status = await GitTool.status();
    let message = 'No changes';
    if (status.modified?.length || status.untracked?.length || status.staged?.length) {
      await GitTool.add();
      await GitTool.commit('auto: UI sync');
      message = 'Committed';
    }
    const pushResult = await GitTool.push();
    return { success: true, message: `${message}, ${pushResult.output || 'pushed'}` };
  }

  if (pathname === '/api/context-stats' && method === 'GET') {
    return agent.getContextStats();
  }

  if (pathname === '/api/chat/clear' && method === 'POST') {
    return agent.clearHistory();
  }

  // Session management endpoints
  if (pathname === '/api/sessions' && method === 'GET') {
    const limit = parseInt(url.searchParams.get('limit') || '50');
    return agent.listSessions(limit);
  }

  if (pathname === '/api/sessions' && method === 'POST') {
    return agent.createSession();
  }

  if (pathname.startsWith('/api/sessions/') && method === 'GET') {
    const parts = pathname.split('/');
    const id = parts[3];
    if (id === 'current') {
      return agent.getCurrentSession();
    }
    if (id === 'count') {
      return { count: agent.getSessionCount() };
    }
    return agent.loadSession(id);
  }

  if (pathname.startsWith('/api/sessions/') && method === 'DELETE') {
    const id = pathname.split('/')[3];
    return agent.deleteSession(id);
  }

  if (pathname.startsWith('/api/sessions/') && pathname.endsWith('/load') && method === 'POST') {
    const id = pathname.split('/')[3];
    const session = agent.loadSession(id);
    return { session, messages: agent.sessionHistory };
  }

  throw new Error('Unknown API route');
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}
