# Changelog

## Unreleased
- Changed default WebUI port to `18881` to avoid cross-project collision.
- Added dedicated runtime home defaults under `~/.openunum-qwen`.
- Added OpenRouter to provider validation and env template.
- Wired memory/bm25 paths through config for isolated persistence.
- Replaced stale tests with runnable smoke and WebUI chat E2E coverage.
- Added systemd service and installer script for deployment consistency.
- Added standardized docs set names: `INDEX.md`, `AGENT_ONBOARDING.md`, `CODEBASE_MAP.md`, `API_REFERENCE.md`, `AUTONOMY_AND_MEMORY.md`, `OPERATIONS_RUNBOOK.md`.
- Added canonical model catalog endpoint and ranking contract:
  - `GET /api/model-catalog`
  - provider order fixed to `ollama,nvidia,openrouter,openai`
- Added capability contract endpoint:
  - `GET /api/capabilities`
- Added mission and event API surfaces:
  - `GET /api/events`
  - `GET /api/missions`
  - `POST /api/missions/start`
  - `GET /api/missions/status`
  - `POST /api/missions/stop`
- Added compatibility adapter:
  - `GET /api/models?provider=...`
- Reworked WebUI into the shared shell layout with standardized provider/model routing, health, trace, and status bar selectors.
- Added new acceptance tests:
  - `tests/model-catalog.e2e.js`
  - `tests/webui-contract.e2e.js`
