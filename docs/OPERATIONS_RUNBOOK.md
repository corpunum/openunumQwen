# Operations Runbook

## Start
- `npm install`
- `npm start`

Default bind: `127.0.0.1:18881`

## Verify
- `npm test`
- `npm run e2e`
- `npm run health`

## Service
Use the repository deploy assets/scripts to install and manage user-level systemd services where configured.

## Health Checks
- `curl -sS http://127.0.0.1:18881/api/health`
- `curl -sS http://127.0.0.1:18881/api/model-catalog`
- `curl -sS http://127.0.0.1:18881/api/capabilities`
