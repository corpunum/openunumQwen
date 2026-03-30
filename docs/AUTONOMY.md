# Autonomy Guide

## How OpenUnum Qwen Works Autonomously

### Task Flow

1. **Receive Task** — User sends a task via chat or API
2. **Plan** — Agent generates step-by-step plan via LLM
3. **Execute** — Run each step with tool calls
4. **Verify** — Check if task actually completed (proof-based)
5. **Self-Heal** — If errors, attempt recovery or failover
6. **Sync** — Auto-commit and push any code changes

### Planning

The agent asks the LLM to generate a JSON plan:

```json
[
  {"step": 1, "action": "Read existing code", "tool": "file_read"},
  {"step": 2, "action": "Identify issues", "tool": "none"},
  {"step": 3, "action": "Create fix", "tool": "file_write"},
  {"step": 4, "action": "Test the fix", "tool": "shell_exec"},
  {"step": 5, "action": "Commit changes", "tool": "git_commit"}
]
```

### Execution Rules

- **One tool at a time** — Sequential execution
- **Failure tracking** — 3 failures disables the tool
- **Repeat detection** — Same call 3 times = abort
- **Usage limits** — Max 8 calls per tool per task
- **Iteration budget** — Max 20 iterations per task

### Self-Healing

When a step fails:

1. **Check if provider-related** — Trigger failover to backup model
2. **Ask for alternative approach** — LLM suggests different method
3. **Skip and continue** — If recovery fails, skip the step
4. **Report status** — Always report what succeeded/failed

### Completion Verification

The agent doesn't trust vague phrases like "done" or "success".

Instead, it asks the LLM:
> "Has the task been FULLY completed? Provide concrete proof."

Expected response:
```json
{"completed": true, "proof": "File created at X, test passed, URL returns 200"}
```

### Git Auto-Sync

After any code change:

1. **Detect change** — `fs.watch` triggers on file modification
2. **Debounce** — Wait 2 seconds for batch of changes
3. **Add files** — `git add` changed files
4. **Commit** — Auto-message with timestamp
5. **Push** — `git push` to GitHub

**Ignored patterns:**
- `node_modules/`, `dist/`, `data/`, `logs/`, `cache/`
- `*.log`, `*.db`, `*.sqlite`, `bm25_*.json`

### Health Monitoring

Runs every 5 iterations and on startup:

| Check | Method | Thresholds |
|-------|--------|------------|
| Provider | HTTP GET `/models` | 5s timeout |
| Fallback | HTTP GET `/models` | 5s timeout |
| Database | File exists check | N/A |
| Disk | `df -h` parsing | >90% = critical |
| Browser | Playwright import | N/A |
| Git | `git remote get-url` | N/A |

**Status levels:**
- `healthy` — All checks pass
- `degraded` — Some checks warning, fallback available
- `unhealthy` — Critical failures, no fallback

### Circuit Breaker

Each tool has independent circuit breaker:

```
Normal (closed) → 3 failures → Open (5 min) → Half-open → Success → Closed
                                      ↑                    ↓
                                      └──── Failure ───────┘
```

**Configuration:**
- `CB_FAILURE_THRESHOLD=3` — Failures before opening
- `CB_RESET_TIMEOUT=300000` — ms before half-open (5 min)

### Memory

Memories are stored with BM25 indexing:

```javascript
// Store
await memory.store('lesson_001', 'Always check disk space before large operations');

// Search
const results = await memory.search('disk space operations');
// Returns: [{id: 'lesson_001', content: '...', score: 2.34}]
```

**Use cases:**
- Lessons learned from failures
- Configuration decisions
- User preferences
- Tool usage patterns

## Example: Autonomous Task

**Task:** "Create a new API endpoint for health checks"

**Plan generated:**
1. Read existing server code
2. Identify where to add endpoint
3. Create health check handler
4. Add route to server
5. Test the endpoint
6. Commit changes

**Execution:**
- Step 1: `file_read` → Success
- Step 2: Model reasoning → Success
- Step 3: `file_write` → Success
- Step 4: `file_write` (edit) → Success
- Step 5: `shell_exec` (curl test) → Success
- Step 6: `git_commit` + `git_push` → Success

**Verification:**
- LLM confirms: "Endpoint created at `/api/health`, returns 200 with status JSON"
- Task marked complete with proof

**Auto-Sync:**
- File changes detected
- Debounced commit: "auto: 2 file(s) updated at 2026-03-30T17:45:32"
- Pushed to GitHub

## Failure Scenarios

### Provider Down
1. Health check fails
2. Failover to backup model
3. Continue with backup
4. Alert user if both down

### Tool Fails 3 Times
1. Circuit breaker opens
2. Tool disabled for 5 min
3. Agent tries alternative approach
4. Reports limitation to user

### Disk Full
1. Health check detects >90% usage
2. Status = degraded
3. Agent warned, avoids large operations
4. User alerted via UI

### Git Push Fails
1. Commit succeeds
2. Push fails (network, auth)
2. Error logged
3. Retry on next change batch
4. User can run `pnpm sync` manually
