# API Reference

## Core Endpoints
- `GET /api/health`
- `GET /api/capabilities`
- `GET /api/model-catalog`
- `GET /api/models?provider=<provider>` (compat)
- `GET /api/config`
- `POST /api/config`
- `GET /api/events?prefix=<optional>&limit=<n>`
- `GET /api/missions`
- `POST /api/missions/start`
- `GET /api/missions/status?id=<missionId>`
- `POST /api/missions/stop`
- `GET /api/models`
- `GET /api/sessions`
- `POST /api/sessions`
- `GET /api/sessions/:id`
- `POST /api/chat`

## Realtime
- `WS /ws` for status, session, and tool event updates.

## Contracts
- Model catalog contract version: `2026-04-01.model-catalog.v1`
- Capabilities contract version: `2026-04-01.webui-capabilities.v1`
- Provider order: `ollama`, `nvidia`, `openrouter`, `openai`

## WebUI Contract
- `data-testid="new-session"`
- `data-testid="session-search"`
- `data-testid="message-stream"`
- `data-testid="composer-input"`
- `data-testid="send-message"`
- `data-testid="provider-select"`
- `data-testid="model-select"`
- `data-testid="fallback-model-select"`
- `data-testid="autonomy-mode-select"`
- `data-testid="provider-health"`
- `data-testid="trace-panel"`
- `data-testid="status-bar"`
