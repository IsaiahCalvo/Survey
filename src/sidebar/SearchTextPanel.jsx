import React, { useState, useCallback, useEffect, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import Icon from '../Icons';

const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, Ubuntu, "Noto Sans", Arial, sans-serif';

const SearchTextPanel = ({
  pdfDoc,
  numPages,
  onNavigateToPage
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedResultIndex, setSelectedResultIndex] = useState(-1);
  const searchInputRef = useRef(null);

  const performSearch = useCallback(async () => {
    if (!pdfDoc || !searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    const results = [];
    const query = searchQuery.toLowerCase().trim();

    try {
      // Search through all pages
      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        try {
          const page = await pdfDoc.getPage(pageNum);
          const textContent = await page.getTextContent();
          
          // Extract text items
          const textItems = textContent.items
            .filter(item => item.str && item.str.trim().length > 0)
            .map(item => item.str);

          // Search for query in text items
          const fullText = textItems.join(' ').toLowerCase();
          if (fullText.includes(query)) {
            // Find all occurrences with context
            let searchIndex = 0;
            while ((searchIndex = fullText.indexOf(query, searchIndex)) !== -1) {
              // Get context around the match
              const start = Math.max(0, searchIndex - 50);
              const end = Math.min(fullText.length, searchIndex + query.length + 50);
              const snippet = fullText.substring(start, end);
              
              // Create a more readable snippet
              const readableSnippet = snippet
                .replace(/\s+/g, ' ')
                .trim();
              
              results.push({
                pageNumber: pageNum,
                index: searchIndex,
                snippet: readableSnippet,
                matchIndex: searchIndex - start
              });
              
              searchIndex += query.length;
            }
          }
        } catch (error) {
          console.error(`Error searching page ${pageNum}:`, error);
        }
      }
    } catch (error) {
      console.error('Error performing search:', error);
    }

    setIsSearching(false);
    setSearchResults(results);
    setSelectedResultIndex(-1);
  }, [pdfDoc, numPages, searchQuery]);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      performSearch();
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, performSearch]);

  const handleResultClick = useCallback((result) => {
    if (onNavigateToPage) {
      onNavigateToPage(result.pageNumber);
    }
  }, [onNavigateToPage]);

  const highlightMatch = (text, matchIndex, queryLength) => {
    const beforeMatch = text.substring(0, matchIndex);
    const match = text.substring(matchIndex, matchIndex + queryLength);
    const afterMatch = text.substring(matchIndex + queryLength);
    
    return (
      <>
        {beforeMatch}
        <strong style={{ background: '#4A90E2', color: '#ffffff' }}>{match}</strong>
        {afterMatch}
      </>
    );
  };

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
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
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
          {searchQuery && (
            <button
              onClick={() => {
                setSearchQuery('');
                setSearchResults([]);
                searchInputRef.current?.focus();
              }}
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
      </div>

      {/* Search Results */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '8px'
      }}>
        {isSearching && (
          <div style={{
            padding: '20px',
            textAlign: 'center',
            color: '#999',
            fontSize: '13px'
          }}>
            Searching...
          </div>
        )}

        {!isSearching && searchQuery && searchResults.length === 0 && (
          <div style={{
            padding: '40px 20px',
            textAlign: 'center',
            color: '#999',
            fontSize: '13px'
          }}>
            No results found
          </div>
        )}

        {!isSearching && !searchQuery && (
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
            {searchResults.map((result, index) => (
              <div
                key={`${result.pageNumber}-${result.index}`}
                onClick={() => {
                  handleResultClick(result);
                  setSelectedResultIndex(index);
                }}
                onDoubleClick={() => handleResultClick(result)}
                style={{
                  padding: '10px 12px',
                  background: selectedResultIndex === index ? '#3a3a3a' : '#2b2b2b',
                  border: '1px solid #3a3a3a',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  transition: 'background 0.15s ease',
                  fontSize: '12px',
                  color: '#ddd'
                }}
                onMouseEnter={(e) => {
                  if (selectedResultIndex !== index) {
                    e.currentTarget.style.background = '#333';
                  }
                }}
                onMouseLeave={(e) => {
                  if (selectedResultIndex !== index) {
                    e.currentTarget.style.background = '#2b2b2b';
                  }
                }}
              >
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  marginBottom: '4px'
                }}>
                  <span style={{
                    fontSize: '11px',
                    fontWeight: '600',
                    color: '#4A90E2',
                    background: '#e8f0fe',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    marginRight: '8px'
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
                  {highlightMatch(result.snippet, result.matchIndex, searchQuery.length)}
                </div>
              </div>
            ))}
          </div>
        )}

        {!isSearching && searchResults.length > 0 && (
          <div style={{
            padding: '8px 12px',
            fontSize: '11px',
            color: '#999',
            textAlign: 'center',
            borderTop: '1px solid #3a3a3a',
            marginTop: '8px',
            paddingTop: '12px'
          }}>
            {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} found
          </div>
        )}
      </div>
    </div>
  );
};

export default SearchTextPanel;

