/**
 * Session Manager - Chat Session Persistence
 * Stores chat sessions with auto-generated summary titles
 * Allows users to switch between conversations
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

export class SessionManager {
  constructor(options = {}) {
    this.sessionsDir = join(ROOT, 'data', 'sessions');
    this.currentSessionId = null;
    
    // Ensure directory exists
    if (!existsSync(this.sessionsDir)) {
      mkdirSync(this.sessionsDir, { recursive: true });
    }
  }

  /**
   * Generate a unique session ID
   */
  generateId() {
    return `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Create a new session
   */
  createSession(title = 'New Chat') {
    const id = this.generateId();
    const session = {
      id,
      title,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
      messageCount: 0
    };
    
    this.saveSession(session);
    this.currentSessionId = id;
    return session;
  }

  /**
   * Load a session by ID
   */
  loadSession(id) {
    const filePath = join(this.sessionsDir, `${id}.json`);
    
    if (!existsSync(filePath)) {
      throw new Error(`Session ${id} not found`);
    }
    
    const session = JSON.parse(readFileSync(filePath, 'utf-8'));
    this.currentSessionId = id;
    return session;
  }

  /**
   * Save a session
   */
  saveSession(session) {
    const filePath = join(this.sessionsDir, `${session.id}.json`);
    session.updatedAt = new Date().toISOString();
    writeFileSync(filePath, JSON.stringify(session, null, 2));
  }

  /**
   * Update session title (auto-generate from first message)
   */
  updateTitle(id, newTitle) {
    const session = this.loadSession(id);
    session.title = newTitle;
    this.saveSession(session);
    return session;
  }

  /**
   * Generate a summary title from messages
   */
  generateSummaryTitle(messages) {
    if (!messages || messages.length === 0) {
      return 'New Chat';
    }
    
    // Find first user message
    const firstUserMsg = messages.find(m => m.role === 'user');
    if (!firstUserMsg) {
      return 'New Chat';
    }
    
    let content = firstUserMsg.content || '';
    
    // Truncate to 40 chars
    if (content.length > 40) {
      content = content.slice(0, 37) + '...';
    }
    
    // Clean up common prefixes
    content = content.replace(/^(please|can you|could you|i need|help me)\s+/i, '');
    
    // Capitalize first letter
    content = content.charAt(0).toUpperCase() + content.slice(1);
    
    return content;
  }

  /**
   * Add a message to the current session
   */
  addMessage(role, content) {
    if (!this.currentSessionId) {
      this.createSession();
    }
    
    const session = this.loadSession(this.currentSessionId);
    session.messages.push({
      role,
      content,
      timestamp: new Date().toISOString()
    });
    session.messageCount = session.messages.length;
    
    // Auto-generate title from first user message
    if (session.messages.length === 1 && role === 'user') {
      session.title = this.generateSummaryTitle(session.messages);
    }
    
    // Update title if it's still "New Chat" and we have 2+ messages
    if (session.title === 'New Chat' && session.messages.length >= 2) {
      session.title = this.generateSummaryTitle(session.messages);
    }
    
    this.saveSession(session);
    return session;
  }

  /**
   * List all sessions (sorted by updated, newest first)
   */
  listSessions(limit = 50) {
    if (!existsSync(this.sessionsDir)) {
      return [];
    }
    
    const files = readdirSync(this.sessionsDir)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
    
    const sessions = files.map(id => {
      try {
        const session = JSON.parse(readFileSync(join(this.sessionsDir, `${id}.json`), 'utf-8'));
        return {
          id: session.id,
          title: session.title,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          messageCount: session.messageCount
        };
      } catch (e) {
        console.error('[Session] Failed to load session:', id, e.message);
        return null;
      }
    }).filter(s => s !== null);
    
    // Sort by updatedAt, newest first
    sessions.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    
    return sessions.slice(0, limit);
  }

  /**
   * Delete a session
   */
  deleteSession(id) {
    const filePath = join(this.sessionsDir, `${id}.json`);
    
    if (!existsSync(filePath)) {
      throw new Error(`Session ${id} not found`);
    }
    
    unlinkSync(filePath);
    
    if (this.currentSessionId === id) {
      this.currentSessionId = null;
    }
    
    return { deleted: true, id };
  }

  /**
   * Get current session
   */
  getCurrentSession() {
    if (!this.currentSessionId) {
      return null;
    }
    
    try {
      return this.loadSession(this.currentSessionId);
    } catch (e) {
      return null;
    }
  }

  /**
   * Clear current session (start fresh)
   */
  clearCurrentSession() {
    if (this.currentSessionId) {
      const session = this.loadSession(this.currentSessionId);
      session.messages = [];
      session.messageCount = 0;
      session.title = 'New Chat';
      this.saveSession(session);
      return session;
    }
    return this.createSession();
  }

  /**
   * Get session count
   */
  getSessionCount() {
    if (!existsSync(this.sessionsDir)) {
      return 0;
    }
    return readdirSync(this.sessionsDir).filter(f => f.endsWith('.json')).length;
  }
}

export default SessionManager;
