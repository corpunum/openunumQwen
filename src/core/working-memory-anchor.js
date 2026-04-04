/**
 * Working Memory Anchor System
 * 
 * Keeps the original task + plan injected as a "ghost message" on every model turn.
 * Designed for weak models (9B) that lose context after 3-4 turns.
 * 
 * Structure:
 *   ANCHOR (always present, never compacted)
 *   - User origin task
 *   - Agent's initial plan
 *   - Success contract
 *   
 *   COMPACTED MIDDLE (summarized with pointer to full history)
 *   - Turns 3 to N-4 summarized
 *   - Pointer to session file for recovery
 *   
 *   RECENT TURNS (raw, last 4 turns)
 *   - Full detail for immediate context
 *   
 *   INJECTION PROMPT (directive to continue, not re-plan)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

export class WorkingMemoryAnchor {
  constructor({ sessionId, workspaceRoot, maxRecentTurns = 4, compactionThreshold = 12 }) {
    this.sessionId = sessionId;
    this.workspaceRoot = workspaceRoot || process.cwd();
    this.maxRecentTurns = maxRecentTurns;  // Keep last N turns raw
    this.compactionThreshold = compactionThreshold;  // Compact after N turns
    this.dataDir = join(this.workspaceRoot, 'data', 'working-memory');
    
    // Ensure data directory exists
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }

    this.anchor = {
      userOrigin: null,      // Original user task
      planAgreed: null,      // Agent's initial plan (may be multi-level)
      contract: null,        // Success criteria + forbidden drift
      subplans: [],          // Array of subplans if task is broken down
      currentSubplanIndex: 0,
      createdAt: null
    };
    
    this.compactedSummary = null;
    this.compactionPointer = null;  // Session ID or file path for full history
    this.turnCount = 0;
    
    // Load existing anchor if present
    this._loadAnchor();
  }

  /**
   * Set the anchor (called on first turn)
   * 
   * @param {string} userTask - Original user request
   * @param {string|object} agentPlan - Initial plan (string or decomposed steps)
   * @param {object} contract - Success criteria
   */
  setAnchor(userTask, agentPlan, contract = {}) {
    const planText = typeof agentPlan === 'string' 
      ? agentPlan 
      : (agentPlan.steps || []).join(' → ');

    this.anchor = {
      userOrigin: userTask.trim(),
      planAgreed: planText,
      contract: {
        successCriteria: contract.successCriteria || 'Task completed as specified',
        forbiddenDrift: contract.forbiddenDrift || [],
        requiredOutputs: contract.requiredOutputs || [],
        ...contract
      },
      subplans: agentPlan.subplans || [],
      currentSubplanIndex: 0,
      createdAt: new Date().toISOString()
    };

    // Persist anchor to disk
    this._persistAnchor();

    console.log('[WorkingMemoryAnchor] Anchor set', {
      sessionId: this.sessionId,
      userOrigin: this.anchor.userOrigin.slice(0, 100),
      planSteps: (agentPlan.steps || []).length,
      subplans: this.anchor.subplans.length
    });
  }

  /**
   * Update current subplan (when moving to next phase of large task)
   */
  setCurrentSubplan(index) {
    if (index < 0 || index >= this.anchor.subplans.length) {
      console.error('[WorkingMemoryAnchor] Invalid subplan index', { index, total: this.anchor.subplans.length });
      return false;
    }
    this.anchor.currentSubplanIndex = index;
    this._persistAnchor();
    console.log('[WorkingMemoryAnchor] Subplan changed', { index, sessionId: this.sessionId });
    return true;
  }

  /**
   * Get current subplan context
   */
  getCurrentSubplan() {
    if (!this.anchor.subplans.length) return null;
    return {
      index: this.anchor.currentSubplanIndex,
      total: this.anchor.subplans.length,
      subplan: this.anchor.subplans[this.anchor.currentSubplanIndex]
    };
  }

  /**
   * Build the injection payload for each turn
   * 
   * @param {Array} recentMessages - Last N turns (raw)
   * @param {number} totalTurns - Total turn count
   * @returns {string} Injection payload to prepend as system message
   */
  buildInjection(recentMessages, totalTurns) {
    this.turnCount = totalTurns;
    const parts = [];

    // 1. ANCHOR (always present)
    if (this.anchor.userOrigin) {
      parts.push('═══ WORKING MEMORY ANCHOR ═══');
      parts.push(`[USER ORIGIN]: ${this.anchor.userOrigin}`);
      
      if (this.anchor.planAgreed) {
        parts.push(`[PLAN AGREED]: ${this.anchor.planAgreed}`);
      }

      // Subplan context (if multi-phase task)
      const subplan = this.getCurrentSubplan();
      if (subplan) {
        parts.push(`[SUBPLAN]: ${subplan.index + 1}/${subplan.total} — ${subplan.subplan.title || 'Phase ' + (subplan.index + 1)}`);
        if (subplan.subplan.steps) {
          parts.push(`[SUBPLAN STEPS]: ${subplan.subplan.steps.join(' → ')}`);
        }
        if (subplan.subplan.completedSteps) {
          parts.push(`[COMPLETED]: ${subplan.subplan.completedSteps.join(', ')}`);
        }
      }

      if (this.anchor.contract.successCriteria) {
        parts.push(`[SUCCESS CRITERIA]: ${this.anchor.contract.successCriteria}`);
      }

      if (this.anchor.contract.forbiddenDrift?.length) {
        parts.push(`[FORBIDDEN DRIFT]: Do NOT ${this.anchor.contract.forbiddenDrift.join(', ')}`);
      }

      parts.push(''); // Blank line separator
    }

    // 2. COMPACTED MIDDLE (if we have enough turns)
    if (this.compactedSummary && totalTurns > this.compactionThreshold) {
      parts.push('═══ COMPACTED HISTORY ═══');
      parts.push(`Turns 1-${totalTurns - this.maxRecentTurns} summarized below.`);
      parts.push(`Full history available in session file: ${this.compactionPointer || 'N/A'}`);
      parts.push('');
      parts.push(this.compactedSummary);
      parts.push('');
    }

    // 3. RECENT TURNS (raw, last N turns)
    if (recentMessages && recentMessages.length > 0) {
      parts.push('═══ RECENT TURNS ═══');
      for (const msg of recentMessages) {
        const role = msg.role === 'user' ? 'USER' : 'ASSISTANT';
        parts.push(`[${role}]: ${msg.content}`);
      }
      parts.push('');
    }

    // 4. INJECTION PROMPT (directive to continue)
    parts.push('═══ CONTINUATION DIRECTIVE ═══');
    parts.push('You are continuing an existing task. DO NOT re-plan or re-state the goal.');
    parts.push('Focus on the immediate next step based on the recent turns above.');
    parts.push(`Current turn: ${totalTurns}. Recent context: ${recentMessages?.length || 0} messages.`);
    if (this.compactedSummary) {
      parts.push('Older context has been summarized — refer to session file if you need full history.');
    }
    parts.push('');

    return parts.join('\n');
  }

  /**
   * Update the compacted summary (called when compaction happens)
   */
  updateCompactedSummary(summary, pointer) {
    this.compactedSummary = summary;
    this.compactionPointer = pointer;
    this._persistAnchor();
  }

  /**
   * Get anchor state
   */
  getAnchor() {
    return { ...this.anchor, turnCount: this.turnCount };
  }

  /**
   * Persist anchor to disk
   */
  _persistAnchor() {
    const filePath = join(this.dataDir, `${this.sessionId}.json`);
    const data = {
      anchor: this.anchor,
      compactedSummary: this.compactedSummary,
      compactionPointer: this.compactionPointer,
      turnCount: this.turnCount,
      lastUpdated: new Date().toISOString()
    };
    writeFileSync(filePath, JSON.stringify(data, null, 2));
  }

  /**
   * Load anchor from disk
   */
  _loadAnchor() {
    const filePath = join(this.dataDir, `${this.sessionId}.json`);
    if (!existsSync(filePath)) {
      return; // Fresh session
    }

    try {
      const data = JSON.parse(readFileSync(filePath, 'utf-8'));
      this.anchor = data.anchor || this.anchor;
      this.compactedSummary = data.compactedSummary;
      this.compactionPointer = data.compactionPointer;
      this.turnCount = data.turnCount || 0;
      console.log('[WorkingMemoryAnchor] Loaded existing anchor', { sessionId: this.sessionId, turnCount: this.turnCount });
    } catch (e) {
      console.error('[WorkingMemoryAnchor] Failed to load anchor:', e.message);
    }
  }

  /**
   * Clear anchor (for session reset)
   */
  clear() {
    const filePath = join(this.dataDir, `${this.sessionId}.json`);
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
    this.anchor = {
      userOrigin: null,
      planAgreed: null,
      contract: null,
      subplans: [],
      currentSubplanIndex: 0,
      createdAt: null
    };
    this.compactedSummary = null;
    this.compactionPointer = null;
    this.turnCount = 0;
  }
}

export default WorkingMemoryAnchor;
