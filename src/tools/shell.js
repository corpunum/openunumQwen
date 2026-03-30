/**
 * Shell Execution Tool
 * Proper ESM imports, timeout handling, safe execution
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export const ShellTool = {
  async exec(args, config) {
    const { command, timeout = 30000, cwd } = args;

    if (!command) {
      throw new Error('Command required for shell_exec');
    }

    // Safety: Block dangerous commands unless explicitly allowed
    const blockedPatterns = [
      /^rm\s+-rf\s+\/\//,
      /^mkfs/,
      /^dd\s+if=.*of=\/dev/,
      /:\(\)\{.*\};:$/,  // Fork bomb
      /^\s*:\(\)\s*\{/
    ];

    for (const pattern of blockedPatterns) {
      if (pattern.test(command)) {
        throw new Error(`Blocked dangerous command pattern: ${command}`);
      }
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout,
        cwd: cwd || config.workspaceRoot,
        maxBuffer: 10 * 1024 * 1024, // 10MB
        shell: '/bin/bash'
      });

      return {
        success: true,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: 0,
        timestamp: Date.now()
      };
    } catch (e) {
      return {
        success: false,
        stdout: e.stdout?.trim() || '',
        stderr: e.stderr?.trim() || e.message,
        exitCode: e.code || 1,
        signal: e.signal,
        timedOut: e.killed,
        timestamp: Date.now()
      };
    }
  },

  async execSafe(args, config) {
    // Whitelist-based execution for sensitive operations
    const allowedCommands = [
      /^git\s+(status|add|commit|push|pull|log|diff)/,
      /^pnpm\s+(install|run|test|build)/,
      /^npm\s+(install|run|test|build)/,
      /^node\s+--version/,
      /^pnpm\s+--version/,
      /^ls\s+/,
      /^cat\s+/,
      /^head\s+/,
      /^tail\s+/,
      /^grep\s+/,
      /^find\s+.*-maxdepth\s+[0-9]/,
      /^pwd/,
      /^echo\s+/
    ];

    const { command } = args;
    const isAllowed = allowedCommands.some(pattern => pattern.test(command));

    if (!isAllowed) {
      throw new Error(`Command not in whitelist: ${command}`);
    }

    return await this.exec(args, config);
  }
};
