/**
 * Autonomous Agent Core
 * Planning, execution, tool calling with self-healing
 * Fixes: Proper ESM, no require(), real completion detection, no context bloat
 */

import { loadConfig, getConfig } from './config.js';
import { CircuitBreaker } from '../health/circuit-breaker.js';
import { MemoryManager } from '../memory/memory.js';

const MAX_ITERATIONS = 20;
const MAX_TOOL_FAILURES = 3;
const MAX_TOOL_REPEATS = 3;
const MAX_TOOL_USES = 8;

export class Agent {
  constructor(options = {}) {
    this.config = loadConfig();
    this.memory = new MemoryManager();
    this.circuitBreaker = new CircuitBreaker();
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
      'health_check()'
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
      health_check: HealthTool.check
    };

    if (!tools[toolName]) {
      throw new Error(`Unknown tool: ${toolName}`);
    }

    return await tools[toolName](args, this.config);
  }

  async run(task, options = {}) {
    await this.initialize();
    
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

    // Verify completion
    const completionCheck = await this.verifyCompletion(task, results);
    
    return {
      task,
      plan,
      results,
      completed: completionCheck.completed,
      proof: completionCheck.proof,
      iterations: this.iterationCount
    };
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
