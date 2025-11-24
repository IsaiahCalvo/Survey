// Advanced caching utilities for PDF rendering

class LRUCache {
  constructor(maxSize = 50) { // Increased cache size for better performance
    this.maxSize = maxSize;
    this.cache = new Map();
  }

  get(key) {
    if (!this.cache.has(key)) return null;
    const value = this.cache.get(key);
    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key, value) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Remove least recently used (first item)
      const firstKey = this.cache.keys().next().value;
      const oldValue = this.cache.get(firstKey);
      // Cleanup canvas if it exists
      if (oldValue?.canvas) {
        const ctx = oldValue.canvas.getContext('2d');
        ctx.clearRect(0, 0, oldValue.canvas.width, oldValue.canvas.height);
      }
      // Cleanup ImageBitmap if it exists
      if (oldValue?.bitmap) {
        try {
          oldValue.bitmap.close();
        } catch (e) {
          // Ignore errors
        }
      }
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  has(key) {
    return this.cache.has(key);
  }

  clear() {
    // Cleanup all canvases and bitmaps
    for (const value of this.cache.values()) {
      if (value?.canvas) {
        const ctx = value.canvas.getContext('2d');
        ctx.clearRect(0, 0, value.canvas.width, value.canvas.height);
      }
      if (value?.bitmap) {
        try {
          value.bitmap.close();
        } catch (e) {
          // Ignore errors
        }
      }
    }
    this.cache.clear();
  }
}

class ImageBitmapCache {
  constructor(maxSize = 100) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.accessOrder = new Map(); // Track access order for LRU
  }

  async set(key, imageData) {
    try {
      // If we have a canvas, create bitmap from it
      let bitmap;
      if (imageData instanceof HTMLCanvasElement || imageData instanceof OffscreenCanvas) {
        bitmap = await createImageBitmap(imageData);
      } else {
        bitmap = await createImageBitmap(imageData);
      }
      
      // Implement LRU eviction
      if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
        // Find least recently used
        let lruKey = null;
        let oldestTime = Infinity;
        for (const [k, time] of this.accessOrder.entries()) {
          if (time < oldestTime) {
            oldestTime = time;
            lruKey = k;
          }
        }
        if (lruKey) {
          const oldBitmap = this.cache.get(lruKey);
          if (oldBitmap) {
            try {
              oldBitmap.close();
            } catch (e) {
              // Ignore errors
            }
          }
          this.cache.delete(lruKey);
          this.accessOrder.delete(lruKey);
        }
      }
      
      this.cache.set(key, bitmap);
      this.accessOrder.set(key, Date.now());
      return bitmap;
    } catch (error) {
      console.error('Failed to create ImageBitmap:', error);
      return null;
    }
  }

  get(key) {
    if (this.cache.has(key)) {
      this.accessOrder.set(key, Date.now()); // Update access time
      return this.cache.get(key);
    }
    return null;
  }

  has(key) {
    return this.cache.has(key);
  }

  clear() {
    for (const bitmap of this.cache.values()) {
      try {
        bitmap.close();
      } catch (e) {
        // Ignore errors
      }
    }
    this.cache.clear();
    this.accessOrder.clear();
  }
}

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

class IndexedDBCache {
  constructor(dbName = 'pdf-cache') {
    this.dbName = dbName;
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('pages')) {
          db.createObjectStore('pages');
        }
      };
    });
  }

  async set(key, value) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['pages'], 'readwrite');
      const store = transaction.objectStore('pages');
      const request = store.put(value, key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async get(key) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['pages'], 'readonly');
      const store = transaction.objectStore('pages');
      const request = store.get(key);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async clear() {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['pages'], 'readwrite');
      const store = transaction.objectStore('pages');
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}

export { LRUCache, ImageBitmapCache, IndexedDBCache, PageRenderCache };