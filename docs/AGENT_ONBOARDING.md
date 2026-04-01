# Agent Onboarding

openunumQwen is an autonomy-first coding assistant.

## Quick Start
1. `cp .env.example .env`
2. `npm install`
3. `npm start`
4. Open WebUI on configured host/port.

## Validation
- `npm test`
- `npm run e2e:webui`

## Runtime Isolation
- Runtime home defaults to `~/.openunum-qwen`.
- Persistent memory, sessions, and operational state live in runtime home, not repository source directories.
