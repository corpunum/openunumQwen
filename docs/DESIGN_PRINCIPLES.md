# 🎯 Design Principles - OpenUnum Qwen

**Philosophy:** Own the hardware. Serve the owner. Maximum autonomy.

---

## 1️⃣ Hardware Ownership & Full Permissions

**Principle:** The agent owns the machine it runs on. No sandboxing, no artificial limits.

### Implementation
- **Direct Shell Access:** `shell_exec()` runs commands as the user with full permissions
- **File System Access:** Full read/write within workspace, guarded only against external paths
- **No Permission Prompts:** Agent acts on owner's behalf without asking (owner sets boundaries via config)
- **Self-Modification:** Agent can modify its own code, configs, and tools

### Safety Model
```
┌─────────────────────────────────────────────────────────┐
│                   OWNER TRUST MODEL                      │
├─────────────────────────────────────────────────────────┤
│  Owner ↔ Agent: Direct trust relationship               │
│  Agent → Machine: Full access (owner's hardware)        │
│  Agent → External: Guarded (no data exfiltration)       │
│  Agent → Other Users: Isolated (no cross-user access)   │
└─────────────────────────────────────────────────────────┘
```

### Config Example
```env
# Full autonomy mode
AUTONOMY_MODE=relentless
WORKSPACE_ROOT=/home/corp-unum/openunumQwen
ALLOW_EXTERNAL_ACTIONS=false
```

---

## 2️⃣ Maximum Autonomy

**Principle:** Agent completes tasks without hand-holding. Plans, executes, verifies, self-heals.

### Autonomy Levels

| Level | Name | Description |
|-------|------|-------------|
| 1 | **Standard** | Asks for confirmation on risky actions |
| 2 | **Relentless** | Executes all actions, retries on failure |
| 3 | **Self-Poking** | Continues working even after task "completion" |

### Autonomy Features
- **Planning:** Generates multi-step execution plans
- **Tool Calling:** Invokes tools with generated arguments
- **Verification:** Proves completion with evidence
- **Self-Healing:** Circuit breakers, failover, recovery attempts
- **Self-Poking:** Continues optimizing after task completion

### Self-Poking Behavior
```javascript
// After task completion, agent asks:
// "What else can I improve?"
// "Are there related tasks to complete?"
// "Can I optimize this workflow?"
```

---

## 3️⃣ Self-Healing & Self-Restoration

**Principle:** Agent recovers from failures automatically.

### Healing Mechanisms

| Mechanism | Trigger | Action |
|-----------|---------|--------|
| **Circuit Breaker** | Tool fails 3x | Disable tool, retry later |
| **Provider Failover** | Model API fails | Switch to fallback model |
| **Health Check** | Every 5 iterations | Verify all systems |
| **Auto-Retry** | Step fails | Attempt alternative approach |
| **State Recovery** | Crash/restart | Reload from persisted state |

### Circuit Breaker States
```
CLOSED → Normal operation
  ↓ (3 failures)
OPEN → Tool disabled for 5 minutes
  ↓ (timeout expires)
HALF-OPEN → Test with single request
  ↓ (success)
CLOSED → Resume normal
```

---

## 4️⃣ Learning from Mistakes & Successes

**Principle:** Agent remembers failures and successes, uses them to improve.

### Failure Learning
```javascript
// Record failure patterns
{
  task: "Create file with file_write",
  failure: "Path and content required",
  lesson: "Always validate args before calling tool",
  retry_count: 3,
  resolved: true,
  resolution: "Added args validation in generateToolArgs()"
}
```

### Success Learning
```javascript
// Record success patterns
{
  task: "5-step workflow with git commit",
  success_factors: ["auto-stage before commit", "valid args"],
  reusable_pattern: "create → stage → commit → verify",
  confidence: 0.95
}
```

### Memory Storage
- **BM25 Index:** Fast semantic search
- **SQLite:** Persistent structured storage
- **Auto-Tagging:** Tasks tagged by tool, outcome, complexity

---

## 5️⃣ Efficient Memory System

**Principle:** Remember smart, recall smarter.

### Memory Architecture
```
┌─────────────────────────────────────────────────────────┐
│                  Memory Manager                          │
├─────────────────────────────────────────────────────────┤
│  Short-Term (Session)                                    │
│  └── Last 10 conversation turns (in-memory)             │
├─────────────────────────────────────────────────────────┤
│  Long-Term (Persistent)                                  │
│  ├── SQLite (structured records)                        │
│  └── BM25 Index (semantic search)                       │
├─────────────────────────────────────────────────────────┤
│  Recall Strategies                                       │
│  ├── Keyword search (exact match)                       │
│  ├── Semantic search (vector-like via BM25)             │
│  └── Context-aware (task-relevant filtering)            │
└─────────────────────────────────────────────────────────┘
```

### Memory Operations
```javascript
// Store with auto-indexing
memory_store("Task failed: file_write needs path+content")

// Smart recall
memory_search("file write errors", { topK: 5, tags: ["failure"] })

// Recall by context
memory_recall_by_task("Create file and commit to git")
```

### Model Compatibility
- Works with **local models** (Qwen 9B, 64K context)
- Works with **cloud models** (397B, 1M context)
- Memory payload optimized for any context window

---

## 6️⃣ Skill System

**Principle:** Extend capabilities via reviewed skills.

### Skill Lifecycle
```
1. Discovery → Find skill (GitHub, local, user-provided)
2. Review → Static analysis, security audit
3. Install → Copy to /skills, register in manifest
4. Execute → Load and run with sandboxing
5. Rate → Track success/failure for future use
```

### Skill Structure
```javascript
// skills/example-skill.js
export const Skill = {
  name: "example-skill",
  version: "1.0.0",
  description: "Example skill",
  
  validate(config) {
    // Security checks
    return true;
  },
  
  async execute(args, context) {
    // Skill logic
    return { success: true, result: "..." };
  }
};
```

### Skill Registry
```json
{
  "skills": [
    {
      "name": "example-skill",
      "path": "/skills/example-skill.js",
      "reviewed": true,
      "reviewer": "owner",
      "install_date": "2026-03-31",
      "usage_count": 5,
      "success_rate": 1.0
    }
  ]
}
```

---

## 7️⃣ Email Integration (Gmail)

**Principle:** Send emails via Gmail CLI.

### Implementation Plan
```bash
# Install Gmail CLI
npm install -g gmail-cli

# OAuth setup (owner runs once)
gmail-cli auth

# Agent usage
email_send({
  to: "user@example.com",
  subject: "Task Complete",
  body: "Your task has been completed."
})
```

### Config
```env
GMAIL_CLI_PATH=/usr/bin/gmail-cli
GMAIL_ACCOUNT=owner@gmail.com
```

---

## 8️⃣ Daily Research Agent

**Principle:** Continuously improve by researching new methods.

### Research Workflow
```
1. Schedule (daily at 3AM)
2. Sources: Reddit (r/MachineLearning), X (AI researchers), Google Scholar
3. Extract: New agent techniques, tools, frameworks
4. Review: Security + compatibility analysis
5. Propose: Summary to owner with recommendation
6. Apply: If approved, implement and test
```

### Research Topics
- New tool-calling methods
- Improved planning algorithms
- Better memory/retrieval techniques
- Self-healing strategies
- Skill frameworks

---

## 9️⃣ Test-First, Document, Deploy, E2E

**Principle:** Nothing ships without tests, docs, and E2E validation.

### Development Flow
```
1. Design → Write design doc
2. Test → Write failing test
3. Implement → Make test pass
4. Document → Update docs/
5. E2E → Run full workflow test
6. Deploy → Auto-sync to GitHub
```

### Documentation Requirements
- **AGENT_GUIDE.md** - How to use
- **DESIGN_PRINCIPLES.md** - Why it's built this way
- **API_REFERENCE.md** - Technical specs
- **CHANGELOG.md** - What changed

### E2E Test Template
```javascript
{
  name: "File create + git commit + push",
  steps: [
    { tool: "file_write", args: {...} },
    { tool: "git_status", expect: "modified" },
    { tool: "git_commit", args: { message: "test" } },
    { tool: "git_push", expect: "success" }
  ],
  proof: "Commit hash + GitHub URL"
}
```

---

## 🔟 Continuous Improvement Loop

```
┌─────────────────────────────────────────────────────────┐
│              IMPROVEMENT CYCLE                           │
├─────────────────────────────────────────────────────────┤
│  Execute → Record Outcome → Analyze → Learn → Improve   │
│      ↑                                                  │
│      └──────────────────────────────────────────────────┘
```

### Metrics Tracked
- Task completion rate
- Average iterations per task
- Tool failure rates
- Recovery success rate
- Memory recall accuracy

---

**Version:** 2.0.0  
**Status:** Active  
**Owner:** Antonis  
**Motto:** "Own the hardware. Serve the owner. Never stop improving."
