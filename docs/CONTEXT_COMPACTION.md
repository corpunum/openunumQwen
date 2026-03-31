# Chat Context Compaction System

**Implemented:** 2026-03-31  
**Status:** ✅ Production Ready

---

## Problem Solved

When chatting with OpenUnum Qwen for extended sessions, the conversation history grows until it approaches the model's context window limit. This causes:

- Slower inference (more tokens to process)
- Potential errors when exceeding context limits
- Loss of recent context if model truncates automatically
- No control over what gets discarded

## Solution: Intelligent Context Compaction

OpenUnum Qwen now **automatically monitors and compacts** chat history before it becomes a problem.

---

## How It Works

### 1. **Context Monitoring**

Before each task execution, the system checks:
```javascript
const status = contextManager.shouldCompact(sessionHistory);
// Returns: { needsCompaction, usagePercent, usedTokens, contextWindow }
```

**Trigger threshold:** 70% of context window  
**Target after compaction:** 22% of context window

### 2. **Smart Compaction Strategy**

When compaction is needed:

| Message Type | Preservation | Strategy |
|--------------|--------------|----------|
| **User messages** | 90% | Keep nearly intact, preserve original intent |
| **Agent responses** | 30% | Extract key points, remove verbose explanations |
| **Recent messages** | 100% | Keep last 30% of conversation untouched |
| **Tool calls** | Results only | Keep results, remove call markup |
| **Code blocks** | Truncated | Keep first 10 lines + last 5 lines |

### 3. **Memory Preservation**

Before deleting old messages, the system:
- Creates a structured summary of key points
- Stores summary in BM25 memory (searchable later)
- Saves summary to `memory/chat-summaries/` directory
- Inserts summary reference at start of compacted history

Example summary reference:
```
[Previous conversation summary - 47 messages compacted at 2026-03-31T08:30:00Z]
Key topics: file operations, model listing, git sync, API endpoints
Reference: Check memory for full summary if needed.
```

### 4. **Model-Aware Context Windows**

The system knows each model's limits:

| Model | Context Window |
|-------|----------------|
| `qwen3.5:9b-64k` | 64K tokens |
| `qwen3.5:9b-128k` | 128K tokens |
| `qwen3.5:9b-262k` | 262K tokens |
| `qwen3.5:397b-cloud` | 262K tokens |
| `glm-5:cloud` | 262K tokens |
| `kimi-k2.5:cloud` | 262K tokens |
| `minimax-m2.5:cloud` | 1M tokens |
| `minimax-m2.7:cloud` | 1M tokens |
| `dolphin-llama3:8b` | 8K tokens |
| `uncensored:latest` | 8K tokens |

---

## User Experience

### Header Indicator

The WebUI header shows real-time context usage:
```
Context: 45%  (green = good, yellow = moderate, red = needs compaction)
```

### Automatic & Transparent

- Compaction happens **before** processing your task
- No manual intervention needed
- You see a log message: `[Agent] Context was compacted, summary saved to memory`
- Recent conversation stays intact

### Manual Reset

Type `/new` in chat to:
- Clear all session history
- Start fresh with zero context usage
- Keep localStorage chat history (browser-side)

---

## API Endpoints

### Get Context Stats
```bash
GET /api/context-stats

Response:
{
  "usagePercent": 0.45,
  "usedTokens": 118000,
  "contextWindow": 262144,
  "availableTokens": 144144,
  "needsCompaction": false,
  "messageCount": 47
}
```

### Clear Chat
```bash
POST /api/chat/clear

Response:
{
  "cleared": true,
  "previousCount": 47
}
```

---

## Files Modified/Created

| File | Purpose |
|------|---------|
| `src/core/context-manager.js` | NEW - Compaction logic, BM25 summary storage |
| `src/core/agent.js` | Added `ensureContextCapacity()`, `getContextStats()`, `clearHistory()` |
| `src/ui/server.js` | Added `/api/context-stats`, `/api/chat/clear` endpoints |
| `ui/public/index.html` | Context usage indicator, color-coded display |
| `docs/CONTEXT_COMPACTION.md` | This documentation |

---

## Configuration

Edit thresholds in `src/core/context-manager.js`:

```javascript
const COMPACTION_TARGET_PERCENT = 0.22; // Target 22% after compaction
const COMPACTION_TRIGGER_PERCENT = 0.70; // Trigger at 70% usage
const MIN_MESSAGES_TO_KEEP = 4; // Always keep at least 4 recent messages
const USER_PRESERVE_RATIO = 0.9; // Keep 90% of user message content
const AGENT_COMPACT_RATIO = 0.3; // Keep 30% of agent response content
```

---

## Logs & Debugging

### Compaction Log
Location: `logs/compaction.log`

Each compaction event is logged:
```json
{
  "timestamp": "2026-03-31T08:30:00.000Z",
  "beforeCount": 94,
  "afterCount": 32,
  "beforeTokens": 183420,
  "afterTokens": 57688,
  "contextWindow": 262144,
  "summarySaved": true
}
```

### Chat Summaries
Location: `memory/chat-summaries/`

Markdown files with structured summaries of compacted conversations.

---

## Testing

### Test 1: Verify Context Stats
```bash
curl http://127.0.0.1:18881/api/context-stats
```

### Test 2: Simulate Long Conversation
```javascript
// In browser console, send many messages
for (let i = 0; i < 50; i++) {
  ws.send(JSON.stringify({ type: 'chat', task: `Message ${i}: ${'x'.repeat(500)}` }));
}
// Watch context percentage rise, then drop after compaction
```

### Test 3: Verify Memory Storage
```bash
ls -la memory/chat-summaries/
cat memory/chat-summaries/summary-*.md | head -30
```

---

## Future Enhancements

- [ ] User-configurable compaction thresholds via UI
- [ ] Export full conversation before compaction
- [ ] Selective memory: mark important messages as "never compact"
- [ ] Compression: use LLM to create denser summaries
- [ ] Multi-session: share summaries across browser refreshes

---

## Related

- [Memory System](./MEMORY_SYSTEM.md) - BM25 retrieval for stored summaries
- [Agent Architecture](./AGENT_GUIDE.md) - How agent uses context
- [Configuration](./CONFIGURATION.md) - Model and context settings
