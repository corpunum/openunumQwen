/**
 * Unified Context Manager - Model-Aware Multi-Stage Compression
 * 
 * Adapts compression strategy based on model class:
 * - weak_9b: 2K full history, compact at 4K, RAG at 6K
 * - mid_70b: 8K full history, compact at 16K, RAG at 32K
 * - strong_400b: 24K full history, compact at 64K, RAG at 128K
 * 
 * Compression pipeline:
 * 1. Full history (under threshold)
 * 2. Lossless deduplication + artifact extraction
 * 3. Summarization with artifact preservation
 * 4. RAG-only retrieval
 */

import { WorkingMemoryAnchor } from './working-memory-anchor.js';
import { ContextCompressor, extractArtifacts, formatArtifacts, countTokens } from './context-compressor.js';
import { loadConfig } from './config.js';

// Model class thresholds (tokens)
const MODEL_THRESHOLDS = {
  weak_9b: {
    fullHistory: 2000,
    gradualCompaction: 4000,
    aggressiveCompaction: 6000,
    ragSwitch: 8000,
    summaryBudget: 400,
    ragBudget: 2000
  },
  mid_70b: {
    fullHistory: 8000,
    gradualCompaction: 16000,
    aggressiveCompaction: 32000,
    ragSwitch: 48000,
    summaryBudget: 800,
    ragBudget: 4000
  },
  strong_400b: {
    fullHistory: 24000,
    gradualCompaction: 64000,
    aggressiveCompaction: 96000,
    ragSwitch: 128000,
    summaryBudget: 1200,
    ragBudget: 8000
  }
};

// Map model IDs to classes
const MODEL_CLASS_MAP = {
  // Local 9B models
  'qwen3.5:9b-64k': 'weak_9b',
  'qwen3.5:9b-128k': 'weak_9b',
  'qwen3.5:9b-262k': 'weak_9b',
  'dolphin-llama3:8b': 'weak_9b',
  'uncensored:latest': 'weak_9b',
  
  // Cloud mid-range
  'glm-5:cloud': 'mid_70b',
  'kimi-k2.5:cloud': 'mid_70b',
  'minimax-m2.5:cloud': 'mid_70b',
  'minimax-m2.7:cloud': 'mid_70b',
  
  // Cloud strong
  'qwen3.5:397b-cloud': 'strong_400b'
};

export class UnifiedContextManager {
  constructor(options = {}) {
    this.config = loadConfig();
    this.workspaceRoot = options.workspaceRoot || process.cwd();
    this.compressor = new ContextCompressor();
    this.vectorStore = options.vectorStore || null; // Optional: for RAG
    this.embedder = options.embedder || null; // Optional: for embeddings
    this.memoryManager = options.memoryManager || null; // Optional: BM25 memory
    
    // Determine model class
    this.modelClass = this._getModelClass(this.config.model);
    this.thresholds = MODEL_THRESHOLDS[this.modelClass];
    
    console.log('[UnifiedContextManager] Initialized', {
      model: this.config.model,
      modelClass: this.modelClass,
      thresholds: this.thresholds
    });
  }

  /**
   * Determine model class from model ID
   */
  _getModelClass(modelId) {
    const modelClass = MODEL_CLASS_MAP[modelId];
    if (modelClass) return modelClass;
    
    // Fallback heuristics
    if (modelId.includes('9b') || modelId.includes('8b') || modelId.includes('7b')) {
      return 'weak_9b';
    }
    if (modelId.includes('70b') || modelId.includes('40b') || modelId.includes('34b')) {
      return 'mid_70b';
    }
    if (modelId.includes('397b') || modelId.includes('405b') || modelId.includes('176b')) {
      return 'strong_400b';
    }
    
    // Default to weak_9b for safety
    console.warn('[UnifiedContextManager] Unknown model, defaulting to weak_9b', { modelId });
    return 'weak_9b';
  }

  /**
   * Build context injection for a session
   * 
   * @param {string} sessionId - Session ID
   * @param {Array} messages - All session messages
   * @param {string} userMessage - Current user message (for RAG query)
   * @param {object} anchorData - Optional: { userTask, agentPlan, contract }
   * @returns {object} Context payload with mode, messages, metadata
   */
  async buildContext(sessionId, messages, userMessage, anchorData = null) {
    const totalTokens = this._countTotalTokens(messages);
    const budget = this.thresholds;
    
    console.log('[UnifiedContextManager] Building context', {
      sessionId,
      totalTokens,
      modelClass: this.modelClass,
      fullHistoryBudget: budget.fullHistory
    });
    
    // Initialize working memory anchor if provided
    let anchor = null;
    if (anchorData) {
      anchor = new WorkingMemoryAnchor({ sessionId, workspaceRoot: this.workspaceRoot });
      if (!anchor.getAnchor().userOrigin) {
        anchor.setAnchor(anchorData.userTask, anchorData.agentPlan, anchorData.contract);
      }
    }
    
    // Stage 1: Under threshold — full history
    if (totalTokens < budget.fullHistory) {
      return this._buildFullHistory(messages, anchor);
    }
    
    // Stage 2: Lossless compression (deduplication + artifacts)
    if (totalTokens < budget.gradualCompaction) {
      return this._buildLosslessCompressed(messages, anchor);
    }
    
    // Stage 3: Lossy summarization with artifacts
    if (totalTokens < budget.ragSwitch) {
      return this._buildSummarized(messages, userMessage, anchor);
    }
    
    // Stage 4: RAG-only mode
    return this._buildRAGOnly(messages, userMessage, anchor);
  }

  /**
   * Stage 1: Full history (no compression)
   */
  _buildFullHistory(messages, anchor) {
    const injection = anchor ? anchor.buildInjection(messages.slice(-4), messages.length) : null;
    
    return {
      mode: 'full_history',
      messages: messages,
      injection: injection,
      tokenCount: this._countTotalTokens(messages),
      compressionRatio: 1.0,
      modelClass: this.modelClass
    };
  }

  /**
   * Stage 2: Lossless compression (deduplication + artifact extraction)
   */
  _buildLosslessCompressed(messages, anchor) {
    // Deduplicate
    const deduplicated = this.compressor.deduplicateTokens(messages);
    
    // Extract artifacts
    const artifacts = extractArtifacts(messages);
    
    // Build injection with anchor + artifacts
    const recentMessages = messages.slice(-4);
    const injection = anchor 
      ? anchor.buildInjection(recentMessages, messages.length)
      : this._buildArtifactInjection(artifacts);
    
    const tokenCount = this._countTotalTokens(deduplicated);
    const originalTokens = this._countTotalTokens(messages);
    
    return {
      mode: 'lossless_compression',
      messages: deduplicated,
      artifacts: artifacts,
      injection: injection,
      tokenCount: tokenCount,
      originalTokenCount: originalTokens,
      compressionRatio: originalTokens / tokenCount,
      modelClass: this.modelClass
    };
  }

  /**
   * Stage 3: Summarization with artifact preservation
   */
  _buildSummarized(messages, userMessage, anchor) {
    const summaryResult = this.compressor.summarizeWithArtifacts(messages, {
      maxTokens: this.thresholds.summaryBudget,
      preserveLastN: 5
    });
    
    // Build injection
    const artifactText = formatArtifacts(summaryResult.artifacts);
    const recentMessages = summaryResult.recentMessages;
    const injection = anchor
      ? anchor.buildInjection(recentMessages, messages.length)
      : this._buildSummaryInjection(summaryResult.summary, artifactText);
    
    // Update anchor with compaction info
    if (anchor) {
      anchor.updateCompactedSummary(
        summaryResult.summary,
        `session:${messages.sessionId || 'unknown'}`
      );
    }
    
    return {
      mode: 'summary_with_artifacts',
      summary: summaryResult.summary,
      artifacts: summaryResult.artifacts,
      recentMessages: recentMessages,
      injection: injection,
      tokenCount: this._countTotalTokens([
        { content: summaryResult.summary },
        { content: artifactText },
        ...recentMessages
      ]),
      originalTokenCount: this._countTotalTokens(messages),
      compressionRatio: summaryResult.compressionRatio,
      modelClass: this.modelClass
    };
  }

  /**
   * Stage 4: RAG-only retrieval
   */
  async _buildRAGOnly(messages, userMessage, anchor) {
    // Use vector search if available, otherwise keyword-based
    let retrieved;
    if (this.vectorStore && this.embedder) {
      const embedding = await this.embedder.encode(userMessage);
      retrieved = await this.vectorStore.search(embedding, {
        limit: 10,
        maxTokens: this.thresholds.ragBudget
      });
    } else {
      // Fallback to keyword retrieval
      const retrievalResult = this.compressor.retrieveRelevantOnly(messages, userMessage, {
        maxTokens: this.thresholds.ragBudget,
        limit: 10
      });
      retrieved = retrievalResult.messages;
    }
    
    // Get rolling summary from memory if available
    let rollingSummary = 'No prior summary available';
    if (this.memoryManager) {
      const summaryResults = this.memoryManager.search('chat summary', { topK: 1 });
      if (summaryResults.length > 0) {
        rollingSummary = summaryResults[0].content;
      }
    }
    
    // Build injection
    const injection = anchor
      ? anchor.buildInjection(retrieved.slice(-4), messages.length)
      : this._buildRAGInjection(rollingSummary, retrieved.length);
    
    return {
      mode: 'rag_only',
      retrieved: retrieved,
      summary: rollingSummary,
      injection: injection,
      tokenCount: this._countTotalTokens(retrieved) + countTokens(rollingSummary),
      originalTokenCount: this._countTotalTokens(messages),
      compressionRatio: this._countTotalTokens(messages) / this._countTotalTokens(retrieved),
      modelClass: this.modelClass,
      ragQuery: userMessage
    };
  }

  /**
   * Build injection for artifact-only mode
   */
  _buildArtifactInjection(artifacts) {
    return `═══ EXTRACTED ARTIFACTS ═══\n${formatArtifacts(artifacts)}\n`;
  }

  /**
   * Build injection for summary mode
   */
  _buildSummaryInjection(summary, artifacts) {
    return `═══ PRIOR CONTEXT SUMMARY ═══\n${summary}\n\n═══ ARTIFACTS ═══\n${artifacts}\n`;
  }

  /**
   * Build injection for RAG mode
   */
  _buildRAGInjection(summary, retrievedCount) {
    return `═══ RETRIEVED CONTEXT ═══\n${summary}\n\nRetrieved ${retrievedCount} relevant messages from history.\n`;
  }

  /**
   * Count total tokens across messages
   */
  _countTotalTokens(messages) {
    return messages.reduce((sum, msg) => sum + countTokens(msg.content || ''), 0);
  }

  /**
   * Get compression stats
   */
  getStats() {
    return {
      modelClass: this.modelClass,
      thresholds: this.thresholds,
      compressionStats: this.compressor.compressionStats
    };
  }
}

export default UnifiedContextManager;
