import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import Icon from '../Icons';

const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, Ubuntu, "Noto Sans", Arial, sans-serif';

const PagesPanel = ({
  pdfDoc,
  numPages,
  pageNum,
  onNavigateToPage,
  onDuplicatePage,
  onDeletePage,
  onCutPage,
  onCopyPage,
  onPastePage,
  clipboardPage,
  clipboardType,
  onRotatePage,
  onMirrorPage,
  onResetPage,
  onReorderPages,
  pageTransformations = {},
  shouldShowPage,
  activeSpacePages,
  scale,
  onPageDragStart,
  tabId
}) => {
  const [thumbnails, setThumbnails] = useState({});
  const [pageAspectRatios, setPageAspectRatios] = useState({});
  const [contextMenu, setContextMenu] = useState(null);
  const [selectedPage, setSelectedPage] = useState(pageNum);
  const [draggedPage, setDraggedPage] = useState(null);
  const [dragOverPage, setDragOverPage] = useState(null);
  const contextMenuRef = useRef(null);
  const thumbnailRefs = useRef({});
  const observerRef = useRef(null);
  const containerRef = useRef(null);
  const allowedPages = useMemo(() => {
    if (Array.isArray(activeSpacePages) && activeSpacePages.length > 0) {
      return activeSpacePages;
    }

    if (typeof shouldShowPage === 'function') {
      return Array.from({ length: numPages }, (_, i) => i + 1).filter(pageNumber => shouldShowPage(pageNumber));
    }

    return Array.from({ length: numPages }, (_, i) => i + 1);
  }, [activeSpacePages, shouldShowPage, numPages]);

  // Update selected page when pageNum prop changes
  useEffect(() => {
    if (allowedPages.includes(pageNum)) {
      setSelectedPage(pageNum);
    } else if (allowedPages.length > 0) {
      setSelectedPage(allowedPages[0]);
    } else {
      setSelectedPage(null);
    }
  }, [pageNum, allowedPages]);

  // Generate aspect ratios for all pages (lightweight, runs once)
  useEffect(() => {
    if (!pdfDoc) return;

    const getAspectRatios = async () => {
      const ratios = {};
      for (let i = 1; i <= numPages; i++) {
        try {
          const page = await pdfDoc.getPage(i);
          const viewport = page.getViewport({ scale: 1 });
          ratios[i] = (viewport.height / viewport.width) * 100; // percentage for paddingBottom
        } catch (error) {
          console.error(`Error getting aspect ratio for page ${i}:`, error);
          ratios[i] = 129; // default to letter size ratio
        }
      }
      setPageAspectRatios(ratios);
    };

    getAspectRatios();
  }, [pdfDoc, numPages]);

  // Generate thumbnail for a specific page
  const generateThumbnail = useCallback(async (pageNumber) => {
    if (!pdfDoc || thumbnails[pageNumber]) return;

    try {
      const page = await pdfDoc.getPage(pageNumber);
      const thumbnailScale = 0.4; // Higher resolution for clearer thumbnails
      const viewport = page.getViewport({ scale: thumbnailScale });

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');

      // Use device pixel ratio for sharper rendering
      const dpr = window.devicePixelRatio || 1;
      canvas.width = viewport.width * dpr;
      canvas.height = viewport.height * dpr;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      context.scale(dpr, dpr);

      await page.render({
        canvasContext: context,
        viewport: viewport
      }).promise;

      setThumbnails(prev => ({
        ...prev,
        [pageNumber]: canvas.toDataURL('image/jpeg', 0.85) // Use JPEG with good quality for smaller size
      }));
    } catch (error) {
      console.error(`Error generating thumbnail for page ${pageNumber}:`, error);
    }
  }, [pdfDoc, thumbnails]);

  // Set up Intersection Observer for lazy loading thumbnails
  useEffect(() => {
    if (!pdfDoc || Object.keys(pageAspectRatios).length === 0) return;

    // Clean up existing observer
    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    // Create new observer
    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const pageNumber = parseInt(entry.target.dataset.pageNumber);
            generateThumbnail(pageNumber);
          }
        });
      },
      {
        root: null,
        rootMargin: '200px', // Start loading 200px before entering viewport
        threshold: 0.01
      }
    );

    // Observe all thumbnail containers
    Object.values(thumbnailRefs.current).forEach((ref) => {
      if (ref) {
        observerRef.current.observe(ref);
      }
    });

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [pdfDoc, pageAspectRatios, generateThumbnail]);

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(event.target)) {
        setContextMenu(null);
      }
    };

    if (contextMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [contextMenu]);

  // Scroll to selected page
  useEffect(() => {
    if (selectedPage && thumbnailRefs.current[selectedPage]) {
      thumbnailRefs.current[selectedPage].scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
    }
  }, [selectedPage]);

  const handleContextMenu = useCallback((e, pageNumber) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      pageNumber,
      x: e.clientX,
      y: e.clientY
    });
  }, []);

  const handlePageClick = useCallback((pageNumber) => {
    setSelectedPage(pageNumber);
    if (onNavigateToPage) {
      onNavigateToPage(pageNumber);
    }
  }, [onNavigateToPage]);

  const handlePageDoubleClick = useCallback((pageNumber) => {
    if (onNavigateToPage) {
      onNavigateToPage(pageNumber);
    }
  }, [onNavigateToPage]);

  const handleDuplicate = useCallback((pageNumber) => {
    if (onDuplicatePage) {
      onDuplicatePage(pageNumber);
    }
    setContextMenu(null);
  }, [onDuplicatePage]);


  const handleDelete = useCallback((pageNumber) => {
    if (onDeletePage && window.confirm(`Delete page ${pageNumber}?`)) {
      onDeletePage(pageNumber);
    }
    setContextMenu(null);
  }, [onDeletePage]);

  const handleCut = useCallback((pageNumber) => {
    if (onCutPage) {
      onCutPage(pageNumber);
    }
    setContextMenu(null);
  }, [onCutPage]);

  const handleCopy = useCallback((pageNumber) => {
    if (onCopyPage) {
      onCopyPage(pageNumber);
    }
    setContextMenu(null);
  }, [onCopyPage]);

  const handlePaste = useCallback((pageNumber) => {
    if (onPastePage && clipboardPage) {
      onPastePage(pageNumber, clipboardPage, clipboardType);
    }
    setContextMenu(null);
  }, [onPastePage, clipboardPage, clipboardType]);

  const handleRotate = useCallback((pageNumber) => {
    if (onRotatePage) {
      onRotatePage(pageNumber);
    }
    setContextMenu(null);
  }, [onRotatePage]);

  const handleMirrorHorizontal = useCallback((pageNumber) => {
    if (onMirrorPage) {
      onMirrorPage(pageNumber, 'horizontal');
    }
    setContextMenu(null);
  }, [onMirrorPage]);

  const handleMirrorVertical = useCallback((pageNumber) => {
    if (onMirrorPage) {
      onMirrorPage(pageNumber, 'vertical');
    }
    setContextMenu(null);
  }, [onMirrorPage]);

  const handleReset = useCallback((pageNumber) => {
    if (onResetPage) {
      onResetPage(pageNumber);
    }
    setContextMenu(null);
  }, [onResetPage]);

  // Handle drag start for internal reordering
  const handleDragStart = useCallback((e, pageNumber) => {
    setDraggedPage(pageNumber);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/pdf-page-internal', pageNumber.toString());
    
    // Also set data for external drag (to tabs)
    if (onPageDragStart && tabId) {
      e.dataTransfer.setData('application/pdf-page', JSON.stringify({
        tabId,
        pageNumber,
        pdfDoc: null
      }));
    }
  }, [onPageDragStart, tabId]);

  // Handle drag over for internal reordering
  const handleDragOver = useCallback((e, targetPageNumber) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Check if this is an internal drag
    const types = Array.from(e.dataTransfer.types || []);
    if (types.includes('application/pdf-page-internal')) {
      e.dataTransfer.dropEffect = 'move';
      if (draggedPage !== null && draggedPage !== targetPageNumber) {
        setDragOverPage(targetPageNumber);
      }
    } else if (types.includes('application/pdf-page')) {
      // External drag to tab - allow it
      e.dataTransfer.dropEffect = 'move';
    }
  }, [draggedPage]);

  // Handle drag leave
  const handleDragLeave = useCallback((e) => {
    const relatedTarget = e.relatedTarget;
    if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
      setDragOverPage(null);
    }
  }, []);

  // Handle drop for internal reordering
  const handleDrop = useCallback((e, targetPageNumber) => {
    e.preventDefault();
    e.stopPropagation();
    
    const types = Array.from(e.dataTransfer.types || []);
    
    // Check if this is an internal reorder
    if (types.includes('application/pdf-page-internal')) {
      const sourcePageNumber = parseInt(e.dataTransfer.getData('application/pdf-page-internal'));
      if (sourcePageNumber && sourcePageNumber !== targetPageNumber && onReorderPages) {
        onReorderPages(sourcePageNumber, targetPageNumber);
      }
    }
    
    setDraggedPage(null);
    setDragOverPage(null);
  }, [onReorderPages]);

  // Handle drag end to reset state if drag is cancelled
  const handleDragEnd = useCallback(() => {
    setDraggedPage(null);
    setDragOverPage(null);
  }, []);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      fontFamily: FONT_FAMILY,
      background: '#252525'
    }}>
      {/* Thumbnail List */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '6px',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px'
        }}
      >
        {allowedPages.map(pageNumber => {
          const isSelected = pageNumber === selectedPage;

          return (
            <div
              key={pageNumber}
              ref={el => { thumbnailRefs.current[pageNumber] = el; }}
              data-page-number={pageNumber}
              draggable={true}
              onDragStart={(e) => {
                handleDragStart(e, pageNumber);
                if (onPageDragStart && tabId) {
                  onPageDragStart(tabId, pageNumber);
                }
              }}
              onDragOver={(e) => handleDragOver(e, pageNumber)}
              onDragLeave={handleDragLeave}
              onDragEnd={handleDragEnd}
              onDrop={(e) => handleDrop(e, pageNumber)}
              onContextMenu={(e) => handleContextMenu(e, pageNumber)}
              onClick={() => handlePageClick(pageNumber)}
              onDoubleClick={() => handlePageDoubleClick(pageNumber)}
              style={{
                position: 'relative',
                padding: '4px',
                background: isSelected ? '#3a3a3a' : (dragOverPage === pageNumber ? '#2b4a5a' : 'transparent'),
                border: isSelected ? '1px solid #4A90E2' : (dragOverPage === pageNumber ? '1px solid #4A90E2' : '1px solid transparent'),
                borderRadius: '4px',
                cursor: draggedPage === pageNumber ? 'grabbing' : 'grab',
                opacity: draggedPage === pageNumber ? 0.5 : 1,
                transition: draggedPage === pageNumber ? 'none' : 'all 0.15s ease'
              }}
              onMouseEnter={(e) => {
                if (!isSelected) {
                  e.currentTarget.style.background = '#2b2b2b';
                }
              }}
              onMouseLeave={(e) => {
                if (!isSelected) {
                  e.currentTarget.style.background = 'transparent';
                }
              }}
            >
              {/* Page Number Badge */}
              <div style={{
                position: 'absolute',
                top: '6px',
                right: '6px',
                width: '20px',
                height: '20px',
                borderRadius: '50%',
                background: '#4a4a4a',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '10px',
                fontWeight: '600',
                fontFamily: FONT_FAMILY,
                zIndex: 1,
                boxShadow: '0 1px 2px rgba(0, 0, 0, 0.3)'
              }}>
                {pageNumber}
              </div>

              {/* Thumbnail */}
              <div style={{
                position: 'relative',
                width: '100%',
                paddingBottom: `${pageAspectRatios[pageNumber] || 129}%`,
                background: '#ffffff',
                borderRadius: '2px',
                overflow: 'hidden'
              }}>
                {thumbnails[pageNumber] ? (
                  <img
                    src={thumbnails[pageNumber]}
                    alt={`Page ${pageNumber}`}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: '100%',
                      objectFit: 'contain',
                      display: 'block',
                      transform: (() => {
                        const transform = pageTransformations[pageNumber] || { rotation: 0, mirrorH: false, mirrorV: false };
                        const transforms = [];
                        if (transform.rotation) {
                          transforms.push(`rotate(${transform.rotation}deg)`);
                        }
                        if (transform.mirrorH) {
                          transforms.push('scaleX(-1)');
                        }
                        if (transform.mirrorV) {
                          transforms.push('scaleY(-1)');
                        }
                        return transforms.length > 0 ? transforms.join(' ') : 'none';
                      })(),
                      transformOrigin: 'center center'
                    }}
                  />
                ) : (
                  <div style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    color: '#666',
                    fontSize: '10px'
                  }}>
                    Loading...
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {allowedPages.length === 0 && (
          <div style={{
            padding: '32px 16px',
            textAlign: 'center',
            color: '#777',
            fontSize: '12px'
          }}>
            No pages are visible in this space. Add pages to the active space to see them here.
          </div>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          style={{
            position: 'fixed',
            left: contextMenu.x,
            top: contextMenu.y,
            background: '#333',
            border: '1px solid #444',
            borderRadius: '6px',
            padding: '4px',
            zIndex: 10000,
            minWidth: '180px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
            fontFamily: FONT_FAMILY
          }}
        >
          <button
            onClick={() => handleCut(contextMenu.pageNumber)}
            style={{
              width: '100%',
              padding: '8px 12px',
              background: 'transparent',
              border: 'none',
              borderRadius: '4px',
              fontSize: '13px',
              textAlign: 'left',
              cursor: 'pointer',
              color: '#ddd',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#3a3a3a'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <Icon name="scissors" size={14} color="#999" />
            Cut
          </button>
          <button
            onClick={() => handleCopy(contextMenu.pageNumber)}
            style={{
              width: '100%',
              padding: '8px 12px',
              background: 'transparent',
              border: 'none',
              borderRadius: '4px',
              fontSize: '13px',
              textAlign: 'left',
              cursor: 'pointer',
              color: '#ddd',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#3a3a3a'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <Icon name="copy" size={14} color="#999" />
            Copy
          </button>
          <button
            onClick={() => handlePaste(contextMenu.pageNumber)}
            disabled={!clipboardPage}
            style={{
              width: '100%',
              padding: '8px 12px',
              background: 'transparent',
              border: 'none',
              borderRadius: '4px',
              fontSize: '13px',
              textAlign: 'left',
              cursor: clipboardPage ? 'pointer' : 'not-allowed',
              color: clipboardPage ? '#ddd' : '#666',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              opacity: clipboardPage ? 1 : 0.5
            }}
            onMouseEnter={(e) => {
              if (clipboardPage) {
                e.currentTarget.style.background = '#3a3a3a';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <Icon name="paste" size={14} color={clipboardPage ? "#999" : "#555"} />
            Paste
          </button>
          <button
            onClick={() => handleDuplicate(contextMenu.pageNumber)}
            style={{
              width: '100%',
              padding: '8px 12px',
              background: 'transparent',
              border: 'none',
              borderRadius: '4px',
              fontSize: '13px',
              textAlign: 'left',
              cursor: 'pointer',
              color: '#ddd',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#3a3a3a'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <Icon name="duplicate" size={14} color="#999" />
            Duplicate
          </button>
          <div style={{
            height: '1px',
            background: '#444',
            margin: '4px 0'
          }} />
          <button
            onClick={() => handleRotate(contextMenu.pageNumber)}
            style={{
              width: '100%',
              padding: '8px 12px',
              background: 'transparent',
              border: 'none',
              borderRadius: '4px',
              fontSize: '13px',
              textAlign: 'left',
              cursor: 'pointer',
              color: '#ddd',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#3a3a3a'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <Icon name="rotate" size={14} color="#999" />
            Rotate
          </button>
          <button
            onClick={() => handleMirrorHorizontal(contextMenu.pageNumber)}
            style={{
              width: '100%',
              padding: '8px 12px',
              background: 'transparent',
              border: 'none',
              borderRadius: '4px',
              fontSize: '13px',
              textAlign: 'left',
              cursor: 'pointer',
              color: '#ddd',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#3a3a3a'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <Icon name="flipHorizontal" size={14} color="#999" />
            Mirror Horizontally
          </button>
          <button
            onClick={() => handleMirrorVertical(contextMenu.pageNumber)}
            style={{
              width: '100%',
              padding: '8px 12px',
              background: 'transparent',
              border: 'none',
              borderRadius: '4px',
              fontSize: '13px',
              textAlign: 'left',
              cursor: 'pointer',
              color: '#ddd',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#3a3a3a'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <Icon name="flipVertical" size={14} color="#999" />
            Mirror Vertically
          </button>
          <button
            onClick={() => handleReset(contextMenu.pageNumber)}
            style={{
              width: '100%',
              padding: '8px 12px',
              background: 'transparent',
              border: 'none',
              borderRadius: '4px',
              fontSize: '13px',
              textAlign: 'left',
              cursor: 'pointer',
              color: '#ddd',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#3a3a3a'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <Icon name="reset" size={14} color="#999" />
            Reset
          </button>
          <div style={{
            height: '1px',
            background: '#444',
            margin: '4px 0'
          }} />
          <button
            onClick={() => handleDelete(contextMenu.pageNumber)}
            style={{
              width: '100%',
              padding: '8px 12px',
              background: 'transparent',
              border: 'none',
              borderRadius: '4px',
              fontSize: '13px',
              textAlign: 'left',
              cursor: 'pointer',
              color: '#ff6b6b',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#3a3a3a'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <Icon name="trash" size={14} color="#ff6b6b" />
            Delete
          </button>
        </div>
      )}
    </div>
  );
};

export default PagesPanel;
