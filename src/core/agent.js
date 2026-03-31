/**
 * Autonomous Agent Core
 * Planning, execution, tool calling with self-healing
 * Fixes: Proper ESM, no require(), real completion detection, no context bloat
 * Added: ContextManager for automatic chat compaction to prevent context overflow
 */

import { loadConfig, getConfig } from './config.js';
import { CircuitBreaker } from '../health/circuit-breaker.js';
import { MemoryManager } from '../memory/memory.js';
import { ContextManager } from './context-manager.js';
import { SessionManager } from './session-manager.js';

const MAX_ITERATIONS = 50;
const MAX_TOOL_FAILURES = 3;
const MAX_TOOL_REPEATS = 3;
const MAX_TOOL_USES = 12;

export class Agent {
  constructor(options = {}) {
    this.config = loadConfig();
    this.memory = new MemoryManager();
    this.circuitBreaker = new CircuitBreaker();
    this.contextManager = new ContextManager();
    this.sessionManager = new SessionManager();
    this.sessionHistory = [];
    this.toolFailures = new Map();
    this.toolCounts = new Map();
    this.lastToolCall = null;
    this.iterationCount = 0;
    this.providerHealthy = true;
    this.currentProvider = this.config.provider;
    this.currentModel = this.config.model;
    this.currentBaseUrl = this.config.baseUrl;
  }

  async initialize() {
    await this.memory.initialize();
    await this.runHealthCheck();
    console.log('[Agent] Initialized with', this.currentProvider, '/', this.currentModel);
  }

  /**
   * Check and compact session history if context usage is too high
   * Called before each run to ensure we have room to work
   */
  async ensureContextCapacity() {
    const status = this.contextManager.shouldCompact(this.sessionHistory);
    
    if (status.needsCompaction) {
      console.log(`[Agent] Context at ${Math.round(status.usagePercent * 100)}% - triggering compaction`);
      const result = await this.contextManager.compact(this.sessionHistory, this.memory);
      
      if (result.compactedMessages) {
        this.sessionHistory = result.compactedMessages;
        console.log(`[Agent] Compaction complete: ${result.summary?.messageCount || 0} messages summarized`);
        return { compacted: true, summary: result.summary };
      }
    }
    
    return { compacted: false };
  }

  async runHealthCheck() {
    try {
      const response = await fetch(`${this.currentBaseUrl}/models`, {
        method: 'GET',
        headers: this.currentProvider === 'ollama' ? {} : {
          'Authorization': `Bearer ${this.config.apiKey}`
        },
        signal: AbortSignal.timeout(5000)
      });
      this.providerHealthy = response.ok;
      if (!response.ok) {
        console.warn('[Health] Provider check failed:', response.status);
        await this.tryFailover();
      }
    } catch (e) {
      console.warn('[Health] Provider unreachable:', e.message);
      this.providerHealthy = false;
      await this.tryFailover();
    }
  }

  async tryFailover() {
    if (!this.config.fallbackModel || !this.config.fallbackBaseUrl) {
      console.warn('[Failover] No fallback configured');
      return false;
    }
    console.log('[Failover] Switching to fallback:', this.config.fallbackModel);
    this.currentProvider = this.config.provider;
    this.currentModel = this.config.fallbackModel;
    this.currentBaseUrl = this.config.fallbackBaseUrl;
    try {
      const response = await fetch(`${this.currentBaseUrl}/models`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });
      this.providerHealthy = response.ok;
      return response.ok;
    } catch (e) {
      console.error('[Failover] Fallback also unreachable:', e.message);
      return false;
    }
  }

  buildSystemPrompt(task, context = []) {
    const tools = [
      'browser_navigate(url)',
      'browser_screenshot()',
      'browser_get_links()',
      'shell_exec(command)',
      'file_read(path)',
      'file_write(path, content)',
      'git_status()',
      'git_commit(message)',
      'git_push()',
      'memory_store(text)',
      'memory_search(query)',
      'health_check()',
      'skill_install(source, name)',
      'skill_list()',
      'skill_approve(name)',
      'skill_execute(name, args)',
      'skill_uninstall(name)',
      'email_send(to, subject, body)',
      'email_send_html(to, subject, htmlBody)',
      'email_list(limit)',
      'email_read(id)',
      'email_check_status()',
      'models_list(source, limit)'
    ].join(', ');

    const workspacePolicy = `You operate ONLY inside /home/corp-unum/openunumQwen unless explicitly told otherwise. Never modify files outside this directory without explicit permission.`;

    return `You are OpenUnum Qwen, an autonomous AI assistant.

WORKSPACE POLICY: ${workspacePolicy}

AVAILABLE TOOLS: ${tools}

COMPLETION CRITERIA:
- Task is complete when the user's goal is fully achieved
- Provide proof of completion (file created, test passed, URL accessible, etc.)
- Do NOT mark as complete based on vague phrases like "done" or "success"
- Verify actual outcomes before declaring completion

AUTONOMY RULES:
- Plan step-by-step before acting
- Execute one tool call at a time
- If a tool fails 3 times, skip it and try alternative approach
- If stuck, ask for clarification
- Self-heal: check health, retry, failover if needed
- Sync to GitHub after every code change
- Self-poke: After task completion, ask "What else can I improve?"
- Learn from failures: Record failure patterns and solutions
- Learn from successes: Record successful patterns for reuse
- Research daily: Run research agent at 3AM for improvement ideas

CONTEXT: ${context.slice(-5).map(c => c.role + ': ' + c.content.slice(0, 200)).join(' | ')}

TASK: ${task}`;
  }

  async plan(task, context = []) {
    const systemPrompt = this.buildSystemPrompt(task, context);
    
    const planningPrompt = `Create a step-by-step execution plan for this task.
Return ONLY a JSON array of steps: [{"step": 1, "action": "description", "tool": "tool_name_or_none"}]

Task: ${task}`;

    try {
      const response = await this.callModel(systemPrompt, planningPrompt, { temperature: 0.3 });
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return [{ step: 1, action: 'Execute task', tool: 'none' }];
    } catch (e) {
      console.warn('[Plan] Failed to generate plan, using default:', e.message);
      return [{ step: 1, action: 'Execute task autonomously', tool: 'none' }];
    }
  }

  async generateToolArgs(step, task, results) {
    const toolDescriptions = {
      shell_exec: '{ command: string, timeout?: number, cwd?: string }',
      file_write: '{ path: string, content: string }',
      file_read: '{ path: string }',
      git_status: '{}',
      git_commit: '{ message: string }',
      git_push: '{}',
      memory_store: '{ text: string }',
      memory_search: '{ query: string, topK?: number }',
      health_check: '{}',
      browser_navigate: '{ url: string }',
      browser_screenshot: '{}',
      browser_get_links: '{}'
    };

    const argsPrompt = `Generate tool arguments for this step:
Step: ${step.action}
Tool: ${step.tool}
Task: ${task}
Previous results: ${JSON.stringify(results.slice(-2))}

Return ONLY JSON matching this schema: ${toolDescriptions[step.tool] || '{}'}

Example for shell_exec: {"command": "ls -la"}
Example for file_write: {"path": "docs/test.md", "content": "hello"}`;

    try {
      const response = await this.callModel(
        this.buildSystemPrompt(task, this.sessionHistory),
        argsPrompt,
        { temperature: 0.1, maxTokens: 300 }
      );
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        // Validate required fields for known tools
        if (step.tool === 'file_write' && (!parsed.path || parsed.content === undefined)) {
          console.warn('[Args] Invalid file_write args, using defaults');
          return { path: 'docs/output.md', content: 'Generated content' };
        }
        if (step.tool === 'file_read' && !parsed.path) {
          console.warn('[Args] Invalid file_read args, using defaults');
          return { path: 'docs/output.md' };
        }
        return parsed;
      }
      return {};
    } catch (e) {
      console.warn('[Args] Failed to generate args:', e.message);
      return {};
    }
  }

  async callModel(systemPrompt, userPrompt, options = {}) {
    if (!this.providerHealthy) {
      const recovered = await this.tryFailover();
      if (!recovered) {
        throw new Error('No healthy provider available');
      }
    }

    const url = `${this.currentBaseUrl}/chat/completions`;
    const headers = {
      'Content-Type': 'application/json',
      ...(this.currentProvider !== 'ollama' && { 'Authorization': `Bearer ${this.config.apiKey}` })
    };

    const body = {
      model: this.currentModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 4096
    };

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeout ?? 120000)
    });

    if (!response.ok) {
      if (response.status >= 500) {
        console.warn('[Model] Server error, triggering failover');
        this.providerHealthy = false;
        await this.tryFailover();
        return this.callModel(systemPrompt, userPrompt, options);
      }
      throw new Error(`Model API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  }

  async executeTool(toolName, args) {
    const key = `${toolName}:${JSON.stringify(args)}`;
    
    // Check for repeated identical calls
    if (this.lastToolCall === key) {
      this.toolFailures.set(key, (this.toolFailures.get(key) || 0) + 1);
      if (this.toolFailures.get(key) >= MAX_TOOL_REPEATS) {
        throw new Error(`Tool ${toolName} called repeatedly with same args, aborting`);
      }
    }
    this.lastToolCall = key;

    // Check tool usage count
    this.toolCounts.set(toolName, (this.toolCounts.get(toolName) || 0) + 1);
    if (this.toolCounts.get(toolName) > MAX_TOOL_USES) {
      throw new Error(`Tool ${toolName} exceeded max uses (${MAX_TOOL_USES})`);
    }

    // Circuit breaker check
    if (!this.circuitBreaker.canExecute(toolName)) {
      throw new Error(`Circuit breaker open for ${toolName}`);
    }

    try {
      const result = await this.invokeTool(toolName, args);
      this.toolFailures.delete(key);
      this.circuitBreaker.recordSuccess(toolName);
      return { success: true, result };
    } catch (e) {
      this.circuitBreaker.recordFailure(toolName);
      const failures = this.toolFailures.get(key) || 0;
      this.toolFailures.set(key, failures + 1);
      if (failures + 1 >= MAX_TOOL_FAILURES) {
        console.warn(`[Tool] ${toolName} disabled after ${MAX_TOOL_FAILURES} failures`);
      }
      throw e;
    }
  }

  async invokeTool(toolName, args) {
    // Tool implementations loaded dynamically
    const { BrowserTool } = await import('../tools/browser.js');
    const { ShellTool } = await import('../tools/shell.js');
    const { FileTool } = await import('../tools/file.js');
    const { GitTool } = await import('../tools/git.js');
    const { MemoryTool } = await import('../tools/memory.js');
    const { HealthTool } = await import('../tools/health.js');
    const { SkillTool } = await import('../tools/skills.js');
    const { EmailTool } = await import('../tools/email.js');
    const { ModelsTool } = await import('../tools/models.js');

    const tools = {
      browser_navigate: BrowserTool.navigate,
      browser_screenshot: BrowserTool.screenshot,
      browser_get_links: BrowserTool.getLinks,
      shell_exec: ShellTool.exec,
      file_read: FileTool.read,
      file_write: FileTool.write,
      git_status: GitTool.status,
      git_commit: GitTool.commit,
      git_push: GitTool.push,
      memory_store: MemoryTool.store,
      memory_search: MemoryTool.search,
      health_check: HealthTool.check,
      skill_install: SkillTool.install,
      skill_list: SkillTool.list,
      skill_approve: SkillTool.approve,
      skill_execute: SkillTool.execute,
      skill_uninstall: SkillTool.uninstall,
      email_send: EmailTool.send,
      email_send_html: EmailTool.sendHtml,
      email_list: EmailTool.list,
      email_read: EmailTool.read,
      email_check_status: EmailTool.checkStatus,
      models_list: ModelsTool.list
    };

    if (!tools[toolName]) {
      throw new Error(`Unknown tool: ${toolName}`);
    }

    return await tools[toolName](args, this.config);
  }

  async run(task, options = {}) {
    await this.initialize();
    
    // Ensure we have a session
    if (!this.sessionManager.currentSessionId) {
      this.sessionManager.createSession();
    }
    
    // Check context usage and compact if needed BEFORE processing
    const compactionResult = await this.ensureContextCapacity();
    if (compactionResult.compacted) {
      console.log('[Agent] Context was compacted, summary saved to memory');
    }
    
    // Add user message to history and persist to session
    this.sessionHistory.push({ role: 'user', content: task });
    this.sessionManager.addMessage('user', task);
    
    const plan = await this.plan(task, this.sessionHistory);
    console.log('[Agent] Plan:', JSON.stringify(plan, null, 2));

    const results = [];
    for (const step of plan) {
      if (this.iterationCount >= MAX_ITERATIONS) {
        console.warn('[Agent] Max iterations reached');
        break;
      }
      this.iterationCount++;

      try {
        if (step.tool && step.tool !== 'none') {
          // Generate tool parameters via model
          const toolArgs = await this.generateToolArgs(step, task, results);
          const result = await this.executeTool(step.tool, toolArgs);
          results.push({ step: step.step, tool: step.tool, result, status: 'success' });
          console.log(`[Agent] Step ${step.step} complete: ${step.action}`);
        } else {
          // Direct model execution for non-tool steps
          const response = await this.callModel(
            this.buildSystemPrompt(task, this.sessionHistory),
            `Execute: ${step.action}\nPrevious results: ${JSON.stringify(results.slice(-3))}`
          );
          results.push({ step: step.step, action: step.action, response, status: 'success' });
          console.log(`[Agent] Step ${step.step} complete: ${step.action}`);
        }

        // Self-healing: run health check periodically
        if (this.iterationCount % 5 === 0) {
          await this.runHealthCheck();
        }
      } catch (e) {
        console.error(`[Agent] Step ${step.step} failed:`, e.message);
        results.push({ step: step.step, tool: step.tool, error: e.message, status: 'failed' });
        
        // Attempt recovery
        const recovery = await this.attemptRecovery(task, e, results);
        if (recovery.recovered) {
          console.log('[Agent] Recovered, continuing...');
        } else {
          console.warn('[Agent] Recovery failed, skipping step');
        }
      }
    }

    // Generate final response for the user
    const finalResponse = await this.generateFinalResponse(task, results);
    
    // Add agent response to history and persist to session
    this.sessionHistory.push({ role: 'assistant', content: finalResponse });
    this.sessionManager.addMessage('assistant', finalResponse);
    
    // Verify completion
    const completionCheck = await this.verifyCompletion(task, results);
    
    // Check context again after adding response - may need immediate compaction
    const postRunStatus = this.contextManager.shouldCompact(this.sessionHistory);
    if (postRunStatus.needsCompaction) {
      console.log(`[Agent] Post-run context at ${Math.round(postRunStatus.usagePercent * 100)}% - will compact on next run`);
    }
    
    return {
      task,
      plan,
      results,
      completed: completionCheck.completed,
      proof: completionCheck.proof,
      iterations: this.iterationCount,
      answer: finalResponse,
      contextUsage: {
        percent: postRunStatus.usagePercent,
        tokens: postRunStatus.usedTokens,
        window: postRunStatus.contextWindow
      }
    };
  }

  /**
   * Get current context usage stats (for UI display)
   */
  getContextStats() {
    const status = this.contextManager.shouldCompact(this.sessionHistory);
    return {
      usagePercent: Math.round(status.usagePercent * 100),
      usedTokens: status.usedTokens,
      contextWindow: status.contextWindow,
      availableTokens: status.contextWindow - status.usedTokens,
      needsCompaction: status.needsCompaction,
      messageCount: this.sessionHistory.length
    };
  }

  /**
   * Clear session history (for /new command)
   */
  clearHistory() {
    const count = this.sessionHistory.length;
    this.sessionHistory = [];
    console.log(`[Agent] Cleared ${count} messages from session history`);
    
    // Also clear persisted session
    this.sessionManager.clearCurrentSession();
    
    return { cleared: true, previousCount: count };
  }

  /**
   * Session management methods
   */
  
  // Create a new session
  createSession() {
    this.sessionHistory = [];
    const session = this.sessionManager.createSession();
    return session;
  }

  // Load a session by ID
  loadSession(id) {
    const session = this.sessionManager.loadSession(id);
    this.sessionHistory = session.messages || [];
    this.sessionManager.currentSessionId = id;
    return session;
  }

  // List all sessions
  listSessions(limit = 50) {
    return this.sessionManager.listSessions(limit);
  }

  // Delete a session
  deleteSession(id) {
    return this.sessionManager.deleteSession(id);
  }

  // Get current session
  getCurrentSession() {
    return this.sessionManager.getCurrentSession();
  }

  // Get session count
  getSessionCount() {
    return this.sessionManager.getSessionCount();
  }

  async generateFinalResponse(task, results) {
    const successfulSteps = results.filter(r => r.status === 'success');
    const failedSteps = results.filter(r => r.status === 'failed');
    
    // Priority 1: Extract clean answer from last successful result
    if (successfulSteps.length > 0) {
      const lastResult = successfulSteps[successfulSteps.length - 1];
      const answer = this.extractCleanAnswer(lastResult);
      if (answer) {
        return answer;
      }
    }
    
    // Priority 2: Format structured tool results (models_list, etc.)
    for (const step of successfulSteps.slice().reverse()) {
      if (step.result) {
        if (step.result.local || step.result.summary) {
          return this.formatModelList(step.result);
        }
        if (step.result.checks) {
          return this.formatHealthCheck(step.result);
        }
        if (step.result.branch !== undefined) {
          return this.formatGitStatus(step.result);
        }
      }
    }
    
    // Priority 3: Generate summary via model
    try {
      const summary = await this.callModel(
        this.buildSystemPrompt(task, this.sessionHistory),
        `Task: ${task}
        Results: ${JSON.stringify(results.slice(-5))}
        
        Provide a CRYSTAL CLEAR, direct answer to the user's question.
        - Put the answer FIRST, before any explanation
        - Use formatting (bold, tables, lists) for clarity
        - If task failed, say so clearly and explain why
        - Do NOT include tool call markup or internal details
        - Be concise but complete`
      );
      return summary;
    } catch (e) {
      // Fallback: simple summary
      const status = failedSteps.length === 0 ? '✅ Completed' : `⚠️ Partial (${successfulSteps.length}/${results.length} steps)`;
      return `${status}\n\nTask: ${task}\n\n${successfulSteps.length} steps executed successfully.${failedSteps.length > 0 ? ` ${failedSteps.length} steps failed.` : ''}`;
    }
  }

  /**
   * Extract a clean answer from a result object
   */
  extractCleanAnswer(result) {
    if (!result) return null;
    
    // String results
    if (typeof result === 'string' && result.trim().length > 10) {
      // Remove tool markup if present
      let clean = result.replace(/<tool_code>[\s\S]*?<\/tool_code>/g, '').trim();
      if (clean.length > 10) {
        return clean;
      }
    }
    
    // Object with content/stdout/output
    if (result.content && typeof result.content === 'string') {
      return result.content;
    }
    if (result.stdout && typeof result.stdout === 'string') {
      return result.stdout;
    }
    if (result.output && typeof result.output === 'string') {
      return result.output;
    }
    if (result.text && typeof result.text === 'string') {
      return result.text;
    }
    
    return null;
  }

  /**
   * Format health check results
   */
  formatHealthCheck(result) {
    let output = `## System Health Status\n\n`;
    const checks = result.checks || {};
    
    for (const [key, check] of Object.entries(checks)) {
      const icon = check.status === 'healthy' ? '✅' : check.status === 'degraded' ? '⚠️' : '❌';
      output += `- **${key}**: ${icon} ${check.status}`;
      if (check.details) output += ` (${check.details})`;
      output += `\n`;
    }
    
    output += `\n**Overall:** ${result.overall || 'unknown'}`;
    return output;
  }

  /**
   * Format git status results
   */
  formatGitStatus(result) {
    return `## Git Status\n\n` +
      `**Branch:** ${result.branch}\n` +
      `**Ahead:** ${result.ahead || 0} | **Behind:** ${result.behind || 0}\n` +
      `**Modified:** ${result.modified || 0} | **Staged:** ${result.staged || 0} | **Untracked:** ${result.untracked || 0}`;
  }

  formatModelList(result) {
    let output = `## Available Models\n\n`;
    output += `| Model | Size | Family | Parameters | Context | Best For |\n`;
    output += `|-------|------|--------|------------|---------|----------|\n`;
    
    if (result.local && result.local.length > 0) {
      result.local.forEach(m => {
        output += `| ${m.name} | ${m.size} | ${m.family} | ${m.parameters} | ${m.context} | ${m.goodFor} |\n`;
      });
    }
    
    output += `\n**Summary:** ${result.summary?.totalLocal || 0} local + ${result.summary?.totalCloud || 0} cloud = ${result.summary?.total || 0} total`;
    return output;
  }

  async attemptRecovery(task, error, results) {
    console.log('[Recovery] Attempting to recover from:', error.message);
    
    // Try failover if provider-related
    if (error.message.includes('provider') || error.message.includes('API')) {
      const recovered = await this.tryFailover();
      if (recovered) {
        return { recovered: true, method: 'failover' };
      }
    }

    // Try alternative approach via model
    try {
      const alternative = await this.callModel(
        this.buildSystemPrompt(task, this.sessionHistory),
        `Previous approach failed: ${error.message}
        Results so far: ${JSON.stringify(results.slice(-3))}
        Suggest an alternative approach to complete the task.`
      );
      return { recovered: true, method: 'alternative', suggestion: alternative };
    } catch (e) {
      return { recovered: false, error: e.message };
    }
  }

  async verifyCompletion(task, results) {
    const verification = await this.callModel(
      this.buildSystemPrompt(task, this.sessionHistory),
      `Task: ${task}
      Results: ${JSON.stringify(results)}
      
      Has the task been FULLY completed? Provide concrete proof.
      Return JSON: {"completed": true/false, "proof": "description of evidence"}`
    );

    try {
      const jsonMatch = verification.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (e) {}

    return { completed: false, proof: 'Verification inconclusive' };
  }

  addSessionMessage(role, content) {
    this.sessionHistory.push({ role, content, timestamp: Date.now() });
    if (this.sessionHistory.length > 50) {
      this.sessionHistory = this.sessionHistory.slice(-50);
    }
  }
}
