import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icons';
import { ARROWHEAD_STYLE_LABELS } from '../components/Callout/types';
import { ZOOM_MODE_OPTIONS } from '../viewerShared';
import { getMobileSyncPresentation, normalizeMobilePresence } from './mobilePdfViewerModel.js';
import './mobilePdfViewer.css';

const TOOL_GROUPS = {
  draw: {
    label: 'Draw',
    icon: 'pen',
    fallback: 'pen',
    tools: [
      { id: 'pen', label: 'Pen', icon: 'pen' },
      { id: 'highlighter', label: 'Highlighter', icon: 'highlighter' },
      { id: 'eraser', label: 'Eraser', icon: 'eraser' },
    ],
  },
  shape: {
    label: 'Shapes',
    icon: 'rect',
    fallback: 'rect',
    tools: [
      { id: 'rect', label: 'Rectangle', icon: 'rect' },
      { id: 'ellipse', label: 'Ellipse', icon: 'ellipse' },
      { id: 'line', label: 'Line', icon: 'line' },
      { id: 'arrow', label: 'Arrow', icon: 'arrow' },
      { id: 'counter', label: 'Counter', icon: 'counter' },
    ],
  },
  review: {
    label: 'Text',
    icon: 'text',
    fallback: 'text',
    tools: [
      { id: 'text', label: 'Text', icon: 'text' },
      { id: 'callout', label: 'Callout', icon: 'callout' },
    ],
  },
};

const TOOL_TO_GROUP = Object.entries(TOOL_GROUPS).reduce((result, [groupId, group]) => {
  group.tools.forEach((tool) => {
    result[tool.id] = groupId;
  });
  return result;
}, {});

const WIDTH_TOOLS = new Set(['pen', 'highlighter', 'rect', 'ellipse', 'line', 'arrow', 'text', 'callout', 'counter']);
const FILL_TOOLS = new Set(['rect', 'ellipse', 'text', 'callout', 'counter']);
const BORDER_STYLE_TOOLS = new Set(['rect', 'ellipse', 'line', 'arrow', 'text', 'callout']);
const MOBILE_ARROWHEAD_STYLE_LABELS = {
  ...ARROWHEAD_STYLE_LABELS,
  solidTriangle: 'Solid Triangle',
  vShape: 'V-Shape',
  openCircle: 'Open Circle',
  openTriangle: 'Open Triangle',
  horizontalLine: 'Horizontal Line',
};

const MOBILE_ANNOTATION_COLORS = [
  '#ff0000',
  '#4A90E2',
  '#27C07D',
  '#F4D35E',
  '#ffffff',
  '#1e293b',
  '#C7A7FF',
  '#FF8A3D',
  '#000000',
];

const categoryGlyph = (name) => {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length > 1) return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
  return (parts[0] || '?').slice(0, 2).toUpperCase();
};

const toHexColor = (value, fallback = '#d8a84e') => {
  const source = String(value || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(source)) return source;
  if (/^#[0-9a-f]{3}$/i.test(source)) {
    return `#${source.slice(1).split('').map((char) => `${char}${char}`).join('')}`;
  }
  const rgb = source.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!rgb) return fallback;
  return `#${rgb.slice(1, 4).map((part) => Math.max(0, Math.min(255, Number(part))).toString(16).padStart(2, '0')).join('')}`;
};

const RailButton = ({ active = false, disabled = false, icon, label, onClick, children }) => (
  <button
    type="button"
    className={`mobile-pdf-tools__button${active ? ' is-active' : ''}`}
    aria-label={label}
    title={label}
    disabled={disabled}
    onClick={onClick}
  >
    {children || <Icon name={icon} size={19} color="currentColor" />}
  </button>
);

function MobileTextAlignmentGlyph({ axis, value, active }) {
  const stroke = active ? '#F4F7FB' : '#D8DEE9';
  const common = {
    stroke,
    strokeWidth: 6,
    strokeLinecap: 'round',
  };

  if (axis === 'horizontal') {
    const leftContent = (
      <>
        <line x1="48" y1="44" x2="48" y2="212" {...common} />
        <rect x="70" y="62" width="150" height="34" rx="8" fill="#d8a84e" />
        <rect x="70" y="111" width="76" height="34" rx="8" fill="#e8d5a8" />
        <rect x="70" y="160" width="116" height="34" rx="8" fill="#d8a84e" />
      </>
    );
    return (
      <svg width="48" height="34" viewBox="0 0 256 256" aria-hidden="true">
        {value === 0 && leftContent}
        {value === 1 && (
          <>
            <line x1="128" y1="44" x2="128" y2="212" {...common} />
            <rect x="53" y="62" width="150" height="34" rx="8" fill="#d8a84e" />
            <rect x="91" y="111" width="74" height="34" rx="8" fill="#e8d5a8" />
            <rect x="72" y="160" width="112" height="34" rx="8" fill="#d8a84e" />
          </>
        )}
        {value === 2 && <g transform="translate(256 0) scale(-1 1)">{leftContent}</g>}
      </svg>
    );
  }

  return (
    <svg width="48" height="34" viewBox="0 0 256 256" aria-hidden="true">
      {value === 0 && (
        <>
          <rect x="53" y="66" width="150" height="34" rx="8" fill="#d8a84e" />
          <line x1="128" y1="130" x2="128" y2="202" {...common} />
          <path d="M128 130 L105 153 M128 130 L151 153" fill="none" {...common} strokeLinejoin="round" />
        </>
      )}
      {value === 1 && (
        <>
          <rect x="53" y="111" width="150" height="34" rx="8" fill="#d8a84e" />
          <line x1="128" y1="40" x2="128" y2="82" {...common} />
          <path d="M128 82 L105 59 M128 82 L151 59" fill="none" {...common} strokeLinejoin="round" />
          <line x1="128" y1="174" x2="128" y2="216" {...common} />
          <path d="M128 174 L105 197 M128 174 L151 197" fill="none" {...common} strokeLinejoin="round" />
        </>
      )}
      {value === 2 && (
        <>
          <line x1="128" y1="48" x2="128" y2="120" {...common} />
          <path d="M128 120 L105 97 M128 120 L151 97" fill="none" {...common} strokeLinejoin="round" />
          <rect x="53" y="156" width="150" height="34" rx="8" fill="#d8a84e" />
        </>
      )}
    </svg>
  );
}

export function MobilePdfViewerHeader({ id, documentName, onBack, topToolbarApi, bottomToolbarApi }) {
  const [pageMenuOpen, setPageMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!pageMenuOpen) return undefined;
    const close = (event) => {
      if (!menuRef.current?.contains(event.target)) setPageMenuOpen(false);
    };
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [pageMenuOpen]);

  return (
    <header id={id} className="mobile-pdf-header" data-mobile-pdf-header="true">
      <div className="mobile-pdf-header__document">
        <button type="button" className="mobile-pdf-header__icon" aria-label="Back to documents" onClick={onBack}>
          <Icon name="chevronLeft" size={21} color="currentColor" />
        </button>
        <button
          type="button"
          className="mobile-pdf-header__title"
          title={documentName || 'Document'}
          aria-label="Document page and zoom options"
          aria-expanded={pageMenuOpen}
          onClick={() => setPageMenuOpen((open) => !open)}
        >
          {documentName || 'Document'}
        </button>
      </div>

      <div className="mobile-pdf-header__pages" ref={menuRef}>
        <button
          type="button"
          className={`mobile-pdf-header__page-pill${pageMenuOpen ? ' is-open' : ''}`}
          aria-label="Page and zoom options"
          aria-expanded={pageMenuOpen}
          onClick={() => setPageMenuOpen((open) => !open)}
        >
          <span>{bottomToolbarApi?.pageNum || 1}</span>
          <span className="mobile-pdf-header__page-total">/ {bottomToolbarApi?.numPages || 1}</span>
          <Icon name="chevronDown" size={11} color="currentColor" />
        </button>

        {pageMenuOpen && bottomToolbarApi && (
          <div className="mobile-pdf-header__page-menu">
            <div className="mobile-pdf-header__page-jump">
              <button
                type="button"
                aria-label="Previous page"
                disabled={bottomToolbarApi.pageNum <= 1}
                onClick={bottomToolbarApi.goToPreviousPage}
              >
                <Icon name="chevronLeft" size={16} color="currentColor" />
              </button>
              <input
                aria-label="Page number"
                inputMode="numeric"
                value={bottomToolbarApi.pageInputValue}
                onChange={bottomToolbarApi.handlePageInputChange}
                onKeyDown={bottomToolbarApi.handlePageInputKeyDown}
                onBlur={bottomToolbarApi.handlePageInputBlur}
              />
              <span>of {bottomToolbarApi.numPages}</span>
              <button
                type="button"
                aria-label="Next page"
                disabled={bottomToolbarApi.pageNum >= bottomToolbarApi.numPages}
                onClick={bottomToolbarApi.goToNextPage}
              >
                <Icon name="chevronRight" size={16} color="currentColor" />
              </button>
            </div>
            {ZOOM_MODE_OPTIONS.map((option) => (
              <button
                type="button"
                key={option.id}
                className={bottomToolbarApi.zoomMode === option.id ? 'is-active' : ''}
                onClick={() => {
                  bottomToolbarApi.handleZoomModeSelect(option.id);
                  setPageMenuOpen(false);
                }}
              >
                <span>{option.label}</span>
                {bottomToolbarApi.zoomMode === option.id && <Icon name="check" size={14} color="currentColor" />}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mobile-pdf-header__history">
        <button
          type="button"
          className="mobile-pdf-header__icon"
          aria-label="Undo"
          disabled={!topToolbarApi?.canUndo}
          onClick={topToolbarApi?.onUndo || undefined}
        >
          <Icon name="undo2" size={17} color="currentColor" />
        </button>
        <button
          type="button"
          className="mobile-pdf-header__icon"
          aria-label="Redo"
          disabled={!topToolbarApi?.canRedo}
          onClick={topToolbarApi?.onRedo || undefined}
        >
          <Icon name="redo2" size={17} color="currentColor" />
        </button>
      </div>
    </header>
  );
}

function MobileToolProperties({ api }) {
  const [counterMenuOpen, setCounterMenuOpen] = useState(false);
  const [colorMenuOpen, setColorMenuOpen] = useState(false);
  const [textDefaultsOpen, setTextDefaultsOpen] = useState(false);
  const [textDefaultsTab, setTextDefaultsTab] = useState('text');
  const [textShapeColorSection, setTextShapeColorSection] = useState('fill');
  const counterMenuRef = useRef(null);
  const colorMenuRef = useRef(null);
  const tool = api?.contextTool || api?.activeTool;

  useEffect(() => {
    if (tool !== 'counter') setCounterMenuOpen(false);
    setColorMenuOpen(false);
    if (tool !== 'text' && tool !== 'callout') setTextDefaultsOpen(false);
  }, [tool]);

  useEffect(() => {
    if (!counterMenuOpen && !colorMenuOpen) return undefined;
    const close = (event) => {
      if (!counterMenuRef.current?.contains(event.target)) setCounterMenuOpen(false);
      if (!colorMenuRef.current?.contains(event.target)) setColorMenuOpen(false);
    };
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [colorMenuOpen, counterMenuOpen]);

  if (!api) return null;

  if (api.regionEditing && api.regionToolbarApi) {
    const region = api.regionToolbarApi;
    // UX (demo parity): tapping "Full Page" swaps this strip into an inline
    // "Make region full page?" Confirm/Cancel step instead of a browser
    // dialog — matches demo App.tsx:1644-1658 / AnnotationFormattingBar.tsx:195-207.
    if (region.fullPageConfirmPending) {
      return (
        <div className="mobile-pdf-properties mobile-pdf-properties--actions" data-mobile-tool-properties="true" role="toolbar" aria-label="Confirm full page region">
          <span className="mobile-pdf-properties__confirm-label">Make region full page?</span>
          <button type="button" className="mobile-pdf-properties__primary" onClick={region.confirmFullPage}>Confirm</button>
          <button type="button" onClick={region.cancelFullPage}>Cancel</button>
        </div>
      );
    }
    return (
      <div className="mobile-pdf-properties mobile-pdf-properties--actions" data-mobile-tool-properties="true" role="toolbar" aria-label="Region editing">
        <button type="button" className="mobile-pdf-properties__primary" onClick={region.confirm}>Confirm</button>
        <button type="button" disabled={!region.canSetFullPage} onClick={region.setFullPage}>Full Page</button>
        <button type="button" onClick={region.cancel}>Cancel</button>
      </div>
    );
  }

  if (
    api.showSurveyPanel
    && api.surveyToolbar
    && ['survey-marker', 'pan', 'select'].includes(api.activeTool)
    && (!api.contextTool || api.contextTool === api.activeTool)
  ) {
    const survey = api.surveyToolbar;
    return (
      <div className="mobile-pdf-properties mobile-pdf-properties--survey" data-mobile-tool-properties="true" role="toolbar" aria-label="Survey placement">
        <select
          aria-label="Survey module"
          value={survey.selectedModuleId || ''}
          disabled={!survey.modules?.length}
          onChange={(event) => survey.onSelectModule?.(event.target.value)}
        >
          {!survey.modules?.length && <option value="">No modules</option>}
          {(survey.modules || []).map((module) => (
            <option key={module.id} value={module.id}>{module.name || 'Untitled Module'}</option>
          ))}
        </select>
        <button
          type="button"
          className={`mobile-pdf-properties__keep${survey.keepCategoryActive ? ' is-active' : ''}`}
          role="checkbox"
          aria-checked={Boolean(survey.keepCategoryActive)}
          onClick={() => survey.onKeepCategoryActiveChange?.(!survey.keepCategoryActive)}
        >
          <span aria-hidden="true">{survey.keepCategoryActive ? '✓' : ''}</span>
          Keep active
        </button>
      </div>
    );
  }

  if (api.richTextEditor) {
    const editor = api.richTextEditor;
    const state = editor.state || {};
    const editorApi = editor.api || {};
    const alignment = `${state.verticalAlign || 'top'}|${state.textAlign || 'left'}`;
    return (
      <div className="mobile-pdf-properties mobile-pdf-properties--text" data-mobile-tool-properties="true" role="toolbar" aria-label="Text formatting">
        <label className="mobile-pdf-properties__color" title="Font color">
          <span style={{ background: toHexColor(state.fontColor, '#1e293b') }} />
          <input type="color" aria-label="Font color" value={toHexColor(state.fontColor, '#1e293b')} onChange={(event) => editorApi.setFontColor?.(event.target.value)} />
        </label>
        <select aria-label="Font" value={state.fontFamily || 'Arial'} onChange={(event) => editorApi.setFontFamily?.(event.target.value)}>
          {['Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana'].map((family) => <option key={family} value={family}>{family}</option>)}
        </select>
        <input
          className="mobile-pdf-properties__font-size"
          aria-label="Font size"
          inputMode="numeric"
          value={state.fontSize ?? 16}
          onChange={(event) => {
            const size = Number.parseInt(event.target.value, 10);
            if (Number.isFinite(size)) editorApi.setFontSize?.(Math.max(1, Math.min(200, size)));
          }}
        />
        {[
          ['B', 'bold', 'toggleBold', 'Bold'],
          ['I', 'italic', 'toggleItalic', 'Italic'],
          ['U', 'underline', 'toggleUnderline', 'Underline'],
          ['S', 'strike', 'toggleStrike', 'Strikethrough'],
        ].map(([label, stateKey, method, title]) => (
          <button
            key={stateKey}
            type="button"
            className={`mobile-pdf-properties__format${state[stateKey] ? ' is-active' : ''}`}
            aria-label={title}
            aria-pressed={Boolean(state[stateKey])}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => editorApi[method]?.()}
          >
            {label}
          </button>
        ))}
        <select
          aria-label="Text alignment"
          value={alignment}
          onChange={(event) => {
            const [vertical, horizontal] = event.target.value.split('|');
            editorApi.setTextAlign?.(horizontal);
            editorApi.setVerticalAlign?.(vertical);
          }}
        >
          {['top', 'middle', 'bottom'].flatMap((vertical) => ['left', 'center', 'right'].map((horizontal) => (
            <option key={`${vertical}|${horizontal}`} value={`${vertical}|${horizontal}`}>{vertical} {horizontal}</option>
          )))}
        </select>
      </div>
    );
  }

  if (api.activeTool === 'pan' || (api.activeTool === 'select' && (!api.contextTool || api.contextTool === 'select'))) return null;

  const isEraser = tool === 'eraser';
  const showWidth = isEraser || WIDTH_TOOLS.has(tool);
  const showFill = FILL_TOOLS.has(tool) && typeof api.handleFillColorChange === 'function';
  const showBorderStyle = BORDER_STYLE_TOOLS.has(tool) && typeof api.setLineBorderStyle === 'function';
  const showArrowhead = (tool === 'arrow' || tool === 'callout') && typeof api.setArrowheadStyle === 'function';
  const showStroke = !isEraser && (WIDTH_TOOLS.has(tool) || FILL_TOOLS.has(tool));

  if (!isEraser && !showStroke && !showFill && !showBorderStyle && !showArrowhead) return null;

  const textDefaults = api.textStyleDefaults || {
    fontColor: '#1e293b',
    fontFamily: 'Arial',
    fontSize: 16,
    bold: true,
    italic: false,
    underline: false,
    strike: false,
    textAlign: 'left',
    verticalAlign: 'top',
  };
  const updateTextDefaults = (patch) => api.onTextStyleDefaultsChange?.({ ...textDefaults, ...patch });
  const textPanelTitle = tool === 'callout' ? 'Callout' : 'Text';
  const shapeColor = textShapeColorSection === 'fill'
    ? toHexColor(api.fillColor, '#ffffff')
    : toHexColor(api.strokeColor, '#ff0000');
  const applyShapeColor = (color) => {
    if (textShapeColorSection === 'fill') api.handleFillColorChange?.(color);
    else api.handleStrokeColorChange?.(color);
  };

  return (
    <>
    <div className="mobile-pdf-properties" data-mobile-tool-properties="true" role="toolbar" aria-label={`${tool || 'Annotation'} formatting`}>
      {isEraser && api.setEraserMode && (
        <select
          aria-label="Eraser mode"
          value={api.eraserMode || 'partial'}
          onChange={(event) => api.setEraserMode(event.target.value)}
        >
          <option value="partial">Partial Erase</option>
          <option value="entire">Full Stroke</option>
        </select>
      )}
      {!isEraser && showStroke && (
        <div className="mobile-pdf-properties__color-anchor" ref={colorMenuRef}>
          {showFill ? (
            <button
              type="button"
              className={`mobile-pdf-properties__swatch${tool === 'counter' ? ' is-counter' : ''}`}
              aria-label={tool === 'counter' ? 'Counter colors' : 'Fill and border colors'}
              aria-expanded={colorMenuOpen}
              style={{
                '--mobile-swatch-fill': toHexColor(api.fillColor, '#ff0000'),
                '--mobile-swatch-stroke': toHexColor(api.strokeColor, '#ff0000'),
              }}
              onClick={() => setColorMenuOpen((open) => !open)}
            >
              {tool === 'counter' ? '1' : null}
            </button>
          ) : (
            <label className="mobile-pdf-properties__swatch" title="Color" style={{ '--mobile-swatch-fill': toHexColor(api.strokeColor, '#ff0000') }}>
              <input
                type="color"
                aria-label="Color"
                value={toHexColor(api.strokeColor, '#ff0000')}
                onChange={(event) => api.handleStrokeColorChange?.(event.target.value)}
              />
            </label>
          )}
          {colorMenuOpen && showFill && (
            <div className="mobile-pdf-properties__color-menu">
              <label>
                <span>{tool === 'counter' ? 'Pin fill' : 'Fill'}</span>
                <input
                  type="color"
                  aria-label={tool === 'counter' ? 'Counter fill color' : 'Fill color'}
                  value={toHexColor(api.fillColor, '#ff0000')}
                  onChange={(event) => api.handleFillColorChange?.(event.target.value)}
                />
              </label>
              <label>
                <span>{tool === 'counter' ? 'Pin number' : 'Stroke'}</span>
                <input
                  type="color"
                  aria-label={tool === 'counter' ? 'Counter number color' : 'Stroke color'}
                  value={toHexColor(api.strokeColor, '#ff0000')}
                  onChange={(event) => api.handleStrokeColorChange?.(event.target.value)}
                />
              </label>
            </div>
          )}
        </div>
      )}
      {showWidth && tool !== 'counter' && (
        <label className="mobile-pdf-properties__number">
          <input
            aria-label={isEraser ? 'Eraser size' : 'Stroke width'}
            inputMode="decimal"
            value={isEraser ? api.eraserSizeInputValue : api.strokeWidthInputValue}
            onChange={isEraser ? api.handleEraserSizeInputChange : api.handleStrokeWidthInputChange}
            onFocus={() => isEraser ? api.setIsEraserSizeFocused?.(true) : api.setIsStrokeWidthFocused?.(true)}
            onBlur={isEraser ? api.handleEraserSizeInputBlur : api.handleStrokeWidthInputBlur}
          />
        </label>
      )}
      {tool === 'counter' && (
        <div className="mobile-pdf-properties__menu-anchor" ref={counterMenuRef}>
          <button
            type="button"
            className="mobile-pdf-properties__text-button"
            aria-expanded={counterMenuOpen}
            onClick={() => setCounterMenuOpen((open) => !open)}
          >
            {(api.counterSeriesList || []).find((series) => series.seriesId === api.activeCounterSeriesId)?.label || 'Counter Series'}
          </button>
          {counterMenuOpen && (
            <div className="mobile-pdf-properties__menu">
              <strong>Counter Series</strong>
              <button type="button" onClick={() => { api.onNewCounterSeries?.(); setCounterMenuOpen(false); }}>+ New Count</button>
              {!!api.counterSeriesList?.length && <span>Continue Count</span>}
              {(api.counterSeriesList || []).map((series) => (
                <button
                  type="button"
                  key={series.seriesId}
                  className={series.seriesId === api.activeCounterSeriesId ? 'is-active' : ''}
                  onClick={() => { api.onSwitchCounterSeries?.(series.seriesId); setCounterMenuOpen(false); }}
                >
                  <i style={{ background: series.color }} />
                  <b>{series.label}</b>
                  <em>{series.count}</em>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {showWidth && tool === 'counter' && (
        <label className="mobile-pdf-properties__number">
          <input
            aria-label="Stroke width"
            inputMode="decimal"
            value={api.strokeWidthInputValue}
            onChange={api.handleStrokeWidthInputChange}
            onFocus={() => api.setIsStrokeWidthFocused?.(true)}
            onBlur={api.handleStrokeWidthInputBlur}
          />
        </label>
      )}
      {showBorderStyle && (
        <select
          aria-label="Border style"
          value={api.lineBorderStyle || 'solid'}
          onChange={(event) => api.setLineBorderStyle(event.target.value)}
        >
          <option value="solid">Solid</option>
          <option value="dashed">Dashed</option>
          <option value="dotted">Dotted</option>
          {tool === 'rect' && <option value="cloud">Cloud</option>}
        </select>
      )}
      {tool === 'rect' && api.lineBorderStyle === 'cloud' && api.setCloudIntensity && (
        <label className="mobile-pdf-properties__bump">
          <span>Bump</span>
          <input
            aria-label="Cloud bump size"
            inputMode="numeric"
            value={api.cloudIntensity ?? 2}
            onChange={(event) => {
              const value = Number.parseInt(event.target.value, 10);
              if (Number.isFinite(value)) api.setCloudIntensity(Math.max(1, Math.min(20, value)));
            }}
          />
        </label>
      )}
      {showArrowhead && (
        <select
          aria-label="Arrowhead style"
          value={api.arrowheadStyle || 'solidTriangle'}
          onChange={(event) => api.setArrowheadStyle(event.target.value)}
        >
          {Object.entries(MOBILE_ARROWHEAD_STYLE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      )}
      {api.onEnterTextEdit && (tool === 'text' || tool === 'callout' || api.richTextEditor) && (
        <button
          type="button"
          className={`mobile-pdf-properties__edit${api.richTextEditor ? ' is-active' : ''}`}
          aria-label="Text formatting"
          aria-expanded={textDefaultsOpen}
          onClick={() => {
            if (api.canEnterTextEdit || api.richTextEditor) api.onEnterTextEdit();
            else {
              setTextDefaultsTab('text');
              setTextDefaultsOpen(true);
            }
          }}
        >
          Aa
        </button>
      )}
    </div>
    {textDefaultsOpen && typeof document !== 'undefined' && createPortal(
      <>
        <button
          type="button"
          className="mobile-pdf-sheet-backdrop"
          aria-label="Close text formatting"
          onClick={() => setTextDefaultsOpen(false)}
        />
        <section
          className={`mobile-pdf-text-defaults is-${textDefaultsTab}${tool === 'callout' ? ' is-callout' : ''}`}
          aria-label={`${textPanelTitle} settings`}
        >
          <div className="mobile-pdf-sheet__handle" aria-hidden="true" />
          <header>
            <div>
              <strong>{textPanelTitle} settings</strong>
              <span>Focused on {textDefaultsTab === 'text' ? 'Text' : 'Shape'}</span>
            </div>
            <button type="button" aria-label="Close annotation settings" onClick={() => setTextDefaultsOpen(false)}>
              <Icon name="close" size={17} color="currentColor" />
            </button>
          </header>
          <div className="mobile-pdf-text-defaults__tabs" role="tablist" aria-label="Annotation settings section">
            <button
              type="button"
              role="tab"
              aria-label="Shape settings"
              aria-selected={textDefaultsTab === 'shape'}
              className={textDefaultsTab === 'shape' ? 'is-active' : ''}
              onClick={() => setTextDefaultsTab('shape')}
            >
              Shape
            </button>
            <span aria-hidden="true" />
            <button
              type="button"
              role="tab"
              aria-label="Text settings"
              aria-selected={textDefaultsTab === 'text'}
              className={textDefaultsTab === 'text' ? 'is-active' : ''}
              onClick={() => setTextDefaultsTab('text')}
            >
              Text
            </button>
          </div>
          <div className="mobile-pdf-text-defaults__scroll">
            {textDefaultsTab === 'text' ? (
              <>
                <section className="mobile-pdf-text-card mobile-pdf-text-card--color mobile-pdf-text-card--text-color">
                  <div className="mobile-pdf-text-card__header">
                    <div>
                      <strong>Text color</strong>
                      <span>{toHexColor(textDefaults.fontColor, '#1e293b').toUpperCase()}</span>
                    </div>
                    <label className="mobile-pdf-text-card__large-swatch" style={{ '--mobile-text-color': toHexColor(textDefaults.fontColor, '#1e293b') }}>
                      <input
                        type="color"
                        aria-label="Open Text color picker"
                        value={toHexColor(textDefaults.fontColor, '#1e293b')}
                        onChange={(event) => updateTextDefaults({ fontColor: event.target.value })}
                      />
                    </label>
                  </div>
                  <div className="mobile-pdf-text-card__colors">
                    {MOBILE_ANNOTATION_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        aria-label={`Set Text color ${color}`}
                        aria-pressed={color.toLowerCase() === toHexColor(textDefaults.fontColor, '#1e293b').toLowerCase()}
                        className={color.toLowerCase() === toHexColor(textDefaults.fontColor, '#1e293b').toLowerCase() ? 'is-active' : ''}
                        onClick={() => updateTextDefaults({ fontColor: color })}
                      >
                        <span style={{ backgroundColor: color }} />
                      </button>
                    ))}
                  </div>
                </section>

                <section className="mobile-pdf-text-card mobile-pdf-text-card--split">
                  <div className="mobile-pdf-text-card__pane">
                    <strong>Text formatting</strong>
                    <div className="mobile-pdf-text-defaults__format" role="toolbar" aria-label="Text formatting">
                      {[
                        ['B', 'bold', 'Bold'],
                        ['I', 'italic', 'Italic'],
                        ['U', 'underline', 'Underline'],
                        ['S', 'strike', 'Strikethrough'],
                      ].map(([label, key, title]) => (
                        <button
                          key={key}
                          type="button"
                          className={`${key}${textDefaults[key] ? ' is-active' : ''}`}
                          aria-label={title}
                          aria-pressed={Boolean(textDefaults[key])}
                          onClick={() => updateTextDefaults({ [key]: !textDefaults[key] })}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <span className="mobile-pdf-text-card__divider" aria-hidden="true" />
                  <label className="mobile-pdf-text-card__pane mobile-pdf-text-card__size">
                    <strong>Text size</strong>
                    <input
                      inputMode="numeric"
                      aria-label="Font size"
                      value={textDefaults.fontSize ?? 16}
                      onChange={(event) => {
                        const fontSize = Number.parseInt(event.target.value, 10);
                        if (Number.isFinite(fontSize)) updateTextDefaults({ fontSize: Math.max(1, Math.min(200, fontSize)) });
                      }}
                    />
                  </label>
                </section>

                <section className="mobile-pdf-text-card mobile-pdf-text-card--alignment">
                  <strong>Text alignment</strong>
                  <div className="mobile-pdf-text-defaults__alignments" role="toolbar" aria-label="Text alignment">
                    {['left', 'center', 'right'].map((alignment) => (
                      <button
                        key={alignment}
                        type="button"
                        aria-label={`${alignment[0].toUpperCase()}${alignment.slice(1)} horizontal alignment`}
                        aria-pressed={(textDefaults.textAlign || 'left') === alignment}
                        className={(textDefaults.textAlign || 'left') === alignment ? 'is-active' : ''}
                        onClick={() => updateTextDefaults({ textAlign: alignment })}
                      >
                        <MobileTextAlignmentGlyph axis="horizontal" value={['left', 'center', 'right'].indexOf(alignment)} active={(textDefaults.textAlign || 'left') === alignment} />
                      </button>
                    ))}
                  </div>
                  <div className="mobile-pdf-text-defaults__alignments" role="toolbar" aria-label="Vertical text alignment">
                    {['top', 'middle', 'bottom'].map((alignment) => (
                      <button
                        key={alignment}
                        type="button"
                        aria-label={`${alignment === 'middle' ? 'Center' : `${alignment[0].toUpperCase()}${alignment.slice(1)}`} vertical alignment`}
                        aria-pressed={(textDefaults.verticalAlign || 'top') === alignment}
                        className={(textDefaults.verticalAlign || 'top') === alignment ? 'is-active' : ''}
                        onClick={() => updateTextDefaults({ verticalAlign: alignment })}
                      >
                        <MobileTextAlignmentGlyph axis="vertical" value={['top', 'middle', 'bottom'].indexOf(alignment)} active={(textDefaults.verticalAlign || 'top') === alignment} />
                      </button>
                    ))}
                  </div>
                </section>
              </>
            ) : (
              <>
                <section className="mobile-pdf-text-card mobile-pdf-text-card--color mobile-pdf-text-card--shape-color">
                  <div className="mobile-pdf-text-card__color-tabs" role="tablist" aria-label="Shape color section">
                    {['fill', 'stroke'].map((section) => (
                      <button
                        key={section}
                        type="button"
                        role="tab"
                        aria-label={`${section === 'fill' ? 'Fill' : 'Stroke'} color`}
                        aria-selected={textShapeColorSection === section}
                        className={textShapeColorSection === section ? 'is-active' : ''}
                        onClick={() => setTextShapeColorSection(section)}
                      >
                        <i style={{ backgroundColor: section === 'fill' ? toHexColor(api.fillColor, '#ffffff') : toHexColor(api.strokeColor, '#ff0000') }} />
                        {section === 'fill' ? 'Fill' : 'Stroke'}
                      </button>
                    ))}
                  </div>
                  <div className="mobile-pdf-text-card__header">
                    <div>
                      <strong>{textShapeColorSection === 'fill' ? 'Fill' : 'Stroke'} color</strong>
                      <span>{shapeColor.toUpperCase()}</span>
                    </div>
                    <label className="mobile-pdf-text-card__large-swatch" style={{ '--mobile-text-color': shapeColor }}>
                      <input type="color" aria-label={`Open ${textShapeColorSection} color picker`} value={shapeColor} onChange={(event) => applyShapeColor(event.target.value)} />
                    </label>
                  </div>
                  <div className="mobile-pdf-text-card__colors">
                    {MOBILE_ANNOTATION_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        aria-label={`Set ${textShapeColorSection === 'fill' ? 'Fill' : 'Stroke'} color ${color}`}
                        aria-pressed={color.toLowerCase() === shapeColor.toLowerCase()}
                        className={color.toLowerCase() === shapeColor.toLowerCase() ? 'is-active' : ''}
                        onClick={() => applyShapeColor(color)}
                      >
                        <span style={{ backgroundColor: color }} />
                      </button>
                    ))}
                  </div>
                </section>

                <section className="mobile-pdf-text-card mobile-pdf-text-card--split">
                  <label className="mobile-pdf-text-card__pane">
                    <strong>Stroke style</strong>
                    <select aria-label="Stroke style" value={api.lineBorderStyle || 'solid'} onChange={(event) => api.setLineBorderStyle?.(event.target.value)}>
                      <option value="solid">Solid</option>
                      <option value="dashed">Dashed</option>
                      <option value="dotted">Dotted</option>
                    </select>
                  </label>
                  <span className="mobile-pdf-text-card__divider" aria-hidden="true" />
                  <label className="mobile-pdf-text-card__pane mobile-pdf-text-card__size">
                    <strong>Stroke width</strong>
                    <input
                      inputMode="decimal"
                      aria-label="Stroke width"
                      value={api.strokeWidthInputValue}
                      onChange={api.handleStrokeWidthInputChange}
                      onFocus={() => api.setIsStrokeWidthFocused?.(true)}
                      onBlur={api.handleStrokeWidthInputBlur}
                    />
                  </label>
                </section>

                {tool === 'callout' && (
                  <section className="mobile-pdf-text-card mobile-pdf-text-card--arrowhead">
                    <strong>Arrowhead</strong>
                    <select aria-label="Arrowhead" value={api.arrowheadStyle || 'solidTriangle'} onChange={(event) => api.setArrowheadStyle?.(event.target.value)}>
                      {Object.entries(MOBILE_ARROWHEAD_STYLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </section>
                )}
              </>
            )}
          </div>
        </section>
      </>,
      document.body
    )}
    </>
  );
}

export function MobilePdfViewerToolRail({ bottomToolbarApi, leftRailApi, onOpenPanel, onAuxPanelStateChange }) {
  const [openCategory, setOpenCategory] = useState(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [presenceOpen, setPresenceOpen] = useState(false);
  const popoverRef = useRef(null);
  const presenceUsers = useMemo(() => normalizeMobilePresence({
    presence: leftRailApi?.presence,
    currentUserId: leftRailApi?.currentUserId,
    currentUserEmail: leftRailApi?.currentUserEmail,
    currentUserDisplayName: leftRailApi?.currentUserDisplayName,
  }), [
    leftRailApi?.presence,
    leftRailApi?.currentUserId,
    leftRailApi?.currentUserEmail,
    leftRailApi?.currentUserDisplayName,
  ]);
  const sync = useMemo(() => getMobileSyncPresentation(
    leftRailApi?.cloudSyncStatus,
    leftRailApi?.cloudSyncQueueSize,
    leftRailApi?.cloudSyncEnabled !== false,
  ), [leftRailApi?.cloudSyncStatus, leftRailApi?.cloudSyncQueueSize, leftRailApi?.cloudSyncEnabled]);

  useEffect(() => {
    if (!moreOpen) return undefined;
    const close = (event) => {
      if (!popoverRef.current?.contains(event.target)) {
        setMoreOpen(false);
      }
    };
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [moreOpen]);

  const activeTool = bottomToolbarApi?.activeTool || 'pan';
  const activeGroup = TOOL_TO_GROUP[activeTool] || null;
  const userInitial = presenceUsers[0]?.initials || 'U';
  const presenceCount = Math.max(presenceUsers.length, 1);

  useEffect(() => {
    onAuxPanelStateChange?.(presenceOpen ? 'users' : null);
    return () => onAuxPanelStateChange?.(null);
  }, [onAuxPanelStateChange, presenceOpen]);

  useEffect(() => {
    if (activeGroup) {
      setOpenCategory(activeGroup);
    } else {
      setOpenCategory(null);
    }
  }, [activeGroup, activeTool]);

  const selectTool = (toolId) => {
    bottomToolbarApi?.setActiveTool?.(toolId);
    bottomToolbarApi?.setActiveCategoryDropdown?.(null);
  };

  const toggleCategory = (groupId) => {
    const group = TOOL_GROUPS[groupId];
    setOpenCategory(groupId);
    if (activeGroup !== groupId) {
      const preferred = groupId === 'draw'
        ? bottomToolbarApi?.lastDrawTool
        : groupId === 'shape'
          ? bottomToolbarApi?.lastShapeTool
          : bottomToolbarApi?.lastReviewTool;
      selectTool(preferred && TOOL_TO_GROUP[preferred] === groupId ? preferred : group.fallback);
    }
  };

  return (
    <>
      <aside className="mobile-pdf-tools" aria-label="Document tools">
        <div className="mobile-pdf-tools__main">
          <RailButton active={activeTool === 'pan'} icon="pan" label="Pan" onClick={() => { setOpenCategory(null); selectTool('pan'); }} />
          <RailButton active={activeTool === 'select'} icon="cursor" label="Select" onClick={() => { setOpenCategory(null); selectTool('select'); }} />
          <div className="mobile-pdf-tools__divider" />
          {Object.entries(TOOL_GROUPS).map(([groupId, group]) => (
            <RailButton
              key={groupId}
              active={activeGroup === groupId || openCategory === groupId}
              icon={group.icon}
              label={group.label}
              onClick={() => toggleCategory(groupId)}
            />
          ))}
          {openCategory && (
            <>
              <div className="mobile-pdf-tools__divider is-short" />
              <div className="mobile-pdf-tools__subtools">
                {TOOL_GROUPS[openCategory].tools.map((tool) => (
                  <RailButton
                    key={tool.id}
                    active={activeTool === tool.id}
                    icon={tool.icon}
                    label={tool.label}
                    onClick={() => selectTool(tool.id)}
                  />
                ))}
              </div>
            </>
          )}
          {bottomToolbarApi?.regionEditing && bottomToolbarApi?.regionToolbarApi && (
            <>
              <div className="mobile-pdf-tools__divider is-short" />
              <div className="mobile-pdf-tools__subtools" aria-label="Region tools">
                <RailButton
                  active={bottomToolbarApi.regionToolbarApi.toolType === 'rectangular'}
                  icon="rect"
                  label="Rectangular region"
                  onClick={() => bottomToolbarApi.regionToolbarApi.setToolType?.('rectangular')}
                />
                <RailButton
                  active={bottomToolbarApi.regionToolbarApi.toolType === 'freehand'}
                  icon="pen"
                  label="Freehand region"
                  onClick={() => bottomToolbarApi.regionToolbarApi.setToolType?.('freehand')}
                />
                <div className="mobile-pdf-tools__divider is-short" />
                <RailButton
                  active={bottomToolbarApi.regionToolbarApi.selectionMode === 'add'}
                  icon="plus"
                  label="Additive region mode"
                  onClick={() => bottomToolbarApi.regionToolbarApi.setSelectionMode?.('add')}
                />
                <RailButton
                  active={bottomToolbarApi.regionToolbarApi.selectionMode === 'subtract'}
                  icon="minus"
                  label="Subtractive region mode"
                  onClick={() => bottomToolbarApi.regionToolbarApi.setSelectionMode?.('subtract')}
                />
              </div>
            </>
          )}
          {bottomToolbarApi?.showSurveyPanel
            && bottomToolbarApi?.surveyToolbar
            && !bottomToolbarApi?.regionEditing
            && !!bottomToolbarApi.surveyToolbar.categories?.length && (
            <>
              <div className="mobile-pdf-tools__divider is-short" />
              <div className="mobile-pdf-tools__survey-categories" aria-label="Survey categories">
                {bottomToolbarApi.surveyToolbar.categories.map((category) => (
                  <button
                    type="button"
                    key={category.id}
                    className={bottomToolbarApi.surveyToolbar.selectedCategoryId === category.id && activeTool === 'survey-marker' ? 'is-active' : ''}
                    aria-label={`Survey category ${category.name || 'Untitled Category'}`}
                    title={category.name || 'Untitled Category'}
                    onClick={() => bottomToolbarApi.surveyToolbar.onSelectCategory?.(category.id)}
                  >
                    {categoryGlyph(category.name)}
                  </button>
                ))}
              </div>
            </>
          )}
          {bottomToolbarApi?.showSurveyPanel
            && bottomToolbarApi?.surveyToolbar
            && !bottomToolbarApi?.regionEditing
            && !!bottomToolbarApi.surveyToolbar.entities?.length && (
            <>
              <div className="mobile-pdf-tools__divider is-short" />
              <div className="mobile-pdf-tools__survey-entities" aria-label="Survey entities">
                {bottomToolbarApi.surveyToolbar.entities.map((entity) => (
                  <button
                    type="button"
                    key={entity.id}
                    className={bottomToolbarApi.surveyToolbar.selectedEntityId === entity.id && activeTool === 'survey-marker' ? 'is-active' : ''}
                    aria-label={`Survey entity ${entity.name || 'Untitled Entity'}`}
                    title={entity.name || 'Untitled Entity'}
                    onClick={() => bottomToolbarApi.surveyToolbar.onSelectEntity?.(entity.id)}
                  >
                    <span style={{ background: entity.color || '#6f7785' }} />
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="mobile-pdf-tools__footer" ref={popoverRef}>
          <RailButton
            icon="more"
            label="More document options"
            active={moreOpen}
            onClick={() => { setMoreOpen((open) => !open); setPresenceOpen(false); }}
          />
          <div className="mobile-pdf-tools__footer-stack">
            <button
              type="button"
              className="mobile-pdf-tools__sync"
              aria-label={`${sync.label}. Tap to sync now.`}
              title={`${sync.label}. Tap to sync now.`}
              disabled={leftRailApi?.cloudSyncEnabled === false}
              onClick={leftRailApi?.cloudSyncOnRetry || undefined}
            >
              <span style={{ background: sync.color }} />
            </button>
            <RailButton
              icon="history"
              label="Version history"
              disabled={!leftRailApi?.documentId}
              onClick={() => {
                setPresenceOpen(false);
                setMoreOpen(false);
                onOpenPanel?.('history');
              }}
            />
            <RailButton
              label={`${presenceCount} active user${presenceCount === 1 ? '' : 's'}`}
              active={presenceOpen}
              onClick={() => { setPresenceOpen((open) => !open); setMoreOpen(false); }}
            >
              <span className="mobile-pdf-tools__avatar">{userInitial}</span>
              {presenceCount > 1 && <span className="mobile-pdf-tools__user-count">+{presenceCount - 1}</span>}
            </RailButton>
          </div>

          {moreOpen && (
            <div className="mobile-pdf-tools__popover is-more">
              <button
                type="button"
                disabled={!bottomToolbarApi?.exportAnnotatedPdf}
                onClick={() => {
                  setMoreOpen(false);
                  bottomToolbarApi?.exportAnnotatedPdf?.();
                }}
              >
                <Icon name="download" size={16} color="currentColor" />
                Export annotated PDF
              </button>
              {typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.() && (
                <button
                  type="button"
                  onClick={() => {
                    setMoreOpen(false);
                    const buffer = window.__consoleLogBuffer;
                    window.dispatchEvent(new CustomEvent('save-log-banner-start', {
                      detail: {
                        consoleText: Array.isArray(buffer) && buffer.length > 0
                          ? buffer.join('\n')
                          : '(no console output captured)',
                      },
                    }));
                  }}
                >
                  <Icon name="document" size={16} color="currentColor" />
                  Save log
                </button>
              )}
              <button type="button" onClick={() => { bottomToolbarApi?.zoomOut?.(); setMoreOpen(false); }}>
                <Icon name="minus" size={16} color="currentColor" />
                Zoom out
              </button>
              <button type="button" onClick={() => { bottomToolbarApi?.zoomIn?.(); setMoreOpen(false); }}>
                <Icon name="plus" size={16} color="currentColor" />
                Zoom in
              </button>
            </div>
          )}

        </div>
      </aside>
      {presenceOpen && (
        <>
          <button
            type="button"
            className="mobile-pdf-sheet-backdrop"
            aria-label="Close active users"
            onClick={() => setPresenceOpen(false)}
          />
          <section className="mobile-pdf-sheet mobile-pdf-users-sheet" aria-label="Active users">
            <div className="mobile-pdf-sheet__handle" aria-hidden="true" />
            <header>
              <div>
                <strong>Active users</strong>
                <span>{presenceCount} viewing this document</span>
              </div>
              <button type="button" aria-label="Close active users" onClick={() => setPresenceOpen(false)}>
                <Icon name="close" size={17} color="currentColor" />
              </button>
            </header>
            <div className="mobile-pdf-users-sheet__list">
              {(presenceUsers.length ? presenceUsers : [{ id: 'current', label: 'You', initials: 'U', isCurrent: true }]).map((person) => (
                <div key={person.id} className="mobile-pdf-users-sheet__row">
                  <span className="mobile-pdf-users-sheet__avatar">{person.initials}</span>
                  <p>
                    <strong>{person.label}{person.isCurrent ? ' (you)' : ''}</strong>
                    <span>{person.role || (person.isCurrent ? 'Document owner' : 'Collaborator')}</span>
                  </p>
                  <em>{person.status || (person.isCurrent ? 'Viewing document' : 'Online')}</em>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
      <MobileToolProperties api={bottomToolbarApi} />
    </>
  );
}

export function MobilePdfViewerDock({ onOpenPanel, onToggleHub, onOpenSurvey, hubMode = 'pages', hubOpen = false, spacesActive, surveyActive }) {
  const hubLabels = { pages: 'Pages', search: 'Search', bookmarks: 'Bookmarks' };
  const hubIcons = { pages: 'document', search: 'search', bookmarks: 'bookmark' };
  return (
    <nav className="mobile-pdf-dock" aria-label="Document panels">
      <div className="mobile-pdf-dock__surface" aria-hidden="true" />
      <button
        type="button"
        className={`mobile-pdf-dock__side${spacesActive ? ' is-active' : ''}`}
        aria-label="Open spaces"
        onClick={() => onOpenPanel?.('spaces')}
      >
        <Icon name="layers" size={21} color="currentColor" />
      </button>
      <button
        type="button"
        className={`mobile-pdf-dock__center${hubOpen ? ' is-active' : ''}`}
        aria-label="Open pages, search, and bookmarks"
        onClick={onToggleHub}
      >
        <Icon name={hubIcons[hubMode] || 'pages'} size={18} color="currentColor" />
        <span>{hubLabels[hubMode] || 'Pages'}</span>
        <Icon name="chevronDown" size={12} color="currentColor" />
      </button>
      <button
        type="button"
        className={`mobile-pdf-dock__side${surveyActive ? ' is-active' : ''}`}
        aria-label="Open survey"
        onClick={onOpenSurvey}
      >
        <Icon name="survey" size={22} color="currentColor" />
      </button>
    </nav>
  );
}
