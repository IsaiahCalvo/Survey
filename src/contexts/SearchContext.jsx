import React, { createContext, useContext, useState, useCallback, useRef, useMemo, useEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

// Search result ID generator
const createResultId = (() => {
  let counter = 0;
  return () => {
    counter += 1;
    return `search-${Date.now()}-${counter}`;
  };
})();

const clampValue = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);

// Create snippet with context around match
const createSnippet = (text, start, end, radius = 60) => {
  if (!text || typeof text !== 'string') {
    return { snippet: '', matchIndex: -1 };
  }
  const snippetStart = Math.max(0, start - radius);
  const snippetEnd = Math.min(text.length, end + radius);
  const prefix = snippetStart > 0 ? '...' : '';
  const suffix = snippetEnd < text.length ? '...' : '';
  const snippetText = `${prefix}${text.slice(snippetStart, snippetEnd)}${suffix}`;
  const highlightOffset = prefix ? 3 : 0;
  const matchIndex = highlightOffset + (start - snippetStart);
  return { snippet: snippetText, matchIndex };
};

// Build rectangles for a text match - converts character positions to visual coordinates
const buildRectanglesForMatch = (pageData, matchStart, matchLength) => {
  const { items, ranges, viewportTransform } = pageData;
  if (!items || !ranges || !viewportTransform) {
    return [];
  }

  const matchEnd = matchStart + matchLength;
  const rects = [];

  for (let i = 0; i < ranges.length; i += 1) {
    const range = ranges[i];
    if (range.end <= matchStart) continue;
    if (range.start >= matchEnd) break;

    const textItem = items[range.itemIndex];
    if (!textItem || !textItem.str || !textItem.transform) continue;

    const overlapStart = Math.max(range.start, matchStart);
    const overlapEnd = Math.min(range.end, matchEnd);
    const relativeStart = overlapStart - range.start;
    const relativeLength = overlapEnd - overlapStart;
    if (relativeLength <= 0) continue;

    const glyphCount = Math.max(textItem.str.length, 1);
    const horizontalScale = clampValue(textItem.width, glyphCount * 2) / glyphCount;

    const transformed = pdfjsLib.Util.transform(viewportTransform, textItem.transform);
    const fontHeight = Math.hypot(clampValue(transformed[2]), clampValue(transformed[3])) || clampValue(textItem.height, 12);

    const baseLeft = transformed[4];
    const baseTop = transformed[5] - fontHeight;

    const rectLeft = baseLeft + horizontalScale * relativeStart;
    const rectWidth = Math.max(horizontalScale * relativeLength, 2);

    rects.push({
      x: rectLeft,
      y: baseTop,
      width: rectWidth,
      height: Math.max(fontHeight, 6)
    });
  }

  return rects;
};

// Calculate bounding box for all rectangles of a match
const calculateMatchBounds = (rectangles) => {
  if (!rectangles || rectangles.length === 0) {
    return null;
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const rect of rectangles) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2
  };
};

const SearchContext = createContext(null);

export const SearchProvider = ({ children, pdfDoc }) => {
  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(-1);
  const [searchProgress, setSearchProgress] = useState({ current: 0, total: 0 });

  // Cache for page text data - persists across searches
  const pageDataCacheRef = useRef(new Map());
  const abortControllerRef = useRef(null);
  const searchIdRef = useRef(0);

  // Reset cache when PDF changes
  useEffect(() => {
    pageDataCacheRef.current.clear();
    setSearchResults([]);
    setCurrentMatchIndex(-1);
    setSearchQuery('');
  }, [pdfDoc]);

  // Load page text data with caching
  const loadPageData = useCallback(async (pageNumber) => {
    if (!pdfDoc) return null;

    // Check cache first
    if (pageDataCacheRef.current.has(pageNumber)) {
      return pageDataCacheRef.current.get(pageNumber);
    }

    try {
      const page = await pdfDoc.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const viewport = page.getViewport({ scale: 1 });

      let fullText = '';
      const ranges = [];

      (textContent.items || []).forEach((item, index) => {
        const str = item?.str || '';
        const start = fullText.length;
        fullText += str;
        ranges.push({ start, end: start + str.length, itemIndex: index });
      });

      const data = {
        text: fullText,
        items: textContent.items || [],
        ranges,
        viewportTransform: viewport.transform
      };

      // Cache the result
      pageDataCacheRef.current.set(pageNumber, data);
      return data;
    } catch (error) {
      console.error(`Error loading page ${pageNumber} text data:`, error);
      return null;
    }
  }, [pdfDoc]);

  // Pre-cache all pages in background for instant search
  const preCachePages = useCallback(async () => {
    if (!pdfDoc) return;

    const numPages = pdfDoc.numPages;
    // Load pages in batches to avoid blocking
    const batchSize = 5;

    for (let i = 1; i <= numPages; i += batchSize) {
      const batch = [];
      for (let j = i; j < Math.min(i + batchSize, numPages + 1); j++) {
        if (!pageDataCacheRef.current.has(j)) {
          batch.push(loadPageData(j));
        }
      }
      if (batch.length > 0) {
        await Promise.all(batch);
        // Small delay between batches to keep UI responsive
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
  }, [pdfDoc, loadPageData]);

  // Start pre-caching when PDF loads
  useEffect(() => {
    if (pdfDoc) {
      // Start pre-caching after a short delay
      const timer = setTimeout(() => {
        preCachePages();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [pdfDoc, preCachePages]);

  // Optimized search function with progressive results
  const performSearch = useCallback(async (query) => {
    // Cancel any ongoing search
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const trimmedQuery = (query || '').trim();

    if (!trimmedQuery || !pdfDoc) {
      setSearchResults([]);
      setCurrentMatchIndex(-1);
      setIsSearching(false);
      setSearchProgress({ current: 0, total: 0 });
      return [];
    }

    const searchId = ++searchIdRef.current;
    abortControllerRef.current = new AbortController();

    setIsSearching(true);
    setSearchProgress({ current: 0, total: pdfDoc.numPages });

    const normalizedQuery = trimmedQuery.toLowerCase();
    const results = [];

    try {
      for (let pageNumber = 1; pageNumber <= pdfDoc.numPages; pageNumber++) {
        // Check if search was cancelled
        if (searchIdRef.current !== searchId) {
          return results;
        }

        const pageData = await loadPageData(pageNumber);
        if (!pageData || !pageData.text) continue;

        const normalizedText = pageData.text.toLowerCase();
        let searchIndex = normalizedText.indexOf(normalizedQuery);

        while (searchIndex !== -1) {
          const { snippet, matchIndex } = createSnippet(
            pageData.text,
            searchIndex,
            searchIndex + normalizedQuery.length
          );
          const rectangles = buildRectanglesForMatch(pageData, searchIndex, normalizedQuery.length);
          const bounds = calculateMatchBounds(rectangles);

          results.push({
            id: createResultId(),
            pageNumber,
            startIndex: searchIndex,
            length: normalizedQuery.length,
            snippet,
            snippetMatchIndex: matchIndex,
            rectangles,
            bounds
          });

          searchIndex = normalizedText.indexOf(normalizedQuery, searchIndex + 1);
        }

        // Update progress
        setSearchProgress({ current: pageNumber, total: pdfDoc.numPages });

        // Update results progressively every few pages for responsive UI
        if (pageNumber % 3 === 0 || pageNumber === pdfDoc.numPages) {
          if (searchIdRef.current === searchId) {
            setSearchResults([...results]);
          }
        }
      }

      if (searchIdRef.current === searchId) {
        setSearchResults(results);
        setCurrentMatchIndex(results.length > 0 ? 0 : -1);
        setIsSearching(false);
      }

      return results;
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('Search error:', error);
      }
      setIsSearching(false);
      return results;
    }
  }, [pdfDoc, loadPageData]);

  // Navigate to next match
  const goToNextMatch = useCallback(() => {
    if (searchResults.length === 0) return null;

    const nextIndex = currentMatchIndex < searchResults.length - 1
      ? currentMatchIndex + 1
      : 0;

    setCurrentMatchIndex(nextIndex);
    return searchResults[nextIndex];
  }, [searchResults, currentMatchIndex]);

  // Navigate to previous match
  const goToPrevMatch = useCallback(() => {
    if (searchResults.length === 0) return null;

    const prevIndex = currentMatchIndex > 0
      ? currentMatchIndex - 1
      : searchResults.length - 1;

    setCurrentMatchIndex(prevIndex);
    return searchResults[prevIndex];
  }, [searchResults, currentMatchIndex]);

  // Go to specific match by index
  const goToMatch = useCallback((index) => {
    if (index >= 0 && index < searchResults.length) {
      setCurrentMatchIndex(index);
      return searchResults[index];
    }
    return null;
  }, [searchResults]);

  // Get current match
  const currentMatch = useMemo(() => {
    if (currentMatchIndex >= 0 && currentMatchIndex < searchResults.length) {
      return searchResults[currentMatchIndex];
    }
    return null;
  }, [searchResults, currentMatchIndex]);

  // Get results grouped by page
  const resultsByPage = useMemo(() => {
    if (!searchResults || searchResults.length === 0) {
      return {};
    }
    return searchResults.reduce((acc, result) => {
      if (!acc[result.pageNumber]) {
        acc[result.pageNumber] = [];
      }
      acc[result.pageNumber].push(result);
      return acc;
    }, {});
  }, [searchResults]);

  // Clear search
  const clearSearch = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setSearchQuery('');
    setSearchResults([]);
    setCurrentMatchIndex(-1);
    setIsSearching(false);
    setSearchProgress({ current: 0, total: 0 });
  }, []);

  const contextValue = useMemo(() => ({
    searchQuery,
    setSearchQuery,
    searchResults,
    isSearching,
    currentMatchIndex,
    currentMatch,
    searchProgress,
    resultsByPage,
    performSearch,
    goToNextMatch,
    goToPrevMatch,
    goToMatch,
    clearSearch
  }), [
    searchQuery,
    searchResults,
    isSearching,
    currentMatchIndex,
    currentMatch,
    searchProgress,
    resultsByPage,
    performSearch,
    goToNextMatch,
    goToPrevMatch,
    goToMatch,
    clearSearch
  ]);

  return (
    <SearchContext.Provider value={contextValue}>
      {children}
    </SearchContext.Provider>
  );
};

export const useSearch = () => {
  const context = useContext(SearchContext);
  if (!context) {
    throw new Error('useSearch must be used within a SearchProvider');
  }
  return context;
};

export default SearchContext;
