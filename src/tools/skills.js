/**
 * Skill System
 * Install, review, execute skills safely
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

const SKILLS_DIR = resolve(process.cwd(), 'skills');
const SKILLS_MANIFEST = join(SKILLS_DIR, 'manifest.json');

// Ensure skills directory exists
if (!existsSync(SKILLS_DIR)) {
  mkdirSync(SKILLS_DIR, { recursive: true });
}

// Initialize manifest if missing
if (!existsSync(SKILLS_MANIFEST)) {
  writeFileSync(SKILLS_MANIFEST, JSON.stringify({ skills: [], reviewed: [] }, null, 2));
}

function loadManifest() {
  return JSON.parse(readFileSync(SKILLS_MANIFEST, 'utf-8'));
}

function saveManifest(manifest) {
  writeFileSync(SKILLS_MANIFEST, JSON.stringify(manifest, null, 2));
}

export const SkillTool = {
  /**
   * Install a skill from GitHub or local path
   */
  async install(args, config) {
    const { source, name } = args;

    if (!source) {
      throw new Error('Source URL or path required');
    }

    const skillName = name || source.split('/').pop().replace('.js', '');
    const skillPath = join(SKILLS_DIR, `${skillName}.js`);

    if (existsSync(skillPath)) {
      throw new Error(`Skill ${skillName} already installed`);
    }

    // Download skill
    let skillCode;
    if (source.startsWith('http')) {
      const { default: fetch } = await import('node-fetch');
      const response = await fetch(source);
      if (!response.ok) {
        throw new Error(`Failed to download skill: ${response.status}`);
      }
      skillCode = await response.text();
    } else {
      // Local path
      skillCode = readFileSync(source, 'utf-8');
    }

    // Security review (basic static analysis)
    const review = await this.reviewCode(skillCode, skillName);

    // Save skill
    writeFileSync(skillPath, skillCode, 'utf-8');

    // Update manifest
    const manifest = loadManifest();
    manifest.skills.push({
      name: skillName,
      path: skillPath,
      installed_at: new Date().toISOString(),
      reviewed: false,
      review_status: review.status,
      security_flags: review.flags
    });
    saveManifest(manifest);

    return {
      success: true,
      skill: skillName,
      path: skillPath,
      review: review,
      requires_approval: review.status === 'pending'
    };
  },

  /**
   * Review a skill for security issues
   */
  async reviewCode(code, skillName) {
    const flags = [];
    const dangerousPatterns = [
      { pattern: /require\(['"]child_process['"]\)/, risk: 'high', msg: 'Direct child_process import' },
      { pattern: /eval\(/, risk: 'critical', msg: 'eval() usage' },
      { pattern: /Function\(/, risk: 'critical', msg: 'Function constructor' },
      { pattern: /process\.env/, risk: 'medium', msg: 'Environment variable access' },
      { pattern: /fetch\(/, risk: 'low', msg: 'Network access' },
      { pattern: /readFileSync|writeFileSync/, risk: 'medium', msg: 'Direct file I/O' }
    ];

    for (const { pattern, risk, msg } of dangerousPatterns) {
      if (pattern.test(code)) {
        flags.push({ pattern: msg, risk });
      }
    }

    // Determine review status
    const hasCritical = flags.some(f => f.risk === 'critical');
    const hasHigh = flags.some(f => f.risk === 'high');

    let status;
    if (hasCritical) {
      status = 'rejected';
    } else if (hasHigh) {
      status = 'pending';
    } else if (flags.length > 0) {
      status = 'reviewed';
    } else {
      status = 'safe';
    }

    return {
      status,
      flags,
      recommendation: status === 'safe' ? 'Approved for use' : 'Requires owner review'
    };
  },

  /**
   * List installed skills
   */
  list(args, config) {
    const manifest = loadManifest();
    return {
      success: true,
      count: manifest.skills.length,
      skills: manifest.skills.map(s => ({
        name: s.name,
        installed: s.installed_at,
        reviewed: s.reviewed,
        status: s.review_status
      }))
    };
  },

  /**
   * Mark a skill as reviewed/approved
   */
  approve(args, config) {
    const { name } = args;

    if (!name) {
      throw new Error('Skill name required');
    }

    const manifest = loadManifest();
    const skill = manifest.skills.find(s => s.name === name);

    if (!skill) {
      throw new Error(`Skill ${name} not found`);
    }

    skill.reviewed = true;
    skill.review_status = 'approved';
    skill.approved_at = new Date().toISOString();
    skill.approved_by = 'owner';

    saveManifest(manifest);

    return {
      success: true,
      skill: name,
      status: 'approved'
    };
  },

  /**
   * Execute a skill
   */
  async execute(args, config) {
    const { name, skillArgs = {} } = args;

    if (!name) {
      throw new Error('Skill name required');
    }

    const manifest = loadManifest();
    const skill = manifest.skills.find(s => s.name === name);

    if (!skill) {
      throw new Error(`Skill ${name} not found`);
    }

    if (!skill.reviewed && skill.review_status !== 'safe') {
      throw new Error(`Skill ${name} requires owner review before execution`);
    }

    // Load and execute skill
    const skillModule = await import(skill.path + '?t=' + Date.now()); // Cache bust

    if (!skillModule.Skill || !skillModule.Skill.execute) {
      throw new Error(`Invalid skill structure: ${name}`);
    }

    try {
      const result = await skillModule.Skill.execute(skillArgs, {
        config,
        skillsDir: SKILLS_DIR,
        workspaceRoot: process.cwd()
      });

      // Record usage
      skill.usage_count = (skill.usage_count || 0) + 1;
      skill.last_used = new Date().toISOString();
      if (result.success) {
        skill.success_count = (skill.success_count || 0) + 1;
      }
      saveManifest(manifest);

      return {
        success: true,
        skill: name,
        result
      };
    } catch (e) {
      // Record failure
      skill.failure_count = (skill.failure_count || 0) + 1;
      saveManifest(manifest);

      throw e;
    }
  },

  /**
   * Uninstall a skill
   */
  async uninstall(args, config) {
    const { name } = args;

    if (!name) {
      throw new Error('Skill name required');
    }

    const manifest = loadManifest();
    const skillIndex = manifest.skills.findIndex(s => s.name === name);

    if (skillIndex === -1) {
      throw new Error(`Skill ${name} not found`);
    }

    const skill = manifest.skills[skillIndex];

    // Remove file
    if (existsSync(skill.path)) {
      const { unlinkSync } = await import('node:fs');
      unlinkSync(skill.path);
    }

    // Remove from manifest
    manifest.skills.splice(skillIndex, 1);
    saveManifest(manifest);

    return {
      success: true,
      skill: name,
      action: 'uninstalled'
    };
  }
};
