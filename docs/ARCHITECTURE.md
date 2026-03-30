# OpenUnum Qwen Architecture

## Overview

OpenUnum Qwen is a lightweight, autonomous AI assistant designed to be self-healing, self-syncing, and powerful while remaining simple.

## Core Principles

1. **Local-First** — Use local models (Ollama/Qwen) by default, cloud as fallback
2. **Self-Healing** — Real health checks, circuit breakers, automatic failover
3. **Autonomous** — Plan, execute, verify completion without hand-holding
4. **Self-Syncing** — Git commit + push on every code change
5. **Minimal** — ~5 core dependencies, no bloat

## Directory Structure

```
openunumQwen/
├── src/
│   ├── core/
│   │   ├── config.js        # Configuration management (schema-validated)
│   │   ├── agent.js         # Main agent: planning, execution, tool calling
│   │   └── auto-sync.js     # Git watcher, auto-commit/push
│   ├── tools/
│   │   ├── browser.js       # Playwright + curl fallback
│   │   ├── shell.js         # Safe shell execution
│   │   ├── file.js          # File operations with workspace guards
│   │   ├── git.js           # Git commands wrapper
│   │   ├── memory.js        # Memory tool (BM25 + SQLite)
│   │   └── health.js        # Real health checks
│   ├── health/
│   │   └── circuit-breaker.js  # Fault tolerance
│   ├── memory/
│   │   └── memory.js        # BM25 indexing + SQLite storage
│   └── ui/
│       ├── server.js        # WebSocket + HTTP server
│       └── public/
│           └── index.html   # Single-page WebUI
├── tests/
│   └── run.js               # Simple test runner
├── scripts/
│   ├── init.js              # Initialization
│   ├── git-sync.js          # Manual sync
│   └── health-check.js      # Manual health check
├── docs/                    # Documentation
├── data/                    # SQLite DB, BM25 index (gitignored)
├── logs/                    # Log files (gitignored)
└── package.json
```

## Component Details

### Agent (`src/core/agent.js`)

The brain of the system:
- **Planning** — Generates step-by-step execution plans via LLM
- **Execution** — Runs tools one at a time with failure tracking
- **Tool Calling** — Supports browser, shell, file, git, memory, health tools
- **Self-Healing** — Checks health periodically, triggers failover on errors
- **Completion Verification** — Uses LLM to verify task actually completed (not just "done" text)

**Key Fixes from Previous Repos:**
- No `require()` in ESM files (proper imports only)
- No context bloat (truncates history, doesn't inject 2000 chars per skill)
- Real completion detection (proof-based, not phrase matching)
- No state mutation in config

### Circuit Breaker (`src/health/circuit-breaker.js`)

Fault tolerance for tools:
- **Closed** — Normal operation
- **Open** — After 3 failures, blocks execution for 5 min
- **Half-Open** — After timeout, allows one test call

**Key Fixes:**
- "Critical" state actually implemented (was missing before)
- Auto-recovery path works (half-open → success → closed)

### Memory (`src/memory/memory.js`)

Persistent memory with semantic search:
- **SQLite** — Stores memories with metadata
- **BM25** — Full-text search indexing
- **Not just key-value** — Real retrieval scoring

### Auto-Sync (`src/core/auto-sync.js`)

Git/GitHub sync on every change:
- Watches workspace with `fs.watch`
- Debounces commits (2s after last change)
- Auto-commits with timestamp message
- Auto-pushes to GitHub

**Key Fixes:**
- Ignores node_modules, data, logs, etc.
- Handles "nothing to commit" gracefully

### Tools

All tools follow the same pattern:
- Proper ESM imports
- Error handling with structured returns
- Safety checks (workspace guards, blocked commands)

| Tool | Purpose | Safety |
|------|---------|--------|
| `browser_navigate` | Open URL in headless browser | Timeout, curl fallback |
| `browser_screenshot` | Capture page screenshot | Requires navigate first |
| `shell_exec` | Run shell commands | Blocks dangerous patterns |
| `file_read/write` | File operations | Workspace path validation |
| `git_*` | Git operations | Token-based auth |
| `memory_*` | Memory storage/search | SQLite + BM25 |
| `health_check` | System health | Real HTTP checks |

## Configuration

See `.env.example`:

```bash
PROVIDER=ollama
MODEL=qwen3.5:9b-64k
BASE_URL=http://127.0.0.1:11434/v1
FALLBACK_MODEL=minimax-m2.5:cloud
GITHUB_REPO=corpunum/openunumQwen
GITHUB_TOKEN=ghp_xxx
```

## WebUI

Single-page app with:
- **Chat** — WebSocket-based real-time chat
- **Config** — View/edit configuration
- **Health** — Live system health dashboard
- **Memory** — Search stored memories
- **Auto-Sync** — View sync status

## Lessons Applied

### From OpenUnum (node/server.mjs issues):
- ✅ No duplicate route handlers
- ✅ Proper ESM imports (no `require()` in ESM)
- ✅ Modular architecture (not monolithic)
- ✅ Real health checks (not metadata-only)
- ✅ Directory creation before use

### From OpenUnumGeminiVersion (agent.ts/autonomy.ts issues):
- ✅ No browser globals in server code (`navigator.onLine`)
- ✅ Health check logic bug fixed (no `|| true` bypass)
- ✅ "Critical" state actually reachable
- ✅ Completion detection is proof-based, not phrase matching
- ✅ Tool failure tracking with real limits

## Running

```bash
# Install
pnpm install

# Initialize
pnpm init

# Start
pnpm start

# Health check
pnpm health

# Manual sync
pnpm sync
```

## Testing

```bash
pnpm test
```

Tests cover:
- Config loading/validation
- Circuit breaker state transitions
- BM25 indexing/search
- File path safety
- Shell command blocking
- Git operations
