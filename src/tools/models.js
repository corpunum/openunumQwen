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

    // Local models via Ollama - parse text output (ollama list doesn't support --format json)
    if (source === 'all' || source === 'local') {
      try {
        const { stdout } = await execAsync('ollama list', {
          timeout: 10000
        });
        
        const lines = stdout.trim().split('\n').slice(1); // Skip header
        for (const line of lines) {
          if (!line.trim()) continue;
          
          // Parse: NAME         ID              SIZE      MODIFIED
          const parts = line.split(/\s+/);
          if (parts.length >= 4) {
            const name = parts[0];
            const size = parts[2];
            const modified = parts[3];
            
            // Get more details via ollama show
            const details = await this.getModelDetails(name);
            
            results.local.push({
              name: name,
              size: size,
              modified: modified,
              family: details.family || this.extractFamily(name),
              parameters: details.parameters || this.extractParameters(name),
              quantization: details.quantization || 'Unknown',
              context: this.estimateContext(details.family || name),
              goodFor: this.getUseCase(details.family || name, details.parameters)
            });
          }
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
      const { stdout } = await execAsync(`ollama show ${modelName}`, {
        timeout: 5000
      });
      
      // Parse ollama show output for key details
      const details = {
        family: this.extractFamily(modelName),
        parameters: this.extractParameters(modelName),
        quantization: 'Unknown'
      };
      
      // Try to extract family from output
      const familyMatch = stdout.match(/family\s+(\w+)/i);
      if (familyMatch) details.family = familyMatch[1];
      
      // Try to extract parameters
      const paramMatch = stdout.match(/parameter\s+size[:\s]+(\S+)/i);
      if (paramMatch) details.parameters = paramMatch[1];
      
      // Try to extract quantization
      const quantMatch = stdout.match(/quantization[:\s]+(\S+)/i);
      if (quantMatch) details.quantization = quantMatch[1];
      
      return details;
    } catch (e) {
      return {
        family: this.extractFamily(modelName),
        parameters: this.extractParameters(modelName),
        quantization: 'Unknown'
      };
    }
  },

  extractFamily(modelName) {
    const name = modelName.toLowerCase();
    if (name.includes('qwen')) return 'Qwen';
    if (name.includes('llama')) return 'Llama';
    if (name.includes('mistral')) return 'Mistral';
    if (name.includes('gemma')) return 'Gemma';
    if (name.includes('phi')) return 'Phi';
    if (name.includes('dolphin')) return 'Llama (Dolphin)';
    if (name.includes('uncensored')) return 'Uncensored';
    return 'Unknown';
  },

  extractParameters(modelName) {
    const name = modelName.toLowerCase();
    // Extract from model name like "qwen3.5:9b-64k" or "dolphin-llama3:8b"
    const paramMatch = name.match(/[:\-_](\d+(?:\.\d+)?)(b|m)/i);
    if (paramMatch) {
      const val = paramMatch[1];
      const unit = paramMatch[2].toLowerCase();
      return unit === 'b' ? `${val}B` : `${val}M`;
    }
    return 'Unknown';
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
