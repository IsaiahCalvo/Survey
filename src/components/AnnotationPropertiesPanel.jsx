/**
 * AnnotationPropertiesPanel.jsx — floating, draggable live-edit panel for a selected annotation/callout.
 *
 * Default-export component (portaled to document.body) opened from the
 * right-click context menu; per-type bodies (rect/ellipse/triangle/line/arrow/
 * path/text/polygon/polyline/counter/callout) expose Fill/Stroke/Width, Border
 * Style (incl. cloud bump size), arrowhead, and text styling. Edits apply live
 * via onUpdate(patch); closes on outside-pointerdown/Escape/X. Font options are
 * single-name only per the Fabric.js measurement gotcha (CLAUDE.md 2026-04-08).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import CompactColorPicker from './CompactColorPicker';
import { resolvePropertiesPanelShape, computeBorderStylePatch } from './propertiesPanelShape';
import { ARROWHEAD_STYLES, ARROWHEAD_STYLE_LABELS } from './Callout/types';

// UX: right-click → context menu → Properties opens this panel in place of
// the context menu. Replaces the deprecated floating mini-toolbar that used
// to appear in edit mode. Edits apply live (no Save / Cancel); the panel
// closes on click-outside, escape, or the corner X. Header is draggable so
// the user can slide the panel away from whatever they're editing.
//
// ctx shape (mirrors annotationContextMenu state in App.jsx):
//   { kind, pageNumber, annotationIndex, calloutId, x, y, groupIndices? }
//
// annotation / callout are the live objects that controls read from and
// write to via onUpdate. onUpdate receives a partial patch and applies it
// to the underlying shape, committing through the existing save pipeline.
const AnnotationPropertiesPanel = ({
  ctx,
  annotation,
  callout,
  onUpdate,
  onClose,
}) => {
  const panelRef = useRef(null);
  const [position, setPosition] = useState({ x: ctx.x, y: ctx.y });
  const positionRef = useRef(position);
  positionRef.current = position;
  const dragStateRef = useRef(null);
  const [showFillPicker, setShowFillPicker] = useState(false);
  const [showStrokePicker, setShowStrokePicker] = useState(false);

  // UX: clamp the panel inside the page bounds on mount — same as the
  // context menu does (App.jsx ~26784). Prevents the panel from opening
  // off-screen if the user right-clicked near a page edge.
  const clampIntoBounds = useCallback((el) => {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    let bounds = null;
    if (ctx.pageNumber != null) {
      const pageEl =
        document.querySelector(`[data-diag-svg-wrapper="${ctx.pageNumber}"]`)
        || document.querySelector(`[data-pal-root="${ctx.pageNumber}"]`);
      if (pageEl) {
        const pageDiv = pageEl.closest('.e-pv-page-div') || pageEl;
        const r = pageDiv.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) bounds = r;
      }
    }
    if (!bounds) {
      bounds = {
        left: 0,
        top: 0,
        right: window.innerWidth,
        bottom: window.innerHeight,
        width: window.innerWidth,
        height: window.innerHeight,
      };
    }
    let nextLeft = position.x;
    if (nextLeft + rect.width + margin > bounds.right) {
      nextLeft = bounds.right - rect.width - margin;
    }
    if (nextLeft < bounds.left + margin) nextLeft = bounds.left + margin;
    let nextTop = position.y;
    if (nextTop + rect.height + margin > bounds.bottom) {
      nextTop = bounds.bottom - rect.height - margin;
    }
    if (nextTop < bounds.top + margin) nextTop = bounds.top + margin;
    if (nextLeft !== position.x || nextTop !== position.y) {
      setPosition({ x: nextLeft, y: nextTop });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.pageNumber]);

  // UX: run the edge-clamp exactly once, after the panel is mounted and laid
  // out. Before 2026-04-21 the clamp was invoked from an inline ref callback
  // on every render, which — combined with clampIntoBounds's useCallback
  // closure over a stale `position` — produced a "Maximum update depth
  // exceeded" infinite loop whenever the panel opened near a page edge
  // (e.g. right-clicking a cloud, polygon, or polyline that happened to sit
  // near the page margins). useLayoutEffect with `[]` deps runs post-mount,
  // reads live DOM geometry via panelRef, and fires setPosition at most once.
  useLayoutEffect(() => {
    clampIntoBounds(panelRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dismiss on click-outside, escape.
  // UX: the SVG selection layer + Pdfjs viewer aggressively call
  // stopPropagation on their own pointer handlers, which blocks bubble-
  // phase listeners at the document level. Binding in the CAPTURE phase
  // lets the panel see every outside click before descendants can swallow
  // it. Uses pointerdown (not mousedown) to match the rest of the app's
  // pointer-event vocabulary and to stay ahead of touch/pen inputs too.
  useEffect(() => {
    const onOutsidePointerDown = (e) => {
      const panel = panelRef.current;
      if (!panel) return;
      // Ignore clicks inside the panel or inside any portal-rendered
      // popup launched from the panel (e.g. the spectrum color picker
      // overlay, which is a sibling portal). The closest() walk catches
      // any descendant under either root.
      if (panel.contains(e.target)) return;
      // Close on any pointerdown outside the panel. This includes clicks
      // on the PDF page, toolbars, or empty background.
      onClose();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', onOutsidePointerDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onOutsidePointerDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  // Draggable header — pointerdown on the header starts a drag, pointermove
  // updates position, pointerup ends. pointer capture keeps the drag alive
  // even if the cursor temporarily leaves the header strip.
  const onHeaderPointerDown = useCallback((e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    dragStateRef.current = {
      startClientX: e.clientX,
      startClientY: e.clientY,
      startPanelX: positionRef.current.x,
      startPanelY: positionRef.current.y,
      pointerId: e.pointerId,
    };
  }, []);

  const onHeaderPointerMove = useCallback((e) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const dx = e.clientX - drag.startClientX;
    const dy = e.clientY - drag.startClientY;
    setPosition({ x: drag.startPanelX + dx, y: drag.startPanelY + dy });
  }, []);

  const onHeaderPointerUp = useCallback((e) => {
    const drag = dragStateRef.current;
    dragStateRef.current = null;
    if (!drag) return;
    try { e.currentTarget.releasePointerCapture(drag.pointerId); } catch {}
  }, []);

  // Pure resolver output for border-style + cloud-intensity detection. The
  // `kind` field on this result is the RAW annotation.type and must not be
  // used for render branching — the `targetKind` useMemo below still owns
  // the normalization (circle→ellipse, textbox→text, line-via-tool→arrow,
  // callout-via-ctx, counter-via-data). `resolvedShape` supplies
  // borderStyle + cloudIntensity only.
  const resolvedShape = useMemo(() => resolvePropertiesPanelShape(annotation), [annotation]);

  // Resolve the target "kind" for per-type content. Covers annotations
  // (rect / circle / ellipse / triangle / line / arrow / path / textbox /
  // polygon / polyline / counter) and callouts.
  const targetKind = useMemo(() => {
    if (ctx.kind === 'callout') return 'callout';
    if (ctx.kind === 'counter' || annotation?.data?.type === 'counter') return 'counter';
    const t = String(annotation?.type || '').toLowerCase();
    if (t === 'rect') return 'rect';
    if (t === 'circle' || t === 'ellipse') return 'ellipse';
    if (t === 'triangle') return 'triangle';
    if (t === 'line') return annotation?.tool === 'arrow' ? 'arrow' : 'line';
    if (t === 'path') return 'path';
    if (t === 'textbox' || t === 'text' || t === 'i-text') return 'text';
    if (t === 'polygon') return 'polygon';
    if (t === 'polyline') return 'polyline';
    return 'unknown';
  }, [ctx.kind, annotation]);

  // Readable label for the header — "Properties · Rectangle" etc.
  const typeLabel = (() => {
    switch (targetKind) {
      case 'callout': return 'Callout';
      case 'counter': return 'Counter Pin';
      case 'rect': return 'Rectangle';
      case 'ellipse': return 'Circle';
      case 'triangle': return 'Triangle';
      case 'line': return 'Line';
      case 'arrow': return 'Arrow';
      case 'path': return 'Stroke';
      case 'text': return 'Text';
      case 'polygon': return 'Polygon';
      case 'polyline': return 'Polyline';
      default: return 'Annotation';
    }
  })();

  // Current values — read from annotation/callout. Defaults mirror what the
  // renderers assume so the panel never shows "undefined" on first open.
  const currentFill = annotation?.fill ?? 'transparent';
  const currentStroke = annotation?.stroke ?? '#000000';
  const currentStrokeWidth = annotation?.strokeWidth ?? 2;
  const counterNumber = annotation?.data?.number ?? '';
  const counterRadius = annotation?.radius ?? 14;

  const handleFillChange = (c) => onUpdate({ fill: c });
  const handleStrokeChange = (c) => onUpdate({ stroke: c });
  const handleStrokeWidthDelta = (delta) => {
    const next = Math.max(1, Math.min(40, currentStrokeWidth + delta));
    onUpdate({ strokeWidth: next });
  };
  // UX 2026-04-21: border-style picker handler. Delegates the transition
  // math to computeBorderStylePatch (pure + unit-tested) so the component
  // only owns glue code. Clearing pdfCloudIntensity when leaving cloud mode
  // is load-bearing — otherwise the renderer's `Number.isFinite(intensity)`
  // cloud branch stays active even after the user picks solid / dashed.
  const handleBorderStyleChange = (nextStyle) => {
    onUpdate(computeBorderStylePatch(annotation, nextStyle));
  };
  // KAL-33: arrowhead style writes to annotation.data.arrowheadStyle — the
  // canonical key honored by lineRenderHelpers (explicit override) and the
  // SVG renderer (SVGAnnotationLayer + svgAnnotationRenderers). Preserve any
  // other data.* fields so we don't strip midpoint / pdfAnnotationId / etc.
  const handleArrowheadStyleChange = (nextStyle) => {
    onUpdate({ data: { ...(annotation?.data ?? {}), arrowheadStyle: nextStyle } });
  };
  // UX 2026-04-21: bump size stepper for cloud shapes. Clamps to 1..4 to
  // match the renderer's bump-count heuristic (see buildCloudPathCommands).
  // Re-reads the live annotation.data each click so rapid clicks accumulate
  // correctly instead of collapsing onto a stale closure value.
  const handleCloudIntensityDelta = (delta) => {
    const current = annotation?.data?.pdfCloudIntensity ?? 2;
    const next = Math.max(1, Math.min(4, current + delta));
    onUpdate({ data: { ...(annotation?.data ?? {}), pdfCloudIntensity: next } });
  };
  const handleCounterRadiusDelta = (delta) => {
    const next = Math.max(6, Math.min(80, counterRadius + delta));
    onUpdate({ radius: next });
  };
  const handleCounterNumberChange = (e) => {
    const raw = e.target.value.replace(/[^0-9]/g, '');
    onUpdate({ data: { ...(annotation?.data || {}), number: raw } });
  };

  // Section helpers — consistent row layout + label styling so every per-type
  // control group looks uniform without each caller rewriting the wrapper.
  const renderLabel = (text) => (
    <div style={{
      fontSize: 10,
      fontWeight: 600,
      letterSpacing: 0.6,
      color: '#6b7280',
      textTransform: 'uppercase',
      marginBottom: 4,
    }}>
      {text}
    </div>
  );

  const renderSwatchRow = (value, onChange, showPicker, togglePicker) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'relative' }}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); togglePicker(); }}
        style={{
          width: 22,
          height: 22,
          borderRadius: 3,
          border: '1px solid #d1d5db',
          background: value === 'transparent' ? '#fff' : value,
          backgroundImage: value === 'transparent'
            ? 'linear-gradient(45deg,#ddd 25%,transparent 25%,transparent 75%,#ddd 75%),linear-gradient(45deg,#ddd 25%,transparent 25%,transparent 75%,#ddd 75%)'
            : undefined,
          backgroundSize: value === 'transparent' ? '8px 8px' : undefined,
          backgroundPosition: value === 'transparent' ? '0 0, 4px 4px' : undefined,
          cursor: 'pointer',
          padding: 0,
        }}
      />
      <span style={{ fontSize: 12, color: '#374151' }}>{value === 'transparent' ? 'None' : value.toUpperCase()}</span>
      {showPicker && (
        <div style={{ position: 'absolute', top: 28, left: 0, zIndex: 10001 }}>
          <CompactColorPicker
            color={value === 'transparent' ? '#000000' : value}
            onChange={onChange}
            onClose={togglePicker}
          />
        </div>
      )}
    </div>
  );

  // UX 2026-04-21: three-button segmented picker for the Border Style row.
  // `options` is an array of { value, label }. Rendered as a native <select>
  // so the user gets a familiar OS dropdown — matches user request 2026-04-21
  // (preferred over a three-button segmented row).
  const renderDropdownRow = (options, currentValue, onSelect) => (
    <select
      value={currentValue ?? ''}
      onChange={(e) => onSelect(e.target.value)}
      style={{
        width: '100%',
        height: 28,
        borderRadius: 4,
        border: '1px solid #d1d5db',
        background: '#fff',
        color: '#374151',
        fontSize: 12,
        padding: '0 8px',
        cursor: 'pointer',
      }}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  );

  const renderStepperRow = (valueLabel, onDecrement, onIncrement) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <button
        type="button"
        onClick={onDecrement}
        style={{
          width: 24,
          height: 24,
          borderRadius: 3,
          border: '1px solid #d1d5db',
          background: '#fff',
          cursor: 'pointer',
          fontSize: 14,
          lineHeight: 1,
          padding: 0,
        }}
      >−</button>
      <span style={{ fontSize: 12, minWidth: 32, textAlign: 'center', color: '#374151' }}>{valueLabel}</span>
      <button
        type="button"
        onClick={onIncrement}
        style={{
          width: 24,
          height: 24,
          borderRadius: 3,
          border: '1px solid #d1d5db',
          background: '#fff',
          cursor: 'pointer',
          fontSize: 14,
          lineHeight: 1,
          padding: 0,
        }}
      >+</button>
    </div>
  );

  // Per-type body selection. Each branch returns its own set of sections.
  // UX: only show controls that apply to the targeted type — e.g. the counter
  // body shows Fill / Number Color / Size / Number, while a rectangle shows
  // Fill / Stroke / Width. Controls irrelevant to a type are never rendered.
  const renderBody = () => {
    if (targetKind === 'counter') {
      return (
        <>
          <section style={{ marginBottom: 14 }}>
            {renderLabel('Fill')}
            {renderSwatchRow(
              currentFill,
              (c) => { handleFillChange(c); setShowFillPicker(false); },
              showFillPicker,
              () => { setShowFillPicker((v) => !v); setShowStrokePicker(false); },
            )}
          </section>
          <section style={{ marginBottom: 14 }}>
            {renderLabel('Number Color')}
            {renderSwatchRow(
              currentStroke,
              (c) => { handleStrokeChange(c); setShowStrokePicker(false); },
              showStrokePicker,
              () => { setShowStrokePicker((v) => !v); setShowFillPicker(false); },
            )}
          </section>
          <section style={{ marginBottom: 14 }}>
            {renderLabel('Size')}
            {renderStepperRow(
              `${counterRadius}px`,
              () => handleCounterRadiusDelta(-1),
              () => handleCounterRadiusDelta(1),
            )}
          </section>
          <section style={{ marginBottom: 4 }}>
            {renderLabel('Number')}
            <input
              type="text"
              value={counterNumber}
              onChange={handleCounterNumberChange}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                height: 28,
                padding: '4px 8px',
                border: '1px solid #d1d5db',
                borderRadius: 3,
                fontSize: 13,
                fontFamily: 'inherit',
              }}
            />
          </section>
        </>
      );
    }

    if (targetKind === 'rect' || targetKind === 'ellipse' || targetKind === 'triangle' || targetKind === 'polygon') {
      // UX 2026-04-21: only rect + polygon get the `cloud` option. Ellipse
      // and triangle don't support revision-cloud rendering (no
      // buildCloudPathCommands branch for them), so they show the
      // two-option picker. Rect + polygon get solid / dashed / cloud.
      const borderOptions = (targetKind === 'rect' || targetKind === 'polygon')
        ? [
            { value: 'solid', label: 'Solid' },
            { value: 'dashed', label: 'Dashed' },
            { value: 'cloud', label: 'Cloud' },
          ]
        : [
            { value: 'solid', label: 'Solid' },
            { value: 'dashed', label: 'Dashed' },
          ];

      return (
        <>
          <section style={{ marginBottom: 14 }}>
            {renderLabel('Fill')}
            {renderSwatchRow(
              currentFill,
              (c) => { handleFillChange(c); setShowFillPicker(false); },
              showFillPicker,
              () => { setShowFillPicker((v) => !v); setShowStrokePicker(false); },
            )}
          </section>
          <section style={{ marginBottom: 14 }}>
            {renderLabel('Stroke')}
            {renderSwatchRow(
              currentStroke,
              (c) => { handleStrokeChange(c); setShowStrokePicker(false); },
              showStrokePicker,
              () => { setShowStrokePicker((v) => !v); setShowFillPicker(false); },
            )}
          </section>
          <section style={{ marginBottom: 14 }}>
            {renderLabel('Width')}
            {renderStepperRow(
              `${currentStrokeWidth}px`,
              () => handleStrokeWidthDelta(-1),
              () => handleStrokeWidthDelta(1),
            )}
          </section>
          {/* UX 2026-04-21: Border Style row sits after Width so the visual
              hierarchy reads top-to-bottom (color → weight → pattern). */}
          <section style={{ marginBottom: 14 }}>
            {renderLabel('Border Style')}
            {renderDropdownRow(borderOptions, resolvedShape.borderStyle, handleBorderStyleChange)}
          </section>
          {/* UX 2026-04-21: Bump Size only appears when the user has
              selected the Cloud style — keeps the panel compact for
              solid / dashed shapes. Range 1..4 matches the renderer. */}
          {resolvedShape.borderStyle === 'cloud' && (
            <section style={{ marginBottom: 4 }}>
              {renderLabel('Bump Size')}
              {renderStepperRow(
                String(resolvedShape.cloudIntensity ?? 2),
                () => handleCloudIntensityDelta(-1),
                () => handleCloudIntensityDelta(1),
              )}
            </section>
          )}
        </>
      );
    }

    if (targetKind === 'line' || targetKind === 'arrow' || targetKind === 'polyline') {
      return (
        <>
          <section style={{ marginBottom: 14 }}>
            {renderLabel('Stroke')}
            {renderSwatchRow(
              currentStroke,
              (c) => { handleStrokeChange(c); setShowStrokePicker(false); },
              showStrokePicker,
              () => { setShowStrokePicker((v) => !v); setShowFillPicker(false); },
            )}
          </section>
          <section style={{ marginBottom: 14 }}>
            {renderLabel('Width')}
            {renderStepperRow(
              `${currentStrokeWidth}px`,
              () => handleStrokeWidthDelta(-1),
              () => handleStrokeWidthDelta(1),
            )}
          </section>
          {/* UX 2026-04-21: open shapes (line / arrow / polyline) get the
              two-option picker only. Cloud style is reserved for closed
              boundary shapes (rect / polygon) per PDF /BE semantics. */}
          <section style={{ marginBottom: targetKind === 'arrow' ? 14 : 4 }}>
            {renderLabel('Border Style')}
            {renderDropdownRow(
              [
                { value: 'solid', label: 'Solid' },
                { value: 'dashed', label: 'Dashed' },
              ],
              resolvedShape.borderStyle,
              handleBorderStyleChange,
            )}
          </section>
          {/* KAL-33: arrowhead style picker for arrows. Six styles match the
              renderer dispatch in lineRenderHelpers / svgAnnotationRenderers.
              Lines and polylines keep their tail-only rendering and do not
              expose an arrowhead control. */}
          {targetKind === 'arrow' && (
            <section style={{ marginBottom: 4 }}>
              {renderLabel('Arrowhead')}
              {renderDropdownRow(
                [
                  { value: ARROWHEAD_STYLES.SOLID_TRIANGLE, label: ARROWHEAD_STYLE_LABELS[ARROWHEAD_STYLES.SOLID_TRIANGLE] },
                  { value: ARROWHEAD_STYLES.OPEN_TRIANGLE, label: ARROWHEAD_STYLE_LABELS[ARROWHEAD_STYLES.OPEN_TRIANGLE] },
                  { value: ARROWHEAD_STYLES.V_SHAPE, label: ARROWHEAD_STYLE_LABELS[ARROWHEAD_STYLES.V_SHAPE] },
                  { value: ARROWHEAD_STYLES.OPEN_CIRCLE, label: ARROWHEAD_STYLE_LABELS[ARROWHEAD_STYLES.OPEN_CIRCLE] },
                  { value: ARROWHEAD_STYLES.HORIZONTAL_LINE, label: ARROWHEAD_STYLE_LABELS[ARROWHEAD_STYLES.HORIZONTAL_LINE] },
                  { value: ARROWHEAD_STYLES.NONE, label: ARROWHEAD_STYLE_LABELS[ARROWHEAD_STYLES.NONE] },
                ],
                annotation?.data?.arrowheadStyle ?? ARROWHEAD_STYLES.SOLID_TRIANGLE,
                handleArrowheadStyleChange,
              )}
            </section>
          )}
        </>
      );
    }

    if (targetKind === 'path') {
      return (
        <>
          <section style={{ marginBottom: 14 }}>
            {renderLabel('Color')}
            {renderSwatchRow(
              currentStroke,
              (c) => { handleStrokeChange(c); setShowStrokePicker(false); },
              showStrokePicker,
              () => { setShowStrokePicker((v) => !v); setShowFillPicker(false); },
            )}
          </section>
          <section style={{ marginBottom: 4 }}>
            {renderLabel('Width')}
            {renderStepperRow(
              `${currentStrokeWidth}px`,
              () => handleStrokeWidthDelta(-1),
              () => handleStrokeWidthDelta(1),
            )}
          </section>
        </>
      );
    }

    if (targetKind === 'text') {
      // KAL-34: text styling controls. Font family options are single-name
      // only — Fabric.js measures characters at CACHE_FONT_SIZE=400px and
      // scales down, so any CSS fallback stack would cause cursor drift when
      // the browser resolves a different fallback at 400 vs the real size.
      // CLAUDE.md 2026-04-08 documents this in detail.
      const currentFontFamily = annotation?.fontFamily ?? 'Helvetica';
      const currentTextAlign = annotation?.textAlign ?? 'left';
      const isBold = annotation?.fontWeight === 'bold' || annotation?.fontWeight === 700;
      const isItalic = annotation?.fontStyle === 'italic';
      const isUnderline = annotation?.underline === true;
      const isStrikethrough = annotation?.linethrough === true;
      const renderToggleButton = (label, active, onToggle, fontStyle = {}) => (
        <button
          type="button"
          onClick={onToggle}
          style={{
            flex: 1,
            height: 28,
            borderRadius: 4,
            border: '1px solid #d1d5db',
            background: active ? '#1e293b' : '#fff',
            color: active ? '#fff' : '#374151',
            fontSize: 13,
            cursor: 'pointer',
            ...fontStyle,
          }}
        >{label}</button>
      );
      return (
        <>
          <section style={{ marginBottom: 14 }}>
            {renderLabel('Text Color')}
            {renderSwatchRow(
              annotation?.fill ?? '#000000',
              (c) => onUpdate({ fill: c }),
              showFillPicker,
              () => setShowFillPicker((v) => !v),
            )}
          </section>
          <section style={{ marginBottom: 14 }}>
            {renderLabel('Font')}
            {renderDropdownRow(
              [
                { value: 'Helvetica', label: 'Helvetica' },
                { value: 'Arial', label: 'Arial' },
                { value: 'Times New Roman', label: 'Times New Roman' },
                { value: 'Courier New', label: 'Courier New' },
                { value: 'Georgia', label: 'Georgia' },
              ],
              currentFontFamily,
              (next) => onUpdate({ fontFamily: next }),
            )}
          </section>
          <section style={{ marginBottom: 14 }}>
            {renderLabel('Font Size')}
            {renderStepperRow(
              `${annotation?.fontSize ?? 14}px`,
              () => onUpdate({ fontSize: Math.max(6, (annotation?.fontSize ?? 14) - 1) }),
              () => onUpdate({ fontSize: Math.min(96, (annotation?.fontSize ?? 14) + 1) }),
            )}
          </section>
          <section style={{ marginBottom: 14 }}>
            {renderLabel('Style')}
            <div style={{ display: 'flex', gap: 6 }}>
              {renderToggleButton(
                'B',
                isBold,
                () => onUpdate({ fontWeight: isBold ? 'normal' : 'bold' }),
                { fontWeight: 700 },
              )}
              {renderToggleButton(
                'I',
                isItalic,
                () => onUpdate({ fontStyle: isItalic ? 'normal' : 'italic' }),
                { fontStyle: 'italic' },
              )}
              {renderToggleButton(
                'U',
                isUnderline,
                () => onUpdate({ underline: !isUnderline }),
                { textDecoration: 'underline' },
              )}
              {renderToggleButton(
                'S',
                isStrikethrough,
                () => onUpdate({ linethrough: !isStrikethrough }),
                { textDecoration: 'line-through' },
              )}
            </div>
          </section>
          <section style={{ marginBottom: 4 }}>
            {renderLabel('Align')}
            {renderDropdownRow(
              [
                { value: 'left', label: 'Left' },
                { value: 'center', label: 'Center' },
                { value: 'right', label: 'Right' },
                { value: 'justify', label: 'Justify' },
              ],
              currentTextAlign,
              (next) => onUpdate({ textAlign: next }),
            )}
          </section>
        </>
      );
    }

    // Fallback placeholder so unknown types still show the panel (header +
    // close X) rather than opening empty. Lets the user confirm the panel
    // is wired before per-type controls land for this shape.
    return (
      <div style={{ fontSize: 12, color: '#6b7280', padding: '12px 0' }}>
        No adjustable properties for this annotation yet.
      </div>
    );
  };

  return createPortal(
    <div
      ref={panelRef}
      data-annotation-properties-panel="true"
      // UX 2026-04-21: swallow contextmenu inside the panel so right-click
      // never falls through to the canvas's paste menu (or the browser's
      // native Paste on text inputs). The panel is a tool surface — right-
      // click on it should do nothing, matching the rest of the app's
      // tool-surface UX. preventDefault suppresses the native menu,
      // stopPropagation keeps it from reaching App's bubble-phase listener.
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        background: '#ffffff',
        border: '1px solid #d1d5db',
        borderRadius: 6,
        boxShadow: '0 6px 20px rgba(0,0,0,0.15)',
        zIndex: 10001,
        minWidth: 220,
        maxWidth: 320,
        fontSize: 13,
        fontFamily: 'system-ui, sans-serif',
        userSelect: 'none',
      }}
    >
      {/* Header — draggable handle + close X. */}
      <div
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        onPointerCancel={onHeaderPointerUp}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 10px',
          borderBottom: '1px solid #e5e7eb',
          cursor: 'grab',
          background: '#f9fafb',
          borderTopLeftRadius: 6,
          borderTopRightRadius: 6,
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: '#111827' }}>
          Properties · {typeLabel}
        </span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          onPointerDown={(e) => { e.stopPropagation(); }}
          style={{
            width: 20,
            height: 20,
            borderRadius: 3,
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#6b7280',
            fontSize: 16,
            lineHeight: 1,
            padding: 0,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#e5e7eb'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          aria-label="Close properties panel"
        >×</button>
      </div>
      {/* Body — per-type controls. */}
      <div style={{ padding: '10px 12px 12px' }}>
        {renderBody()}
      </div>
    </div>,
    document.body,
  );
};

export default AnnotationPropertiesPanel;
