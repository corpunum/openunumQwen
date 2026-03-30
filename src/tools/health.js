/**
 * Health Check Tool
 * Fixes: Real connectivity checks, not just metadata
 */

import { loadConfig } from '../core/config.js';

export const HealthTool = {
  async check(args, config) {
    const cfg = config || loadConfig();
    
    const results = {
      timestamp: Date.now(),
      checks: {},
      overall: 'healthy'
    };

    // 1. Provider connectivity (real HTTP check)
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(`${cfg.baseUrl}/models`, {
        method: 'GET',
        headers: cfg.provider === 'ollama' ? {} : {
          'Authorization': `Bearer ${cfg.apiKey}`
        },
        signal: controller.signal
      });
      clearTimeout(timeout);

      results.checks.provider = {
        status: response.ok ? 'healthy' : 'degraded',
        code: response.status,
        model: cfg.model
      };

      if (!response.ok) {
        results.overall = 'degraded';
      }
    } catch (e) {
      results.checks.provider = {
        status: 'unhealthy',
        error: e.message
      };
      results.overall = 'unhealthy';

      // Try fallback
      if (cfg.fallbackBaseUrl) {
        try {
          const fbResponse = await fetch(`${cfg.fallbackBaseUrl}/models`, {
            method: 'GET',
            signal: AbortSignal.timeout(5000)
          });
          results.checks.fallback = {
            status: fbResponse.ok ? 'healthy' : 'unhealthy',
            model: cfg.fallbackModel
          };
          if (fbResponse.ok) {
            results.overall = 'degraded';
            results.checks.provider.failoverAvailable = true;
          }
        } catch (fbError) {
          results.checks.fallback = {
            status: 'unhealthy',
            error: fbError.message
          };
        }
      }
    }

    // 2. Database health
    try {
      const { existsSync } = await import('node:fs');
      const { join } = await import('node:path');
      const dbPath = join(process.cwd(), cfg.memoryDbPath || './data/memory.db');
      const dbExists = existsSync(dbPath);
      results.checks.database = {
        status: dbExists ? 'healthy' : 'not_initialized',
        path: dbPath
      };
    } catch (e) {
      results.checks.database = {
        status: 'error',
        error: e.message
      };
    }

    // 3. Disk space
    try {
      const { exec } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execAsync = promisify(exec);
      const { stdout } = await execAsync('df -h / | tail -1');
      const parts = stdout.trim().split(/\s+/);
      const usePercent = parseInt(parts[4]) || 0;
      
      results.checks.disk = {
        status: usePercent > 90 ? 'critical' : usePercent > 80 ? 'warning' : 'healthy',
        used: parts[3],
        available: parts[2],
        percent: usePercent
      };

      if (results.checks.disk.status === 'critical') {
        results.overall = 'degraded';
      }
    } catch (e) {
      results.checks.disk = {
        status: 'unknown',
        error: e.message
      };
    }

    // 4. Browser/Playwright health
    try {
      await import('playwright');
      results.checks.browser = {
        status: 'healthy',
        mode: 'playwright'
      };
    } catch (e) {
      results.checks.browser = {
        status: 'fallback_only',
        mode: 'curl',
        note: 'Playwright not installed'
      };
    }

    // 5. Git health
    try {
      const { exec } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execAsync = promisify(exec);
      
      const { stdout: branch } = await execAsync('git branch --show-current');
      const { stdout: remote } = await execAsync('git remote get-url origin 2>/dev/null || echo "no_remote"');
      
      results.checks.git = {
        status: remote.includes('no_remote') ? 'no_remote' : 'healthy',
        branch: branch.trim(),
        remote: remote.trim().replace(/https:\/\/[^@]+@/, 'https://***@')
      };
    } catch (e) {
      results.checks.git = {
        status: 'error',
        error: e.message
      };
    }

    return results;
  }
};
