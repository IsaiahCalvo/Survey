/**
 * useVisiblePages Hook
 *
 * Tracks which pages are currently visible in the viewport
 * using IntersectionObserver for efficient visibility detection.
 *
 * Returns:
 * - visiblePages: Set of currently visible page numbers
 * - registerPage: Function to register a page element for tracking
 * - unregisterPage: Function to unregister a page element
 */

import { useState, useCallback, useRef, useEffect } from 'react';

export function useVisiblePages(options = {}) {
  const {
    rootMargin = '100px 0px', // Buffer above/below viewport
    threshold = 0.1, // 10% visible = considered visible
  } = options;

  const [visiblePages, setVisiblePages] = useState(new Set());
  const observerRef = useRef(null);
  const elementsRef = useRef(new Map()); // pageNum -> element

  // Initialize IntersectionObserver
  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        setVisiblePages(prev => {
          const next = new Set(prev);
          let changed = false;

          entries.forEach(entry => {
            const pageNum = parseInt(entry.target.dataset.pageNum, 10);
            if (isNaN(pageNum)) return;

            if (entry.isIntersecting) {
              if (!next.has(pageNum)) {
                next.add(pageNum);
                changed = true;
              }
            } else {
              if (next.has(pageNum)) {
                next.delete(pageNum);
                changed = true;
              }
            }
          });

          return changed ? next : prev;
        });
      },
      {
        rootMargin,
        threshold,
      }
    );

    // Observe any elements that were registered before observer was ready
    elementsRef.current.forEach((element, pageNum) => {
      observerRef.current.observe(element);
    });

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [rootMargin, threshold]);

  // Register a page element for visibility tracking
  const registerPage = useCallback((pageNum, element) => {
    if (!element) return;

    element.dataset.pageNum = pageNum;
    elementsRef.current.set(pageNum, element);

    if (observerRef.current) {
      observerRef.current.observe(element);
    }
  }, []);

  // Unregister a page element
  const unregisterPage = useCallback((pageNum) => {
    const element = elementsRef.current.get(pageNum);
    if (element && observerRef.current) {
      observerRef.current.unobserve(element);
    }
    elementsRef.current.delete(pageNum);
  }, []);

  // Get priority for a page based on visibility
  const getPagePriority = useCallback((pageNum) => {
    if (visiblePages.has(pageNum)) return 'high';

    // Check if it's adjacent to visible pages (buffer zone)
    for (const visible of visiblePages) {
      if (Math.abs(visible - pageNum) <= 2) return 'medium';
    }

    return 'low';
  }, [visiblePages]);

  return {
    visiblePages,
    registerPage,
    unregisterPage,
    getPagePriority,
    isVisible: (pageNum) => visiblePages.has(pageNum),
  };
}

export default useVisiblePages;
