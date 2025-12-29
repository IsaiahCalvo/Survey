import React, { useState } from 'react';
import { presetBorderColors, presetFillColors, fontFamilies, fontSizes, ARROWHEAD_STYLES, ARROWHEAD_STYLE_LABELS, defaultCalloutStyle } from './types';
import CompactColorPicker from '../CompactColorPicker';

/**
 * CalloutPropertiesPanel - Sliding panel for editing callout properties
 * Ported from reference Callout app
 *
 * @param {Object} props
 * @param {Object|null} props.selectedCallout - Currently selected callout
 * @param {Function} props.onUpdateStyle - Callback to update style properties
 * @param {Function} props.onClose - Callback to close the panel
 */
const CalloutPropertiesPanel = ({
  selectedCallout,
  onUpdateStyle,
  onClose,
}) => {
  const [colorMode, setColorMode] = useState('border');
  const [expandedSections, setExpandedSections] = useState({
    visual: true,
    text: true,
  });
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showTextColorPicker, setShowTextColorPicker] = useState(false);

  if (!selectedCallout) {
    return null;
  }

  // Merge callout style with defaults to ensure all properties exist
  const style = { ...defaultCalloutStyle, ...selectedCallout.style };

  const toggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const currentColor = colorMode === 'border' ? style.borderColor : style.fillColor;
  const currentOpacity = colorMode === 'border' ? style.borderOpacity : style.fillOpacity;

  const handleColorChange = (hex, alpha) => {
    if (colorMode === 'border') {
      onUpdateStyle({ borderColor: hex, borderOpacity: alpha });
    } else {
      onUpdateStyle({ fillColor: hex, fillOpacity: alpha });
    }
  };

  const handleTextColorChange = (hex, alpha) => {
    // Text color doesn't use opacity, but we'll accept it for consistency
    onUpdateStyle({ fontColor: hex });
  };

  // Stop all events from propagating to canvas below
  const stopPropagation = (e) => {
    e.stopPropagation();
  };

  return (
    <div
      className="callout-properties-panel"
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        width: 280,
        height: '100vh',
        backgroundColor: '#ffffff',
        borderLeft: '1px solid #e5e7eb',
        boxShadow: '-4px 0 12px rgba(0,0,0,0.1)',
        zIndex: 10000,
        overflowY: 'auto',
        animation: 'slideInFromRight 0.2s ease-out',
      }}
      onMouseDown={stopPropagation}
      onMouseMove={stopPropagation}
      onMouseUp={stopPropagation}
      onClick={stopPropagation}
      onPointerDown={stopPropagation}
      onPointerMove={stopPropagation}
      onPointerUp={stopPropagation}
    >
      {/* Header */}
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Properties</h3>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 4,
            fontSize: 18,
            color: '#6b7280',
          }}
        >
          ×
        </button>
      </div>

      <div style={{ padding: 12 }}>
        {/* Visual Settings Section */}
        <div style={{ marginBottom: 16 }}>
          <button
            onClick={() => toggleSection('visual')}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'none',
              border: 'none',
              padding: '8px 0',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
              color: '#374151',
            }}
          >
            Visual Settings
            <span style={{ fontSize: 10 }}>{expandedSections.visual ? '▼' : '▶'}</span>
          </button>

          {expandedSections.visual && (
            <div style={{ paddingTop: 8 }}>
              {/* Color Toggle */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label style={{ fontSize: 10, fontWeight: 500, color: '#6b7280', textTransform: 'uppercase' }}>
                    COLOR
                  </label>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      onClick={() => setColorMode('border')}
                      style={{
                        padding: '4px 8px',
                        fontSize: 10,
                        border: colorMode === 'border' ? '1px solid #3b82f6' : '1px solid #d1d5db',
                        background: colorMode === 'border' ? '#3b82f6' : 'white',
                        color: colorMode === 'border' ? 'white' : '#374151',
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
                        border: colorMode === 'fill' ? '1px solid #3b82f6' : '1px solid #d1d5db',
                        background: colorMode === 'fill' ? '#3b82f6' : 'white',
                        color: colorMode === 'fill' ? 'white' : '#374151',
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
                      border: '1px solid #d1d5db',
                      borderRadius: 4,
                      background: 'white',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span style={{ fontSize: 12, color: '#374151' }}>Select Color</span>
                    <div
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: 4,
                        background: currentColor === 'transparent'
                          ? 'linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)'
                          : currentColor,
                        backgroundSize: currentColor === 'transparent' ? '8px 8px' : 'auto',
                        backgroundPosition: currentColor === 'transparent' ? '0 0, 0 4px, 4px -4px, -4px 0px' : 'auto',
                        border: '1px solid #d1d5db',
                      }}
                    />
                  </button>
                  
                  {showColorPicker && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 1001, marginTop: 4 }}>
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
                <label style={{ fontSize: 10, fontWeight: 500, color: '#6b7280', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
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
                        onUpdateStyle({ borderOpacity: value });
                      } else {
                        onUpdateStyle({ fillOpacity: value });
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
                        onUpdateStyle({ borderOpacity: value });
                      } else {
                        onUpdateStyle({ fillOpacity: value });
                      }
                    }}
                    style={{
                      width: 50,
                      padding: '4px 6px',
                      fontSize: 12,
                      border: '1px solid #d1d5db',
                      borderRadius: 4,
                      textAlign: 'right',
                    }}
                  />
                  <span style={{ fontSize: 12, color: '#6b7280' }}>%</span>
                </div>
              </div>

              {/* Line Thickness */}
              <div>
                <label style={{ fontSize: 10, fontWeight: 500, color: '#6b7280', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                  LINE THICKNESS
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="range"
                    min={1}
                    max={6}
                    step={1}
                    value={style.lineThickness}
                    onChange={(e) => onUpdateStyle({ lineThickness: Number(e.target.value) })}
                    style={{ flex: 1 }}
                  />
                  <input
                    type="number"
                    min={1}
                    max={6}
                    value={style.lineThickness}
                    onChange={(e) => {
                      const value = Math.max(1, Math.min(6, Number(e.target.value) || 1));
                      onUpdateStyle({ lineThickness: value });
                    }}
                    style={{
                      width: 50,
                      padding: '4px 6px',
                      fontSize: 12,
                      border: '1px solid #d1d5db',
                      borderRadius: 4,
                      textAlign: 'right',
                    }}
                  />
                  <span style={{ fontSize: 12, color: '#6b7280' }}>px</span>
                </div>
              </div>

              {/* Arrowhead Style */}
              <div>
                <label style={{ fontSize: 10, fontWeight: 500, color: '#6b7280', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                  ARROWHEAD STYLE
                </label>
                <select
                  value={style.arrowheadStyle || ARROWHEAD_STYLES.SOLID_TRIANGLE}
                  onChange={(e) => onUpdateStyle({ arrowheadStyle: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    fontSize: 12,
                    border: '1px solid #d1d5db',
                    borderRadius: 4,
                    backgroundColor: 'white',
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
        </div>

        {/* Text Settings Section */}
        <div>
          <button
            onClick={() => toggleSection('text')}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'none',
              border: 'none',
              padding: '8px 0',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
              color: '#374151',
            }}
          >
            Text Settings
            <span style={{ fontSize: 10 }}>{expandedSections.text ? '▼' : '▶'}</span>
          </button>

          {expandedSections.text && (
            <div style={{ paddingTop: 8 }}>
              {/* Font Family & Size */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 10, fontWeight: 500, color: '#6b7280', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                    FONT
                  </label>
                  <select
                    value={style.fontFamily}
                    onChange={(e) => onUpdateStyle({ fontFamily: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      fontSize: 12,
                      border: '1px solid #d1d5db',
                      borderRadius: 4,
                      fontFamily: style.fontFamily,
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
                  <label style={{ fontSize: 10, fontWeight: 500, color: '#6b7280', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                    SIZE
                  </label>
                  <select
                    value={style.fontSize}
                    onChange={(e) => onUpdateStyle({ fontSize: Number(e.target.value) })}
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      fontSize: 12,
                      border: '1px solid #d1d5db',
                      borderRadius: 4,
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
                <label style={{ fontSize: 10, fontWeight: 500, color: '#6b7280', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                  TEXT ALIGNMENT
                </label>
                <div style={{ display: 'flex', gap: 4 }}>
                  {['left', 'center', 'right'].map((align) => (
                    <button
                      key={align}
                      onClick={() => onUpdateStyle({ textAlign: align })}
                      style={{
                        flex: 1,
                        padding: '6px 12px',
                        fontSize: 12,
                        border: style.textAlign === align ? '1px solid #3b82f6' : '1px solid #d1d5db',
                        background: style.textAlign === align ? '#3b82f6' : 'white',
                        color: style.textAlign === align ? 'white' : '#374151',
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
                <label style={{ fontSize: 10, fontWeight: 500, color: '#6b7280', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                  STYLE
                </label>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    onClick={() => onUpdateStyle({ bold: !style.bold })}
                    style={{
                      padding: '6px 10px',
                      fontSize: 14,
                      fontWeight: 'bold',
                      border: style.bold ? '1px solid #3b82f6' : '1px solid #d1d5db',
                      background: style.bold ? '#3b82f6' : 'white',
                      color: style.bold ? 'white' : '#374151',
                      borderRadius: 4,
                      cursor: 'pointer',
                    }}
                  >
                    B
                  </button>
                  <button
                    onClick={() => onUpdateStyle({ italic: !style.italic })}
                    style={{
                      padding: '6px 10px',
                      fontSize: 14,
                      fontStyle: 'italic',
                      border: style.italic ? '1px solid #3b82f6' : '1px solid #d1d5db',
                      background: style.italic ? '#3b82f6' : 'white',
                      color: style.italic ? 'white' : '#374151',
                      borderRadius: 4,
                      cursor: 'pointer',
                    }}
                  >
                    I
                  </button>
                  <button
                    onClick={() => onUpdateStyle({ underline: !style.underline })}
                    style={{
                      padding: '6px 10px',
                      fontSize: 14,
                      textDecoration: 'underline',
                      border: style.underline ? '1px solid #3b82f6' : '1px solid #d1d5db',
                      background: style.underline ? '#3b82f6' : 'white',
                      color: style.underline ? 'white' : '#374151',
                      borderRadius: 4,
                      cursor: 'pointer',
                    }}
                  >
                    U
                  </button>
                  <button
                    onClick={() => onUpdateStyle({ strikethrough: !style.strikethrough })}
                    style={{
                      padding: '6px 10px',
                      fontSize: 14,
                      textDecoration: 'line-through',
                      border: style.strikethrough ? '1px solid #3b82f6' : '1px solid #d1d5db',
                      background: style.strikethrough ? '#3b82f6' : 'white',
                      color: style.strikethrough ? 'white' : '#374151',
                      borderRadius: 4,
                      cursor: 'pointer',
                    }}
                  >
                    S
                  </button>
                </div>
              </div>

              {/* Text Color */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label style={{ fontSize: 10, fontWeight: 500, color: '#6b7280', textTransform: 'uppercase' }}>
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
                      border: '1px solid #d1d5db',
                      borderRadius: 4,
                      background: 'white',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span style={{ fontSize: 12, color: '#374151' }}>Select Color</span>
                    <div
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: 4,
                        background: style.fontColor || '#000000',
                        border: '1px solid #d1d5db',
                      }}
                    />
                  </button>
                  
                  {showTextColorPicker && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 1001, marginTop: 4 }}>
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
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CalloutPropertiesPanel;
