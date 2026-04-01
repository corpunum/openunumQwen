# OpenUnum Qwen ⚡

**The Ultimate Autonomous Assistant**

A lightweight, self-healing, autonomous AI agent that owns its hardware and software, listens to you, and completes tasks without halting.

## Core Principles

1. **Autonomous** — Self-planning, self-executing, self-healing
2. **Light** — Minimal dependencies, efficient resource usage
3. **Powerful** — Full tool calling, web browsing, planning, execution
4. **Self-Syncing** — Git/GitHub sync on every change
5. **Reliable** — Real health checks, circuit breakers, recovery paths

## Architecture

```
openunumQwen/
├── src/
│   ├── core/           # Agent core, planning, execution
│   ├── tools/          # Tool implementations (browser, shell, etc.)
│   ├── config/         # Configuration management
│   ├── memory/         # Persistent memory & learning
│   ├── health/         # Health monitoring & self-healing
│   └── ui/             # Web UI (optional, lightweight)
├── tests/              # Test suite
├── docs/               # Documentation
├── scripts/            # Utility scripts
└── package.json
```

## Quick Start

```bash
# Install
pnpm install

# Configure
cp .env.example .env
# Edit .env with your model provider details

# Run
pnpm start
```

Web UI default: `http://127.0.0.1:18881`

## Runtime Isolation

- App home: `~/.openunum-qwen` (override with `OPENUNUM_QWEN_HOME`)
- Config: `~/.openunum-qwen/config.json`
- Memory DB: `~/.openunum-qwen/data/memory.db`
- BM25 index: `~/.openunum-qwen/data/bm25_index.json`
- Logs: `~/.openunum-qwen/logs`

## Model Support

- **Local:** Ollama (Qwen 3.5 9B, etc.)
- **Cloud:** OpenAI, OpenRouter, Anthropic, NVIDIA NIM, Ollama Cloud

## Features

- ✅ Tool calling with automatic retry & fallback
- ✅ Autonomous planning with proof-of-work completion
- ✅ Web browsing via Playwright or CDP
- ✅ Self-healing with real connectivity checks
- ✅ Git sync on every code change
- ✅ Circuit breaker for fault tolerance
- ✅ Persistent memory with BM25 retrieval
- ✅ Lightweight (~5 core dependencies)

## Status

🟢 **Active Development** — Baseline autonomous + WebUI capabilities are implemented and continuously hardened.

---

*Built with lessons from OpenUnum & OpenUnumGeminiVersion*
