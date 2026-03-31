/**
 * Model Discovery Tool
 * Lists local and cloud models with detailed metadata
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export const ModelsTool = {
  async list(args, config) {
    const { source = 'all', limit = 50 } = args || {};
    const results = {
      local: [],
      cloud: [],
      summary: {}
    };

    // Local models via Ollama
    if (source === 'all' || source === 'local') {
      try {
        const { stdout } = await execAsync('ollama list --format json', {
          timeout: 10000
        });
        const models = JSON.parse(stdout);
        
        for (const m of (models.models || [])) {
          const details = await this.getModelDetails(m.name);
          results.local.push({
            name: m.name,
            size: this.formatSize(m.size),
            modified: m.modified_at ? new Date(m.modified_at).toLocaleDateString() : 'Unknown',
            family: m.details?.family || 'Unknown',
            parameters: m.details?.parameter_size || 'Unknown',
            quantization: m.details?.quantization_level || 'Unknown',
            context: this.estimateContext(m.details?.family),
            goodFor: this.getUseCase(m.details?.family, m.details?.parameter_size)
          });
        }
      } catch (e) {
        results.localError = e.message;
      }
    }

    // Cloud models from config
    if (source === 'all' || source === 'cloud') {
      const cloudModels = config.cloudModels || [
        { id: 'qwen3.5:397b-cloud', name: 'Qwen 3.5 397B', provider: 'Ollama Cloud' },
        { id: 'minimax-m2.7:cloud', name: 'MiniMax M2.7', provider: 'Ollama Cloud' },
        { id: 'kimi-k2.5:cloud', name: 'Kimi K2.5', provider: 'Ollama Cloud' },
        { id: 'glm-5:cloud', name: 'GLM-5', provider: 'Ollama Cloud' }
      ];
      
      for (const m of cloudModels) {
        results.cloud.push({
          name: m.id,
          displayName: m.name,
          provider: m.provider,
          context: m.context || '262K',
          goodFor: 'Complex reasoning, long context tasks'
        });
      }
    }

    results.summary = {
      totalLocal: results.local.length,
      totalCloud: results.cloud.length,
      total: results.local.length + results.cloud.length
    };

    return results;
  },

  async getModelDetails(modelName) {
    try {
      const { stdout } = await execAsync(`ollama show ${modelName} --modelfile`, {
        timeout: 5000
      });
      return { modelfile: stdout };
    } catch (e) {
      return {};
    }
  },

  formatSize(bytes) {
    if (!bytes) return 'Unknown';
    const gb = bytes / (1024 * 1024 * 1024);
    return `${gb.toFixed(1)} GB`;
  },

  estimateContext(family) {
    const contexts = {
      'qwen': '32K-262K',
      'llama': '8K-128K',
      'mistral': '32K',
      'gemma': '8K',
      'phi': '16K'
    };
    for (const [key, val] of Object.entries(contexts)) {
      if (family?.toLowerCase().includes(key)) return val;
    }
    return '4K-8K';
  },

  getUseCase(family, params) {
    const useCases = {
      'qwen': 'Coding, math, multilingual',
      'llama': 'General purpose, chat',
      'mistral': 'Fast inference, efficient',
      'gemma': 'Lightweight tasks',
      'phi': 'Reasoning, compact deployment'
    };
    
    let base = 'General tasks';
    for (const [key, val] of Object.entries(useCases)) {
      if (family?.toLowerCase().includes(key)) {
        base = val;
        break;
      }
    }

    const paramNum = parseFloat(params);
    if (paramNum > 100) base += ' (Large-scale reasoning)';
    else if (paramNum > 20) base += ' (Balanced performance)';
    else base += ' (Fast, efficient)';

    return base;
  }
};
