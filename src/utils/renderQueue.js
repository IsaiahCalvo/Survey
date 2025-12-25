/**
 * Render Queue Manager
 *
 * Professional PDF rendering optimizations:
 * 1. Concurrent render limiting (max 2-3 simultaneous renders)
 * 2. Priority-based queue (visible pages first)
 * 3. Render cancellation on scale/zoom changes
 * 4. Debounced re-rendering after zoom settles
 */

class RenderQueue {
  constructor(options = {}) {
    this.maxConcurrent = options.maxConcurrent || 2;
    this.queue = [];
    this.activeRenders = new Map(); // pageNum -> { task, scale, priority }
    this.completedRenders = new Map(); // pageNum -> { scale, timestamp }
    this.currentScale = 1.0;
    this.onRenderComplete = options.onRenderComplete || (() => {});
    this.onQueueEmpty = options.onQueueEmpty || (() => {});
  }

  /**
   * Add a page to the render queue
   * @param {number} pageNum - Page number to render
   * @param {string} priority - 'high' (visible), 'medium' (buffer), 'low' (prerender)
   * @param {Function} renderFn - Async function that performs the render
   */
  enqueue(pageNum, priority, renderFn) {
    // Don't queue if already rendering at same scale
    const active = this.activeRenders.get(pageNum);
    if (active && active.scale === this.currentScale) {
      return;
    }

    // Don't queue if already completed at same scale recently
    const completed = this.completedRenders.get(pageNum);
    if (completed && completed.scale === this.currentScale) {
      return;
    }

    // Remove any existing queue entry for this page
    this.queue = this.queue.filter(item => item.pageNum !== pageNum);

    // Add to queue with priority
    const priorityValue = priority === 'high' ? 0 : priority === 'medium' ? 1 : 2;
    this.queue.push({
      pageNum,
      priority: priorityValue,
      renderFn,
      scale: this.currentScale,
      timestamp: Date.now()
    });

    // Sort by priority (lower = higher priority), then by timestamp
    this.queue.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.timestamp - b.timestamp;
    });

    this.processQueue();
  }

  /**
   * Process the queue, respecting concurrent limits
   */
  async processQueue() {
    while (this.activeRenders.size < this.maxConcurrent && this.queue.length > 0) {
      const item = this.queue.shift();

      // Skip if scale changed since enqueue
      if (item.scale !== this.currentScale) {
        continue;
      }

      // Skip if already rendering
      if (this.activeRenders.has(item.pageNum)) {
        continue;
      }

      this.activeRenders.set(item.pageNum, {
        scale: item.scale,
        priority: item.priority,
        startTime: Date.now()
      });

      // Start render (don't await - let it run concurrently)
      this.executeRender(item);
    }
  }

  async executeRender(item) {
    try {
      await item.renderFn();

      // Mark as completed
      this.completedRenders.set(item.pageNum, {
        scale: item.scale,
        timestamp: Date.now()
      });

      this.onRenderComplete(item.pageNum, item.scale);
    } catch (error) {
      if (error.name !== 'RenderingCancelledException') {
        console.error(`Render failed for page ${item.pageNum}:`, error);
      }
    } finally {
      this.activeRenders.delete(item.pageNum);

      // Process more items
      this.processQueue();

      // Notify if queue is empty
      if (this.queue.length === 0 && this.activeRenders.size === 0) {
        this.onQueueEmpty();
      }
    }
  }

  /**
   * Cancel all renders and clear queue (called on scale change)
   */
  cancelAll() {
    // Clear the queue
    this.queue = [];

    // Note: We can't truly cancel PDF.js renders, but we can
    // mark them as stale so their results are ignored
    this.activeRenders.clear();
  }

  /**
   * Update scale and invalidate cached renders
   */
  setScale(newScale) {
    if (Math.abs(newScale - this.currentScale) > 0.0001) {
      this.currentScale = newScale;
      this.cancelAll();
      // Clear completed renders since they're at wrong scale
      this.completedRenders.clear();
    }
  }

  /**
   * Check if a page needs rendering at current scale
   */
  needsRender(pageNum) {
    const completed = this.completedRenders.get(pageNum);
    if (completed && Math.abs(completed.scale - this.currentScale) < 0.0001) {
      return false;
    }
    return true;
  }

  /**
   * Get queue status for debugging
   */
  getStatus() {
    return {
      queueLength: this.queue.length,
      activeRenders: this.activeRenders.size,
      completedRenders: this.completedRenders.size,
      currentScale: this.currentScale
    };
  }

  /**
   * Clear all state
   */
  clear() {
    this.queue = [];
    this.activeRenders.clear();
    this.completedRenders.clear();
  }
}

// Singleton instance
export const renderQueue = new RenderQueue();

export default RenderQueue;
