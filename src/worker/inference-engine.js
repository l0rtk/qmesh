/**
 * Inference Engine Module
 * Manages LLM contexts and handles inference requests
 */

import { LlamaContext } from 'node-llama-cpp';
import config from '../config/default.js';

/**
 * Context wrapper to track usage and state
 */
class ManagedContext {
  constructor(context, id) {
    this.context = context;
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
    // node-llama-cpp contexts don't have explicit dispose
    // Just clear the reference
    this.context = null;
  }
}

/**
 * Inference engine class
 * Manages context pool and handles inference requests
 */
export class InferenceEngine {
  constructor(model, options = {}) {
    if (!model) {
      throw new Error('Model is required for InferenceEngine');
    }

    this.model = model;
    this.contexts = [];
    this.maxContexts = options.maxContexts ?? config.model.contextPool.maxContexts;
    this.reuseContexts = options.reuseContexts ?? config.model.contextPool.reuseContexts;
    this.contextTimeout = options.contextTimeout ?? config.model.contextPool.contextTimeout;
    this.contextIdCounter = 0;

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
   * Get or create an available context
   */
  async getAvailableContext() {
    // Try to find an available context
    if (this.reuseContexts) {
      const availableContext = this.contexts.find(ctx => !ctx.busy);
      if (availableContext) {
        availableContext.markBusy();
        return availableContext;
      }
    }

    // Create new context if under limit
    if (this.contexts.length < this.maxContexts) {
      return await this.createContext();
    }

    // No available contexts and at max capacity
    throw new Error('No available contexts. All contexts are busy.');
  }

  /**
   * Create a new context
   */
  async createContext() {
    const contextId = ++this.contextIdCounter;

    try {
      const context = new LlamaContext({
        model: this.model,
        contextSize: this.defaultParams.contextSize,
      });

      const managedContext = new ManagedContext(context, contextId);
      managedContext.markBusy();
      this.contexts.push(managedContext);

      return managedContext;

    } catch (error) {
      throw new Error(`Failed to create context: ${error.message}`);
    }
  }

  /**
   * Release a context back to the pool
   */
  releaseContext(managedContext) {
    managedContext.markAvailable();
  }

  /**
   * Generate text from a prompt (non-streaming)
   * @param {string} prompt - The input prompt
   * @param {Object} options - Inference parameters
   * @returns {Promise<Object>} Generated text and metadata
   */
  async generate(prompt, options = {}) {
    const startTime = Date.now();
    let managedContext = null;

    try {
      // Get available context
      managedContext = await this.getAvailableContext();

      // Merge parameters
      const params = {
        ...this.defaultParams,
        ...options,
      };

      // Perform inference
      const result = await managedContext.context.evaluate(
        managedContext.context.encode(prompt),
        {
          temperature: params.temperature,
          topP: params.topP,
          topK: params.topK,
          repeatPenalty: params.repeatPenalty,
          maxTokens: params.maxTokens,
        }
      );

      // Decode the result
      const text = managedContext.context.decode(result);

      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000;
      const tokensPerSecond = result.length / duration;

      return {
        text,
        tokens: result.length,
        duration,
        tokensPerSecond: Math.round(tokensPerSecond),
        contextId: managedContext.id,
      };

    } catch (error) {
      throw new Error(`Inference failed: ${error.message}`);

    } finally {
      // Release context back to pool
      if (managedContext) {
        this.releaseContext(managedContext);
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
    let managedContext = null;
    let totalTokens = 0;

    try {
      // Get available context
      managedContext = await this.getAvailableContext();

      // Merge parameters
      const params = {
        ...this.defaultParams,
        ...options,
      };

      // Create a simple token-by-token generator
      // Note: node-llama-cpp v3 has different streaming API
      // This is a simplified implementation
      const encoded = managedContext.context.encode(prompt);

      const result = await managedContext.context.evaluate(encoded, {
        temperature: params.temperature,
        topP: params.topP,
        topK: params.topK,
        repeatPenalty: params.repeatPenalty,
        maxTokens: params.maxTokens,
        onToken: (token) => {
          const text = managedContext.context.decode([token]);
          totalTokens++;
          if (onToken) {
            onToken(text, totalTokens);
          }
        },
      });

      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000;
      const tokensPerSecond = totalTokens / duration;

      return {
        tokens: totalTokens,
        duration,
        tokensPerSecond: Math.round(tokensPerSecond),
        contextId: managedContext.id,
      };

    } catch (error) {
      throw new Error(`Streaming inference failed: ${error.message}`);

    } finally {
      // Release context back to pool
      if (managedContext) {
        this.releaseContext(managedContext);
      }
    }
  }

  /**
   * Get pool statistics
   */
  getStats() {
    return {
      totalContexts: this.contexts.length,
      busyContexts: this.contexts.filter(ctx => ctx.busy).length,
      availableContexts: this.contexts.filter(ctx => !ctx.busy).length,
      maxContexts: this.maxContexts,
      contexts: this.contexts.map(ctx => ({
        id: ctx.id,
        busy: ctx.busy,
        requestCount: ctx.requestCount,
        idleTime: ctx.getIdleTime(),
      })),
    };
  }

  /**
   * Cleanup idle contexts
   */
  cleanupIdleContexts() {
    const now = Date.now();
    const toRemove = [];

    for (const ctx of this.contexts) {
      // Don't remove busy contexts
      if (ctx.busy) continue;

      // Check if context has been idle too long
      if (now - ctx.lastUsedAt > this.contextTimeout) {
        toRemove.push(ctx);
      }
    }

    // Remove idle contexts
    for (const ctx of toRemove) {
      const index = this.contexts.indexOf(ctx);
      if (index > -1) {
        this.contexts.splice(index, 1);
        ctx.dispose();
      }
    }

    if (toRemove.length > 0) {
      console.log(`🗑️  Cleaned up ${toRemove.length} idle context(s)`);
    }
  }

  /**
   * Start periodic cleanup timer
   */
  startCleanupTimer() {
    // Run cleanup every minute
    this.cleanupTimer = setInterval(() => {
      this.cleanupIdleContexts();
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
   * Dispose all contexts and cleanup
   */
  async dispose() {
    this.stopCleanupTimer();

    // Dispose all contexts
    for (const ctx of this.contexts) {
      await ctx.dispose();
    }

    this.contexts = [];
    console.log('✅ Inference engine disposed');
  }
}

/**
 * Simple inference helper function
 * Creates a one-time context for quick inference
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
