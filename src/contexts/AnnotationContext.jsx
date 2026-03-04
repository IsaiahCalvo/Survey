/**
 * AnnotationContext - High-Performance Annotation State Management
 *
 * Solves the performance problem of top-level state causing App.jsx re-renders.
 *
 * Key optimizations:
 * 1. Page-specific state isolation - only affected pages re-render
 * 2. Batch updates to reduce render cycles
 * 3. Memoized selectors to prevent unnecessary prop changes
 * 4. Direct page subscription model (like Redux)
 */

import React, { createContext, useContext, useRef, useCallback, useSyncExternalStore } from 'react';

const AnnotationContext = createContext(null);

/**
 * High-performance annotation store
 * Uses subscription model to allow components to subscribe to specific pages only
 */
class AnnotationStore {
  constructor() {
    // Store annotations by page: { [pageNum]: { [annotationId]: annotation } }
    this.annotationsByPage = new Map();

    // Subscribers by page: { [pageNum]: Set<callback> }
    this.pageSubscribers = new Map();

    // Global subscribers (for all annotation changes)
    this.globalSubscribers = new Set();

    // Batch update queue
    this.batchQueue = [];
    this.batchTimeout = null;
  }

  /**
   * Get all annotations for a specific page
   */
  getPageAnnotations(pageNum) {
    const pageMap = this.annotationsByPage.get(pageNum);
    return pageMap ? Array.from(pageMap.values()) : [];
  }

  /**
   * Get all annotations across all pages
   */
  getAllAnnotations() {
    const all = [];
    for (const pageMap of this.annotationsByPage.values()) {
      all.push(...Array.from(pageMap.values()));
    }
    return all;
  }

  /**
   * Add or update annotation(s)
   */
  setAnnotations(annotations, options = {}) {
    const { batch = false } = options;

    if (batch) {
      // Queue for batch processing
      this.batchQueue.push({ type: 'set', annotations });
      this.scheduleBatchUpdate();
    } else {
      this._applySetAnnotations(annotations);
    }
  }

  _applySetAnnotations(annotations) {
    const affectedPages = new Set();

    for (const annotation of annotations) {
      const pageNum = annotation.page || annotation.pageNum;
      if (pageNum === undefined) continue;

      if (!this.annotationsByPage.has(pageNum)) {
        this.annotationsByPage.set(pageNum, new Map());
      }

      const pageMap = this.annotationsByPage.get(pageNum);
      pageMap.set(annotation.id, annotation);
      affectedPages.add(pageNum);
    }

    // Notify only affected pages
    for (const pageNum of affectedPages) {
      this.notifyPageSubscribers(pageNum);
    }
    this.notifyGlobalSubscribers();
  }

  /**
   * Delete annotation(s)
   */
  deleteAnnotations(annotationIds, options = {}) {
    const { batch = false } = options;

    if (batch) {
      this.batchQueue.push({ type: 'delete', annotationIds });
      this.scheduleBatchUpdate();
    } else {
      this._applyDeleteAnnotations(annotationIds);
    }
  }

  _applyDeleteAnnotations(annotationIds) {
    const affectedPages = new Set();

    for (const annotationId of annotationIds) {
      // Find and remove annotation
      for (const [pageNum, pageMap] of this.annotationsByPage.entries()) {
        if (pageMap.has(annotationId)) {
          pageMap.delete(annotationId);
          affectedPages.add(pageNum);

          // Clean up empty page maps
          if (pageMap.size === 0) {
            this.annotationsByPage.delete(pageNum);
          }
        }
      }
    }

    // Notify only affected pages
    for (const pageNum of affectedPages) {
      this.notifyPageSubscribers(pageNum);
    }
    this.notifyGlobalSubscribers();
  }

  /**
   * Clear all annotations
   */
  clearAll() {
    this.annotationsByPage.clear();
    this.notifyAllSubscribers();
  }

  /**
   * Subscribe to changes for a specific page
   */
  subscribeToPage(pageNum, callback) {
    if (!this.pageSubscribers.has(pageNum)) {
      this.pageSubscribers.set(pageNum, new Set());
    }
    this.pageSubscribers.get(pageNum).add(callback);

    // Return unsubscribe function
    return () => {
      const subscribers = this.pageSubscribers.get(pageNum);
      if (subscribers) {
        subscribers.delete(callback);
        if (subscribers.size === 0) {
          this.pageSubscribers.delete(pageNum);
        }
      }
    };
  }

  /**
   * Subscribe to all annotation changes
   */
  subscribeGlobal(callback) {
    this.globalSubscribers.add(callback);
    return () => this.globalSubscribers.delete(callback);
  }

  /**
   * Notify subscribers for a specific page
   */
  notifyPageSubscribers(pageNum) {
    const subscribers = this.pageSubscribers.get(pageNum);
    if (subscribers) {
      subscribers.forEach(callback => callback());
    }
  }

  /**
   * Notify all global subscribers
   */
  notifyGlobalSubscribers() {
    this.globalSubscribers.forEach(callback => callback());
  }

  /**
   * Notify all subscribers (page-specific and global)
   */
  notifyAllSubscribers() {
    for (const subscribers of this.pageSubscribers.values()) {
      subscribers.forEach(callback => callback());
    }
    this.notifyGlobalSubscribers();
  }

  /**
   * Schedule batch update
   */
  scheduleBatchUpdate() {
    if (this.batchTimeout) return;

    this.batchTimeout = setTimeout(() => {
      this.processBatchQueue();
      this.batchTimeout = null;
    }, 16); // One frame (60fps)
  }

  /**
   * Process queued batch updates
   */
  processBatchQueue() {
    if (this.batchQueue.length === 0) return;

    const affectedPages = new Set();

    for (const item of this.batchQueue) {
      if (item.type === 'set') {
        for (const annotation of item.annotations) {
          const pageNum = annotation.page || annotation.pageNum;
          if (pageNum === undefined) continue;

          if (!this.annotationsByPage.has(pageNum)) {
            this.annotationsByPage.set(pageNum, new Map());
          }

          const pageMap = this.annotationsByPage.get(pageNum);
          pageMap.set(annotation.id, annotation);
          affectedPages.add(pageNum);
        }
      } else if (item.type === 'delete') {
        for (const annotationId of item.annotationIds) {
          for (const [pageNum, pageMap] of this.annotationsByPage.entries()) {
            if (pageMap.has(annotationId)) {
              pageMap.delete(annotationId);
              affectedPages.add(pageNum);
              if (pageMap.size === 0) {
                this.annotationsByPage.delete(pageNum);
              }
            }
          }
        }
      }
    }

    this.batchQueue = [];

    // Single notification for all affected pages
    for (const pageNum of affectedPages) {
      this.notifyPageSubscribers(pageNum);
    }
    this.notifyGlobalSubscribers();
  }
}

/**
 * Provider component
 */
export function AnnotationProvider({ children }) {
  const storeRef = useRef(new AnnotationStore());

  const value = {
    store: storeRef.current,
  };

  return (
    <AnnotationContext.Provider value={value}>
      {children}
    </AnnotationContext.Provider>
  );
}

/**
 * Hook to access annotation store
 */
export function useAnnotationStore() {
  const context = useContext(AnnotationContext);
  if (!context) {
    throw new Error('useAnnotationStore must be used within AnnotationProvider');
  }
  return context.store;
}

/**
 * Hook to subscribe to annotations for a specific page
 * Only re-renders when annotations on THIS page change
 */
export function usePageAnnotations(pageNum) {
  const store = useAnnotationStore();

  const subscribe = useCallback(
    (callback) => store.subscribeToPage(pageNum, callback),
    [store, pageNum]
  );

  const getSnapshot = useCallback(
    () => store.getPageAnnotations(pageNum),
    [store, pageNum]
  );

  const annotations = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const setAnnotations = useCallback(
    (annotations, options) => store.setAnnotations(annotations, options),
    [store]
  );

  const deleteAnnotations = useCallback(
    (annotationIds, options) => store.deleteAnnotations(annotationIds, options),
    [store]
  );

  return {
    annotations,
    setAnnotations,
    deleteAnnotations,
  };
}

/**
 * Hook to subscribe to ALL annotations (use sparingly)
 */
export function useAllAnnotations() {
  const store = useAnnotationStore();

  const subscribe = useCallback(
    (callback) => store.subscribeGlobal(callback),
    [store]
  );

  const getSnapshot = useCallback(
    () => store.getAllAnnotations(),
    [store]
  );

  const annotations = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return annotations;
}
