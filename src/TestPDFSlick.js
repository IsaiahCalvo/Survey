import React, { useState, useRef, useEffect } from 'react';
import { PDFSlick } from '@pdfslick/react';
import '@pdfslick/react/dist/pdf_viewer.css';
import './App.css';

// PDFSlick v3 uses a simpler API - just the PDFSlick component
function App() {
  const [showZoomDropdown, setShowZoomDropdown] = useState(false);
  const [customZoom, setCustomZoom] = useState('100');
  const [pdfSlickInstance, setPdfSlickInstance] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const dropdownRef = useRef(null);
  const containerRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowZoomDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Handle PDF load
  const handlePDFLoad = (instance) => {
    console.log('PDF loaded:', instance);
    setPdfSlickInstance(instance);
    
    // Get page info from the instance
    if (instance?.pdfDocument) {
      setTotalPages(instance.pdfDocument.numPages);
      setCurrentPage(1);
    }
  };

  // Zoom functions - using standard PDF.js viewer controls
  const zoomIn = () => {
    if (pdfSlickInstance?.viewer) {
      const viewer = pdfSlickInstance.viewer;
      const currentScale = viewer.currentScale || 1;
      viewer.currentScale = Math.min(currentScale * 1.1, 3.0);
      setCustomZoom(Math.round(viewer.currentScale * 100).toString());
    }
  };

  const zoomOut = () => {
    if (pdfSlickInstance?.viewer) {
      const viewer = pdfSlickInstance.viewer;
      const currentScale = viewer.currentScale || 1;
      viewer.currentScale = Math.max(currentScale * 0.9, 0.1);
      setCustomZoom(Math.round(viewer.currentScale * 100).toString());
    }
  };

  const handleCustomZoom = (e) => {
    setCustomZoom(e.target.value);
  };

  const applyCustomZoom = () => {
    const zoom = parseInt(customZoom);
    if (!isNaN(zoom) && pdfSlickInstance?.viewer) {
      pdfSlickInstance.viewer.currentScale = zoom / 100;
    }
  };

  // Adobe zoom presets
  const applyActualSize = () => {
    if (pdfSlickInstance?.viewer) {
      pdfSlickInstance.viewer.currentScaleValue = 'page-actual';
      setCustomZoom('100');
    }
  };

  const applyFitToPage = () => {
    if (pdfSlickInstance?.viewer) {
      pdfSlickInstance.viewer.currentScaleValue = 'page-fit';
    }
  };

  const applyFitWidth = () => {
    if (pdfSlickInstance?.viewer) {
      pdfSlickInstance.viewer.currentScaleValue = 'page-width';
    }
  };

  const applyFitHeight = () => {
    if (pdfSlickInstance?.viewer) {
      pdfSlickInstance.viewer.currentScaleValue = 'page-height';
    }
  };

  const applyAutoZoom = () => {
    if (pdfSlickInstance?.viewer) {
      pdfSlickInstance.viewer.currentScaleValue = 'auto';
    }
  };

  // Page navigation
  const [jumpToPage, setJumpToPage] = useState('1');

  useEffect(() => {
    setJumpToPage(currentPage.toString());
  }, [currentPage]);

  const handlePageJump = (e) => {
    setJumpToPage(e.target.value);
  };

  const jumpToPageNumber = () => {
    const pageNum = parseInt(jumpToPage);
    if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= totalPages && pdfSlickInstance?.viewer) {
      pdfSlickInstance.viewer.currentPageNumber = pageNum;
      setCurrentPage(pageNum);
    }
  };

  const previousPage = () => {
    if (currentPage > 1 && pdfSlickInstance?.viewer) {
      const newPage = currentPage - 1;
      pdfSlickInstance.viewer.currentPageNumber = newPage;
      setCurrentPage(newPage);
    }
  };

  const nextPage = () => {
    if (currentPage < totalPages && pdfSlickInstance?.viewer) {
      const newPage = currentPage + 1;
      pdfSlickInstance.viewer.currentPageNumber = newPage;
      setCurrentPage(newPage);
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT') return;
      
      if (e.ctrlKey || e.metaKey) {
        if (e.key === '=' || e.key === '+') {
          e.preventDefault();
          zoomIn();
        } else if (e.key === '-' || e.key === '_') {
          e.preventDefault();
          zoomOut();
        } else if (e.key === '0') {
          e.preventDefault();
          applyActualSize();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pdfSlickInstance]);

  const currentZoom = parseInt(customZoom);
  const isDocumentLoaded = totalPages > 0;

  return (
    <div className="App">
      <div className="toolbar">
        <div className="toolbar-left">
          <span className="app-title">Survey</span>
        </div>
        
        <div className="toolbar-center">
          <div className="zoom-group">
            <button 
              className="tool-btn" 
              onClick={zoomOut} 
              disabled={!isDocumentLoaded || currentZoom <= 10}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M4 8a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7A.5.5 0 0 1 4 8z"/>
              </svg>
            </button>
            
            <div className="zoom-input-wrapper">
              <input 
                type="number" 
                value={customZoom}
                onChange={handleCustomZoom}
                onBlur={applyCustomZoom}
                onKeyPress={(e) => e.key === 'Enter' && applyCustomZoom()}
                className="zoom-input"
                min="10"
                max="300"
                step="10"
                disabled={!isDocumentLoaded}
              />
              <span className="percent">%</span>
            </div>
            
            <button 
              className="tool-btn" 
              onClick={zoomIn} 
              disabled={!isDocumentLoaded || currentZoom >= 300}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4z"/>
              </svg>
            </button>
            
            <div className="zoom-dropdown-container" ref={dropdownRef}>
              <button 
                className="tool-btn dropdown-btn" 
                onClick={() => setShowZoomDropdown(!showZoomDropdown)}
                disabled={!isDocumentLoaded}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M1.5 1a.5.5 0 0 0-.5.5v4a.5.5 0 0 1-1 0v-4A1.5 1.5 0 0 1 1.5 0h4a.5.5 0 0 1 0 1h-4zM10 .5a.5.5 0 0 1 .5-.5h4A1.5 1.5 0 0 1 16 1.5v4a.5.5 0 0 1-1 0v-4a.5.5 0 0 0-.5-.5h-4a.5.5 0 0 1-.5-.5zM.5 10a.5.5 0 0 1 .5.5v4a.5.5 0 0 0 .5.5h4a.5.5 0 0 1 0 1h-4A1.5 1.5 0 0 1 0 14.5v-4a.5.5 0 0 1 .5-.5zm15 0a.5.5 0 0 1 .5.5v4a1.5 1.5 0 0 1-1.5 1.5h-4a.5.5 0 0 1 0-1h4a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 1 .5-.5z"/>
                </svg>
                <svg width="8" height="8" viewBox="0 0 16 16" fill="currentColor" className="dropdown-arrow">
                  <path fillRule="evenodd" d="M4.646 6.646a.5.5 0 0 1 .708 0L8 9.293l2.646-2.647a.5.5 0 0 1 .708.708l-3 3a.5.5 0 0 1-.708 0l-3-3a.5.5 0 0 1 0-.708z"/>
                </svg>
              </button>
              
              {showZoomDropdown && (
                <div className="zoom-dropdown">
                  <button className="dropdown-item" onClick={applyAutoZoom}>
                    <span>Automatic Zoom</span>
                  </button>
                  <button className="dropdown-item" onClick={applyActualSize}>
                    <span>Actual Size</span>
                    <span className="shortcut">100%</span>
                  </button>
                  <button className="dropdown-item" onClick={applyFitToPage}>
                    <span>Fit to Page</span>
                  </button>
                  <button className="dropdown-item" onClick={applyFitWidth}>
                    <span>Fit to Width</span>
                  </button>
                  <button className="dropdown-item" onClick={applyFitHeight}>
                    <span>Fit Height</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        
        <div className="toolbar-right">
        </div>
      </div>

      <div className="pdf-viewer-container" ref={containerRef}>
        <PDFSlick 
          src="/test.pdf"
          onLoad={handlePDFLoad}
          className="pdfSlick"
        />
      </div>

      <div className="page-indicator">
        <button 
          className="page-nav-btn" 
          onClick={previousPage}
          disabled={!isDocumentLoaded || currentPage <= 1}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path fillRule="evenodd" d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0z"/>
          </svg>
        </button>
        
        <div className="page-input-wrapper">
          <input 
            type="number"
            value={jumpToPage}
            onChange={handlePageJump}
            onBlur={jumpToPageNumber}
            onKeyPress={(e) => e.key === 'Enter' && jumpToPageNumber()}
            className="page-input"
            min="1"
            max={totalPages || 1}
            disabled={!isDocumentLoaded}
          />
          <span className="page-separator">of</span>
          <span className="total-pages">{totalPages || 0}</span>
        </div>
        
        <button 
          className="page-nav-btn" 
          onClick={nextPage}
          disabled={!isDocumentLoaded || currentPage >= totalPages}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path fillRule="evenodd" d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z"/>
          </svg>
        </button>
      </div>
    </div>
  );
}

export default App;