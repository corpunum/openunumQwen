/**
 * Context Manager - Chat Session Compaction
 * Monitors context usage and compacts old messages while preserving recent ones
 * Saves important info to memory before compaction for future reference
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, getConfig } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

// Model context windows (tokens)
const MODEL_CONTEXT_WINDOWS = {
  // Local models
  'qwen3.5:9b-64k': 65536,
  'qwen3.5:9b-128k': 131072,
  'qwen3.5:9b-262k': 262144,
  'dolphin-llama3:8b': 8192,
  'uncensored:latest': 8192,
  'nomic-embed-text:latest': 8192,
  
  // Cloud models
  'qwen3.5:397b-cloud': 262144,
  'glm-5:cloud': 262144,
  'kimi-k2.5:cloud': 262144,
  'minimax-m2.5:cloud': 1048576,
  'minimax-m2.7:cloud': 1048576,
  
  // Fallback defaults
  'default': 32768,
  'cloud-default': 131072
};

// Compaction thresholds
const COMPACTION_TARGET_PERCENT = 0.22; // 22% of context window (leaves 78% room)
const COMPACTION_TRIGGER_PERCENT = 0.70; // Trigger compaction at 70% usage
const MIN_MESSAGES_TO_KEEP = 4; // Always keep at least this many recent messages
const USER_PRESERVE_RATIO = 0.9; // Keep 90% of user message content
const AGENT_COMPACT_RATIO = 0.3; // Keep only 30% of agent response content

export class ContextManager {
  constructor(options = {}) {
    this.config = loadConfig();
    this.compactionLogPath = join(ROOT, 'logs', 'compaction.log');
    this.summaryDir = join(ROOT, 'memory', 'chat-summaries');
    
    // Ensure directories exist
    const logDir = dirname(this.compactionLogPath);
    if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
    if (!existsSync(this.summaryDir)) mkdirSync(this.summaryDir, { recursive: true });
  }

  /**
   * Get context window size for current model
   */
  getContextWindowSize(model) {
    const modelName = model || this.config.model;
    return MODEL_CONTEXT_WINDOWS[modelName] || MODEL_CONTEXT_WINDOWS['default'];
  }

  /**
   * Estimate token count for a message (rough estimate: 1 token ≈ 4 chars)
   */
  estimateTokens(text) {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
  }

  /**
   * Calculate total context usage for a conversation
   */
  calculateContextUsage(messages) {
    let totalTokens = 0;
    for (const msg of messages) {
      totalTokens += this.estimateTokens(msg.content || '');
      if (msg.role) totalTokens += 4; // role label overhead
    }
    return totalTokens;
  }

  /**
   * Check if compaction is needed
   * Returns: { needsCompaction: boolean, usagePercent: number, contextWindow: number }
   */
  shouldCompact(messages) {
    const contextWindow = this.getContextWindowSize(this.config.model);
    const usedTokens = this.calculateContextUsage(messages);
    const usagePercent = usedTokens / contextWindow;
    
    return {
      needsCompaction: usagePercent >= COMPACTION_TRIGGER_PERCENT,
      usagePercent,
      usedTokens,
      contextWindow,
      targetTokens: Math.floor(contextWindow * COMPACTION_TARGET_PERCENT)
    };
  }

  /**
   * Extract key information from a message for summary
   */
  extractKeyPoints(message, isAgent) {
    if (!isAgent) {
      // User messages: keep mostly intact
      return message.content;
    }
    
    // Agent messages: extract key points
    const content = message.content || '';
    
    // Remove tool call markup and keep results
    let cleaned = content
      .replace(/<tool>[\s\S]*?<\/tool>/g, (match) => {
        // Keep tool results, remove calls
        const resultMatch = match.match(/<result>([\s\S]*?)<\/result>/);
        return resultMatch ? `Result: ${resultMatch[1]}` : '';
      })
      .replace(/```[\s\S]*?```/g, (match) => {
        // Keep code blocks but truncate long ones
        const lines = match.split('\n');
        if (lines.length > 10) {
          return '```[code block truncated]\n' + lines.slice(-5).join('\n') + '```';
        }
        return match;
      });
    
    // Truncate if still too long
    if (cleaned.length > 500) {
      cleaned = cleaned.slice(0, 400) + '\n...[truncated]...\n' + cleaned.slice(-100);
    }
    
    return cleaned;
  }

  /**
   * Create a summary of old messages before compaction
   */
  createSummary(messages, compactionIndex) {
    const messagesToSummarize = messages.slice(0, compactionIndex);
    
    if (messagesToSummarize.length === 0) return null;
    
    const summary = {
      timestamp: new Date().toISOString(),
      messageCount: messagesToSummarize.length,
      keyPoints: [],
      filesCreated: [],
      actionsTaken: [],
      decisions: []
    };
    
    for (const msg of messagesToSummarize) {
      if (msg.role === 'user') {
        summary.keyPoints.push(`User: ${msg.content.slice(0, 200)}`);
      } else if (msg.role === 'assistant') {
        const points = this.extractKeyPoints(msg, true);
        summary.keyPoints.push(`Agent: ${points.slice(0, 300)}`);
        
        // Extract file operations
        const fileMatches = msg.content.match(/(created|wrote|modified|read)\s+[`\']?([^\s`\'\n]+)[`\']?/gi);
        if (fileMatches) {
          summary.filesCreated.push(...fileMatches);
        }
        
        // Extract tool calls
        const toolMatches = msg.content.match(/<tool>([\s\S]*?)<\/tool>/g);
        if (toolMatches) {
          summary.actionsTaken.push(...toolMatches.slice(0, 5));
        }
      }
    }
    
    return summary;
  }

  /**
   * Save summary to memory before compaction
   */
  async saveSummaryToMemory(summary, memoryManager) {
    if (!summary || !memoryManager) return null;
    
    const summaryText = `
[Chat Session Summary - ${summary.timestamp}]
Messages summarized: ${summary.messageCount}

Key Points:
${summary.keyPoints.slice(0, 20).map(p => `- ${p}`).join('\n')}

Files Created/Modified:
${summary.filesCreated.slice(0, 10).map(f => `- ${f}`).join('\n')}

Actions Taken:
${summary.actionsTaken.slice(0, 10).map(a => `- ${a.slice(0, 100)}`).join('\n')}
`.trim();
    
    try {
      // Store in BM25 memory
      await memoryManager.store(summaryText, { tags: ['chat-summary', 'compaction'] });
      
      // Also save to file for reference
      const summaryFile = join(this.summaryDir, `summary-${Date.now()}.md`);
      writeFileSync(summaryFile, summaryText);
      
      return { stored: true, file: summaryFile };
    } catch (e) {
      console.error('[ContextManager] Failed to save summary:', e.message);
      return { stored: false, error: e.message };
    }
  }

  /**
   * Compact messages while preserving recent ones
   * Returns: { compactedMessages: Array, summary: Object }
   */
  async compact(messages, memoryManager = null) {
    const status = this.shouldCompact(messages);
    if (!status.needsCompaction) {
      return { compactedMessages: messages, summary: null, reason: 'not needed' };
    }
    
    console.log(`[ContextManager] Compaction needed: ${Math.round(status.usagePercent * 100)}% usage`);
    console.log(`  Target: ${status.targetTokens} tokens (${Math.round(COMPACTION_TARGET_PERCENT * 100)}% of ${status.contextWindow})`);
    
    // Determine compaction point - keep newer messages intact
    const keepCount = Math.max(MIN_MESSAGES_TO_KEEP, Math.floor(messages.length * 0.3));
    const compactionIndex = messages.length - keepCount;
    
    // Create summary of old messages
    const summary = this.createSummary(messages, compactionIndex);
    
    // Save summary to memory before compaction
    if (summary && memoryManager) {
      await this.saveSummaryToMemory(summary, memoryManager);
    }
    
    // Create compacted version of old messages
    const oldMessages = messages.slice(0, compactionIndex);
    const newMessages = messages.slice(compactionIndex);
    
    // Compact old messages aggressively
    const compactedOld = [];
    let runningTokenCount = 0;
    
    for (let i = 0; i < oldMessages.length; i += 2) {
      const userMsg = oldMessages[i];
      const agentMsg = oldMessages[i + 1];
      
      if (!userMsg) continue;
      
      // Keep user message mostly intact
      const preservedUser = {
        role: 'user',
        content: userMsg.content,
        compacted: false
      };
      
      // Compact agent response significantly
      let preservedAgent = null;
      if (agentMsg) {
        preservedAgent = {
          role: 'assistant',
          content: this.extractKeyPoints(agentMsg, true),
          compacted: true,
          originalLength: agentMsg.content?.length || 0
        };
      }
      
      compactedOld.push(preservedUser);
      if (preservedAgent) compactedOld.push(preservedAgent);
      
      runningTokenCount += this.estimateTokens(preservedUser.content);
      if (preservedAgent) runningTokenCount += this.estimateTokens(preservedAgent.content);
      
      // Stop if we've reached target
      if (runningTokenCount >= status.targetTokens * 0.8) {
        console.log(`[ContextManager] Reached target token count at message ${i}`);
        break;
      }
    }
    
    // Add summary reference at the beginning
    const summaryRef = {
      role: 'system',
      content: `[Previous conversation summary - ${summary?.messageCount || 0} messages compacted at ${new Date().toISOString()}]
Key topics: ${summary?.keyPoints?.slice(0, 5).map(p => p.slice(0, 50)).join(' | ') || 'N/A'}
Reference: Check memory for full summary if needed.`,
      isSummary: true
    };
    
    const compactedMessages = [summaryRef, ...compactedOld, ...newMessages];
    
    // Log compaction
    this.logCompaction({
      timestamp: new Date().toISOString(),
      beforeCount: messages.length,
      afterCount: compactedMessages.length,
      beforeTokens: status.usedTokens,
      afterTokens: this.calculateContextUsage(compactedMessages),
      contextWindow: status.contextWindow,
      summarySaved: !!summary
    });
    
    return {
      compactedMessages,
      summary,
      reason: 'compaction completed'
    };
  }

  /**
   * Log compaction event
   */
  logCompaction(event) {
    try {
      const logLine = JSON.stringify(event) + '\n';
      writeFileSync(this.compactionLogPath, logLine, { flag: 'a' });
    } catch (e) {
      console.error('[ContextManager] Failed to write compaction log:', e.message);
    }
  }

  /**
   * Get compaction history
   */
  getCompactionHistory(limit = 10) {
    if (!existsSync(this.compactionLogPath)) return [];
    
    try {
      const content = readFileSync(this.compactionLogPath, 'utf-8');
      const lines = content.trim().split('\n').filter(l => l.trim());
      const events = lines.map(l => JSON.parse(l));
      return events.slice(-limit);
    } catch (e) {
      console.error('[ContextManager] Failed to read compaction log:', e.message);
      return [];
    }
  }
}

export default ContextManager;
