/**
 * Git Operations Tool with Auto-Sync
 * Fixes: Real git commands, proper error handling, GitHub sync
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

async function git(args, options = {}) {
  const { stdout, stderr } = await execAsync(`git ${args}`, {
    timeout: options.timeout || 30000,
    ...options
  });
  return { stdout: stdout.trim(), stderr: stderr.trim() };
}

export const GitTool = {
  async status(args, config) {
    try {
      const { stdout } = await git('status --porcelain');
      const { stdout: branchInfo } = await git('branch --show-current');
      
      const files = stdout.split('\n').filter(line => line.trim()).map(line => ({
        status: line.slice(0, 2).trim(),
        path: line.slice(3).trim()
      }));

      return {
        success: true,
        branch: branchInfo,
        dirty: files.length > 0,
        files
      };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  async add(args, config) {
    const { files = '.' } = args;
    try {
      await git(`add ${Array.isArray(files) ? files.join(' ') : files}`);
      return { success: true, added: files };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  async commit(args, config) {
    const { message, files = '.' } = args;

    if (!message) {
      throw new Error('Commit message required');
    }

    try {
      if (files) {
        await git(`add ${Array.isArray(files) ? files.join(' ') : files}`);
      }
      await git(`commit -m "${message.replace(/"/g, '\\"')}"`);
      const { stdout } = await git('log -1 --format="%H"');
      return { success: true, hash: stdout, message };
    } catch (e) {
      if (e.message.includes('nothing to commit')) {
        return { success: true, skipped: true, reason: 'no_changes' };
      }
      return { success: false, error: e.message };
    }
  },

  async push(args, config) {
    const { remote = 'origin', branch } = args;

    try {
      const { stdout: currentBranch } = await git('branch --show-current');
      const targetBranch = branch || currentBranch;

      // Check if remote exists
      try {
        await git(`remote get-url ${remote}`);
      } catch (e) {
        if (config.githubRepo && config.githubToken) {
          // Auto-setup remote
          const remoteUrl = `https://${config.githubToken}@github.com/${config.githubRepo}.git`;
          await git(`remote add ${remote} ${remoteUrl}`);
        } else {
          throw new Error('No remote configured. Set githubRepo and githubToken in config');
        }
      }

      await git(`push -u ${remote} ${targetBranch}`);
      return { success: true, remote, branch: targetBranch };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  async pull(args, config) {
    const { remote = 'origin', branch } = args;

    try {
      const { stdout: currentBranch } = await git('branch --show-current');
      const targetBranch = branch || currentBranch;
      await git(`pull ${remote} ${targetBranch}`);
      return { success: true, branch: targetBranch };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  async log(args, config) {
    const { limit = 10 } = args;
    try {
      const { stdout } = await git(`log -${limit} --format="%H|%s|%ai" --oneline`);
      const commits = stdout.split('\n').filter(line => line).map(line => {
        const [hash, message, date] = line.split('|');
        return { hash, message, date };
      });
      return { success: true, commits };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  async diff(args, config) {
    const { target = 'HEAD' } = args;
    try {
      const { stdout } = await git(`diff ${target}`);
      return { success: true, diff: stdout };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  async setupRemote(args, config) {
    const { repo, token, branch = 'main' } = args;

    if (!repo || !token) {
      throw new Error('repo and token required for setupRemote');
    }

    try {
      // Remove existing origin if present
      try {
        await git('remote remove origin');
      } catch (e) {}

      const remoteUrl = `https://${token}@github.com/${repo}.git`;
      await git(`remote add origin ${remoteUrl}`);
      
      // Initial push
      await git(`push -u origin ${branch}`);
      
      return { success: true, remote: repo, branch };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
};
