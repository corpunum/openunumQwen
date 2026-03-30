/**
 * Memory Manager with BM25 Retrieval
 * Fixes: Proper directory creation, real BM25 indexing, not just key-value
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

// Simple BM25 implementation for memory retrieval
class BM25Index {
  constructor(k1 = 1.5, b = 0.75) {
    this.k1 = k1;
    this.b = b;
    this.documents = new Map(); // id -> tokens
    this.docFreq = new Map(); // term -> count of docs containing term
    this.avgDocLength = 0;
    this.totalDocs = 0;
  }

  tokenize(text) {
    return text.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(t => t.length > 2);
  }

  addDocument(id, text) {
    const tokens = this.tokenize(text);
    this.documents.set(id, tokens);
    
    // Update document frequency
    const uniqueTokens = new Set(tokens);
    for (const token of uniqueTokens) {
      this.docFreq.set(token, (this.docFreq.get(token) || 0) + 1);
    }
    
    this.totalDocs++;
    this.avgDocLength = (this.avgDocLength * (this.totalDocs - 1) + tokens.length) / this.totalDocs;
  }

  search(query, topK = 10) {
    const queryTokens = this.tokenize(query);
    const scores = new Map();

    for (const [docId, tokens] of this.documents.entries()) {
      let score = 0;
      const docLength = tokens.length;
      
      for (const qToken of queryTokens) {
        const termFreq = tokens.filter(t => t === qToken).length;
        const docCountWithTerm = this.docFreq.get(qToken) || 0;
        
        if (docCountWithTerm === 0) continue;
        
        const idf = Math.log((this.totalDocs - docCountWithTerm + 0.5) / (docCountWithTerm + 0.5) + 1);
        const numerator = termFreq * (this.k1 + 1);
        const denominator = termFreq + this.k1 * (1 - this.b + this.b * (docLength / this.avgDocLength));
        
        score += idf * (numerator / denominator);
      }
      
      if (score > 0) {
        scores.set(docId, score);
      }
    }

    // Sort by score and return top K
    const sorted = Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK);
    
    return sorted.map(([docId, score]) => ({ id: docId, score }));
  }

  toJSON() {
    return {
      documents: Array.from(this.documents.entries()),
      docFreq: Array.from(this.docFreq.entries()),
      avgDocLength: this.avgDocLength,
      totalDocs: this.totalDocs
    };
  }

  fromJSON(data) {
    this.documents = new Map(data.documents);
    this.docFreq = new Map(data.docFreq);
    this.avgDocLength = data.avgDocLength;
    this.totalDocs = data.totalDocs;
  }
}

export class MemoryManager {
  constructor(options = {}) {
    this.dbPath = options.dbPath || join(ROOT, 'data', 'memory.db');
    this.bm25IndexPath = options.bm25IndexPath || join(ROOT, 'data', 'bm25_index.json');
    this.db = null;
    this.bm25 = new BM25Index();
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;

    // Ensure directories exist (fixes: logs dir not created issue)
    const dataDir = join(ROOT, 'data');
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }

    // Initialize SQLite database
    this.db = new Database(this.dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        metadata TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at DESC)
    `);

    // Load BM25 index
    if (existsSync(this.bm25IndexPath)) {
      try {
        const data = JSON.parse(readFileSync(this.bm25IndexPath, 'utf-8'));
        this.bm25.fromJSON(data);
      } catch (e) {
        console.warn('[Memory] BM25 index corrupted, rebuilding');
      }
    }

    // Rebuild BM25 from database if needed
    if (this.bm25.totalDocs === 0) {
      const rows = this.db.prepare('SELECT id, content FROM memories').all();
      for (const row of rows) {
        this.bm25.addDocument(row.id, row.content);
      }
      this.saveBM25();
    }

    this.initialized = true;
    console.log('[Memory] Initialized with', this.bm25.totalDocs, 'memories');
  }

  store(id, content, metadata = {}) {
    if (!this.initialized) {
      throw new Error('Memory not initialized');
    }

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO memories (id, content, metadata, updated_at)
      VALUES (?, ?, ?, strftime('%s', 'now'))
    `);
    stmt.run(id, content, JSON.stringify(metadata));

    // Update BM25 index
    this.bm25.addDocument(id, content);
    this.saveBM25();

    return { id, created: Date.now() };
  }

  search(query, topK = 10) {
    if (!this.initialized) {
      throw new Error('Memory not initialized');
    }

    const results = this.bm25.search(query, topK);
    const enriched = results.map(r => {
      const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(r.id);
      return {
        id: row.id,
        content: row.content,
        metadata: JSON.parse(row.metadata || '{}'),
        created_at: row.created_at,
        score: r.score
      };
    });

    return enriched;
  }

  get(id) {
    if (!this.initialized) {
      throw new Error('Memory not initialized');
    }
    return this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
  }

  delete(id) {
    if (!this.initialized) {
      throw new Error('Memory not initialized');
    }
    this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
    // Rebuild BM25 (simpler than removing from index)
    this.rebuildBM25();
  }

  getAll(limit = 100) {
    if (!this.initialized) {
      throw new Error('Memory not initialized');
    }
    return this.db.prepare('SELECT * FROM memories ORDER BY created_at DESC LIMIT ?').all(limit);
  }

  rebuildBM25() {
    this.bm25 = new BM25Index();
    const rows = this.db.prepare('SELECT id, content FROM memories').all();
    for (const row of rows) {
      this.bm25.addDocument(row.id, row.content);
    }
    this.saveBM25();
  }

  saveBM25() {
    writeFileSync(this.bm25IndexPath, JSON.stringify(this.bm25.toJSON(), null, 2));
  }

  close() {
    if (this.db) {
      this.db.close();
    }
  }
}
