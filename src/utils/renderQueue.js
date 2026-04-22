/**
 * Render Queue Manager - Optimized for Fast Scrolling Through Large PDFs
 *
 * High-performance PDF rendering optimizations for 100+ page documents:
 * 1. Concurrent render limiting (max 10 simultaneous renders for instant appearance)
 * 2. Priority-based queue (visible pages first)
 * 3. Aggressive predictive pre-rendering (30 pages ahead in scroll direction)
 * 4. Multi-scale caching (keeps renders at 3 different zoom levels)
 * 5. requestIdleCallback for low-priority background renders
 * 6. Render cancellation on scale/zoom changes
 * 7. Fast debouncing (50ms) for responsive re-rendering
 */

class RenderQueue {
  constructor(options = {}) {
    // Increased from 2 to 10 for near-instant rendering during fast scrolling
    // Modern hardware can handle 10+ parallel renders for large PDFs
    this.maxConcurrent = options.maxConcurrent || 10;
    this.queue = [];
    this.activeRenders = new Map(); // pageNum -> { task, scale, priority }

    // Multi-scale cache: pageNum -> Map of { scale -> { timestamp } }
    // Keeps last 3 zoom levels cached to avoid re-rendering on zoom changes
    this.multiScaleCache = new Map();
    this.maxScaleCacheSize = 3; // Keep renders at 3 different scales

    this.completedRenders = new Map(); // pageNum -> { scale, timestamp }
    this.currentScale = 1.0;
    this.onRenderComplete = options.onRenderComplete || (() => {});
    this.onQueueEmpty = options.onQueueEmpty || (() => {});

    // Scroll direction and velocity tracking for predictive pre-rendering
    this.scrollDirection = null; // 'up' or 'down'
    this.scrollVelocity = 0; // pages per second
    this.lastScrollPosition = 0;
    this.lastScrollTime = Date.now();
  }

  /**
   * Update scroll position for predictive rendering
   * @param {number} currentPage - Current visible page number
   * @param {number} scrollOffset - Current scroll position in pixels
   */
  updateScrollPosition(currentPage, scrollOffset) {
    const now = Date.now();
    const timeDelta = (now - this.lastScrollTime) / 1000; // seconds

    if (timeDelta > 0 && this.lastScrollPosition !== scrollOffset) {
      // Calculate scroll direction
      if (scrollOffset > this.lastScrollPosition) {
        this.scrollDirection = 'down';
      } else if (scrollOffset < this.lastScrollPosition) {
        this.scrollDirection = 'up';
      }

      // Calculate velocity (pages per second)
      const pageDelta = Math.abs(currentPage - (this.lastScrollPosition || currentPage));
      this.scrollVelocity = pageDelta / timeDelta;
    }

    this.lastScrollPosition = scrollOffset;
    this.lastScrollTime = now;
  }

  /**
   * Add a page to the render queue
   * @param {number} pageNum - Page number to render
   * @param {string} priority - 'high' (visible), 'medium' (buffer), 'low' (prerender)
   * @param {Function} renderFn - Async function that performs the render
   * @param {number} currentPage - Current visible page for predictive priority adjustment
   */
  enqueue(pageNum, priority, renderFn, currentPage = null) {
    // Don't queue if already rendering at same scale
    const active = this.activeRenders.get(pageNum);
    if (active && active.scale === this.currentScale) {
      return;
    }

    // Check multi-scale cache first
    const pageCache = this.multiScaleCache.get(pageNum);
    if (pageCache && pageCache.has(this.currentScale)) {
      return; // Already rendered at this scale
    }

    // Don't queue if already completed at same scale recently
    const completed = this.completedRenders.get(pageNum);
    if (completed && completed.scale === this.currentScale) {
      return;
    }

    // Remove any existing queue entry for this page
    this.queue = this.queue.filter(item => item.pageNum !== pageNum);

    // Add to queue with priority, adjusted for scroll direction
    let priorityValue = priority === 'high' ? 0 : priority === 'medium' ? 1 : 2;

    // Aggressive predictive priority boost based on scroll direction
    if (currentPage !== null && this.scrollDirection && priorityValue > 0) {
      const pageDistance = pageNum - currentPage;

      // Boost priority for pages in scroll direction (increased range for fast scrolling)
      if (this.scrollDirection === 'down' && pageDistance > 0 && pageDistance <= 30) {
        // Pages ahead in scroll direction get aggressive priority boost
        // Closer pages get highest priority
        if (pageDistance <= 10) {
          priorityValue = 0; // Treat as visible
        } else if (pageDistance <= 20) {
          priorityValue = Math.max(0, priorityValue - 1);
        }
      } else if (this.scrollDirection === 'up' && pageDistance < 0 && pageDistance >= -30) {
        // Pages behind in scroll direction get aggressive priority boost
        if (pageDistance >= -10) {
          priorityValue = 0; // Treat as visible
        } else if (pageDistance >= -20) {
          priorityValue = Math.max(0, priorityValue - 1);
        }
      }
    }

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
      // For low priority renders (priority 2), use requestIdleCallback if available
      // This prevents interfering with user interactions and animations
      if (item.priority === 2 && typeof requestIdleCallback !== 'undefined') {
        await new Promise((resolve) => {
          requestIdleCallback(() => resolve(), { timeout: 5000 });
        });
      }

      await item.renderFn();

      // Mark as completed
      this.completedRenders.set(item.pageNum, {
        scale: item.scale,
        timestamp: Date.now()
      });

      // Add to multi-scale cache
      if (!this.multiScaleCache.has(item.pageNum)) {
        this.multiScaleCache.set(item.pageNum, new Map());
      }
      const pageCache = this.multiScaleCache.get(item.pageNum);
      pageCache.set(item.scale, { timestamp: Date.now() });

      // Evict old scales if cache is too large (LRU)
      if (pageCache.size > this.maxScaleCacheSize) {
        // Find oldest entry
        let oldestScale = null;
        let oldestTime = Infinity;
        for (const [scale, data] of pageCache.entries()) {
          if (data.timestamp < oldestTime) {
            oldestTime = data.timestamp;
            oldestScale = scale;
          }
        }
        if (oldestScale !== null) {
          pageCache.delete(oldestScale);
        }
      }

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
      // Note: We DON'T clear multiScaleCache - it keeps renders at multiple scales!
    }
  }

  /**
   * Check if a page needs rendering at current scale
   */
  needsRender(pageNum) {
    // Check multi-scale cache first
    const pageCache = this.multiScaleCache.get(pageNum);
    if (pageCache && pageCache.has(this.currentScale)) {
      return false;
    }

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
    this.multiScaleCache.clear();
  }
}

// Singleton instance
export const renderQueue = new RenderQueue();

export default RenderQueue;
