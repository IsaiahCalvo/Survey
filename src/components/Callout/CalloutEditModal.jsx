import React, { useState, useEffect, useRef } from 'react';
import { presetBorderColors, presetFillColors, fontFamilies, fontSizes, ARROWHEAD_STYLES, ARROWHEAD_STYLE_LABELS, defaultCalloutStyle } from './types';
import CompactColorPicker from '../CompactColorPicker';

const CalloutEditModal = ({ visible, callout, onUpdate, onClose, anchorPosition }) => {
  const modalRef = useRef(null);
  const colorPickerRef = useRef(null);
  const textColorPickerRef = useRef(null);
  const [activeTab, setActiveTab] = useState('visual');
  const [colorMode, setColorMode] = useState('border');
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showTextColorPicker, setShowTextColorPicker] = useState(false);
  
  // Drag state
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [modalPosition, setModalPosition] = useState({ top: 0, left: 0 });

  // Merge callout style with defaults
  const style = callout ? { ...defaultCalloutStyle, ...callout.style } : defaultCalloutStyle;

  // Initialize modal position when it becomes visible
  useEffect(() => {
    if (!visible) return;
    
    const modalWidth = 320;
    const padding = 20;
    const headerHeight = 48;
    const tabHeight = 40;
    const maxContentHeight = window.innerHeight - padding * 2 - headerHeight - tabHeight;
    
    let left, top;
    
    if (!anchorPosition) {
      left = (window.innerWidth - modalWidth) / 2;
      top = padding;
    } else {
      left = anchorPosition.x;
      top = anchorPosition.y;
      
      if (left + modalWidth > window.innerWidth) {
        left = window.innerWidth - modalWidth - padding;
      }
      if (left < padding) {
        left = padding;
      }
      
      const totalHeight = maxContentHeight + headerHeight + tabHeight;
      if (top + totalHeight > window.innerHeight - padding) {
        top = window.innerHeight - totalHeight - padding;
      }
      if (top < padding) {
        top = padding;
      }
    }
    
    setModalPosition({ top, left });
  }, [visible, anchorPosition]);

  useEffect(() => {
    if (!visible) return;

    // Use a ref to track if we should ignore the next click (prevents immediate close)
    const ignoreNextClickRef = { current: true };
    const ignoreTimeout = setTimeout(() => {
      ignoreNextClickRef.current = false;
    }, 100);

    const handleClickOutside = (e) => {
      // Check if click originated from inside the modal by checking the event path
      const clickPath = e.composedPath ? e.composedPath() : (e.path || []);
      const isClickInsideModal = clickPath.some(node => {
        if (!node || typeof node !== 'object') return false;
        // Check if node is the modal or contains the data attribute
        if (node === modalRef.current) return true;
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.hasAttribute && node.hasAttribute('data-callout-edit-modal')) return true;
          if (node.closest && node.closest('[data-callout-edit-modal]')) return true;
        }
        return false;
      });
      
      // Also check using contains as fallback
      const isInsideByContains = modalRef.current && modalRef.current.contains(e.target);
      
      // Check for color picker
      const isColorPicker = e.target.closest && e.target.closest('.compact-color-picker');
      
      // Ignore the first click after opening (from context menu click)
      if (ignoreNextClickRef.current) {
        return;
      }
      
      // Don't close if clicking on modal or any element inside it
      if (isClickInsideModal || isInsideByContains) {
        return;
      }
      
      // Don't close if clicking on color picker (which might render outside modal)
      if (isColorPicker) {
        return;
      }
      
      // Only close if clicking truly outside
      onClose();
    };

    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    // Delay attaching listener to avoid immediate close from opening click
    const timeout = setTimeout(() => {
      document.addEventListener('click', handleClickOutside, false); // Use bubble phase
    }, 150); // Increased delay to ensure modal is fully rendered and first click is processed

    document.addEventListener('keydown', handleEscape);

    return () => {
      clearTimeout(timeout);
      clearTimeout(ignoreTimeout);
      document.removeEventListener('click', handleClickOutside, false);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [visible, onClose]);

  // Adjust color picker position if it would overflow viewport
  useEffect(() => {
    if (showColorPicker && colorPickerRef.current) {
      const rect = colorPickerRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      if (rect.bottom > viewportHeight - 20) {
        // Position above button instead
        colorPickerRef.current.style.top = 'auto';
        colorPickerRef.current.style.bottom = '100%';
        colorPickerRef.current.style.marginTop = '0';
        colorPickerRef.current.style.marginBottom = '4px';
      } else {
        // Reset to default position
        colorPickerRef.current.style.top = '100%';
        colorPickerRef.current.style.bottom = 'auto';
        colorPickerRef.current.style.marginTop = '4px';
        colorPickerRef.current.style.marginBottom = '0';
      }
    }
  }, [showColorPicker]);

  useEffect(() => {
    if (showTextColorPicker && textColorPickerRef.current) {
      const rect = textColorPickerRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      if (rect.bottom > viewportHeight - 20) {
        // Position above button instead
        textColorPickerRef.current.style.top = 'auto';
        textColorPickerRef.current.style.bottom = '100%';
        textColorPickerRef.current.style.marginTop = '0';
        textColorPickerRef.current.style.marginBottom = '4px';
      } else {
        // Reset to default position
        textColorPickerRef.current.style.top = '100%';
        textColorPickerRef.current.style.bottom = 'auto';
        textColorPickerRef.current.style.marginTop = '4px';
        textColorPickerRef.current.style.marginBottom = '0';
      }
    }
  }, [showTextColorPicker]);

  // Drag handlers
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e) => {
      const newLeft = e.clientX - dragOffset.x;
      const newTop = e.clientY - dragOffset.y;
      
      const modalWidth = 320;
      const padding = 20;
      const maxLeft = window.innerWidth - modalWidth - padding;
      const maxTop = window.innerHeight - padding;
      
      setModalPosition({
        left: Math.max(padding, Math.min(newLeft, maxLeft)),
        top: Math.max(padding, Math.min(newTop, maxTop))
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragOffset]);

  if (!visible || !callout) return null;

  const currentColor = colorMode === 'border' ? style.borderColor : style.fillColor;
  const currentOpacity = colorMode === 'border' ? style.borderOpacity : style.fillOpacity;

  const handleColorChange = (hex, alpha) => {
    if (colorMode === 'border') {
      onUpdate({ borderColor: hex, borderOpacity: alpha });
    } else {
      onUpdate({ fillColor: hex, fillOpacity: alpha });
    }
  };

  const handleTextColorChange = (hex, alpha) => {
    onUpdate({ fontColor: hex });
  };

  const handleHeaderMouseDown = (e) => {
    // Don't start drag if clicking on the close button
    if (e.target.closest('button')) {
      return;
    }
    
    if (modalRef.current) {
      const rect = modalRef.current.getBoundingClientRect();
      setDragOffset({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      });
      setIsDragging(true);
    }
  };

  // Calculate modal position and size (anchor near callout, but ensure it's visible and fits viewport)
  const getModalPosition = () => {
    const modalWidth = 320;
    const padding = 20;
    const headerHeight = 48; // Approximate header height
    const tabHeight = 40; // Approximate tab height
    // Use most of viewport height, leaving padding for color picker overflow
    const maxContentHeight = window.innerHeight - padding * 2 - headerHeight - tabHeight;

    return { 
      top: `${modalPosition.top}px`, 
      left: `${modalPosition.left}px`, 
      transform: 'none',
      height: `${maxContentHeight + headerHeight + tabHeight}px`,
      maxHeight: `${window.innerHeight - padding * 2}px`
    };
  };

  return (
    <div
      data-callout-modal-overlay
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        zIndex: 10001,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        ref={modalRef}
        data-callout-edit-modal
        style={{
          ...getModalPosition(),
          position: 'fixed',
          width: 320,
          height: '368px',
          paddingTop: '0px',
          paddingBottom: '0px',
          backgroundColor: '#2b2b2b',
          border: '1px solid #444',
          borderRadius: '8px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          cursor: isDragging ? 'grabbing' : 'default'
        }}
        onMouseDown={(e) => {
          // Stop propagation to prevent canvas and document handlers from receiving the event
          e.stopPropagation();
        }}
        onClick={(e) => {
          // Stop propagation to prevent document click handler from closing modal
          e.stopPropagation();
        }}
      >
        {/* Header */}
        <div
          onMouseDown={handleHeaderMouseDown}
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid #444',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: '#252525',
            cursor: isDragging ? 'grabbing' : 'grab',
            userSelect: 'none'
          }}
        >
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#ddd' }}>Edit Callout</h3>
          <button
            onClick={onClose}
            onMouseDown={(e) => {
              // Stop propagation to prevent drag from starting when clicking close button
              e.stopPropagation();
            }}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 4,
              fontSize: 18,
              color: '#999',
            }}
            onMouseEnter={(e) => e.currentTarget.style.color = '#ddd'}
            onMouseLeave={(e) => e.currentTarget.style.color = '#999'}
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #444', background: '#252525' }}>
          <button
            onClick={() => setActiveTab('visual')}
            style={{
              flex: 1,
              padding: '10px 16px',
              background: activeTab === 'visual' ? '#2b2b2b' : 'transparent',
              border: 'none',
              borderBottom: activeTab === 'visual' ? '2px solid #4A90E2' : '2px solid transparent',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 500,
              color: activeTab === 'visual' ? '#ddd' : '#999',
            }}
          >
            Visual Settings
          </button>
          <button
            onClick={() => setActiveTab('text')}
            style={{
              flex: 1,
              padding: '10px 16px',
              background: activeTab === 'text' ? '#2b2b2b' : 'transparent',
              border: 'none',
              borderBottom: activeTab === 'text' ? '2px solid #4A90E2' : '2px solid transparent',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 500,
              color: activeTab === 'text' ? '#ddd' : '#999',
            }}
          >
            Text Settings
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: 12, background: '#2b2b2b', flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {activeTab === 'visual' && (
            <div>
              {/* Color Toggle */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label style={{ fontSize: 10, fontWeight: 500, color: '#999', textTransform: 'uppercase' }}>
                    COLOR
                  </label>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      onClick={() => setColorMode('border')}
                      style={{
                        padding: '4px 8px',
                        fontSize: 10,
                        border: colorMode === 'border' ? '1px solid #4A90E2' : '1px solid #555',
                        background: colorMode === 'border' ? '#4A90E2' : '#333',
                        color: colorMode === 'border' ? 'white' : '#ddd',
                        borderRadius: 4,
                        cursor: 'pointer',
                      }}
                    >
                      Border
                    </button>
                    <button
                      onClick={() => setColorMode('fill')}
                      style={{
                        padding: '4px 8px',
                        fontSize: 10,
                        border: colorMode === 'fill' ? '1px solid #4A90E2' : '1px solid #555',
                        background: colorMode === 'fill' ? '#4A90E2' : '#333',
                        color: colorMode === 'fill' ? 'white' : '#ddd',
                        borderRadius: 4,
                        cursor: 'pointer',
                      }}
                    >
                      Fill
                    </button>
                  </div>
                </div>

                {/* Color Picker Button */}
                <div style={{ position: 'relative' }}>
                  <button
                    onClick={() => setShowColorPicker(!showColorPicker)}
                    style={{
                      width: '100%',
                      padding: '8px',
                      border: '1px solid #555',
                      borderRadius: 4,
                      background: '#333',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span style={{ fontSize: 12, color: '#ddd' }}>Select Color</span>
                    <div
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: 4,
                        background: currentColor === 'transparent'
                          ? 'linear-gradient(45deg, #666 25%, transparent 25%), linear-gradient(-45deg, #666 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #666 75%), linear-gradient(-45deg, transparent 75%, #666 75%)'
                          : currentColor,
                        backgroundSize: currentColor === 'transparent' ? '8px 8px' : 'auto',
                        backgroundPosition: currentColor === 'transparent' ? '0 0, 0 4px, 4px -4px, -4px 0px' : 'auto',
                        border: '1px solid #555',
                      }}
                    />
                  </button>
                  
                  {showColorPicker && (
                    <div 
                      ref={colorPickerRef}
                      style={{ position: 'absolute', top: '100%', left: 0, zIndex: 1002, marginTop: 4 }}
                    >
                      <CompactColorPicker
                        color={currentColor}
                        opacity={currentOpacity}
                        onChange={handleColorChange}
                        onClose={() => setShowColorPicker(false)}
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Opacity */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 10, fontWeight: 500, color: '#999', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                  OPACITY
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="range"
                    min={20}
                    max={100}
                    step={5}
                    value={Math.round(currentOpacity * 100)}
                    onChange={(e) => {
                      const value = Number(e.target.value) / 100;
                      if (colorMode === 'border') {
                        onUpdate({ borderOpacity: value });
                      } else {
                        onUpdate({ fillOpacity: value });
                      }
                    }}
                    style={{ flex: 1 }}
                  />
                  <input
                    type="number"
                    min={20}
                    max={100}
                    value={Math.round(currentOpacity * 100)}
                    onChange={(e) => {
                      const value = Math.max(20, Math.min(100, Number(e.target.value) || 20)) / 100;
                      if (colorMode === 'border') {
                        onUpdate({ borderOpacity: value });
                      } else {
                        onUpdate({ fillOpacity: value });
                      }
                    }}
                    style={{
                      width: 50,
                      padding: '4px 6px',
                      fontSize: 12,
                      border: '1px solid #555',
                      borderRadius: 4,
                      textAlign: 'right',
                      background: '#333',
                      color: '#ddd',
                    }}
                  />
                  <span style={{ fontSize: 12, color: '#999' }}>%</span>
                </div>
              </div>

              {/* Line Thickness */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 10, fontWeight: 500, color: '#999', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                  LINE THICKNESS
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="range"
                    min={1}
                    max={6}
                    step={1}
                    value={style.lineThickness}
                    onChange={(e) => onUpdate({ lineThickness: Number(e.target.value) })}
                    style={{ flex: 1 }}
                  />
                  <input
                    type="number"
                    min={1}
                    max={6}
                    value={style.lineThickness}
                    onChange={(e) => {
                      const value = Math.max(1, Math.min(6, Number(e.target.value) || 1));
                      onUpdate({ lineThickness: value });
                    }}
                    style={{
                      width: 50,
                      padding: '4px 6px',
                      fontSize: 12,
                      border: '1px solid #555',
                      borderRadius: 4,
                      textAlign: 'right',
                      background: '#333',
                      color: '#ddd',
                    }}
                  />
                  <span style={{ fontSize: 12, color: '#999' }}>px</span>
                </div>
              </div>

              {/* Arrowhead Style */}
              <div>
                <label style={{ fontSize: 10, fontWeight: 500, color: '#999', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                  ARROWHEAD STYLE
                </label>
                <select
                  value={style.arrowheadStyle || ARROWHEAD_STYLES.SOLID_TRIANGLE}
                  onChange={(e) => onUpdate({ arrowheadStyle: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    fontSize: 12,
                    border: '1px solid #555',
                    borderRadius: 4,
                    backgroundColor: '#333',
                    color: '#ddd',
                    cursor: 'pointer',
                  }}
                >
                  {Object.entries(ARROWHEAD_STYLE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {activeTab === 'text' && (
            <div>
              {/* Text Color */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label style={{ fontSize: 10, fontWeight: 500, color: '#999', textTransform: 'uppercase' }}>
                    TEXT COLOR
                  </label>
                </div>

                {/* Text Color Picker Button */}
                <div style={{ position: 'relative' }}>
                  <button
                    onClick={() => setShowTextColorPicker(!showTextColorPicker)}
                    style={{
                      width: '100%',
                      padding: '8px',
                      border: '1px solid #555',
                      borderRadius: 4,
                      background: '#333',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span style={{ fontSize: 12, color: '#ddd' }}>Select Color</span>
                    <div
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: 4,
                        background: style.fontColor || '#000000',
                        border: '1px solid #555',
                      }}
                    />
                  </button>
                  
                  {showTextColorPicker && (
                    <div 
                      ref={textColorPickerRef}
                      style={{ position: 'absolute', top: '100%', left: 0, zIndex: 1002, marginTop: 4 }}
                    >
                      <CompactColorPicker
                        color={style.fontColor || '#000000'}
                        opacity={1}
                        onChange={handleTextColorChange}
                        onClose={() => setShowTextColorPicker(false)}
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Font Family & Size */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 10, fontWeight: 500, color: '#999', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                    FONT
                  </label>
                  <select
                    value={style.fontFamily}
                    onChange={(e) => onUpdate({ fontFamily: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      fontSize: 12,
                      border: '1px solid #555',
                      borderRadius: 4,
                      fontFamily: style.fontFamily,
                      backgroundColor: '#333',
                      color: '#ddd',
                      cursor: 'pointer',
                    }}
                  >
                    {fontFamilies.map((font) => (
                      <option key={font} value={font} style={{ fontFamily: font }}>
                        {font.split(',')[0]}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ width: 70 }}>
                  <label style={{ fontSize: 10, fontWeight: 500, color: '#999', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                    SIZE
                  </label>
                  <select
                    value={style.fontSize}
                    onChange={(e) => onUpdate({ fontSize: Number(e.target.value) })}
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      fontSize: 12,
                      border: '1px solid #555',
                      borderRadius: 4,
                      backgroundColor: '#333',
                      color: '#ddd',
                      cursor: 'pointer',
                    }}
                  >
                    {fontSizes.map((size) => (
                      <option key={size} value={size}>
                        {size}px
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Text Alignment */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 10, fontWeight: 500, color: '#999', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                  TEXT ALIGNMENT
                </label>
                <div style={{ display: 'flex', gap: 4 }}>
                  {['left', 'center', 'right'].map((align) => (
                    <button
                      key={align}
                      onClick={() => onUpdate({ textAlign: align })}
                      style={{
                        flex: 1,
                        padding: '6px 12px',
                        fontSize: 12,
                        border: style.textAlign === align ? '1px solid #4A90E2' : '1px solid #555',
                        background: style.textAlign === align ? '#4A90E2' : '#333',
                        color: style.textAlign === align ? 'white' : '#ddd',
                        borderRadius: 4,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {align === 'left' && (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="15" y2="12" /><line x1="3" y1="18" x2="18" y2="18" />
                        </svg>
                      )}
                      {align === 'center' && (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="3" y1="6" x2="21" y2="6" /><line x1="6" y1="12" x2="18" y2="12" /><line x1="4" y1="18" x2="20" y2="18" />
                        </svg>
                      )}
                      {align === 'right' && (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="3" y1="6" x2="21" y2="6" /><line x1="9" y1="12" x2="21" y2="12" /><line x1="6" y1="18" x2="21" y2="18" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Text Style (Bold, Italic, Underline, Strikethrough) */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 10, fontWeight: 500, color: '#999', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                  STYLE
                </label>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    onClick={() => onUpdate({ bold: !style.bold })}
                    style={{
                      padding: '6px 10px',
                      fontSize: 14,
                      fontWeight: 'bold',
                      border: style.bold ? '1px solid #4A90E2' : '1px solid #555',
                      background: style.bold ? '#4A90E2' : '#333',
                      color: style.bold ? 'white' : '#ddd',
                      borderRadius: 4,
                      cursor: 'pointer',
                    }}
                  >
                    B
                  </button>
                  <button
                    onClick={() => onUpdate({ italic: !style.italic })}
                    style={{
                      padding: '6px 10px',
                      fontSize: 14,
                      fontStyle: 'italic',
                      border: style.italic ? '1px solid #4A90E2' : '1px solid #555',
                      background: style.italic ? '#4A90E2' : '#333',
                      color: style.italic ? 'white' : '#ddd',
                      borderRadius: 4,
                      cursor: 'pointer',
                    }}
                  >
                    I
                  </button>
                  <button
                    onClick={() => onUpdate({ underline: !style.underline })}
                    style={{
                      padding: '6px 10px',
                      fontSize: 14,
                      textDecoration: 'underline',
                      border: style.underline ? '1px solid #4A90E2' : '1px solid #555',
                      background: style.underline ? '#4A90E2' : '#333',
                      color: style.underline ? 'white' : '#ddd',
                      borderRadius: 4,
                      cursor: 'pointer',
                    }}
                  >
                    U
                  </button>
                  <button
                    onClick={() => onUpdate({ strikethrough: !style.strikethrough })}
                    style={{
                      padding: '6px 10px',
                      fontSize: 14,
                      textDecoration: 'line-through',
                      border: style.strikethrough ? '1px solid #4A90E2' : '1px solid #555',
                      background: style.strikethrough ? '#4A90E2' : '#333',
                      color: style.strikethrough ? 'white' : '#ddd',
                      borderRadius: 4,
                      cursor: 'pointer',
                    }}
                  >
                    S
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CalloutEditModal;

