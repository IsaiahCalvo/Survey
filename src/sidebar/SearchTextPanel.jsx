import React, { useState, useCallback, useEffect, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import Icon from '../Icons';

const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, Ubuntu, "Noto Sans", Arial, sans-serif';

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

const SearchTextPanel = ({
  pdfDoc,
  numPages,
  onNavigateToPage,
  onNavigateToMatch,
  searchResults: externalSearchResults,
  currentMatchIndex: externalCurrentMatchIndex,
  onSearchResultsChange,
  onCurrentMatchIndexChange
}) => {
  // Internal state for standalone use
  const [internalSearchQuery, setInternalSearchQuery] = useState('');
  const [internalSearchResults, setInternalSearchResults] = useState([]);
  const [internalCurrentMatchIndex, setInternalCurrentMatchIndex] = useState(-1);
  const [isSearching, setIsSearching] = useState(false);
  const [searchProgress, setSearchProgress] = useState({ current: 0, total: 0 });
  const searchInputRef = useRef(null);
  const resultsContainerRef = useRef(null);
  const pageDataCacheRef = useRef(new Map());
  const searchIdRef = useRef(0);

  // Use external state if provided, otherwise use internal state
  const searchResults = externalSearchResults !== undefined ? externalSearchResults : internalSearchResults;
  const currentMatchIndex = externalCurrentMatchIndex !== undefined ? externalCurrentMatchIndex : internalCurrentMatchIndex;

  const setSearchResults = useCallback((results) => {
    if (onSearchResultsChange) {
      onSearchResultsChange(results);
    } else {
      setInternalSearchResults(results);
    }
  }, [onSearchResultsChange]);

  const setCurrentMatchIndex = useCallback((index) => {
    if (onCurrentMatchIndexChange) {
      onCurrentMatchIndexChange(index);
    } else {
      setInternalCurrentMatchIndex(index);
    }
  }, [onCurrentMatchIndexChange]);

  // Reset cache when PDF changes
  useEffect(() => {
    pageDataCacheRef.current.clear();
    setSearchResults([]);
    setCurrentMatchIndex(-1);
    setInternalSearchQuery('');
  }, [pdfDoc, setSearchResults, setCurrentMatchIndex]);

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

  // Pre-cache pages in background
  useEffect(() => {
    if (!pdfDoc) return;

    let cancelled = false;

    const preCachePages = async () => {
      const batchSize = 5;
      for (let i = 1; i <= numPages; i += batchSize) {
        if (cancelled) break;
        const batch = [];
        for (let j = i; j < Math.min(i + batchSize, numPages + 1); j++) {
          if (!pageDataCacheRef.current.has(j)) {
            batch.push(loadPageData(j));
          }
        }
        if (batch.length > 0) {
          await Promise.all(batch);
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }
    };

    const timer = setTimeout(preCachePages, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pdfDoc, numPages, loadPageData]);

  // Optimized search function
  const performSearch = useCallback(async (query) => {
    const trimmedQuery = (query || '').trim();

    if (!trimmedQuery || !pdfDoc) {
      setSearchResults([]);
      setCurrentMatchIndex(-1);
      setIsSearching(false);
      setSearchProgress({ current: 0, total: 0 });
      return [];
    }

    const searchId = ++searchIdRef.current;
    setIsSearching(true);
    setSearchProgress({ current: 0, total: numPages });

    const normalizedQuery = trimmedQuery.toLowerCase();
    const results = [];

    try {
      for (let pageNumber = 1; pageNumber <= numPages; pageNumber++) {
        if (searchIdRef.current !== searchId) return results;

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

        setSearchProgress({ current: pageNumber, total: numPages });

        // Progressive results update
        if (pageNumber % 3 === 0 || pageNumber === numPages) {
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
      console.error('Search error:', error);
      setIsSearching(false);
      return results;
    }
  }, [pdfDoc, numPages, loadPageData, setSearchResults, setCurrentMatchIndex]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      performSearch(internalSearchQuery);
    }, 200);

    return () => clearTimeout(timer);
  }, [internalSearchQuery, performSearch]);

  // Navigate to match and trigger callback
  const navigateToMatch = useCallback((index) => {
    if (index < 0 || index >= searchResults.length) return;

    setCurrentMatchIndex(index);
    const result = searchResults[index];

    if (onNavigateToMatch) {
      onNavigateToMatch(result, index);
    } else if (onNavigateToPage) {
      onNavigateToPage(result.pageNumber);
    }
  }, [searchResults, setCurrentMatchIndex, onNavigateToMatch, onNavigateToPage]);

  // Go to next match
  const goToNextMatch = useCallback(() => {
    if (searchResults.length === 0) return;
    const nextIndex = currentMatchIndex < searchResults.length - 1
      ? currentMatchIndex + 1
      : 0;
    navigateToMatch(nextIndex);
  }, [searchResults, currentMatchIndex, navigateToMatch]);

  // Go to previous match
  const goToPrevMatch = useCallback(() => {
    if (searchResults.length === 0) return;
    const prevIndex = currentMatchIndex > 0
      ? currentMatchIndex - 1
      : searchResults.length - 1;
    navigateToMatch(prevIndex);
  }, [searchResults, currentMatchIndex, navigateToMatch]);

  // Handle result click
  const handleResultClick = useCallback((result, index) => {
    navigateToMatch(index);
  }, [navigateToMatch]);

  // Scroll selected result into view in the list
  useEffect(() => {
    if (currentMatchIndex >= 0 && resultsContainerRef.current) {
      const selectedElement = resultsContainerRef.current.querySelector(`[data-result-index="${currentMatchIndex}"]`);
      if (selectedElement) {
        selectedElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [currentMatchIndex]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!searchInputRef.current) return;

      // Only handle shortcuts when search input is focused or has results
      const isInputFocused = document.activeElement === searchInputRef.current;

      if (e.key === 'Enter' && isInputFocused) {
        e.preventDefault();
        if (e.shiftKey) {
          goToPrevMatch();
        } else {
          goToNextMatch();
        }
      }

      // F3 or Ctrl+G for next/prev (common search shortcuts)
      if (e.key === 'F3' || (e.ctrlKey && e.key === 'g')) {
        e.preventDefault();
        if (e.shiftKey) {
          goToPrevMatch();
        } else {
          goToNextMatch();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [goToNextMatch, goToPrevMatch]);

  const highlightMatch = (text, matchIndex, queryLength) => {
    if (matchIndex < 0 || !text) return text;

    const beforeMatch = text.substring(0, matchIndex);
    const match = text.substring(matchIndex, matchIndex + queryLength);
    const afterMatch = text.substring(matchIndex + queryLength);

    return (
      <>
        {beforeMatch}
        <strong style={{ background: '#4A90E2', color: '#ffffff', padding: '0 2px', borderRadius: '2px' }}>{match}</strong>
        {afterMatch}
      </>
    );
  };

  const clearSearch = useCallback(() => {
    setInternalSearchQuery('');
    setSearchResults([]);
    setCurrentMatchIndex(-1);
    searchInputRef.current?.focus();
  }, [setSearchResults, setCurrentMatchIndex]);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      fontFamily: FONT_FAMILY,
      background: '#252525'
    }}>
      {/* Search Bar */}
      <div style={{
        padding: '12px',
        background: '#252525',
        borderBottom: '1px solid #3a3a3a'
      }}>
        <div style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center'
        }}>
          <Icon
            name="search"
            size={16}
            color="#999"
            style={{
              position: 'absolute',
              left: '10px',
              pointerEvents: 'none'
            }}
          />
          <input
            ref={searchInputRef}
            type="text"
            value={internalSearchQuery}
            onChange={(e) => setInternalSearchQuery(e.target.value)}
            placeholder="Search text in PDF..."
            style={{
              width: '100%',
              padding: '8px 10px 8px 36px',
              background: '#2b2b2b',
              border: '1px solid #3a3a3a',
              borderRadius: '6px',
              fontSize: '13px',
              fontFamily: FONT_FAMILY,
              color: '#ddd',
              outline: 'none',
              transition: 'border-color 0.15s ease'
            }}
            onFocus={(e) => e.currentTarget.style.borderColor = '#4A90E2'}
            onBlur={(e) => e.currentTarget.style.borderColor = '#3a3a3a'}
          />
          {internalSearchQuery && (
            <button
              onClick={clearSearch}
              style={{
                position: 'absolute',
                right: '8px',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '4px'
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = '#333'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <Icon name="close" size={14} color="#999" />
            </button>
          )}
        </div>

        {/* Navigation Controls - shown when there are results */}
        {searchResults.length > 0 && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: '10px',
            padding: '6px 8px',
            background: '#2b2b2b',
            borderRadius: '6px',
            border: '1px solid #3a3a3a'
          }}>
            {/* Result Counter */}
            <div style={{
              fontSize: '12px',
              color: '#ddd',
              fontWeight: '500'
            }}>
              {currentMatchIndex >= 0 ? (
                <span>
                  <span style={{ color: '#4A90E2' }}>{currentMatchIndex + 1}</span>
                  <span style={{ color: '#999' }}> of </span>
                  <span style={{ color: '#4A90E2' }}>{searchResults.length}</span>
                </span>
              ) : (
                <span style={{ color: '#999' }}>{searchResults.length} results</span>
              )}
            </div>

            {/* Navigation Buttons */}
            <div style={{
              display: 'flex',
              gap: '4px'
            }}>
              <button
                onClick={goToPrevMatch}
                disabled={searchResults.length === 0}
                title="Previous match (Shift+Enter)"
                style={{
                  background: 'transparent',
                  border: '1px solid #3a3a3a',
                  borderRadius: '4px',
                  cursor: searchResults.length > 0 ? 'pointer' : 'not-allowed',
                  padding: '4px 8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: searchResults.length > 0 ? 1 : 0.5
                }}
                onMouseEnter={(e) => {
                  if (searchResults.length > 0) e.currentTarget.style.background = '#333';
                }}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                <Icon name="chevronUp" size={14} color="#ddd" />
              </button>
              <button
                onClick={goToNextMatch}
                disabled={searchResults.length === 0}
                title="Next match (Enter)"
                style={{
                  background: 'transparent',
                  border: '1px solid #3a3a3a',
                  borderRadius: '4px',
                  cursor: searchResults.length > 0 ? 'pointer' : 'not-allowed',
                  padding: '4px 8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: searchResults.length > 0 ? 1 : 0.5
                }}
                onMouseEnter={(e) => {
                  if (searchResults.length > 0) e.currentTarget.style.background = '#333';
                }}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                <Icon name="chevronDown" size={14} color="#ddd" />
              </button>
            </div>
          </div>
        )}

        {/* Search Progress */}
        {isSearching && searchProgress.total > 0 && (
          <div style={{
            marginTop: '8px',
            height: '3px',
            background: '#3a3a3a',
            borderRadius: '2px',
            overflow: 'hidden'
          }}>
            <div style={{
              width: `${(searchProgress.current / searchProgress.total) * 100}%`,
              height: '100%',
              background: '#4A90E2',
              transition: 'width 0.1s ease'
            }} />
          </div>
        )}
      </div>

      {/* Search Results */}
      <div
        ref={resultsContainerRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px'
        }}
      >
        {isSearching && (
          <div style={{
            padding: '20px',
            textAlign: 'center',
            color: '#999',
            fontSize: '13px'
          }}>
            Searching... ({searchProgress.current}/{searchProgress.total} pages)
          </div>
        )}

        {!isSearching && internalSearchQuery && searchResults.length === 0 && (
          <div style={{
            padding: '40px 20px',
            textAlign: 'center',
            color: '#999',
            fontSize: '13px'
          }}>
            No results found
          </div>
        )}

        {!isSearching && !internalSearchQuery && (
          <div style={{
            padding: '40px 20px',
            textAlign: 'center',
            color: '#999',
            fontSize: '13px'
          }}>
            Enter a search term to find text in the PDF
          </div>
        )}

        {!isSearching && searchResults.length > 0 && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '2px'
          }}>
            {searchResults.map((result, index) => {
              const isActive = index === currentMatchIndex;
              return (
                <div
                  key={result.id}
                  data-result-index={index}
                  onClick={() => handleResultClick(result, index)}
                  style={{
                    padding: '10px 12px',
                    background: isActive ? '#3a5070' : '#2b2b2b',
                    border: isActive ? '1px solid #4A90E2' : '1px solid #3a3a3a',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    fontSize: '12px',
                    color: '#ddd'
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.background = '#333';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.background = '#2b2b2b';
                    }
                  }}
                >
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    marginBottom: '4px',
                    gap: '8px'
                  }}>
                    <span style={{
                      fontSize: '10px',
                      fontWeight: '600',
                      color: '#fff',
                      background: isActive ? '#4A90E2' : '#666',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      minWidth: '20px',
                      textAlign: 'center'
                    }}>
                      {index + 1}
                    </span>
                    <span style={{
                      fontSize: '11px',
                      fontWeight: '600',
                      color: '#4A90E2',
                      background: '#e8f0fe',
                      padding: '2px 6px',
                      borderRadius: '4px'
                    }}>
                      Page {result.pageNumber}
                    </span>
                  </div>
                  <div style={{
                    fontSize: '12px',
                    lineHeight: '1.4',
                    color: '#999',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}>
                    {highlightMatch(result.snippet, result.snippetMatchIndex, internalSearchQuery.length)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default SearchTextPanel;
