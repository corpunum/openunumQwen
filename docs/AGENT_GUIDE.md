# 🤖 OpenUnum Qwen - Agent Guide

**Version:** 2.0.0 | **Last Updated:** 2026-03-31 | **Status:** Production Ready

---

## 📖 Quick Start for Agents

```bash
# Start the agent
cd /home/corp-unum/openunumQwen && pnpm start

# Access WebUI
http://127.0.0.1:18881

# Run tests
pnpm test

# Check health
curl http://127.0.0.1:18881/api/health
```

---

## 🎯 Core Capabilities

| Capability | Status | Description |
|------------|--------|-------------|
| **Full Shell Access** | ✅ | Execute any command with safety filters |
| **Web Browsing** | ✅ | Playwright-based navigation, screenshots, link extraction |
| **File Operations** | ✅ | Read, write, list, delete with workspace guards |
| **Git Operations** | ✅ | Status, commit, push, pull, auto-sync |
| **Memory System** | ✅ | BM25 semantic search + SQLite persistence |
| **Self-Healing** | ✅ | Circuit breakers, health checks, auto-failover |
| **Auto-Sync** | ✅ | Git commit + push on every code change |
| **Skill System** | ✅ | Install, review, execute skills safely |
| **Email (Gmail)** | 🔄 | Gmail CLI integration (pending setup) |
| **Research Agent** | 🔄 | Daily internet research (pending scheduler) |

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    OpenUnum Qwen v2.0                        │
├─────────────────────────────────────────────────────────────┤
│  WebUI (WebSocket + HTTP)                                   │
│  └── /api/chat, /api/health, /api/config, /api/memory       │
├─────────────────────────────────────────────────────────────┤
│  Agent Core                                                  │
│  ├── Planner (JSON step generation)                         │
│  ├── Executor (Tool orchestration)                          │
│  ├── Verifier (Completion proof)                            │
│  └── Recovery (Self-healing, failover)                      │
├─────────────────────────────────────────────────────────────┤
│  Tools Layer                                                 │
│  ├── browser.js (Playwright + curl fallback)                │
│  ├── shell.js (Safe exec with whitelist)                    │
│  ├── file.js (Workspace-guarded I/O)                        │
│  ├── git.js (Auto-stage, commit, push)                      │
│  ├── memory.js (BM25 + SQLite)                              │
│  ├── health.js (Real connectivity checks)                   │
│  └── skills.js (Skill loader + executor)                    │
├─────────────────────────────────────────────────────────────┤
│  Health & Resilience                                         │
│  ├── Circuit Breaker (Per-tool failure tracking)            │
│  ├── Auto-Sync (Git watcher + auto-commit)                  │
│  └── Failover (Cloud fallback on local failure)             │
└─────────────────────────────────────────────────────────────┘
```

---

## 📁 File Structure

```
openunumQwen/
├── src/
│   ├── core/
│   │   ├── config.js        # Config with schema validation
│   │   ├── agent.js         # Main agent loop
│   │   └── auto-sync.js     # Git auto-commit watcher
│   ├── tools/
│   │   ├── browser.js       # Web automation
│   │   ├── shell.js         # Command execution
│   │   ├── file.js          # File I/O
│   │   ├── git.js           # Git operations
│   │   ├── memory.js        # Memory storage/search
│   │   ├── health.js        # Health checks
│   │   ├── skills.js        # Skill system
│   │   └── email.js         # Gmail CLI (pending)
│   ├── health/
│   │   └── circuit-breaker.js
│   ├── memory/
│   │   └── memory.js        # BM25 + SQLite
│   └── ui/
│       ├── server.js        # API + WebSocket
│       └── public/
│           └── index.html   # WebUI
├── skills/                   # Installed skills (reviewed)
├── tests/
│   └── run.js               # Test runner
├── scripts/
│   ├── research-agent.js    # Daily research (pending)
│   └── git-sync.js
├── docs/                     # Documentation
├── data/                     # SQLite + BM25 (gitignored)
├── logs/                     # Logs (gitignored)
└── package.json
```

---

## 🔧 API Reference

### POST /api/chat
Execute a task via the agent.

```json
{
  "task": "Create a file and run tests"
}
```

### GET /api/health
System health status.

### GET/PUT /api/config
Configuration management.

### GET/POST /api/memory
Memory storage and search.

### GET /ws
WebSocket for real-time chat.

---

## 🧠 Memory System

**Storage:** SQLite + BM25 semantic index

**Operations:**
- `memory_store(text)` - Save with auto-indexing
- `memory_search(query, topK)` - Semantic + keyword search
- Auto-learns from successes/failures

**Location:** `/home/corp-unum/openunumQwen/data/memory.db`

---

## 🛡️ Safety & Security

| Protection | Implementation |
|------------|----------------|
| **Workspace Guards** | All file ops restricted to `/home/corp-unum/openunumQwen` |
| **Shell Whitelist** | Dangerous commands blocked (rm -rf /, etc.) |
| **Circuit Breakers** | Per-tool failure limits, auto-disable |
| **Skill Review** | Skills must be reviewed before installation |
| **Git Auto-Sync** | All code changes committed + pushed |

---

## 📊 Testing

```bash
# Run all tests
pnpm test

# Test output
✅ Config loads without errors
✅ Config validation works
✅ Circuit breaker opens after failures
✅ Circuit breaker enters half-open state
✅ BM25 indexes and searches correctly
✅ File tool blocks paths outside workspace
✅ Shell tool blocks dangerous commands
✅ Git status returns valid output

Results: 8 passed, 0 failed
```

---

## 🚀 Deployment Checklist

- [ ] Dependencies installed (`pnpm install`)
- [ ] `.env` configured (provider, model, GitHub token)
- [ ] Playwright browsers installed (`pnpm exec playwright install`)
- [ ] GitHub remote configured
- [ ] Health check passes
- [ ] Unit tests pass (8/8)
- [ ] E2E test completes successfully

---

## 📞 Contact & Support

**Repo:** https://github.com/corpunum/openunumQwen  
**Owner:** Antonis (+306936643331)  
**Philosophy:** Own the hardware, serve the owner, maximum autonomy
