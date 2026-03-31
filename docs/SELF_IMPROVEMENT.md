# 🔄 Self-Improvement System

**Version:** 2.0.0 | **Status:** Active

---

## Overview

OpenUnum Qwen continuously improves through:

1. **Learning from failures** - Records what went wrong and how it was fixed
2. **Learning from successes** - Captures successful patterns for reuse
3. **Daily research** - Scours the internet for new techniques
4. **Self-poking** - Continues optimizing after task completion
5. **Memory-driven decisions** - Uses past experience to guide future actions

---

## Failure Learning

### How It Works

```javascript
// When a tool fails:
{
  task: "Create file with file_write",
  tool: "file_write",
  failure: "Path and content required for file_write",
  root_cause: "Model generated empty args {}",
  solution: "Added validation in generateToolArgs() with fallback defaults",
  retry_count: 3,
  resolved: true,
  timestamp: "2026-03-31T07:40:00Z"
}
```

### Storage
- **SQLite Table:** `failures`
- **BM25 Indexed:** Yes (searchable by task, tool, error message)
- **Retention:** Last 1000 failures (configurable)

### Retrieval
```javascript
// Agent automatically checks for similar failures
memory_search("file_write empty args", { tags: ["failure"] })
// Returns: "Use generateToolArgs validation with fallback defaults"
```

---

## Success Learning

### How It Works

```javascript
// When a task completes successfully:
{
  task: "5-step workflow: create file, git commit, push",
  steps_completed: 5,
  success_factors: [
    "auto-stage before commit",
    "valid args generated",
    "circuit breaker stayed closed"
  ],
  pattern: "create → stage → commit → verify",
  confidence: 0.95,
  reusable: true,
  timestamp: "2026-03-31T07:41:00Z"
}
```

### Storage
- **SQLite Table:** `successes`
- **BM25 Indexed:** Yes (searchable by task type, tools used)
- **Retention:** Last 500 successes (configurable)

### Pattern Reuse
When planning a similar task, agent checks:
```javascript
memory_search("git commit workflow", { tags: ["success"] })
// Returns: "Use auto-stage before commit, validate args first"
```

---

## Daily Research Agent

### Schedule
- **Time:** 3:00 AM (Europe/Athens)
- **Frequency:** Daily
- **Duration:** ~5 minutes

### Sources
| Source | Type | Topics |
|--------|------|--------|
| Reddit r/MachineLearning | JSON API | Agent planning, tool-calling |
| Reddit r/LocalLLaMA | JSON API | Ollama, Qwen, local agents |
| X (Twitter) | Web scraping | AI researcher tweets |
| Google Scholar | Web scraping | Academic papers |
| Hugging Face Papers | Web scraping | New agent frameworks |
| GitHub Trending | Web scraping | Agent repos |

### Output
```json
{
  "date": "2026-03-31",
  "findings": [
    {
      "source": "Reddit - r/MachineLearning",
      "title": "New planning algorithm for autonomous agents",
      "relevance_score": 0.87,
      "url": "https://reddit.com/r/MachineLearning/..."
    }
  ],
  "proposals": [
    {
      "finding": "...",
      "proposal": "Review and consider implementing",
      "priority": "high"
    }
  ]
}
```

### Review Process
1. Research agent runs at 3AM
2. Saves findings to `research/research-YYYY-MM-DD.json`
3. Agent presents top 3 findings to owner
4. Owner approves/rejects implementation
5. If approved → implement → test → document → deploy

---

## Self-Poking Behavior

### What Is Self-Poking?

After completing a task, instead of stopping, the agent asks:

```
"What else can I improve?"
"Are there related tasks to complete?"
"Can I optimize this workflow?"
"Should I document what I just learned?"
```

### Implementation

```javascript
// In agent.run() after task completion:
if (options.selfPoke !== false) {
  const improvementSuggestions = await this.generateImprovementIdeas(task, results);
  if (improvementSuggestions.length > 0) {
    console.log('[Agent] Self-poke suggestions:', improvementSuggestions);
    // Optionally present to user or auto-execute low-risk improvements
  }
}
```

### Examples

| Task Completed | Self-Poke Suggestion |
|----------------|---------------------|
| Created file + committed | "Should I add this to documentation?" |
| Fixed a bug | "Should I add a test case for this?" |
| Ran tests | "Should I update the test coverage report?" |
| Deployed code | "Should I create a changelog entry?" |

---

## Memory-Driven Decisions

### Decision Flow

```
┌─────────────────────────────────────────────────────────┐
│  New Task Arrives                                        │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│  Search Memory for Similar Tasks                         │
│  - Similar successes (high confidence patterns)         │
│  - Similar failures (what to avoid)                     │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│  Incorporate Learnings into Plan                         │
│  - Use successful patterns                              │
│  - Avoid known failure modes                            │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│  Execute with Informed Strategy                          │
└─────────────────────────────────────────────────────────┘
```

### Example

```
Task: "Create a file and commit it to git"

Memory Recall:
- Success: "auto-stage before commit prevents failures" (confidence: 0.95)
- Failure: "empty args cause file_write to fail" (lesson: validate args)

Plan Generated:
1. Generate args with validation (avoid failure)
2. Create file with file_write
3. Auto-stage via git_commit (use success pattern)
4. Verify with git log
```

---

## Configuration

### Enable/Disable Features

```env
# .env
SELF_POKE_ENABLED=true
FAILURE_LEARNING_ENABLED=true
SUCCESS_LEARNING_ENABLED=true
RESEARCH_AGENT_ENABLED=true
RESEARCH_AGENT_SCHEDULE=0 3 * * *  # 3AM daily
MEMORY_MAX_FAILURES=1000
MEMORY_MAX_SUCCESSES=500
```

---

## Metrics

### Tracked Statistics

| Metric | Description | Target |
|--------|-------------|--------|
| **Task Completion Rate** | % of tasks completed successfully | >90% |
| **Avg Iterations/Task** | Efficiency measure | <10 |
| **Tool Failure Rate** | % of tool calls that fail | <5% |
| **Recovery Success Rate** | % of failures recovered | >80% |
| **Memory Recall Accuracy** | % of recalled items that are relevant | >85% |
| **Research Actions Taken** | # of research findings implemented | >1/week |

### View Metrics

```bash
# Run health check with metrics
curl http://127.0.0.1:18881/api/health

# Or via agent task
"Show me my performance metrics for the last 7 days"
```

---

## Continuous Improvement Loop

```
┌─────────────────────────────────────────────────────────┐
│                    IMPROVEMENT CYCLE                     │
│                                                          │
│  Execute Task → Record Outcome → Analyze Pattern        │
│       ↑                              ↓                   │
│       └────── Improve ← Learn ←──────┘                  │
│                                                          │
│  Repeat infinitely. Never stop improving.                │
└─────────────────────────────────────────────────────────┘
```

---

**Philosophy:** "Good enough" is the enemy of great. Always improve.
