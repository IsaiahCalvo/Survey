// Advanced caching utilities for PDF rendering

// Page render cache with ImageBitmap support
class PageRenderCache {
  constructor(maxSize = 50) {
    this.maxSize = maxSize;
    this.cache = new Map(); // key: `${pageNumber}_${scale}`, value: { bitmap, canvas, viewport }
    this.accessOrder = new Map();
  }

  getCacheKey(pageNumber, scale) {
    return `${pageNumber}_${scale.toFixed(2)}`;
  }

  get(pageNumber, scale) {
    const key = this.getCacheKey(pageNumber, scale);
    if (this.cache.has(key)) {
      this.accessOrder.set(key, Date.now());
      return this.cache.get(key);
    }
    return null;
  }

  async set(pageNumber, scale, canvas, viewport) {
    const key = this.getCacheKey(pageNumber, scale);
    
    // Create ImageBitmap from canvas for instant rendering
    let bitmap = null;
    try {
      bitmap = await createImageBitmap(canvas);
    } catch (error) {
      console.warn('Failed to create ImageBitmap for page', pageNumber, error);
    }
    
    // Don't store canvas reference - we only need the bitmap for instant rendering
    // Canvas can be recreated from bitmap when needed
    const value = {
      bitmap,
      viewport,
      pageNumber,
      scale
    };
    
    // LRU eviction
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      let lruKey = null;
      let oldestTime = Infinity;
      for (const [k, time] of this.accessOrder.entries()) {
        if (time < oldestTime) {
          oldestTime = time;
          lruKey = k;
        }
      }
      if (lruKey) {
        const oldValue = this.cache.get(lruKey);
        if (oldValue?.bitmap) {
          try {
            oldValue.bitmap.close();
          } catch (e) {
            // Ignore errors
          }
        }
        this.cache.delete(lruKey);
        this.accessOrder.delete(lruKey);
      }
    }
    
    this.cache.set(key, value);
    this.accessOrder.set(key, Date.now());
    return value;
  }

  has(pageNumber, scale) {
    const key = this.getCacheKey(pageNumber, scale);
    return this.cache.has(key);
  }

  clear() {
    for (const value of this.cache.values()) {
      if (value?.bitmap) {
        try {
          value.bitmap.close();
        } catch (e) {
          // Ignore errors
        }
      }
    }
    this.cache.clear();
    this.accessOrder.clear();
  }

  clearForScale(scale) {
    // Clear all entries for a specific scale (useful when zooming)
    const keysToDelete = [];
    for (const [key, value] of this.cache.entries()) {
      if (Math.abs(value.scale - scale) < 0.01) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach(key => {
      const value = this.cache.get(key);
      if (value?.bitmap) {
        try {
          value.bitmap.close();
        } catch (e) {
          // Ignore errors
        }
      }
      this.cache.delete(key);
      this.accessOrder.delete(key);
    });
  }
}

export { PageRenderCache };