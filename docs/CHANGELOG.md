# Changelog

## Unreleased
- Changed default WebUI port to `18881` to avoid cross-project collision.
- Added dedicated runtime home defaults under `~/.openunum-qwen`.
- Added OpenRouter to provider validation and env template.
- Wired memory/bm25 paths through config for isolated persistence.
- Replaced stale tests with runnable smoke and WebUI chat E2E coverage.
- Added systemd service and installer script for deployment consistency.
