import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { fabric } from 'fabric';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.js?url';
import { useCounterTool } from './hooks/useCounterTool';
import { useIntersectionObserver } from './hooks/useIntersectionObserver';
import { getCounterSeriesList, pickNextSeriesColor, renumberCounters } from './utils/counterNumbering';
import './App.css';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

// Individual Virtualized Page Component
function PDFPage({ pageNumber, pdfDoc, scale, globals, activeTool, setActiveObject, defaultDims }) {
  const [wrapperRef, isVisible] = useIntersectionObserver({ rootMargin: '1200px 0px' });
  const [pageDims, setPageDims] = useState(defaultDims || { width: 800, height: 1100 }); 
  
  const canvasRef = useRef(null);
  const pdfCanvasRef = useRef(null);
  const fabricCanvasRef = useRef(null);
  const renderTaskRef = useRef(null);

  // Update dims if defaultDims changes
  useEffect(() => {
    if (defaultDims) setPageDims(defaultDims);
  }, [defaultDims]);

  // Main Mount / Unmount Logic when visible
  // Need to recreate completely when zoom (scale) changes too
  useEffect(() => {
    if (!isVisible || !pdfDoc) return;
    let isCancelled = false;
    
    async function renderPage() {
      try {
        const page = await pdfDoc.getPage(pageNumber);
        if (isCancelled) return;
        
        const viewport = page.getViewport({ scale });
        
        // Setup PDF Canvas
        const pdfCanvas = pdfCanvasRef.current;
        if (!pdfCanvas) return;
        const context = pdfCanvas.getContext('2d');
        pdfCanvas.width = viewport.width;
        pdfCanvas.height = viewport.height;
        
        // Setup Fabric
        if (fabricCanvasRef.current) {
          fabricCanvasRef.current.dispose();
        }
        
        const fCanvas = new fabric.Canvas(canvasRef.current, {
          width: viewport.width,
          height: viewport.height,
          selection: false,
          preserveObjectStacking: true,
        });
        fabricCanvasRef.current = fCanvas;
        
        // Restore annotations if any
        if (globals.pageMapRef.current[pageNumber]) {
          await fCanvas.loadFromJSON(globals.pageMapRef.current[pageNumber]);
          // Rescale objects natively based on zoom change between loads.
          // Wait, if zoom changes, objects loaded from old scale JSON will be the wrong size!
          // We must apply scale relative to base. 
          // Fabric objects store `left/top` exactly as drawn. If we scale the canvas manually, 
          // we need to `.scale(scale)` on every object. 
          // BUT - an easier trick: apply Zoom via CSS `transform` on the wrapper, NOT by re-rendering canvas!
          // BUT the user asked to "look at the counter in great detail" -> CSS transform makes it blurry!
          // To correctly scale Fabric without blurring, we do `setZoom` on the Fabric instance itself!
          fCanvas.setZoom(scale);
        } else {
          fCanvas.setZoom(scale); 
        }

        fCanvas.requestRenderAll();
        
        const renderContext = { canvasContext: context, viewport };
        renderTaskRef.current = page.render(renderContext);
        await renderTaskRef.current.promise;
      } catch (err) {
        if (err.name !== 'RenderingCancelledException') {
          console.error("PDF Render Error:", err);
        }
      }
    }
    
    renderPage();
    
    // Cleanup/Unmount
    return () => {
      isCancelled = true;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
      
      if (fabricCanvasRef.current) {
        // Cache state before destroying
        globals.pageMapRef.current[pageNumber] = fabricCanvasRef.current.toJSON(['data']);
        fabricCanvasRef.current.dispose();
        fabricCanvasRef.current = null;
      }
    };
  }, [isVisible, pdfDoc, pageNumber, scale, globals]);

  // Hook in the tool explicitly to this active page instance if visible
  useCounterTool(
    isVisible ? fabricCanvasRef.current : null, 
    activeTool === 'counter', 
    setActiveObject, 
    globals
  );

  return (
    <div 
      ref={wrapperRef} 
      className="pdf-page-wrapper"
      style={{ 
        width: pageDims.width * scale, 
        height: pageDims.height * scale,
        position: 'relative'
      }}
    >
      {!isVisible && (
        <div className="placeholder-overlay">
          <p>Loading Page {pageNumber}...</p>
        </div>
      )}
      <canvas 
        ref={pdfCanvasRef} 
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} 
      />
      <canvas 
        ref={canvasRef} 
      />
    </div>
  );
}

export default function App() {
  const [pdfDoc, setPdfDoc] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [activeTool, setActiveTool] = useState('select');
  const [activeObject, setActiveObject] = useState(null);
  const [scale, setScale] = useState(1);
  const [isSpaceDown, setIsSpaceDown] = useState(false);

  // Advanced Counter Tooling State
  const [activeSeriesId, setActiveSeriesId] = useState(null);
  const [counterCaretPopupOpen, setCounterCaretPopupOpen] = useState(false);
  const [counterCaretSubmenu, setCounterCaretSubmenu] = useState(null);
  const counterCaretPopupRef = useRef(null);

  const scrollContainerRef = useRef(null);
  const panStart = useRef({ x: 0, y: 0, sLeft: 0, sTop: 0 });
  const isPanning = useRef(false);

  // Global document state
  const globals = useMemo(() => ({
    pageMapRef: { current: {} }, // Cache pages JSON
    counterSeriesRef: { current: 0 }, 
    currentColorRef: { current: '#ef4444' }, // Now derived
    currentPageRef: { current: 1 } 
  }), []);

  // Compute active counter groupings from all cached pages
  const counterSeriesList = useMemo(() => {
    return getCounterSeriesList(globals.pageMapRef.current);
  }, [globals.pageMapRef.current, counterCaretPopupOpen]); // Recompute when opening menu

  const handleNewCounterSeries = () => {
    const existingHues = counterSeriesList.map(s => s.color);
    const newColor = pickNextSeriesColor(existingHues);
    const newId = crypto.randomUUID();
    setActiveSeriesId(newId);
    globals.currentColorRef.current = newColor;
    setCounterCaretPopupOpen(false);
    setCounterCaretSubmenu(null);
    setActiveTool('counter');
  };

  // Close popup if clicked outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      // Don't close if clicking caret button or popup
      if (e.target.closest('[data-counter-caret-button="true"]')) return;
      if (e.target.closest('[data-counter-caret-popup="true"]')) return;
      setCounterCaretPopupOpen(false);
      setCounterCaretSubmenu(null);
    };
    if (counterCaretPopupOpen) {
      document.addEventListener('pointerdown', handleClickOutside);
    }
    return () => document.removeEventListener('pointerdown', handleClickOutside);
  }, [counterCaretPopupOpen]);

  // Update object color dynamically
  const handleColorChange = (e) => {
    const hex = e.target.value;
    globals.currentColorRef.current = hex;
    if (activeObject && activeObject.type === 'group' && activeObject.data?.type === 'counter') {
      const bubblePath = activeObject.item(0);
      if (bubblePath) {
        bubblePath.set('fill', hex);
        activeObject.canvas.requestRenderAll();
        
        // Cache update
        const parentCanvas = activeObject.canvas;
        // Find which page this canvas belongs to? We can just let the object:modified event catch it if possible, 
        // but Since we don't have pageNumber explicitly mapped backwards, we rely on the component.
      }
    }
  };

  // Update text label dynamically
  const handleTextChange = (e) => {
    const val = e.target.value;
    if (activeObject && activeObject.type === 'group' && activeObject.data?.type === 'counter') {
      const textObj = activeObject.item(1);
      if (textObj) {
        textObj.set('text', val);
        activeObject.set('data', { ...activeObject.data, displayNumber: val });
        activeObject.canvas.requestRenderAll();
      }
    }
  };

  const [defaultDims, setDefaultDims] = useState(null);

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (file && file.type === 'application/pdf') {
      const arrayBuffer = await file.arrayBuffer();
      try {
        const doc = await pdfjsLib.getDocument(arrayBuffer).promise;
        setPdfDoc(doc);
        setNumPages(doc.numPages);
        
        // Format pageMapRef to align roughly with original expectation
        globals.pageMapRef.current = {};
        
        // Calculate fit to page scale and default dims from Page 1
        const page1 = await doc.getPage(1);
        const viewport = page1.getViewport({ scale: 1 });
        setDefaultDims({ width: viewport.width, height: viewport.height });
        
        const containerWidth = scrollContainerRef.current?.clientWidth || 800;
        // Add a 10% margin padding
        const fitScale = (containerWidth * 0.9) / viewport.width;
        setScale(Math.max(0.5, Math.min(fitScale, 5)));
        
      } catch (err) {
        console.error("Failed to parse PDF:", err);
        alert("Could not read PDF. Check console.");
      }
    }
  };

  // Zooming Logic (Ctrl + Wheel AND Keyboard Shortcuts)
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleWheel = (e) => {
      // Check Ctrl or Meta key for trackpad pinch / Ctrl+Wheel
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        
        const delta = e.deltaY;
        setScale(prev => {
          let newScale = prev - (delta * 0.005);
          return Math.max(0.5, Math.min(newScale, 5)); // Bound between 0.5x and 5x
        });
      }
    };
    
    const handleKeyDown = (e) => {
      // Handle Space panning
      if (e.code === 'Space' && !isSpaceDown && document.activeElement.tagName !== 'INPUT') {
        e.preventDefault();
        setIsSpaceDown(true);
      }
      
      // Handle Keyboard Zooming (Cmd/Ctrl + and -)
      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '-' || e.key === '+')) {
        e.preventDefault();
        if (e.key === '=' || e.key === '+') {
          setScale(prev => Math.min(prev + 0.2, 5));
        } else if (e.key === '-') {
          setScale(prev => Math.max(prev - 0.2, 0.5));
        }
      }
      // Handle Cmd/Ctrl + 0 to reset zoom
      if ((e.ctrlKey || e.metaKey) && e.key === '0') {
         e.preventDefault();
         setScale(1);
      }
    };
    
    const handleKeyUp = (e) => {
      if (e.code === 'Space') {
        setIsSpaceDown(false);
        isPanning.current = false;
      }
    };
    
    container.addEventListener('wheel', handleWheel, { passive: false });
    window.addEventListener('keydown', handleKeyDown, { passive: false });
    window.addEventListener('keyup', handleKeyUp);
    
    return () => {
      container.removeEventListener('wheel', handleWheel);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isSpaceDown]);

  const handleZoomIn = () => setScale(prev => Math.min(prev + 0.2, 5));
  const handleZoomOut = () => setScale(prev => Math.max(prev - 0.2, 0.5));

  const handlePointerDown = (e) => {
    if (isSpaceDown) {
      isPanning.current = true;
      panStart.current = {
        x: e.clientX,
        y: e.clientY,
        sLeft: scrollContainerRef.current.scrollLeft,
        sTop: scrollContainerRef.current.scrollTop
      };
    }
  };

  const handlePointerMove = (e) => {
    if (isPanning.current && isSpaceDown) {
      const dx = e.clientX - panStart.current.x;
      const dy = e.clientY - panStart.current.y;
      scrollContainerRef.current.scrollLeft = panStart.current.sLeft - dx;
      scrollContainerRef.current.scrollTop = panStart.current.sTop - dy;
    }
  };

  const handlePointerUp = () => {
    isPanning.current = false;
  };

  // Create an array mapping [1..numPages]
  const pagesArray = Array.from(new Array(numPages), (el, index) => index + 1);

  return (
    <div className="app-container">
      <div className="header">
        <h1>PDF Counter <span style={{fontSize: '0.8rem', color: '#64748b'}}>Playground</span></h1>
        
        <div className="controls">
          {/* Zoom Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: '#e2e8f0', padding: '2px 8px', borderRadius: '4px' }}>
            <button onClick={handleZoomOut} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '1.2rem', fontWeight: 'bold' }}>-</button>
            <span style={{ fontSize: '0.9rem', width: '40px', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{Math.round(scale * 100)}%</span>
            <button onClick={handleZoomIn} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '1.2rem', fontWeight: 'bold' }}>+</button>
          </div>

          <label className="upload-btn">
            Upload PDF
            <input type="file" accept="application/pdf" onChange={handleFileUpload} />
          </label>
          
          {numPages > 0 && (
            <div className="tool-info">
              <span className="status-badge">{numPages} Pages Loaded</span>
              <div 
                style={{
                  display: 'flex', gap: '5px', padding: '4px', background: '#e2e8f0', borderRadius: '4px'
                }}
              >
                <button 
                  onClick={() => setActiveTool('select')} 
                  style={{ background: activeTool==='select'?'#3b82f6':'#fff', color: activeTool==='select'?'#fff':'#000', border:'none', padding:'5px 10px', borderRadius:'4px', cursor: 'pointer' }}
                >Select</button>
                
                {/* Advanced Counter Toolbar Split-Button */ }
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <button 
                    onClick={() => {
                       setActiveTool('counter');
                       // If no series exists, create one!
                       if (!activeSeriesId) handleNewCounterSeries();
                    }}
                    style={{ background: activeTool==='counter'?'#ef4444':'#fff', color: activeTool==='counter'?'#fff':'#000', border:'none', padding:'5px 10px', borderRadius:'4px 0 0 4px', cursor: 'pointer' }}
                  >Counter Tool</button>
                  <button
                    data-counter-caret-button="true"
                    onClick={() => setCounterCaretPopupOpen(!counterCaretPopupOpen)}
                    style={{ background: activeTool==='counter'?'#dc2626':'#e2e8f0', color: activeTool==='counter'?'#fff':'#000', border:'none', borderLeft: '1px solid rgba(0,0,0,0.1)', padding:'5px 6px', borderRadius:'0 4px 4px 0', cursor: 'pointer', minHeight: '100%' }}
                  >
                    ▼
                  </button>

                  {/* Counter Chevron Popup Menu (Shottr/Original Replica) */}
                  {counterCaretPopupOpen && (
                    <div
                      ref={counterCaretPopupRef}
                      data-counter-caret-popup="true"
                      style={{
                        position: 'absolute',
                        top: '120%',
                        right: 0,
                        backgroundColor: 'rgb(30, 30, 30)',
                        backgroundImage: 'none',
                        border: '1px solid #333',
                        borderRadius: '6px',
                        boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
                        zIndex: 999999,
                        display: 'flex',
                        flexDirection: 'column',
                        padding: '4px',
                        minWidth: '140px',
                        color: '#DDD',
                        pointerEvents: 'auto',
                        cursor: 'default',
                        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, Ubuntu, "Noto Sans", Arial, sans-serif',
                        fontSize: '12px'
                      }}
                    >
                      <div style={{ padding: '4px 8px', fontSize: '10px', color: '#888', textTransform: 'uppercase', fontWeight: 600, borderBottom: '1px solid #333', marginBottom: '4px' }}>
                        Counter Series
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleNewCounterSeries(); }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = '#2a2a2a'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', background: 'transparent', border: 'none', borderRadius: '4px', color: '#DDD', textAlign: 'left', cursor: 'pointer', fontSize: '12px', fontFamily: 'inherit' }}
                      >
                        + New Count
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setCounterCaretSubmenu(s => s === 'continue' ? null : 'continue'); }}
                        onMouseEnter={(e) => { setCounterCaretSubmenu('continue'); e.currentTarget.style.background = '#2a2a2a'; }}
                        onMouseLeave={(e) => { if (counterCaretSubmenu !== 'continue') { e.currentTarget.style.background = 'transparent'; } }}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '6px 10px', background: counterCaretSubmenu === 'continue' ? '#2a2a2a' : 'transparent', border: 'none', borderRadius: '4px', color: '#DDD', textAlign: 'left', cursor: 'pointer', fontSize: '12px', fontFamily: 'inherit' }}
                      >
                        <span>Continue Count</span>
                        <span style={{ fontSize: '10px', color: '#888' }}>▶</span>
                      </button>
                      
                      {counterCaretSubmenu === 'continue' && (
                        <div
                          data-counter-caret-popup="true"
                          style={{
                            position: 'absolute',
                            bottom: 0,
                            right: '100%',
                            marginRight: '2px',
                            backgroundColor: 'rgb(30, 30, 30)',
                            border: '1px solid #333',
                            borderRadius: '6px',
                            boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
                            display: 'flex',
                            flexDirection: 'column',
                            padding: '4px',
                            minWidth: '100px',
                            maxHeight: '60vh',
                            overflowY: 'auto'
                          }}
                        >
                          {counterSeriesList.map((s) => {
                            const isActive = s.seriesId === activeSeriesId;
                            return (
                              <button
                                key={s.seriesId}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveSeriesId(s.seriesId);
                                  globals.currentColorRef.current = s.color;
                                  setCounterCaretPopupOpen(false);
                                  setCounterCaretSubmenu(null);
                                  setActiveTool('counter');
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.background = isActive ? '#4A90E2' : '#2a2a2a'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = isActive ? '#4A90E2' : 'transparent'; }}
                                style={{
                                  display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 8px', borderRadius: '4px', border: 'none', cursor: 'pointer',
                                  background: isActive ? '#4A90E2' : 'transparent', color: isActive ? '#fff' : '#DDD', textAlign: 'left', fontSize: '12px'
                                }}
                              >
                                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: s.color, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.2)' }} />
                                {s.label} ({s.count})
                              </button>
                            );
                          })}
                          {counterSeriesList.length === 0 && (
                            <div style={{ padding: '8px', color: '#888', fontSize: '11px', textAlign: 'center' }}>No counts yet.</div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div 
        className="main-content"
      >
        <div 
           className="pdf-scroll-container"
           ref={scrollContainerRef}
           onPointerDown={handlePointerDown}
           onPointerMove={handlePointerMove}
           onPointerUp={handlePointerUp}
           onPointerLeave={handlePointerUp}
           style={{ 
             cursor: isSpaceDown ? (isPanning.current ? 'grabbing' : 'grab') : 'auto',
             /* Prevent fabric interaction when panning so we don't accidentally select */
             pointerEvents: isSpaceDown ? 'none' : 'auto'
           }}
        >
          {/* We must wrap children in a div that accepts pointer-events back since we disabled them on the scroll container during pan */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', pointerEvents: isSpaceDown ? 'none' : 'auto', gap: '2rem' }}>
            {pagesArray.map(pageNum => (
              <PDFPage 
                key={pageNum}
                pageNumber={pageNum}
                pdfDoc={pdfDoc}
                scale={scale}
                globals={globals}
                activeTool={activeTool}
                setActiveObject={setActiveObject}
                defaultDims={defaultDims}
              />
            ))}

            {numPages === 0 && (
               <div style={{ marginTop: '20vh', color: '#64748b', fontSize: '1.2rem'}}>
                 Upload a PDF to get started!
               </div>
            )}
          </div>
        </div>
        
        {/* Active Object Properties Panel */}
        {activeObject && activeObject.data?.type === 'counter' && (
          <div className="properties-panel">
             <h3>Counter Properties</h3>
             <div className="prop-row">
               <label>Text Label:</label>
               <input 
                  type="text" 
                  className="prop-input"
                  value={activeObject.data?.displayNumber || ''} 
                  onChange={handleTextChange} 
               />
             </div>
             <div className="prop-row">
               <label>Color:</label>
               <input 
                 type="color" 
                 className="color-picker"
                 value={globals.currentColorRef.current} 
                 onChange={handleColorChange} 
               />
             </div>
          </div>
        )}
      </div>
    </div>
  );
}
