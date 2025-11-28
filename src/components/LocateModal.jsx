import React, { useEffect, useState, useCallback } from 'react';
import Icon from '../Icons';

const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, Ubuntu, "Noto Sans", Arial, sans-serif';

/**
 * LocateModal - Modal for locating text in PDF when item has no highlight
 * 
 * Props:
 * - isOpen: boolean - whether modal is open
 * - onClose: function - callback to close modal
 * - searchTerm: string - the text to search for
 * - searchResults: array - results from PDF text search
 * - currentIndex: number - current result index (0-based)
 * - onNavigatePrevious: function - navigate to previous result
 * - onNavigateNext: function - navigate to next result
 * - onSelectResult: function(index) - select a specific result
 * - onDrawHighlight: function - callback when user wants to draw highlight
 * - position: string - 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'
 */
const LocateModal = ({
  isOpen,
  onClose,
  searchTerm,
  searchResults = [],
  currentIndex = -1,
  onNavigatePrevious,
  onNavigateNext,
  onSelectResult,
  onDrawHighlight,
  position = 'top-right',
  isSearching = false
}) => {
  const [isDrawing, setIsDrawing] = useState(false);

  // Get position styles based on position prop
  const getPositionStyles = () => {
    const baseStyles = {
      position: 'fixed',
      zIndex: 10000,
      padding: '16px',
      background: '#2b2b2b',
      border: '1px solid #4A90E2',
      borderRadius: '8px',
      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
      fontFamily: FONT_FAMILY,
      minWidth: '280px',
      maxWidth: '320px'
    };

    switch (position) {
      case 'top-left':
        return { ...baseStyles, top: '80px', left: '20px' };
      case 'top-right':
        return { ...baseStyles, top: '80px', right: '20px' };
      case 'bottom-left':
        return { ...baseStyles, bottom: '80px', left: '20px' };
      case 'bottom-right':
        return { ...baseStyles, bottom: '80px', right: '20px' };
      default:
        return { ...baseStyles, top: '80px', right: '20px' };
    }
  };

  const handleDrawHighlight = useCallback(() => {
    setIsDrawing(true);
    if (onDrawHighlight) {
      onDrawHighlight();
    }
    // Modal will be closed by parent after highlight is drawn
  }, [onDrawHighlight]);

  // Don't render if not open
  if (!isOpen) return null;

  const totalResults = searchResults.length;
  const displayIndex = currentIndex >= 0 ? currentIndex + 1 : 0;
  const hasResults = totalResults > 0;

  return (
    <div style={getPositionStyles()}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '12px',
        paddingBottom: '12px',
        borderBottom: '1px solid #444'
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ fontSize: '14px', fontWeight: '600', color: '#fff' }}>
            Locate: {searchTerm || 'Untitled'}
          </div>
          <div style={{ fontSize: '12px', color: '#999' }}>
            {isSearching ? 'Searching...' : hasResults ? `${totalResults} instance${totalResults !== 1 ? 's' : ''} found` : 'No matches found'}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#999',
            cursor: 'pointer',
            padding: '4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          onMouseEnter={(e) => e.currentTarget.style.color = '#fff'}
          onMouseLeave={(e) => e.currentTarget.style.color = '#999'}
        >
          <Icon name="close" size={16} color="currentColor" />
        </button>
      </div>

      {/* Navigation Controls */}
      {isSearching ? (
        <div style={{
          padding: '24px',
          textAlign: 'center',
          color: '#999',
          fontSize: '13px'
        }}>
          Searching for "{searchTerm}"...
        </div>
      ) : hasResults ? (
        <>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            marginBottom: '12px'
          }}>
            <button
              onClick={onNavigatePrevious}
              disabled={totalResults === 0 || isSearching}
              style={{
                padding: '8px 12px',
                background: '#333',
                border: '1px solid #444',
                borderRadius: '6px',
                color: '#ddd',
                fontSize: '13px',
                cursor: totalResults > 0 && !isSearching ? 'pointer' : 'not-allowed',
                opacity: totalResults > 0 && !isSearching ? 1 : 0.5,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                flex: 1
              }}
              onMouseEnter={(e) => {
                if (totalResults > 0 && !isSearching) {
                  e.currentTarget.style.background = '#3a3a3a';
                  e.currentTarget.style.borderColor = '#4A90E2';
                }
              }}
              onMouseLeave={(e) => {
                if (totalResults > 0 && !isSearching) {
                  e.currentTarget.style.background = '#333';
                  e.currentTarget.style.borderColor = '#444';
                }
              }}
            >
              <Icon name="chevronLeft" size={14} color="currentColor" />
              Previous
            </button>

            <div style={{
              fontSize: '13px',
              color: '#bbb',
              padding: '8px 12px',
              background: '#333',
              borderRadius: '6px',
              minWidth: '80px',
              textAlign: 'center'
            }}>
              {displayIndex} of {totalResults}
            </div>

            <button
              onClick={onNavigateNext}
              disabled={totalResults === 0 || isSearching}
              style={{
                padding: '8px 12px',
                background: '#333',
                border: '1px solid #444',
                borderRadius: '6px',
                color: '#ddd',
                fontSize: '13px',
                cursor: totalResults > 0 && !isSearching ? 'pointer' : 'not-allowed',
                opacity: totalResults > 0 && !isSearching ? 1 : 0.5,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                flex: 1
              }}
              onMouseEnter={(e) => {
                if (totalResults > 0 && !isSearching) {
                  e.currentTarget.style.background = '#3a3a3a';
                  e.currentTarget.style.borderColor = '#4A90E2';
                }
              }}
              onMouseLeave={(e) => {
                if (totalResults > 0 && !isSearching) {
                  e.currentTarget.style.background = '#333';
                  e.currentTarget.style.borderColor = '#444';
                }
              }}
            >
              Next
              <Icon name="chevronRight" size={14} color="currentColor" />
            </button>
          </div>

          {/* Result List */}
          <div style={{
            maxHeight: '200px',
            overflowY: 'auto',
            marginBottom: '12px'
          }}>
            {searchResults.map((result, index) => {
              const isActive = index === currentIndex;
              return (
                <div
                  key={result.id}
                  onClick={() => onSelectResult?.(index)}
                  style={{
                    padding: '8px 12px',
                    background: isActive ? '#3a3a3a' : '#333',
                    border: `1px solid ${isActive ? '#4A90E2' : '#444'}`,
                    borderRadius: '6px',
                    marginBottom: '6px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    color: '#ddd',
                    transition: 'background 0.15s ease, border 0.15s ease'
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.background = '#3a3a3a';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.background = '#333';
                    }
                  }}
                >
                  <div style={{ color: '#4A90E2', fontWeight: '600', marginBottom: '2px' }}>
                    Page {result.pageNumber}
                  </div>
                  {result.snippet && (
                    <div style={{ color: '#aaa', lineHeight: 1.4 }}>
                      {result.snippet}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Draw Highlight Button */}
          <button
            onClick={handleDrawHighlight}
            disabled={isDrawing || isSearching}
            style={{
              width: '100%',
              padding: '10px 16px',
              background: (isDrawing || isSearching) ? '#555' : '#4A90E2',
              border: 'none',
              borderRadius: '6px',
              color: '#fff',
              fontSize: '13px',
              fontWeight: '600',
              cursor: (isDrawing || isSearching) ? 'not-allowed' : 'pointer',
              transition: 'background 0.15s ease'
            }}
            onMouseEnter={(e) => {
              if (!isDrawing && !isSearching) {
                e.currentTarget.style.background = '#5AA0F2';
              }
            }}
            onMouseLeave={(e) => {
              if (!isDrawing && !isSearching) {
                e.currentTarget.style.background = '#4A90E2';
              }
            }}
          >
            {isDrawing ? 'Drawing...' : isSearching ? 'Searching...' : 'Draw Highlight Here'}
          </button>
        </>
      ) : !isSearching ? (
        <div style={{
          padding: '24px',
          textAlign: 'center',
          color: '#999',
          fontSize: '13px'
        }}>
          No matches found for "{searchTerm}"
        </div>
      ) : null}
    </div>
  );
};

export default LocateModal;
