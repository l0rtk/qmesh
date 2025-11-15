/**
 * Inference Engine Module
 * Manages LLM contexts and handles inference requests
 * Updated for node-llama-cpp v3 API
 */

import { LlamaChatSession } from 'node-llama-cpp';
import config from '../config/default.js';

/**
 * Session wrapper to track usage and state
 */
class ManagedSession {
  constructor(context, session, id) {
    this.context = context;
    this.session = session;
    this.id = id;
    this.busy = false;
    this.createdAt = Date.now();
    this.lastUsedAt = Date.now();
    this.requestCount = 0;
  }

  markBusy() {
    this.busy = true;
    this.lastUsedAt = Date.now();
  }

  markAvailable() {
    this.busy = false;
    this.lastUsedAt = Date.now();
    this.requestCount++;
  }

  getIdleTime() {
    return Date.now() - this.lastUsedAt;
  }

  async dispose() {
    // Clear references
    this.session = null;
    this.context = null;
  }
}

/**
 * Inference engine class
 * Manages session pool and handles inference requests
 */
export class InferenceEngine {
  constructor(model, options = {}) {
    if (!model) {
      throw new Error('Model is required for InferenceEngine');
    }

    this.model = model;
    this.sessions = [];
    this.maxSessions = options.maxContexts ?? config.model.contextPool.maxContexts;
    this.reuseSessions = options.reuseContexts ?? config.model.contextPool.reuseContexts;
    this.sessionTimeout = options.contextTimeout ?? config.model.contextPool.contextTimeout;
    this.sessionIdCounter = 0;

    // Default inference parameters
    this.defaultParams = {
      contextSize: options.contextSize ?? config.model.inference.contextSize,
      temperature: options.temperature ?? config.model.inference.temperature,
      topP: options.topP ?? config.model.inference.topP,
      topK: options.topK ?? config.model.inference.topK,
      repeatPenalty: options.repeatPenalty ?? config.model.inference.repeatPenalty,
      maxTokens: options.maxTokens ?? config.model.inference.maxTokens,
    };

    // Start cleanup timer
    this.startCleanupTimer();
  }

  /**
   * Get or create an available session
   */
  async getAvailableSession() {
    // Try to find an available session
    if (this.reuseSessions) {
      const availableSession = this.sessions.find(s => !s.busy);
      if (availableSession) {
        availableSession.markBusy();
        return availableSession;
      }
    }

    // Create new session if under limit
    if (this.sessions.length < this.maxSessions) {
      return await this.createSession();
    }

    // No available sessions and at max capacity
    throw new Error('No available sessions. All sessions are busy.');
  }

  /**
   * Create a new session
   */
  async createSession() {
    const sessionId = ++this.sessionIdCounter;

    try {
      // Create context from model (v3 API)
      const context = await this.model.createContext({
        contextSize: this.defaultParams.contextSize,
      });

      // Create chat session (v3 API)
      const session = new LlamaChatSession({
        contextSequence: context.getSequence(),
      });

      const managedSession = new ManagedSession(context, session, sessionId);
      managedSession.markBusy();
      this.sessions.push(managedSession);

      return managedSession;

    } catch (error) {
      throw new Error(`Failed to create session: ${error.message}`);
    }
  }

  /**
   * Release a session back to the pool
   */
  releaseSession(managedSession) {
    managedSession.markAvailable();
  }

  /**
   * Generate text from a prompt (non-streaming)
   * @param {string} prompt - The input prompt
   * @param {Object} options - Inference parameters
   * @returns {Promise<Object>} Generated text and metadata
   */
  async generate(prompt, options = {}) {
    const startTime = Date.now();
    let managedSession = null;

    try {
      // Get available session
      managedSession = await this.getAvailableSession();

      // Merge parameters
      const params = {
        ...this.defaultParams,
        ...options,
      };

      // Perform inference using chat session (v3 API)
      const text = await managedSession.session.prompt(prompt, {
        temperature: params.temperature,
        topP: params.topP,
        topK: params.topK,
        repeatPenalty: params.repeatPenalty,
        maxTokens: params.maxTokens,
      });

      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000;

      // Estimate tokens (rough estimate based on text length)
      const tokens = Math.ceil(text.length / 4);
      const tokensPerSecond = Math.round(tokens / duration);

      return {
        text,
        tokens,
        duration,
        tokensPerSecond,
        sessionId: managedSession.id,
      };

    } catch (error) {
      throw new Error(`Inference failed: ${error.message}`);

    } finally {
      // Release session back to pool
      if (managedSession) {
        this.releaseSession(managedSession);
      }
    }
  }

  /**
   * Generate text from a prompt (streaming)
   * @param {string} prompt - The input prompt
   * @param {Function} onToken - Callback for each generated token
   * @param {Object} options - Inference parameters
   * @returns {Promise<Object>} Generation metadata
   */
  async generateStream(prompt, onToken, options = {}) {
    const startTime = Date.now();
    let managedSession = null;
    let totalText = '';
    let totalTokens = 0;

    try {
      // Get available session
      managedSession = await this.getAvailableSession();

      // Merge parameters
      const params = {
        ...this.defaultParams,
        ...options,
      };

      // Perform streaming inference (v3 API)
      await managedSession.session.prompt(prompt, {
        temperature: params.temperature,
        topP: params.topP,
        topK: params.topK,
        repeatPenalty: params.repeatPenalty,
        maxTokens: params.maxTokens,
        onToken: (tokens) => {
          // v3 API returns array of tokens, convert to string
          const chunk = Array.isArray(tokens) ? tokens.join('') : tokens;
          totalText += chunk;
          totalTokens++;
          if (onToken) {
            onToken(chunk, totalTokens);
          }
        },
      });

      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000;
      const tokensPerSecond = Math.round(totalTokens / duration);

      return {
        tokens: totalTokens,
        duration,
        tokensPerSecond,
        sessionId: managedSession.id,
      };

    } catch (error) {
      throw new Error(`Streaming inference failed: ${error.message}`);

    } finally {
      // Release session back to pool
      if (managedSession) {
        this.releaseSession(managedSession);
      }
    }
  }

  /**
   * Get pool statistics
   */
  getStats() {
    return {
      totalSessions: this.sessions.length,
      busySessions: this.sessions.filter(s => s.busy).length,
      availableSessions: this.sessions.filter(s => !s.busy).length,
      maxSessions: this.maxSessions,
      sessions: this.sessions.map(s => ({
        id: s.id,
        busy: s.busy,
        requestCount: s.requestCount,
        idleTime: s.getIdleTime(),
      })),
    };
  }

  /**
   * Cleanup idle sessions
   */
  cleanupIdleSessions() {
    const now = Date.now();
    const toRemove = [];

    for (const session of this.sessions) {
      // Don't remove busy sessions
      if (session.busy) continue;

      // Check if session has been idle too long
      if (now - session.lastUsedAt > this.sessionTimeout) {
        toRemove.push(session);
      }
    }

    // Remove idle sessions
    for (const session of toRemove) {
      const index = this.sessions.indexOf(session);
      if (index > -1) {
        this.sessions.splice(index, 1);
        session.dispose();
      }
    }

    if (toRemove.length > 0) {
      console.log(`🗑️  Cleaned up ${toRemove.length} idle session(s)`);
    }
  }

  /**
   * Start periodic cleanup timer
   */
  startCleanupTimer() {
    // Run cleanup every minute
    this.cleanupTimer = setInterval(() => {
      this.cleanupIdleSessions();
    }, 60000);
  }

  /**
   * Stop cleanup timer
   */
  stopCleanupTimer() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Dispose all sessions and cleanup
   */
  async dispose() {
    this.stopCleanupTimer();

    // Dispose all sessions
    for (const session of this.sessions) {
      await session.dispose();
    }

    this.sessions = [];
    console.log('✅ Inference engine disposed');
  }
}

/**
 * Simple inference helper function
 * Creates a one-time session for quick inference
 */
export async function quickInference(model, prompt, options = {}) {
  const engine = new InferenceEngine(model, {
    maxContexts: 1,
    reuseContexts: false,
  });

  try {
    const result = await engine.generate(prompt, options);
    return result;
  } finally {
    await engine.dispose();
  }
}

export default InferenceEngine;
