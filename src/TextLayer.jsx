import React, { useEffect, useRef, memo } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

const TextLayer = memo(({ 
  pageNumber, 
  page, 
  scale, 
  width, 
  height,
  onTextSelected,
  isSelectionMode = true
}) => {
  const textLayerRef = useRef(null);
  const textDivsRef = useRef([]);

  // Memoize text content to avoid reloading unnecessarily
  const textContentRef = useRef(null);
  const lastScaleRef = useRef(scale);

  useEffect(() => {
    if (!page || !textLayerRef.current) return;

    const loadTextContent = async () => {
      try {
        // Only reload text content if scale changed significantly (avoid reload on tiny changes)
        const scaleChanged = Math.abs(scale - lastScaleRef.current) > 0.01;
        
        // Load text content only once or if scale changed significantly
        if (!textContentRef.current || scaleChanged) {
          textContentRef.current = await page.getTextContent();
          lastScaleRef.current = scale;
        }
        
        const textContent = textContentRef.current;
        const viewport = page.getViewport({ scale });
        const textLayerDiv = textLayerRef.current;
        
        // Only clear and recreate if scale changed significantly
        if (scaleChanged) {
          // Clear previous content
          textLayerDiv.innerHTML = '';
          textDivsRef.current = [];
        }
        
        textLayerDiv.style.width = `${viewport.width}px`;
        textLayerDiv.style.height = `${viewport.height}px`;
        textLayerDiv.style.transform = `scale(${scale})`;
        textLayerDiv.style.transformOrigin = 'top left';

        // Only create text divs if they don't exist (scale changed significantly)
        if (textDivsRef.current.length === 0 && textContent.items.length > 0) {
          // Create text divs manually for better control
          const textItems = textContent.items;
          
          textItems.forEach((textItem) => {
          const tx = textItem.transform;
          const angle = Math.atan2(tx[1], tx[0]);
          const fontHeight = Math.hypot(tx[2], tx[3]);
          
          // Calculate position and dimensions
          const left = tx[4];
          const top = tx[5];
          const fontSize = fontHeight;
          const width = textItem.width;
          const height = textItem.height || fontSize;
          
          // Create a span for each text item
          const textDiv = document.createElement('span');
          textDiv.style.position = 'absolute';
          textDiv.style.left = `${left}px`;
          textDiv.style.top = `${top}px`;
          textDiv.style.fontSize = `${fontSize}px`;
          textDiv.style.fontFamily = textItem.fontName || 'sans-serif';
          textDiv.style.color = 'transparent';
          textDiv.style.whiteSpace = 'pre';
          textDiv.style.cursor = 'text';
          textDiv.style.userSelect = 'text';
          textDiv.style.webkitUserSelect = 'text';
          textDiv.textContent = textItem.str;
          
          // Rotate if needed
          if (angle !== 0) {
            textDiv.style.transform = `rotate(${angle}rad)`;
            textDiv.style.transformOrigin = '0 0';
          }
          
            textLayerDiv.appendChild(textDiv);
            textDivsRef.current.push(textDiv);
          });
        }
        
        // Make the entire layer selectable
        if (isSelectionMode) {
          textLayerDiv.style.userSelect = 'text';
          textLayerDiv.style.webkitUserSelect = 'text';
        }
        
      } catch (error) {
        console.error(`Error loading text content for page ${pageNumber}:`, error);
      }
    };

    loadTextContent();
  }, [page, pageNumber, scale, isSelectionMode]);

  // Handle text selection
  useEffect(() => {
    const textLayerDiv = textLayerRef.current;
    if (!textLayerDiv || !onTextSelected || !isSelectionMode) return;

    const handleMouseUp = () => {
      // Small delay to let selection complete
      setTimeout(() => {
        const selection = window.getSelection();
        if (selection.rangeCount > 0 && !selection.isCollapsed) {
          const range = selection.getRangeAt(0);
          const selectedText = selection.toString().trim();
          
          // Check if selection is within this text layer
          if (selectedText && textLayerDiv.contains(range.commonAncestorContainer)) {
            // Get bounding rectangles of selected text
            const rects = range.getClientRects();
            const textLayerRect = textLayerDiv.getBoundingClientRect();
            
            // Convert to coordinates relative to the PDF page (accounting for scale)
            const highlights = Array.from(rects).map(rect => {
              const x = (rect.left - textLayerRect.left) / scale;
              const y = (rect.top - textLayerRect.top) / scale;
              const w = rect.width / scale;
              const h = rect.height / scale;
              
              return {
                x: x,
                y: y,
                width: w,
                height: h
              };
            });

            // Call callback with selection data
            if (highlights.length > 0) {
              onTextSelected(pageNumber, selectedText, highlights);
            }
            
            // Clear selection after capturing
            setTimeout(() => {
              selection.removeAllRanges();
            }, 50);
          }
        }
      }, 10);
    };

    textLayerDiv.addEventListener('mouseup', handleMouseUp);
    
    return () => {
      textLayerDiv.removeEventListener('mouseup', handleMouseUp);
    };
  }, [textLayerRef, onTextSelected, pageNumber, scale, isSelectionMode]);

  if (!page) return null;

  return (
    <div
      ref={textLayerRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: `${width}px`,
        height: `${height}px`,
        pointerEvents: isSelectionMode ? 'auto' : 'none',
        zIndex: 8, // Between canvas (1) and annotation layer (10) to allow text selection
        userSelect: isSelectionMode ? 'text' : 'none',
        WebkitUserSelect: isSelectionMode ? 'text' : 'none',
        overflow: 'hidden'
      }}
      className="textLayer"
    />
  );
});

TextLayer.displayName = 'TextLayer';

export default TextLayer;

