import React from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icons';
import CompactColorPicker from './CompactColorPicker';
import { ARROWHEAD_STYLE_LABELS } from '../PageAnnotationLayer';
import { FORM_TOOL_IDS } from './formDesignerTools';
import { ZOOM_MODES } from '../utils/zoomController';

const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, Ubuntu, "Noto Sans", Arial, sans-serif';
const REVIEW_TOOL_IDS = ['text', 'callout'];

const ZOOM_MODE_LABELS = {
  [ZOOM_MODES.FIT_PAGE]: 'Fit Page',
  [ZOOM_MODES.FIT_WIDTH]: 'Fit Width',
  [ZOOM_MODES.FIT_HEIGHT]: 'Fit Height',
  [ZOOM_MODES.MANUAL]: 'Manual %'
};

const ZOOM_MODE_DESCRIPTIONS = {
  [ZOOM_MODES.FIT_PAGE]: 'Show the entire page within the viewport.',
  [ZOOM_MODES.FIT_WIDTH]: 'Fill the viewer width. Scroll vertically for height.',
  [ZOOM_MODES.FIT_HEIGHT]: 'Fill the viewer height. Horizontal scroll may appear.',
  [ZOOM_MODES.MANUAL]: 'Use a specific zoom percentage.'
};

const ZOOM_MODE_OPTIONS = [
  {
    id: ZOOM_MODES.FIT_PAGE,
    label: ZOOM_MODE_LABELS[ZOOM_MODES.FIT_PAGE],
    description: ZOOM_MODE_DESCRIPTIONS[ZOOM_MODES.FIT_PAGE]
  },
  {
    id: ZOOM_MODES.FIT_WIDTH,
    label: ZOOM_MODE_LABELS[ZOOM_MODES.FIT_WIDTH],
    description: ZOOM_MODE_DESCRIPTIONS[ZOOM_MODES.FIT_WIDTH]
  },
  {
    id: ZOOM_MODES.FIT_HEIGHT,
    label: ZOOM_MODE_LABELS[ZOOM_MODES.FIT_HEIGHT],
    description: ZOOM_MODE_DESCRIPTIONS[ZOOM_MODES.FIT_HEIGHT]
  },
  {
    id: ZOOM_MODES.MANUAL,
    label: ZOOM_MODE_LABELS[ZOOM_MODES.MANUAL],
    description: ZOOM_MODE_DESCRIPTIONS[ZOOM_MODES.MANUAL]
  }
];

const ensureRgbaOpacity = (color, opacity = 0.2) => {
  if (!color || typeof color !== 'string') return 'rgba(255, 0, 0, ' + opacity + ')';
  if (color.startsWith('rgba')) {
    return color.replace(/rgba\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/, 'rgba($1, $2, $3, ' + opacity + ')');
  }
  if (color.startsWith('rgb')) {
    return color.replace(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/, 'rgba($1, $2, $3, ' + opacity + ')');
  }
  if (color.startsWith('#')) {
    const hex = color.replace('#', '');
    if (hex.length === 6) {
      const r = parseInt(hex.substring(0, 2), 16);
      const g = parseInt(hex.substring(2, 4), 16);
      const b = parseInt(hex.substring(4, 6), 16);
      return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + opacity + ')';
    }
  }
  return color;
};

export function PDFTopToolbarChrome({
  isViewerVisible,
  topToolbarApi,
  bottomToolbarApi,
  showArrowheadMenu,
  setShowArrowheadMenu,
  colorPickerTab,
  setColorPickerTab,
  showAlignGrid,
  setShowAlignGrid,
  showFontColorPicker,
  setShowFontColorPicker,
  showFontFamilyMenu,
  setShowFontFamilyMenu,
  showFontSizeMenu,
  setShowFontSizeMenu,
  showStyleMenu,
  setShowStyleMenu
}) {
  const [lastFormTool, setLastFormTool] = React.useState('form-textbox');

  React.useEffect(() => {
    if (FORM_TOOL_IDS.includes(bottomToolbarApi?.activeTool)) {
      setLastFormTool(bottomToolbarApi.activeTool);
    }
  }, [bottomToolbarApi?.activeTool]);

  return (
        <div
          id="chrome-top-host"
          style={{
            display: isViewerVisible ? 'flex' : 'none',
            flexShrink: 0,
            padding: '8px 12px',
            background: '#2d2d2d',
            alignItems: 'center',
            justifyContent: 'center',
            flexWrap: 'wrap',
            rowGap: '6px',
            columnGap: '8px',
            fontSize: '13px',
            fontFamily: FONT_FAMILY,
            color: '#ddd',
            position: 'relative',
            zIndex: 5500
          }}
        >
          {/* UX 2026-05-14: Undo + Redo pinned to the LEFT via absolute
              positioning so the rest of the toolbar can center cleanly
              with justifyContent: 'center'. This mirrors the old bottom
              toolbar where tools sat centered and adjacent helpers
              flanked them. Padding inside the strip leaves 12 px for the
              Undo/Redo cluster. */}
          <div style={{
            position: 'absolute',
            left: '12px',
            top: 0,
            bottom: 0,
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <button
              onClick={topToolbarApi.onUndo || (() => {})}
              disabled={!topToolbarApi.canUndo}
              className="btn btn-default btn-sm"
              title="Undo"
              style={{
                padding: '4px 8px',
                opacity: topToolbarApi.canUndo ? 1 : 0.4,
                cursor: topToolbarApi.canUndo ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              <Icon name="undo" size={14} />
            </button>
            <button
              onClick={topToolbarApi.onRedo || (() => {})}
              disabled={!topToolbarApi.canRedo}
              className="btn btn-default btn-sm"
              title="Redo"
              style={{
                padding: '4px 8px',
                opacity: topToolbarApi.canRedo ? 1 : 0.4,
                cursor: topToolbarApi.canRedo ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                transform: 'matrix(1, 0, 0, 1, 0, -0.591158) rotate(180deg) scaleX(-1)'
              }}
            >
              <Icon name="redo" size={14} />
            </button>
          </div>

          {/* UX 2026-05-14: Tools section — Pan / Select / Draw / Shapes /
              Text / Survey-category / Color / Width. Inlined from the old
              bottom toolbar. Consumes bottomToolbarApi which is still
              published from PDFViewer; if no PDF is open we skip the
              section entirely. Tooltip placement is "below" so labels
              fall under the buttons (above would clip the OS chrome).
              These flow inside the centered flex container so the whole
              tool cluster sits centered while Undo/Redo float on the
              left edge. */}
          {bottomToolbarApi && (
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '6px' }}>
              {/* 2026-05-26: Pan + Select sit in their own absolute block to
                  the LEFT of the centered annotation cluster. This mirrors
                  the right-side tool properties block so the annotation
                  icons stay centered on the screen — only the side blocks
                  shift as their contents change. */}
              <div style={{
                position: 'absolute',
                right: '100%',
                top: '50%',
                transform: 'translateY(-50%)',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                paddingRight: '8px',
                whiteSpace: 'nowrap'
              }}>
              {[
                { id: 'pan', label: 'Pan', iconName: 'pan' },
                { id: 'select', label: 'Select', iconName: 'cursor' }
              ].map(t => (
                <button
                  key={t.id}
                  onClick={() => {
                    bottomToolbarApi.setActiveTool(t.id);
                    bottomToolbarApi.setActiveCategoryDropdown(null);
                  }}
                  onMouseEnter={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    bottomToolbarApi.setTooltip({
                      visible: true,
                      text: t.label,
                      x: rect.left + rect.width / 2,
                      y: rect.bottom + 10,
                      placement: 'below'
                    });
                  }}
                  onMouseLeave={() => bottomToolbarApi.setTooltip({ visible: false, text: '', x: 0, y: 0 })}
                  className={`btn btn-icon ${bottomToolbarApi.activeTool === t.id ? 'btn-active' : ''}`}
                >
                  <Icon name={t.iconName} size={16} />
                </button>
              ))}

              <div style={{ width: '1px', height: '20px', background: '#555', margin: '0 4px' }} />
              </div>

              {/* Draw category */}
              <button
                onClick={() => {
                  const isActive = bottomToolbarApi.activeCategoryDropdown === 'draw';
                  bottomToolbarApi.setActiveCategoryDropdown(isActive ? null : 'draw');
                  if (!isActive) {
                    if (!['pen', 'highlighter', 'text-highlight', 'eraser'].includes(bottomToolbarApi.activeTool)) {
                      bottomToolbarApi.setActiveTool(bottomToolbarApi.lastDrawTool);
                    }
                  }
                }}
                onMouseEnter={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  bottomToolbarApi.setTooltip({
                    visible: true,
                    text: 'Draw',
                    x: rect.left + rect.width / 2,
                    y: rect.bottom + 10,
                    placement: 'below'
                  });
                }}
                onMouseLeave={() => bottomToolbarApi.setTooltip({ visible: false, text: '', x: 0, y: 0 })}
                className={`btn btn-md ${bottomToolbarApi.activeTool !== 'pan' && bottomToolbarApi.activeTool !== 'select' && (bottomToolbarApi.activeCategoryDropdown === 'draw' || ['pen', 'highlighter', 'text-highlight', 'eraser'].includes(bottomToolbarApi.activeTool)) ? 'btn-active' : 'btn-default'}`}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 10px' }}
                title="Draw"
              >
                <Icon name="pen" size={18} />
              </button>

              {/* Shapes category */}
              <button
                onClick={() => {
                  const isActive = bottomToolbarApi.activeCategoryDropdown === 'shape';
                  bottomToolbarApi.setActiveCategoryDropdown(isActive ? null : 'shape');
                  if (!isActive) {
                    if (!['rect', 'ellipse', 'line', 'arrow', 'counter'].includes(bottomToolbarApi.activeTool)) {
                      bottomToolbarApi.setActiveTool(bottomToolbarApi.lastShapeTool);
                    }
                  }
                }}
                onMouseEnter={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  bottomToolbarApi.setTooltip({
                    visible: true,
                    text: 'Shapes',
                    x: rect.left + rect.width / 2,
                    y: rect.bottom + 10,
                    placement: 'below'
                  });
                }}
                onMouseLeave={() => bottomToolbarApi.setTooltip({ visible: false, text: '', x: 0, y: 0 })}
                className={`btn btn-md ${bottomToolbarApi.activeTool !== 'pan' && bottomToolbarApi.activeTool !== 'select' && (bottomToolbarApi.activeCategoryDropdown === 'shape' || ['rect', 'ellipse', 'line', 'arrow', 'counter'].includes(bottomToolbarApi.activeTool)) ? 'btn-active' : 'btn-default'}`}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 10px' }}
                title="Shapes"
              >
                <Icon name="rect" size={18} />
              </button>

              {/* Text category */}
              <button
                onClick={() => {
                  const isActive = bottomToolbarApi.activeCategoryDropdown === 'review';
                  bottomToolbarApi.setActiveCategoryDropdown(isActive ? null : 'review');
                  if (!isActive) {
                    if (!REVIEW_TOOL_IDS.includes(bottomToolbarApi.activeTool)) {
                      bottomToolbarApi.setActiveTool(bottomToolbarApi.lastReviewTool);
                    }
                  }
                }}
                onMouseEnter={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  bottomToolbarApi.setTooltip({
                    visible: true,
                    text: 'Text',
                    x: rect.left + rect.width / 2,
                    y: rect.bottom + 10,
                    placement: 'below'
                  });
                }}
                onMouseLeave={() => bottomToolbarApi.setTooltip({ visible: false, text: '', x: 0, y: 0 })}
                className={`btn btn-md ${bottomToolbarApi.activeTool !== 'pan' && bottomToolbarApi.activeTool !== 'select' && (bottomToolbarApi.activeCategoryDropdown === 'review' || REVIEW_TOOL_IDS.includes(bottomToolbarApi.activeTool)) ? 'btn-active' : 'btn-default'}`}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 10px' }}
                title="Text"
              >
                <Icon name="text" size={18} />
              </button>

              {/* KAL-47: Forms category. Opens the form-field subtoolbar
                  (Textbox / Checkbox / Radio / Signature) and routes
                  activeTool through the FORM_TOOL_IDS set. We do not
                  enable Syncfusion's built-in form-designer toolbar — the
                  subtoolbar is wired directly to the FormDesigner API
                  through the syncfusionViewerRef.
                  2026-05-26: Hidden for first release — feature not yet
                  ready for users. Code stays intact; flip false back to
                  true to re-enable. */}
              {false && (
              <button
                data-testid="forms-category-button"
                onClick={() => {
                  const isActive = bottomToolbarApi.activeCategoryDropdown === 'forms';
                  bottomToolbarApi.setActiveCategoryDropdown(isActive ? null : 'forms');
                  if (!isActive) {
                    if (!FORM_TOOL_IDS.includes(bottomToolbarApi.activeTool)) {
                      bottomToolbarApi.setActiveTool(lastFormTool || 'form-textbox');
                    }
                  } else {
                    // Closing dropdown: leave Forms mode so pan/select work.
                    if (FORM_TOOL_IDS.includes(bottomToolbarApi.activeTool)) {
                      bottomToolbarApi.setActiveTool('pan');
                    }
                  }
                }}
                onMouseEnter={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  bottomToolbarApi.setTooltip({
                    visible: true,
                    text: 'Forms',
                    x: rect.left + rect.width / 2,
                    y: rect.bottom + 10,
                    placement: 'below'
                  });
                }}
                onMouseLeave={() => bottomToolbarApi.setTooltip({ visible: false, text: '', x: 0, y: 0 })}
                className={`btn btn-md ${bottomToolbarApi.activeTool !== 'pan' && bottomToolbarApi.activeTool !== 'select' && (bottomToolbarApi.activeCategoryDropdown === 'forms' || FORM_TOOL_IDS.includes(bottomToolbarApi.activeTool)) ? 'btn-active' : 'btn-default'}`}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 10px' }}
                title="Forms"
              >
                <Icon name="edit" size={18} />
              </button>
              )}

              {/* Survey toggle lives in the former survey-tool slot so users
                  enter/exit survey mode from the same top toolbar cluster as
                  the annotation tools. The subtoolbar still opens
                  automatically after template selection. */}
              {topToolbarApi.onSurveyToggle && (
                <button
                  onClick={() => {
                    if (topToolbarApi.surveyActive) {
                      bottomToolbarApi.setActiveCategoryDropdown(null);
                    }
                    topToolbarApi.onSurveyToggle();
                  }}
                  onMouseEnter={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    bottomToolbarApi.setTooltip({
                      visible: true,
                      text: 'Survey',
                      x: rect.left + rect.width / 2,
                      y: rect.bottom + 10,
                      placement: 'below'
                    });
                  }}
                  onMouseLeave={() => bottomToolbarApi.setTooltip({ visible: false, text: '', x: 0, y: 0 })}
                  className={`btn btn-md ${topToolbarApi.surveyActive ? 'btn-active' : 'btn-default'}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '4px 10px',
                    opacity: topToolbarApi.surveyEnabled ? 1 : 0.6,
                    cursor: topToolbarApi.surveyEnabled ? 'pointer' : 'not-allowed',
                    position: 'relative'
                  }}
                  title={!topToolbarApi.surveyEnabled ? 'Pro feature - Upgrade to unlock' : 'Survey'}
                >
                  <Icon name="survey" size={16} />
                  {!topToolbarApi.surveyEnabled && (
                    <Icon name="lock" size={9} style={{ marginLeft: '-3px' }} />
                  )}
                </button>
              )}

              {/* 2026-05-26: Tool properties (divider + color swatch + width +
                  any tool-specific extras like the arrowhead dropdown + Aa)
                  are absolutely positioned to the right edge of the icon
                  cluster so they grow outward to the right / shrink back to
                  the left without nudging the pan-select or annotation icons.
                  User priority is icon stability over visual centering. */}
              <div style={{
                position: 'absolute',
                left: '100%',
                top: '50%',
                transform: 'translateY(-50%)',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                paddingLeft: '8px',
                whiteSpace: 'nowrap'
              }}>
              <div style={{ width: '1px', height: '20px', background: '#555', margin: '0 4px' }} />

              {/* Color swatch + Width input. Color picker now flips DOWN
                  (top: 100%) since the swatch lives at the top of the
                  viewport instead of the bottom — popping up would shoot
                  off-screen.
                  2026-05-25: Pen + highlighter render the swatch as a flat
                  solid-disc circle (no fill/border ring) per the new
                  context-aware strip contract — visual reference is
                  prototype-context-toolbar.html. Other tools keep the
                  rectangle swatch until they migrate. */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', position: 'relative' }}>
                {bottomToolbarApi.richTextEditor && typeof document !== 'undefined' && document.getElementById('chrome-sub-toolbar-host') && createPortal(
                  /* 2026-05-26: Rich-text edit mode — the formatting controls
                     drop into the sub-row beneath the top strip (mirrors the
                     Draw / Shape category sub-rows). The inline strip's swatch,
                     width input, and Aa button stay put — only the rich-text
                     controls relocate, so the user keeps the usual chrome.
                     The strip-wide PDFViewer portal suppresses itself when
                     richTextEditor is non-null so the two sub-rows can't stack.
                     2026-05-25: Bridge contract — state comes from the
                     bridge's `state` field (per-selection aware); writes route
                     through the bridge's `api`. The data-rich-text-toolbar
                     attribute opts these buttons out of FabricEditCanvas's
                     document-level click-outside handler so clicks don't
                     commit-and-close the editor. */
                  <div data-rich-text-toolbar style={{ width: '100%', height: '34px', background: '#2b2b2b', borderBottom: '1px solid #3a3a3a', borderTop: 'none', cursor: 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', zIndex: 10, boxSizing: 'border-box' }}>
                    {/* 2026-05-26: Order — font color, font size, B / I / U / S,
                        alignment. Matches the user's requested left-to-right
                        sequence so the chrome reads as one cohesive row. Font
                        family was removed from the strip in this pass per the
                        same request. */}
                    {/* Font color — reuses the shared color picker, just like
                        the stroke/fill swatches above. The picker drops DOWN
                        below the swatch via an absolute wrapper (top:100%) so
                        it lines up with the other top-bar pickers. */}
                    <div data-font-color-picker style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                      <button
                        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                        onClick={() => setShowFontColorPicker((v) => !v)}
                        className="ctx-color-swatch"
                        style={{
                          width: '24px',
                          height: '24px',
                          padding: 0,
                          borderRadius: '50%',
                          border: 'none',
                          position: 'relative',
                          overflow: 'hidden',
                          boxSizing: 'border-box',
                          cursor: 'pointer',
                        }}
                        title="Font color"
                        aria-label="Font color"
                      >
                        <span
                          className="ctx-color-fill"
                          style={{ background: bottomToolbarApi.richTextEditor?.state?.fontColor || '#1e293b' }}
                        />
                      </button>
                      {showFontColorPicker && (
                        <div style={{
                          position: 'absolute',
                          top: '100%',
                          left: '50%',
                          marginTop: '10px',
                          transform: 'translate(-50%, 0)',
                          zIndex: 2000,
                        }}>
                          <CompactColorPicker
                            color={bottomToolbarApi.richTextEditor?.state?.fontColor || '#1e293b'}
                            opacity={1}
                            marginRight="0"
                            onChange={(hex) => {
                              bottomToolbarApi.richTextEditor?.api?.setFontColor?.(hex);
                            }}
                            onClose={() => setShowFontColorPicker(false)}
                            firstPreset="transparent"
                          />
                        </div>
                      )}
                    </div>
                    {/* Font family — custom dropdown so it opens strictly
                        downward and styling matches the rest of the chrome.
                        Single-name fonts only per the Fabric cursor-drift
                        gotcha (2026-04-08). */}
                    {(() => {
                      const FONT_FAMILIES = ['Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana'];
                      const currentFamily = bottomToolbarApi.richTextEditor?.state?.fontFamily || 'Arial';
                      return (
                        <div data-font-family-menu style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                          <button
                            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                            onClick={() => setShowFontFamilyMenu((v) => !v)}
                            style={{
                              height: '24px',
                              padding: '0 8px',
                              minWidth: '110px',
                              background: '#444',
                              color: '#ddd',
                              border: '1px solid transparent',
                              borderRadius: '5px',
                              fontSize: '12px',
                              fontFamily: FONT_FAMILY,
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: '6px',
                            }}
                            title="Font"
                            aria-label="Font"
                          >
                            <span style={{ fontFamily: currentFamily, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{currentFamily}</span>
                            <span style={{ color: '#888', fontSize: '9px' }}>▼</span>
                          </button>
                          {showFontFamilyMenu && (
                            <div style={{
                              position: 'absolute',
                              top: 'calc(100% + 6px)',
                              left: 0,
                              zIndex: 5600,
                              background: '#1e2026',
                              border: '1px solid #383d46',
                              borderRadius: '6px',
                              padding: '4px',
                              boxShadow: '0 12px 36px rgba(0,0,0,0.5)',
                              minWidth: '160px',
                              maxHeight: '280px',
                              overflowY: 'auto',
                            }}>
                              {FONT_FAMILIES.map((f) => {
                                const on = f === currentFamily;
                                return (
                                  <button
                                    key={f}
                                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                    onClick={() => {
                                      bottomToolbarApi.richTextEditor?.api?.setFontFamily?.(f);
                                      setShowFontFamilyMenu(false);
                                    }}
                                    style={{
                                      display: 'block',
                                      width: '100%',
                                      textAlign: 'left',
                                      padding: '6px 10px',
                                      background: on ? 'rgba(216,168,78,0.12)' : 'transparent',
                                      color: on ? '#d8a84e' : '#ddd',
                                      border: 'none',
                                      borderRadius: '4px',
                                      cursor: 'pointer',
                                      fontFamily: f,
                                      fontSize: '13px',
                                    }}
                                  >
                                    {f}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    {/* Font size — custom dropdown of standard increments.
                        Opens strictly downward (native select can flip up
                        when many options don't fit below). If the active
                        size isn't in the preset list, it's prepended so the
                        trigger label still matches the live value. */}
                    {(() => {
                      const FONT_SIZE_PRESETS = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72];
                      const currentSize = bottomToolbarApi.richTextEditor?.state?.fontSize ?? 16;
                      const sizes = FONT_SIZE_PRESETS.includes(currentSize)
                        ? FONT_SIZE_PRESETS
                        : [currentSize, ...FONT_SIZE_PRESETS];
                      return (
                        <div data-font-size-menu style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                          <button
                            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                            onClick={() => setShowFontSizeMenu((v) => !v)}
                            style={{
                              height: '24px',
                              padding: '0 8px',
                              minWidth: '58px',
                              background: '#444',
                              color: '#ddd',
                              border: '1px solid transparent',
                              borderRadius: '5px',
                              fontSize: '12px',
                              fontFamily: FONT_FAMILY,
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: '6px',
                            }}
                            title="Font size"
                            aria-label="Font size"
                          >
                            <span>{currentSize}</span>
                            <span style={{ color: '#888', fontSize: '9px' }}>▼</span>
                          </button>
                          {showFontSizeMenu && (
                            <div style={{
                              position: 'absolute',
                              top: 'calc(100% + 6px)',
                              left: 0,
                              zIndex: 5600,
                              background: '#1e2026',
                              border: '1px solid #383d46',
                              borderRadius: '6px',
                              padding: '4px',
                              boxShadow: '0 12px 36px rgba(0,0,0,0.5)',
                              minWidth: '72px',
                              maxHeight: '280px',
                              overflowY: 'auto',
                            }}>
                              {sizes.map((s) => {
                                const on = s === currentSize;
                                return (
                                  <button
                                    key={s}
                                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                    onClick={() => {
                                      bottomToolbarApi.richTextEditor?.api?.setFontSize?.(s);
                                      setShowFontSizeMenu(false);
                                    }}
                                    style={{
                                      display: 'block',
                                      width: '100%',
                                      textAlign: 'left',
                                      padding: '6px 10px',
                                      background: on ? 'rgba(216,168,78,0.12)' : 'transparent',
                                      color: on ? '#d8a84e' : '#ddd',
                                      border: 'none',
                                      borderRadius: '4px',
                                      cursor: 'pointer',
                                      fontFamily: FONT_FAMILY,
                                      fontSize: '13px',
                                    }}
                                  >
                                    {s}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    {/* Bold / Italic / Underline / Strikethrough toggles. */}
                    {[
                      ['B', 'bold', 'toggleBold', { fontWeight: 700 }],
                      ['I', 'italic', 'toggleItalic', { fontStyle: 'italic' }],
                      ['U', 'underline', 'toggleUnderline', { textDecoration: 'underline' }],
                      ['S', 'strike', 'toggleStrike', { textDecoration: 'line-through' }],
                    ].map(([label, stateKey, apiKey, fontStyleOverride]) => {
                      const isOn = !!bottomToolbarApi.richTextEditor?.state?.[stateKey];
                      return (
                        <button
                          key={stateKey}
                          onMouseDown={(e) => {
                            // Prevent the textbox from losing its selection
                            // when the user clicks the toggle — without this
                            // the Fabric Textbox blurs and the toggle would
                            // apply to an empty range.
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                          onClick={() => bottomToolbarApi.richTextEditor?.api?.[apiKey]?.()}
                          style={{
                            width: '28px',
                            height: '24px',
                            padding: 0,
                            background: isOn ? 'rgba(216,168,78,0.18)' : '#444',
                            color: isOn ? '#d8a84e' : '#ddd',
                            border: '1px solid transparent',
                            borderRadius: '5px',
                            fontSize: '13px',
                            fontFamily: FONT_FAMILY,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            ...fontStyleOverride,
                          }}
                          title={label === 'B' ? 'Bold' : label === 'I' ? 'Italic' : label === 'U' ? 'Underline' : 'Strikethrough'}
                          aria-label={label === 'B' ? 'Bold' : label === 'I' ? 'Italic' : label === 'U' ? 'Underline' : 'Strikethrough'}
                          aria-pressed={isOn}
                        >
                          {label}
                        </button>
                      );
                    })}
                    {/* Alignment — 28x26 trigger with 3x3 mini-grid, opens a
                        "Text alignment" popover that picks horizontal +
                        vertical anchor at once. */}
                    {(() => {
                      const hAlign = bottomToolbarApi.richTextEditor?.state?.textAlign || 'left';
                      const vAlign = bottomToolbarApi.richTextEditor?.state?.verticalAlign || 'top';
                      const labelFor = (v, h) => `${v}-${h === 'center' ? 'center' : h}`;
                      const isCellActive = (v, h) => v === vAlign && h === hAlign;
                      return (
                        <div data-align-grid style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{
                            fontSize: '10.5px',
                            letterSpacing: '0.04em',
                            textTransform: 'uppercase',
                            color: '#9ca3af',
                            fontFamily: FONT_FAMILY,
                          }}>Align</span>
                          <button
                            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                            onClick={() => setShowAlignGrid((v) => !v)}
                            style={{
                              width: '28px',
                              height: '26px',
                              padding: 0,
                              background: '#2a2e36',
                              border: '1px solid #383d46',
                              borderRadius: '5px',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                            title="Text alignment"
                            aria-label="Text alignment"
                          >
                            <span style={{
                              display: 'grid',
                              gridTemplateColumns: 'repeat(3, 4px)',
                              gridTemplateRows: 'repeat(3, 4px)',
                              gap: '2px',
                            }}>
                              {['top', 'middle', 'bottom'].flatMap((v) => ['left', 'center', 'right'].map((h) => {
                                const on = isCellActive(v, h);
                                return (
                                  <span key={labelFor(v, h)} style={{
                                    width: '4px',
                                    height: '4px',
                                    borderRadius: '1px',
                                    background: on ? '#d8a84e' : 'rgba(168,176,191,0.4)',
                                    boxShadow: on ? '0 0 0 1px rgba(216,168,78,0.25)' : 'none',
                                  }} />
                                );
                              }))}
                            </span>
                          </button>
                          {showAlignGrid && (
                            <div style={{
                              position: 'absolute',
                              top: 'calc(100% + 6px)',
                              right: 0,
                              zIndex: 5600,
                              background: '#1e2026',
                              border: '1px solid #383d46',
                              borderRadius: '8px',
                              padding: '10px',
                              boxShadow: '0 12px 36px rgba(0,0,0,0.5)',
                            }}>
                              <div style={{
                                fontSize: '10.5px',
                                letterSpacing: '0.04em',
                                textTransform: 'uppercase',
                                color: '#9ca3af',
                                marginBottom: '8px',
                                fontFamily: FONT_FAMILY,
                              }}>Text alignment</div>
                              <div style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(3, 26px)',
                                gap: '4px',
                              }}>
                                {['top', 'middle', 'bottom'].flatMap((v) => ['left', 'center', 'right'].map((h) => {
                                  const on = isCellActive(v, h);
                                  return (
                                    <button
                                      key={labelFor(v, h)}
                                      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                      onClick={() => {
                                        bottomToolbarApi.richTextEditor?.api?.setTextAlign?.(h);
                                        bottomToolbarApi.richTextEditor?.api?.setVerticalAlign?.(v);
                                        setShowAlignGrid(false);
                                      }}
                                      style={{
                                        appearance: 'none',
                                        width: '26px',
                                        height: '26px',
                                        background: on ? 'rgba(216,168,78,0.10)' : '#14171c',
                                        border: on ? '1px solid #d8a84e' : '1px solid #2a2e36',
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        padding: 0,
                                      }}
                                      title={`${v} ${h}`}
                                      aria-label={`${v} ${h}`}
                                    >
                                      <span style={{
                                        width: '6px',
                                        height: '6px',
                                        borderRadius: '50%',
                                        background: on ? '#d8a84e' : '#5a606a',
                                      }} />
                                    </button>
                                  );
                                }))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>,
                  document.getElementById('chrome-sub-toolbar-host')
                )}
                <>
                {/* 2026-05-25: Eraser hides the color swatch entirely — only
                    the diameter input below remains visible for that tool. */}
                {bottomToolbarApi.activeTool !== 'eraser' && (
                  <>
                {!bottomToolbarApi.richTextEditor && (bottomToolbarApi.contextTool === 'pen' || bottomToolbarApi.contextTool === 'highlighter' || bottomToolbarApi.contextTool === 'arrow' || bottomToolbarApi.contextTool === 'line') ? (
                  /* 2026-05-25: Stroke-only swatch (pen, highlighter, arrow,
                     line). Checker pattern shows through low-opacity strokes
                     and a faint hairline ring lifts pure black off the dark
                     toolbar — both behaviours come from .ctx-color-swatch. */
                  <button
                    onClick={() => bottomToolbarApi.setShowAnnotationColorPicker(!bottomToolbarApi.showAnnotationColorPicker)}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="ctx-color-swatch"
                    style={{
                      width: '24px',
                      height: '24px',
                      padding: 0,
                      borderRadius: '50%',
                      border: 'none',
                      position: 'relative',
                      overflow: 'hidden',
                      boxSizing: 'border-box',
                      cursor: 'pointer'
                    }}
                    title="Color"
                    aria-label="Color"
                  >
                    <span
                      className="ctx-color-fill"
                      style={{
                        background: ensureRgbaOpacity(bottomToolbarApi.strokeColor || '#000000', (bottomToolbarApi.strokeOpacity ?? 100) / 100)
                      }}
                    />
                  </button>
                ) : bottomToolbarApi.contextTool === 'counter' && bottomToolbarApi.handleFillColorChange ? (
                  /* 2026-05-25: Counter swatch — a literal preview of the pin.
                     Background disc = fill colour (pin colour), the centred
                     "1" = stroke colour (number colour). Updates live as the
                     user picks colours so they always see what the next pin
                     will look like, instead of an abstract ring + disc. */
                  <button
                    onClick={() => {
                      bottomToolbarApi.setShowAnnotationColorPicker(!bottomToolbarApi.showAnnotationColorPicker);
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="ctx-color-swatch"
                    style={{
                      width: '24px',
                      height: '24px',
                      padding: 0,
                      borderRadius: '50%',
                      border: 'none',
                      boxSizing: 'border-box',
                      position: 'relative',
                      overflow: 'hidden',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                    title="Counter colors"
                    aria-label="Counter colors"
                  >
                    <span
                      className="ctx-color-fill"
                      style={{
                        background: ensureRgbaOpacity(bottomToolbarApi.fillColor || '#ef4444', (bottomToolbarApi.fillOpacity ?? 100) / 100)
                      }}
                    />
                    <span style={{
                      position: 'relative',
                      zIndex: 2,
                      fontSize: '12px',
                      fontWeight: 700,
                      lineHeight: 1,
                      color: ensureRgbaOpacity(bottomToolbarApi.strokeColor || '#ffffff', (bottomToolbarApi.strokeOpacity ?? 100) / 100),
                      fontFamily: FONT_FAMILY,
                      pointerEvents: 'none'
                    }}>1</span>
                  </button>
                ) : (bottomToolbarApi.contextTool === 'rect' || bottomToolbarApi.contextTool === 'ellipse' || bottomToolbarApi.contextTool === 'text' || bottomToolbarApi.contextTool === 'callout' || !!bottomToolbarApi.richTextEditor) && bottomToolbarApi.handleFillColorChange ? (
                  /* 2026-05-25: Fill + border swatch. Checker shows through
                     low-opacity fills, faint hairline lifts black borders. */
                  <button
                    onClick={() => {
                      bottomToolbarApi.setShowAnnotationColorPicker(!bottomToolbarApi.showAnnotationColorPicker);
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="ctx-color-swatch"
                    style={{
                      width: '24px',
                      height: '24px',
                      padding: 0,
                      borderRadius: '50%',
                      border: `2px solid ${ensureRgbaOpacity(bottomToolbarApi.strokeColor || '#000000', (bottomToolbarApi.strokeOpacity ?? 100) / 100)}`,
                      boxSizing: 'border-box',
                      position: 'relative',
                      overflow: 'hidden',
                      cursor: 'pointer'
                    }}
                    title="Color"
                    aria-label="Color"
                  >
                    <span
                      className="ctx-color-fill"
                      style={{
                        background: ensureRgbaOpacity(bottomToolbarApi.fillColor || '#ffffff', (bottomToolbarApi.fillOpacity ?? 100) / 100)
                      }}
                    />
                  </button>
                ) : null}

                {bottomToolbarApi.showAnnotationColorPicker && (() => {
                  const isShape = (bottomToolbarApi.contextTool === 'rect' || bottomToolbarApi.contextTool === 'ellipse' || bottomToolbarApi.contextTool === 'text' || bottomToolbarApi.contextTool === 'callout' || bottomToolbarApi.contextTool === 'counter')
                    && bottomToolbarApi.handleFillColorChange;
                  const isCounter = bottomToolbarApi.contextTool === 'counter';
                  const secondTabLabel = isCounter ? 'Number' : 'Border';
                  const onFillTab = isShape && colorPickerTab === 'fill';
                  // 2026-05-25: Shapes (rectangle + ellipse) follow one rule —
                  // at least one side must stay visible. Either the fill or
                  // the border can be transparent, but never both at the same
                  // time. When the user takes the side they're editing to 0
                  // while the other side is already at 0, the other side gets
                  // bumped to fully opaque so the shape stays visible. Text
                  // and Callout opt out (their borders + fills are optional).
                  const shapeOneVisibleRule = bottomToolbarApi.contextTool === 'rect'
                    || bottomToolbarApi.contextTool === 'ellipse';
                  const currentColor = onFillTab ? (bottomToolbarApi.fillColor || '#ff0000') : bottomToolbarApi.strokeColor;
                  const currentOpacity = onFillTab ? ((bottomToolbarApi.fillOpacity ?? 100) / 100) : (bottomToolbarApi.strokeOpacity / 100);
                  const applyChange = (hex, alpha) => {
                    if (onFillTab) {
                      const otherAlpha = (bottomToolbarApi.strokeOpacity ?? 100) / 100;
                      if (shapeOneVisibleRule && alpha <= 0 && otherAlpha <= 0) {
                        bottomToolbarApi.handleStrokeOpacityChange(100);
                      }
                      bottomToolbarApi.handleFillColorChange(hex);
                      bottomToolbarApi.handleFillOpacityChange(Math.round(alpha * 100));
                    } else {
                      const otherAlpha = (bottomToolbarApi.fillOpacity ?? 100) / 100;
                      if (shapeOneVisibleRule && alpha <= 0 && otherAlpha <= 0) {
                        bottomToolbarApi.handleFillOpacityChange(100);
                      }
                      bottomToolbarApi.handleStrokeColorChange(hex);
                      bottomToolbarApi.handleStrokeOpacityChange(Math.round(alpha * 100));
                    }
                  };
                  return (
                    <div style={{
                      position: 'absolute',
                      top: '100%',
                      left: '50%',
                      marginTop: '10px',
                      transform: 'translate(-50%, 0)',
                      zIndex: 2000
                    }}>
                      {isShape && (
                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr 1fr',
                          background: '#1e1e1e',
                          border: '1px solid #333',
                          borderBottom: 'none',
                          borderRadius: '8px 8px 0 0',
                          overflow: 'hidden',
                          width: '260px',
                          marginRight: '53px'
                        }}>
                          {[['fill', 'Fill'], ['border', secondTabLabel]].map(([k, label], i) => {
                            const on = colorPickerTab === k;
                            return (
                              <button
                                key={k}
                                onClick={() => setColorPickerTab(k)}
                                onMouseDown={(e) => e.stopPropagation()}
                                style={{
                                  background: on ? 'rgba(216,168,78,0.08)' : 'transparent',
                                  color: on ? '#eee' : '#888',
                                  fontWeight: 600,
                                  fontSize: 12,
                                  padding: '8px 0',
                                  border: 0,
                                  borderRight: i === 0 ? '1px solid #333' : 0,
                                  cursor: 'pointer',
                                  position: 'relative'
                                }}
                              >
                                {label}
                                {on && (
                                  <span style={{
                                    position: 'absolute', left: 0, right: 0, bottom: 0,
                                    height: 2, background: '#d8a84e'
                                  }} />
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}
                      <CompactColorPicker
                        color={currentColor}
                        opacity={currentOpacity}
                        marginRight="53px"
                        onChange={applyChange}
                        onClose={() => bottomToolbarApi.setShowAnnotationColorPicker(false)}
                        firstPreset={(shapeOneVisibleRule && !onFillTab)
                          ? { kind: 'match', color: bottomToolbarApi.fillColor || '#ffffff', opacity: (bottomToolbarApi.fillOpacity ?? 100) / 100 }
                          : 'transparent'}
                      />
                    </div>
                  );
                })()}
                  </>
                )}

                {(bottomToolbarApi.contextTool === 'pen'
                  || bottomToolbarApi.contextTool === 'highlighter'
                  || bottomToolbarApi.contextTool === 'arrow'
                  || bottomToolbarApi.contextTool === 'line'
                  || bottomToolbarApi.contextTool === 'rect'
                  || bottomToolbarApi.contextTool === 'ellipse'
                  || bottomToolbarApi.contextTool === 'text'
                  || bottomToolbarApi.contextTool === 'callout'
                  || bottomToolbarApi.contextTool === 'counter'
                  || bottomToolbarApi.activeTool === 'eraser') && (
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  className="no-spin-buttons"
                  value={bottomToolbarApi.activeTool === 'eraser' ? bottomToolbarApi.eraserSizeInputValue : bottomToolbarApi.strokeWidthInputValue}
                  onChange={bottomToolbarApi.activeTool === 'eraser' ? bottomToolbarApi.handleEraserSizeInputChange : bottomToolbarApi.handleStrokeWidthInputChange}
                  onFocus={() => bottomToolbarApi.activeTool === 'eraser' ? bottomToolbarApi.setIsEraserSizeFocused(true) : bottomToolbarApi.setIsStrokeWidthFocused(true)}
                  onBlur={bottomToolbarApi.activeTool === 'eraser' ? bottomToolbarApi.handleEraserSizeInputBlur : bottomToolbarApi.handleStrokeWidthInputBlur}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.target.blur();
                    }
                  }}
                  style={{
                    width: '36px',
                    height: '20px',
                    padding: '4px 4px',
                    background: '#444',
                    color: '#ddd',
                    border: '1px solid transparent',
                    borderRadius: '5px',
                    fontSize: '12px',
                    fontFamily: FONT_FAMILY,
                    textAlign: 'center'
                  }}
                  title="Width"
                />
                )}
                {/* 2026-05-25: Style picker — solid/dashed/dotted for line + arrow;
                    solid/dashed/dotted/cloud for rectangle; solid/dashed/dotted
                    for ellipse (no cloud option). Always opens downward. */}
                {(bottomToolbarApi.contextTool === 'arrow' || bottomToolbarApi.contextTool === 'line' || bottomToolbarApi.contextTool === 'rect' || bottomToolbarApi.contextTool === 'ellipse' || bottomToolbarApi.contextTool === 'text' || bottomToolbarApi.contextTool === 'callout') && bottomToolbarApi.setLineBorderStyle && (
                  <div data-style-menu style={{ position: 'relative' }}>
                    <button
                      onClick={() => setShowStyleMenu(!showStyleMenu)}
                      onMouseDown={(e) => e.stopPropagation()}
                      style={{
                        height: '24px',
                        padding: '0 22px 0 8px',
                        background: '#444',
                        color: '#ddd',
                        border: '1px solid transparent',
                        borderRadius: '5px',
                        fontSize: '12px',
                        fontFamily: FONT_FAMILY,
                        cursor: 'pointer',
                        backgroundImage:
                          'linear-gradient(45deg, transparent 50%, #aaa 50%), linear-gradient(135deg, #aaa 50%, transparent 50%)',
                        backgroundPosition: 'calc(100% - 11px) 10px, calc(100% - 7px) 10px',
                        backgroundSize: '4px 4px, 4px 4px',
                        backgroundRepeat: 'no-repeat'
                      }}
                      title="Style"
                      aria-label="Style"
                    >
                      {{ solid: 'Solid', dashed: 'Dashed', dotted: 'Dotted', cloud: 'Cloud' }[bottomToolbarApi.lineBorderStyle] || 'Solid'}
                    </button>
                    {showStyleMenu && (
                      <div style={{
                        position: 'absolute',
                        top: 'calc(100% + 4px)',
                        left: 0,
                        background: '#1e1e1e',
                        border: '1px solid #444',
                        borderRadius: '6px',
                        boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
                        padding: '4px',
                        zIndex: 5600,
                        minWidth: '120px',
                        whiteSpace: 'nowrap'
                      }}>
                        {[
                          ['solid','Solid'],
                          ['dashed','Dashed'],
                          ['dotted','Dotted'],
                          ...(bottomToolbarApi.contextTool === 'rect' ? [['cloud','Cloud']] : [])
                        ].map(([val, label]) => {
                          const isOn = bottomToolbarApi.lineBorderStyle === val;
                          return (
                            <button
                              key={val}
                              onClick={() => {
                                bottomToolbarApi.setLineBorderStyle(val);
                                setShowStyleMenu(false);
                              }}
                              style={{
                                display: 'block',
                                width: '100%',
                                padding: '6px 10px',
                                background: isOn ? 'rgba(216,168,78,0.12)' : 'transparent',
                                color: isOn ? '#d8a84e' : '#ddd',
                                border: 'none',
                                borderRadius: '4px',
                                fontSize: '12px',
                                fontFamily: FONT_FAMILY,
                                textAlign: 'left',
                                cursor: 'pointer'
                              }}
                              onMouseEnter={(e) => { if (!isOn) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                              onMouseLeave={(e) => { if (!isOn) e.currentTarget.style.background = 'transparent'; }}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
                {/* 2026-05-25: Bump number input — only shows for rectangle when
                    the border style is Cloud. Drives how big the cloud's wave
                    bumps render. Mirrors the width input visual. */}
                {bottomToolbarApi.contextTool === 'rect' && bottomToolbarApi.lineBorderStyle === 'cloud' && bottomToolbarApi.setCloudIntensity && (
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#bbb', fontSize: '11px', fontFamily: FONT_FAMILY }}>
                    Bump
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      className="no-spin-buttons"
                      value={bottomToolbarApi.cloudIntensity ?? 2}
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (raw === '' || /^\d+$/.test(raw)) {
                          const next = raw === '' ? 1 : Math.max(1, Math.min(20, parseInt(raw, 10)));
                          bottomToolbarApi.setCloudIntensity(next);
                        }
                      }}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                      style={{
                        width: '36px',
                        height: '20px',
                        padding: '4px 4px',
                        background: '#444',
                        color: '#ddd',
                        border: '1px solid transparent',
                        borderRadius: '5px',
                        fontSize: '12px',
                        fontFamily: FONT_FAMILY,
                        textAlign: 'center'
                      }}
                      title="Cloud bump size"
                    />
                  </label>
                )}
                {/* 2026-05-25: Arrow tool (or selected callout) — custom
                    arrowhead menu that always opens downward and shows every
                    option at once (native select scrolls / picks its own
                    direction). Callouts have their own arrowhead end so the
                    same picker drives both. */}
                {(bottomToolbarApi.contextTool === 'arrow' || bottomToolbarApi.contextTool === 'callout') && bottomToolbarApi.setArrowheadStyle && (
                  <div data-arrowhead-menu style={{ position: 'relative' }}>
                    <button
                      onClick={() => setShowArrowheadMenu(!showArrowheadMenu)}
                      onMouseDown={(e) => e.stopPropagation()}
                      style={{
                        height: '24px',
                        padding: '0 22px 0 8px',
                        background: '#444',
                        color: '#ddd',
                        border: '1px solid transparent',
                        borderRadius: '5px',
                        fontSize: '12px',
                        fontFamily: FONT_FAMILY,
                        cursor: 'pointer',
                        backgroundImage:
                          'linear-gradient(45deg, transparent 50%, #aaa 50%), linear-gradient(135deg, #aaa 50%, transparent 50%)',
                        backgroundPosition: 'calc(100% - 11px) 10px, calc(100% - 7px) 10px',
                        backgroundSize: '4px 4px, 4px 4px',
                        backgroundRepeat: 'no-repeat'
                      }}
                      title="Arrowhead"
                      aria-label="Arrowhead"
                    >
                      {ARROWHEAD_STYLE_LABELS[bottomToolbarApi.arrowheadStyle] || 'Solid Triangle'}
                    </button>
                    {showArrowheadMenu && (
                      <div style={{
                        position: 'absolute',
                        top: 'calc(100% + 4px)',
                        left: 0,
                        background: '#1e1e1e',
                        border: '1px solid #444',
                        borderRadius: '6px',
                        boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
                        padding: '4px',
                        zIndex: 5600,
                        minWidth: '160px',
                        whiteSpace: 'nowrap'
                      }}>
                        {Object.entries(ARROWHEAD_STYLE_LABELS).map(([val, label]) => {
                          const isOn = bottomToolbarApi.arrowheadStyle === val;
                          return (
                            <button
                              key={val}
                              onClick={() => {
                                bottomToolbarApi.setArrowheadStyle(val);
                                setShowArrowheadMenu(false);
                              }}
                              style={{
                                display: 'block',
                                width: '100%',
                                padding: '6px 10px',
                                background: isOn ? 'rgba(216,168,78,0.12)' : 'transparent',
                                color: isOn ? '#d8a84e' : '#ddd',
                                border: 'none',
                                borderRadius: '4px',
                                fontSize: '12px',
                                fontFamily: FONT_FAMILY,
                                textAlign: 'left',
                                cursor: 'pointer'
                              }}
                              onMouseEnter={(e) => {
                                if (!isOn) e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                              }}
                              onMouseLeave={(e) => {
                                if (!isOn) e.currentTarget.style.background = 'transparent';
                              }}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
                {/* 2026-05-25: Rich-text edit entry button. Only renders when
                    the user is on the text box / callout tool or has one of
                    those selected. Disabled when nothing editable is picked.
                    Clicking drops the user into text edit mode on the
                    selected item — same path as double-clicking the text. */}
                {bottomToolbarApi.onEnterTextEdit
                  && (bottomToolbarApi.contextTool === 'text'
                      || bottomToolbarApi.contextTool === 'callout'
                      || !!bottomToolbarApi.richTextEditor) && (
                  <button
                    onClick={() => bottomToolbarApi.onEnterTextEdit()}
                    onMouseDown={(e) => e.stopPropagation()}
                    disabled={!bottomToolbarApi.canEnterTextEdit}
                    style={{
                      height: '24px',
                      padding: '0 8px',
                      background: bottomToolbarApi.richTextEditor ? 'rgba(216,168,78,0.18)' : '#444',
                      color: bottomToolbarApi.richTextEditor
                        ? '#d8a84e'
                        : bottomToolbarApi.canEnterTextEdit ? '#ddd' : '#666',
                      border: '1px solid transparent',
                      borderRadius: '5px',
                      fontSize: '13px',
                      fontWeight: 600,
                      fontFamily: FONT_FAMILY,
                      cursor: bottomToolbarApi.canEnterTextEdit ? 'pointer' : 'not-allowed',
                      opacity: bottomToolbarApi.canEnterTextEdit ? 1 : 0.5,
                      lineHeight: 1,
                    }}
                    title={bottomToolbarApi.canEnterTextEdit
                      ? 'Edit text'
                      : 'Select a text box or callout to edit its text'}
                    aria-label="Edit text"
                    aria-pressed={!!bottomToolbarApi.richTextEditor}
                  >
                    Aa
                  </button>
                )}
                </>
              </div>
              </div>
            </div>
          )}
  
        </div>
  );
}

export function PDFRightRailChrome({
  isViewerVisible,
  bottomToolbarApi,
  isEditingRailPage,
  setIsEditingRailPage,
  isEditingRailZoom,
  setIsEditingRailZoom
}) {
  return (
          <div
            id="chrome-right-host"
            style={{
              display: isViewerVisible ? 'flex' : 'none',
              flexShrink: 0,
              width: '48px',
              alignSelf: 'stretch',
              background: '#252525',
              color: '#ddd',
              fontFamily: FONT_FAMILY,
              flexDirection: 'column',
              alignItems: 'center',
              padding: '8px 0',
              gap: '8px',
              position: 'relative',
              zIndex: 5500
            }}
          >
            {/* Spacer pushes the bottom slot to the bottom of the rail. */}
            <div style={{ flex: 1 }} />

            {/* Bottom slot — page nav above zoom controls. All handlers come
                from bottomToolbarApi which PDFViewer already publishes.
                UX 2026-05-14: Sizing matched to the Walkthrough reference
                app — smaller buttons (24-28px), 10px tabular-nums fonts,
                and a middle dot between current page and total instead of
                a slash. Tighter overall to fit the 48px-wide rail more
                neatly. */}
            {bottomToolbarApi && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                {/* Page previous — chevron up because vertical layout */}
                <button
                  onClick={bottomToolbarApi.goToPreviousPage}
                  disabled={bottomToolbarApi.pageNum <= 1}
                  title="Previous page"
                  style={{
                    width: '24px',
                    height: '24px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0,
                    background: 'transparent',
                    border: 'none',
                    borderRadius: '4px',
                    color: '#bbb',
                    cursor: bottomToolbarApi.pageNum <= 1 ? 'not-allowed' : 'pointer',
                    opacity: bottomToolbarApi.pageNum <= 1 ? 0.35 : 1
                  }}
                >
                  <Icon name="chevronUp" size={14} />
                </button>

                {/* Current page — Walkthrough-style: a plain accent-colored
                    number by default, click or double-click to edit. The
                    input only mounts while editing so the dot above and
                    total below stay perfectly centered around a single
                    number glyph. */}
                {isEditingRailPage ? (
                  <input
                    ref={bottomToolbarApi.pageInputRef}
                    type="text"
                    data-page-number-input
                    autoFocus
                    value={bottomToolbarApi.pageInputValue}
                    onChange={bottomToolbarApi.handlePageInputChange}
                    onKeyDown={(e) => {
                      bottomToolbarApi.handlePageInputKeyDown(e);
                      if (e.key === 'Enter' || e.key === 'Escape') {
                        setIsEditingRailPage(false);
                      }
                    }}
                    onBlur={(e) => {
                      bottomToolbarApi.handlePageInputBlur(e);
                      setIsEditingRailPage(false);
                    }}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    aria-label="Current page"
                    style={{
                      width: '28px',
                      padding: 0,
                      background: 'transparent',
                      color: '#4A90E2',
                      border: 'none',
                      fontSize: '11px',
                      fontFamily: FONT_FAMILY,
                      fontWeight: '600',
                      fontVariantNumeric: 'tabular-nums',
                      textAlign: 'center',
                      outline: 'none',
                      lineHeight: 1
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsEditingRailPage(true)}
                    onDoubleClick={() => setIsEditingRailPage(true)}
                    aria-label="Edit page number"
                    title="Click to jump to a page"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#4A90E2',
                      fontSize: '11px',
                      fontFamily: FONT_FAMILY,
                      fontWeight: '600',
                      fontVariantNumeric: 'tabular-nums',
                      padding: '1px 4px',
                      borderRadius: '3px',
                      cursor: 'pointer',
                      lineHeight: 1
                    }}
                  >
                    {bottomToolbarApi.pageNum}
                  </button>
                )}

                {/* Middle dot — sits between current page input above and
                    total page count below, matching the Walkthrough slim
                    rail convention. Tabular-nums on the total keeps "9"
                    and "99" centered identically. */}
                <span aria-hidden="true" style={{
                  color: '#888',
                  fontSize: '14px',
                  lineHeight: 0.5,
                  fontFamily: FONT_FAMILY
                }}>·</span>
                <span style={{
                  color: '#888',
                  fontSize: '10px',
                  fontFamily: FONT_FAMILY,
                  fontVariantNumeric: 'tabular-nums',
                  lineHeight: 1
                }}>
                  {bottomToolbarApi.numPages}
                </span>

                {/* Page next — chevron down */}
                <button
                  onClick={bottomToolbarApi.goToNextPage}
                  disabled={bottomToolbarApi.pageNum >= bottomToolbarApi.numPages}
                  title="Next page"
                  style={{
                    width: '24px',
                    height: '24px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0,
                    background: 'transparent',
                    border: 'none',
                    borderRadius: '4px',
                    color: '#bbb',
                    cursor: bottomToolbarApi.pageNum >= bottomToolbarApi.numPages ? 'not-allowed' : 'pointer',
                    opacity: bottomToolbarApi.pageNum >= bottomToolbarApi.numPages ? 0.35 : 1
                  }}
                >
                  <Icon name="chevronDown" size={14} />
                </button>

                {/* Divider between page nav and zoom — Walkthrough's
                    rail-collapsed divider style (1px tall, 32px wide). */}
                <div style={{ width: '32px', height: '1px', background: '#3a3a3a', margin: '4px 0' }} />

                {/* Zoom in (plus). 28×28 button, plain English '+' glyph so
                    the rail reads cleanly without leaning on the icon set
                    for character-based buttons. */}
                <button
                  onClick={bottomToolbarApi.zoomIn}
                  title="Zoom in"
                  style={{
                    width: '28px',
                    height: '28px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0,
                    background: 'transparent',
                    border: 'none',
                    borderRadius: '4px',
                    color: '#bbb',
                    fontSize: '16px',
                    lineHeight: 1,
                    cursor: 'pointer'
                  }}
                >
                  <Icon name="plus" size={14} />
                </button>

                {/* Zoom percentage — Walkthrough-style: shows the value as
                    "100%" with no input box by default, click swaps to an
                    editable input. Centered in the rail. The handlers
                    already clamp on commit (10%–500%) and during typing
                    (max 500%), matching the app's actual zoom range. */}
                {isEditingRailZoom ? (
                  <input
                    ref={bottomToolbarApi.zoomInputRef}
                    type="text"
                    autoFocus
                    value={bottomToolbarApi.zoomInputValue}
                    onChange={bottomToolbarApi.handleZoomInputChange}
                    onKeyDown={(e) => {
                      bottomToolbarApi.handleZoomInputKeyDown(e);
                      if (e.key === 'Enter' || e.key === 'Escape') {
                        setIsEditingRailZoom(false);
                      }
                    }}
                    onBlur={(e) => {
                      bottomToolbarApi.handleZoomInputBlur(e);
                      setIsEditingRailZoom(false);
                    }}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    aria-label="Zoom percentage"
                    style={{
                      width: '36px',
                      background: 'transparent',
                      color: '#bbb',
                      border: 'none',
                      padding: 0,
                      margin: 0,
                      fontSize: '10px',
                      fontFamily: FONT_FAMILY,
                      fontWeight: '500',
                      fontVariantNumeric: 'tabular-nums',
                      textAlign: 'center',
                      outline: 'none',
                      lineHeight: 1
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsEditingRailZoom(true)}
                    onDoubleClick={() => setIsEditingRailZoom(true)}
                    aria-label="Edit zoom percentage"
                    title="Click to type a zoom percentage"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#bbb',
                      fontSize: '10px',
                      fontFamily: FONT_FAMILY,
                      fontWeight: '500',
                      fontVariantNumeric: 'tabular-nums',
                      padding: '1px 4px',
                      borderRadius: '3px',
                      cursor: 'pointer',
                      lineHeight: 1,
                      textAlign: 'center'
                    }}
                  >
                    {bottomToolbarApi.zoomInputValue || Math.round((bottomToolbarApi.manualZoomScale || 1) * 100)}%
                  </button>
                )}

                {/* Zoom out (minus) */}
                <button
                  onClick={bottomToolbarApi.zoomOut}
                  title="Zoom out"
                  style={{
                    width: '28px',
                    height: '28px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0,
                    background: 'transparent',
                    border: 'none',
                    borderRadius: '4px',
                    color: '#bbb',
                    fontSize: '16px',
                    lineHeight: 1,
                    cursor: 'pointer'
                  }}
                >
                  <Icon name="minus" size={14} />
                </button>

                {/* Page-fit button — matches the Walkthrough slim-rail
                    pattern exactly: a 36×28 cell with the current fit
                    mode's icon centered (page / width / height SVG) and
                    a small left-pointing chevron pinned to the left edge
                    indicating the popup expands to the LEFT. Popup width
                    144 px, anchored to the rail's left edge. */}
                {(() => {
                  const mode = bottomToolbarApi.zoomMode;
                  // Fall back to fit-page icon when mode is MANUAL or unknown.
                  const iconMode = (mode === ZOOM_MODES.FIT_WIDTH || mode === ZOOM_MODES.FIT_HEIGHT) ? mode : ZOOM_MODES.FIT_PAGE;
                  const renderFitIcon = (m) => {
                    const stroke = {
                      fill: 'none',
                      stroke: 'currentColor',
                      strokeLinecap: 'round',
                      strokeLinejoin: 'round',
                      strokeWidth: 1.7
                    };
                    if (m === ZOOM_MODES.FIT_WIDTH) {
                      return (
                        <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: '16px', height: '16px' }}>
                          <rect x="4" y="5" width="16" height="14" rx="1.5" {...stroke} />
                          <path d="M7 12h10M7 12l3-3M7 12l3 3M17 12l-3-3M17 12l-3 3" {...stroke} />
                        </svg>
                      );
                    }
                    if (m === ZOOM_MODES.FIT_HEIGHT) {
                      return (
                        <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: '16px', height: '16px' }}>
                          <rect x="5" y="4" width="14" height="16" rx="1.5" {...stroke} />
                          <path d="M12 7v10M12 7l-3 3M12 7l3 3M12 17l-3-3M12 17l3-3" {...stroke} />
                        </svg>
                      );
                    }
                    // fit-page (default)
                    return (
                      <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: '16px', height: '16px' }}>
                        <rect x="6" y="3" width="12" height="18" rx="1.5" {...stroke} />
                        <path d="M9 7h6M9 11h6M9 15h4" {...stroke} />
                      </svg>
                    );
                  };
                  return (
                    <div
                      ref={bottomToolbarApi.zoomMenuRef}
                      style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }}
                    >
                      <button
                        onClick={bottomToolbarApi.toggleZoomMenu}
                        aria-haspopup="listbox"
                        aria-expanded={bottomToolbarApi.isZoomMenuOpen}
                        aria-label="Fit options"
                        data-active={mode !== ZOOM_MODES.MANUAL}
                        title={`Page fit: ${bottomToolbarApi.zoomDropdownLabel}`}
                        style={{
                          position: 'relative',
                          width: '36px',
                          height: '28px',
                          padding: 0,
                          background: 'transparent',
                          border: 'none',
                          borderRadius: '2px',
                          color: mode !== ZOOM_MODES.MANUAL ? '#e0e0e0' : '#bbb',
                          cursor: 'pointer'
                        }}
                      >
                        {/* Left-edge chevron — points LEFT to signal the
                            popup expands leftward when clicked. */}
                        <svg
                          viewBox="0 0 12 12"
                          aria-hidden="true"
                          style={{
                            position: 'absolute',
                            left: '2px',
                            top: '50%',
                            width: '12px',
                            height: '12px',
                            transform: 'translateY(-50%)',
                            fill: 'none',
                            stroke: 'currentColor',
                            strokeLinecap: 'round',
                            strokeLinejoin: 'round',
                            strokeWidth: 1.8
                          }}
                        >
                          <path d="M7.5 2.5 4 6l3.5 3.5" />
                        </svg>
                        {/* Fit icon centered. */}
                        <span style={{
                          position: 'absolute',
                          left: '50%',
                          top: '50%',
                          transform: 'translate(-50%, -50%)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}>
                          {renderFitIcon(iconMode)}
                        </span>
                      </button>

                  {bottomToolbarApi.isZoomMenuOpen && (
                    <div
                      style={{
                        position: 'absolute',
                        bottom: 0,
                        right: '100%',
                        marginRight: '6px',
                        background: 'rgb(30, 30, 30)',
                        border: '1px solid #3a3a3a',
                        borderRadius: '2px',
                        boxShadow: '0 10px 24px rgba(0,0,0,0.45)',
                        width: '144px',
                        zIndex: 6000,
                        padding: '2px'
                      }}
                    >
                      {ZOOM_MODE_OPTIONS.map((option) => {
                        if (option.id === ZOOM_MODES.MANUAL) return null;
                        const isActive = option.id === bottomToolbarApi.zoomMode;
                        return (
                          <button
                            key={option.id}
                            onClick={() => bottomToolbarApi.handleZoomModeSelect(option.id)}
                            data-active={isActive}
                            style={{
                              width: '100%',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              padding: '6px 8px',
                              background: 'transparent',
                              border: 'none',
                              borderRadius: '2px',
                              textAlign: 'left',
                              cursor: 'pointer',
                              color: isActive ? '#e0e0e0' : '#bbb',
                              fontSize: '11px',
                              fontFamily: FONT_FAMILY
                            }}
                          >
                            {renderFitIcon(option.id)}
                            <span>{option.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                  );
                })()}
              </div>
            )}
          </div>

  );
}
