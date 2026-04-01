/**
 * Memory Tool Wrapper
 * Interfaces with MemoryManager for agent tool calling
 */

import { MemoryManager } from '../memory/memory.js';

let memoryManager = null;

function getManager(config) {
  if (!memoryManager) {
    memoryManager = new MemoryManager({
      dbPath: config?.memoryDbPath,
      bm25IndexPath: config?.bm25IndexPath
    });
  }
  return memoryManager;
}

export const MemoryTool = {
  async store(args, config) {
    const { text, id, metadata = {} } = args;

    if (!text) {
      throw new Error('Text required for memory_store');
    }

    const manager = getManager(config);
    await manager.initialize();

    const memoryId = id || `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const result = manager.store(memoryId, text, metadata);

    return {
      success: true,
      id: memoryId,
      created: result.created
    };
  },

  async search(args, config) {
    const { query, topK = 10 } = args;

    if (!query) {
      throw new Error('Query required for memory_search');
    }

    const manager = getManager(config);
    await manager.initialize();

    const results = manager.search(query, topK);

    return {
      success: true,
      query,
      count: results.length,
      results: results.map(r => ({
        id: r.id,
        content: r.content,
        score: r.score,
        metadata: r.metadata
      }))
    };
  },

  async get(args, config) {
    const { id } = args;

    if (!id) {
      throw new Error('ID required for memory_get');
    }

    const manager = getManager(config);
    await manager.initialize();

    const memory = manager.get(id);

    if (!memory) {
      return { success: false, notFound: true, id };
    }

    return {
      success: true,
      id: memory.id,
      content: memory.content,
      metadata: JSON.parse(memory.metadata || '{}'),
      created_at: memory.created_at
    };
  },

  async delete(args, config) {
    const { id } = args;

    if (!id) {
      throw new Error('ID required for memory_delete');
    }

    const manager = getManager(config);
    await manager.initialize();

    manager.delete(id);

    return { success: true, deleted: id };
  },

  async list(args, config) {
    const { limit = 20 } = args;

    const manager = getManager(config);
    await manager.initialize();

    const memories = manager.getAll(limit);

    return {
      success: true,
      count: memories.length,
      memories: memories.map(m => ({
        id: m.id,
        content: m.content.slice(0, 200),
        metadata: JSON.parse(m.metadata || '{}'),
        created_at: m.created_at
      }))
    };
  }
};
