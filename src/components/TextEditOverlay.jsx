/**
 * TextEditOverlay — same-surface text editing for textboxes and callout text.
 *
 * Replaces FabricEditCanvas for editType 'text'. The old model kept an
 * invisible Fabric.js textbox (canvas-measured caret) over SVG-painted glyphs
 * (CSS-measured layout); the two engines could never agree on wrap points and
 * per-line steps, so the caret drifted from the letters. Here the caret and
 * the glyphs live in ONE contentEditable div styled by the exact same style
 * contract the SVG view renderers use (buildPlainTextContentStyle /
 * buildCalloutTextContentStyle from svgAnnotationRenderers.jsx), so they can
 * never disagree — this is how PDF tools with native-feeling text editing do
 * it (same-surface editing).
 *
 * While mounted:
 *  - the SVG hides the edited annotation's glyphs (hideText) but keeps
 *    painting its border/background from the liveBounds broadcast;
 *  - this overlay is the visible text surface; per-input it re-measures
 *    content height and broadcasts the same liveBounds payload
 *    FabricEditCanvas emitted (onLiveTextGrow) so the SVG box + callout
 *    leader line track growth;
 *  - it publishes the same {api, state} bridge to onRichTextEditorChange the
 *    AppShell formatting sub-row binds to.
 *
 * Commit JSON parity lives in src/utils/textEditCommit.js.
 *
 * Positioning: a wrapper fills the page overlay host (inset 0); inside it a
 * page-space div sized pageWidth×pageHeight carries transform:scale(sx, sy)
 * (container-aware: measured from the host's real offset size, per the
 * CLAUDE.md canvas-sizing rule — never pageSize×reportedZoom). Children are
 * laid out in raw page units, so CSS text layout happens at the SAME units
 * and scale the SVG foreignObject uses — pixel-identical wrap and line step.
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  buildPlainTextContentStyle,
  buildCalloutTextContentStyle,
} from '../utils/svgAnnotationRenderers.jsx';
import {
  TEXT_PADDING,
  buildNewTextCommitJSON,
  buildExistingTextCommitJSON,
} from '../utils/textEditCommit.js';
import { stampAnnotationCreationIdentity } from '../utils/annotationStorageIdentity.js';
import { shouldStampActiveRegionId } from '../utils/annotationVisibilityRules.js';
import { resolveCaretAnchorPoint } from '../utils/doubleTapEditEntry.js';

const DEFAULT_FONT_FAMILY = 'Helvetica';

const deepClone = (value) => JSON.parse(JSON.stringify(value));

// Shared 2D context for the new-text tight-fit width measurement. Canvas
// measureText tracks DOM text width closely for single-name fonts; the +2px
// breathing room in the commit builder absorbs sub-pixel disagreement.
let measureCtx = null;
const measureLineWidth = (text, { fontStyle, fontWeight, fontSize, fontFamily }) => {
  try {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    measureCtx.font = `${fontStyle || 'normal'} ${fontWeight || 'normal'} ${fontSize}px ${fontFamily || DEFAULT_FONT_FAMILY}`;
    let max = 0;
    for (const line of String(text).split('\n')) {
      const w = measureCtx.measureText(line).width;
      if (w > max) max = w;
    }
    return max;
  } catch {
    return 0;
  }
};

const calloutStylePatch = (key, val) => {
  switch (key) {
    case 'fontWeight': return { bold: val === 'bold' };
    case 'fontStyle': return { italic: val === 'italic' };
    case 'underline': return { underline: !!val };
    case 'linethrough': return { strikethrough: !!val };
    case 'textAlign': return { textAlign: val };
    case 'verticalAlign': return { verticalAlign: val };
    case 'fontFamily': return { fontFamily: val };
    case 'fontSize': return { fontSize: Number(val) || 12 };
    case 'fill': return { fontColor: val };
    default: return null;
  }
};

/** Whole-contents range — the historical select-all-on-open behaviour. */
function selectAllRange(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  return range;
}

/**
 * The caret point for this editor, or null while it is still unlaid-out. The
 * anchor is stored as a fraction of the annotation's box, so it is re-resolved
 * against the editor's CURRENT rect — immune to any scroll the mount caused
 * (observed live: under Text Select the editor mounted 500px below the click,
 * and a raw client point landed nowhere near the glyphs).
 */
function caretPointFor(el, anchor) {
  if (!anchor) return null;
  const rect = el.getBoundingClientRect();
  if (!(rect.width > 0 && rect.height > 0)) return null;
  const point = resolveCaretAnchorPoint(anchor, rect);
  if (!point) return null;
  // A click on the frame or outside the glyph box keeps the historical
  // select-all rather than snapping the caret to an arbitrary edge.
  if (point.x < rect.left || point.x > rect.right
    || point.y < rect.top || point.y > rect.bottom) return null;
  return point;
}

/**
 * Collapsed caret range at a client point, or null when the point resolves
 * outside this editor (stale coordinates, a point on the box border, a browser
 * without either caret-from-point API). Callers fall back to select-all, so a
 * null here is always safe.
 */
function caretRangeAt(el, point) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  try {
    let range = null;
    if (typeof document.caretRangeFromPoint === 'function') {
      range = document.caretRangeFromPoint(point.x, point.y);
    } else if (typeof document.caretPositionFromPoint === 'function') {
      const position = document.caretPositionFromPoint(point.x, point.y);
      if (position?.offsetNode) {
        range = document.createRange();
        range.setStart(position.offsetNode, position.offset);
      }
    }
    if (!range || !el.contains(range.startContainer)) {
      // The native APIs hit-test the whole page, so anything painted above the
      // editor answers instead of us — notably the pdf.js text layer, which owns
      // pointer events under Text Select. Fall back to measuring our own glyphs,
      // which no stacking context can interfere with.
      return caretRangeByGeometry(el, point);
    }
    range.collapse(true);
    return range;
  } catch {
    return null;
  }
}

/** Longest string we will walk character-by-character to place a caret. */
const CARET_SCAN_CHAR_LIMIT = 2000;

/**
 * Caret range at a client point, measured from this editor's own text-node
 * geometry: the nearest character boundary, preferring the line the point is on.
 * Independent of z-order, pointer-events and any overlay above the editor.
 */
function caretRangeByGeometry(el, point) {
  const doc = el.ownerDocument;
  if (!doc?.createTreeWalker) return null;
  const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const probe = doc.createRange();
  let scanned = 0;
  let best = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.length || 0;
    scanned += length;
    if (scanned > CARET_SCAN_CHAR_LIMIT) return null;
    for (let offset = 0; offset <= length; offset += 1) {
      probe.setStart(node, offset);
      probe.collapse(true);
      const rect = probe.getBoundingClientRect();
      if (rect.height <= 0) continue;
      // Vertical distance dominates so a click always lands on the clicked LINE
      // first, then on the nearest character boundary within it.
      const dy = point.y < rect.top ? rect.top - point.y
        : point.y > rect.bottom ? point.y - rect.bottom : 0;
      const distance = dy * 10000 + Math.abs(point.x - rect.left);
      if (!best || distance < best.distance) best = { node, offset, distance };
    }
  }
  if (!best) return null;
  const range = doc.createRange();
  range.setStart(best.node, best.offset);
  range.collapse(true);
  return range;
}

export default function TextEditOverlay({
  pageNumber,
  pageWidth,
  pageHeight,
  annotationData,
  annotationIndex,
  annotations,
  reactCalloutId = null,
  isNewText = false,
  clickPosition = null,
  // UX 2026-09-15 — where in the annotation's own box the double-click /
  // double-tap landed. The caret is placed at that spot instead of selecting the
  // whole string, matching Drawboard PDF (double-click a text box and you land
  // between the letters you clicked). Null for every other entry (toolbar
  // button, new-text creation), which keeps the old select-all.
  caretAnchor = null,
  textBoxWidth,
  newTextStyle = null,
  strokeColor,
  authorId = null,
  // KAL-88 — Decision 11 companion: survey/region scope inputs for NEW text.
  // Same sources of truth as SVGAnnotationLayer's creation commit (survey:
  // selectedModuleId; region: shouldStampActiveRegionId over the active
  // space/region), read at commit time so the stamp reflects current mode.
  selectedModuleId = null,
  selectedSpaceId = null,
  activeRegionId = null,
  spaces = [],
  isRegionOverlayEnabled = null,
  onLiveTextGrow,
  onRichTextEditorChange,
  onCalloutTextStyleChange,
  onEditCommit,
  onEditCancel,
}) {
  const isCallout = !!reactCalloutId;
  const pad = TEXT_PADDING;
  const padY = isCallout ? 0 : pad;

  // ---------------------------------------------------------------------
  // Immutable-per-mount edit context (the mount key remounts per target).
  // ---------------------------------------------------------------------
  const originalRef = useRef(null);
  const styleRef = useRef(null);
  const geomRef = useRef(null);
  if (styleRef.current === null) {
    const src = annotationData || {};
    originalRef.current = annotationData ? deepClone(annotationData) : null;
    styleRef.current = isNewText
      ? {
        fontSize: Number(newTextStyle?.fontSize) || 16,
        fontFamily: newTextStyle?.fontFamily || DEFAULT_FONT_FAMILY,
        fontWeight: newTextStyle?.bold ? 'bold' : 'normal',
        fontStyle: newTextStyle?.italic ? 'italic' : 'normal',
        underline: Boolean(newTextStyle?.underline),
        linethrough: Boolean(newTextStyle?.strike),
        textAlign: newTextStyle?.textAlign || 'left',
        verticalAlign: 'top',
        lineHeight: 1.16,
        // Plan 15-04 parity: new text's intended look — the SVG preview and
        // the committed annotation both use these.
        fill: newTextStyle?.fontColor || strokeColor || '#007AFF',
        stroke: '#000000',
        strokeWidth: 1,
      }
      : {
        fontSize: Number(src.fontSize) || 16,
        fontFamily: src.fontFamily || DEFAULT_FONT_FAMILY,
        fontWeight: src.fontWeight || 'normal',
        fontStyle: src.fontStyle || 'normal',
        underline: !!src.underline,
        linethrough: !!src.linethrough,
        textAlign: src.textAlign || 'left',
        verticalAlign: src.verticalAlign || 'top',
        lineHeight: Number(src.lineHeight) || 1.16,
        fill: (typeof src.fill === 'string' && src.fill !== 'rgba(0,0,0,0)') ? src.fill : '#1e293b',
        stroke: src.stroke,
        strokeWidth: src.strokeWidth,
      };
    const scaleX = Math.abs(Number(src.scaleX) || 1);
    const scaleY = Math.abs(Number(src.scaleY) || 1);
    geomRef.current = isNewText
      ? {
        left: clickPosition?.x ?? 0,
        top: clickPosition?.y ?? 0,
        outerW: Math.max(8 + 2 * pad, textBoxWidth || 160),
        outerH: (Number(newTextStyle?.fontSize) || 16) * 1.16 * 1.13 + 2 * pad,
        angle: 0,
      }
      : {
        left: Number(src.left) || 0,
        top: Number(src.top) || 0,
        outerW: (Number(src.width) || 0) * scaleX,
        outerH: (Number(src.height) || 0) * scaleY,
        angle: Number(src.angle) || 0,
      };
  }

  // Live outer height (grows with content; floor = the mount-time height).
  const [liveOuterH, setLiveOuterH] = useState(geomRef.current.outerH);
  const liveOuterHRef = useRef(geomRef.current.outerH);
  const [, forceRender] = useState(0);

  const wrapperRef = useRef(null);
  const editableRef = useRef(null);
  const committedRef = useRef(false);

  // Container-aware effective scale from the page host's real size.
  const [effScale, setEffScale] = useState({ x: 1, y: 1 });
  useLayoutEffect(() => {
    const host = wrapperRef.current;
    if (!host) return undefined;
    const measure = () => {
      const w = host.offsetWidth;
      const h = host.offsetHeight;
      if (w > 0 && h > 0 && pageWidth > 0 && pageHeight > 0) {
        setEffScale((prev) => {
          const x = w / pageWidth;
          const y = h / pageHeight;
          return (prev.x === x && prev.y === y) ? prev : { x, y };
        });
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    return () => ro.disconnect();
  }, [pageWidth, pageHeight]);

  // ---------------------------------------------------------------------
  // Text access — uncontrolled contentEditable (React never re-renders the
  // text node, so IME/undo/caret state is never clobbered).
  // ---------------------------------------------------------------------
  // Last text/height this editor actually observed.
  //
  // 2026-09-15 — DATA LOSS GUARD. The unmount flush ("unmount = commit") can run
  // after React has already detached the editable and nulled editableRef, which
  // is exactly what happens whenever something else clears editingAnnotation
  // first: PDFViewer's window-capture Escape / backdrop handler under the Select
  // family runs before this component's own document-capture listeners. Reading
  // '' off a dead element and committing it silently WIPED the annotation's
  // text (reproduced on base: double-click a text box in Rectangle Select, press
  // Escape, the text is gone). Commit what we last saw instead, and never commit
  // a value we never observed.
  const lastTextRef = useRef(null);
  const lastInnerHeightRef = useRef(0);

  const readText = () => {
    const el = editableRef.current;
    if (!el) return lastTextRef.current;
    // contentEditable=plaintext-only keeps '\n' text nodes under
    // white-space:pre-wrap; innerText also folds any stray <br> to '\n'.
    let t = el.innerText ?? '';
    t = t.replace(/\r\n?/g, '\n');
    // A trailing newline artifact appears when the last child is a <br>.
    if (t.endsWith('\n') && !(el.textContent || '').endsWith('\n')) t = t.slice(0, -1);
    lastTextRef.current = t;
    return t;
  };

  const measureNaturalInnerHeight = () => {
    const el = editableRef.current;
    if (!el) return lastInnerHeightRef.current;
    // scrollHeight is untransformed layout units — page units under the
    // scaled page-space container — and reports CONTENT height even when
    // the flex container would squeeze the item's box (getBoundingClientRect
    // measures the flexed box, which under-reported by whole lines).
    lastInnerHeightRef.current = el.scrollHeight;
    return lastInnerHeightRef.current;
  };

  // ---------------------------------------------------------------------
  // Live bounds broadcast — the exact payload FabricEditCanvas emitted, so
  // renderText/renderCallout box chrome + the callout leader line track the
  // edit with zero contract change.
  // ---------------------------------------------------------------------
  const broadcastLiveBounds = useCallback(() => {
    if (typeof onLiveTextGrow !== 'function') return;
    const s = styleRef.current;
    const g = geomRef.current;
    const text = readText();
    const naturalInnerH = measureNaturalInnerHeight();
    const floorH = g.outerH;
    const outerH = Math.max(naturalInnerH + 2 * padY, floorH);
    if (outerH !== liveOuterHRef.current) {
      liveOuterHRef.current = outerH;
      setLiveOuterH(outerH);
    }
    onLiveTextGrow({
      left: g.left,
      top: g.top,
      width: g.outerW,
      height: outerH,
      text,
      textLines: text.length ? text.split('\n') : [],
      fontSize: s.fontSize,
      lineHeight: s.lineHeight,
      fontWeight: s.fontWeight,
      fontStyle: s.fontStyle,
      underline: s.underline,
      linethrough: s.linethrough,
      textAlign: s.textAlign,
      verticalAlign: s.verticalAlign,
      fontFamily: s.fontFamily,
      fill: s.fill,
      ...(isNewText ? { stroke: s.stroke, strokeWidth: s.strokeWidth || 1, isCreating: true } : {}),
    });
  }, [onLiveTextGrow, isNewText, padY]);

  // ---------------------------------------------------------------------
  // Rich-text bridge ({api, state}) — same keys the AppShell sub-row binds.
  // ---------------------------------------------------------------------
  const publishBridge = useCallback(() => {
    // Style changes publish after paint. A commit can happen before that queued
    // frame runs; never let the late frame resurrect a bridge we just cleared.
    if (committedRef.current) return;
    if (typeof onRichTextEditorChange !== 'function') return;
    const s = styleRef.current;
    const applyStyle = (key, val) => {
      styleRef.current = { ...styleRef.current, [key]: val };
      if (isCallout && typeof onCalloutTextStyleChange === 'function') {
        const patch = calloutStylePatch(key, val);
        if (patch) onCalloutTextStyleChange(reactCalloutId, patch);
      }
      forceRender((n) => n + 1);
      // Style changes reflow the text — re-measure + rebroadcast after paint.
      requestAnimationFrame(() => { broadcastLiveBounds(); publishBridge(); });
      // preventScroll: a bold/italic/size click must not scroll the page away
      // from the box being styled.
      editableRef.current?.focus({ preventScroll: true });
    };
    const api = {
      toggleBold: () => applyStyle('fontWeight', styleRef.current.fontWeight === 'bold' ? 'normal' : 'bold'),
      toggleItalic: () => applyStyle('fontStyle', styleRef.current.fontStyle === 'italic' ? 'normal' : 'italic'),
      toggleUnderline: () => applyStyle('underline', !styleRef.current.underline),
      toggleStrike: () => applyStyle('linethrough', !styleRef.current.linethrough),
      setFontSize: (n) => applyStyle('fontSize', Math.max(6, Math.min(200, Math.round(Number(n) || 16)))),
      setTextAlign: (a) => applyStyle('textAlign', ['left', 'center', 'right', 'justify'].includes(a) ? a : 'left'),
      setVerticalAlign: (v) => applyStyle('verticalAlign', ['top', 'middle', 'bottom'].includes(v) ? v : 'top'),
      // Single-name fonts only (fabric/CSS measurement contract, CLAUDE.md).
      setFontFamily: (f) => applyStyle('fontFamily', typeof f === 'string' && f.length > 0 && !f.includes(',') ? f : 'Arial'),
      setFontColor: (c) => applyStyle('fill', typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : '#000000'),
    };
    onRichTextEditorChange({
      api,
      state: {
        bold: s.fontWeight === 'bold',
        italic: s.fontStyle === 'italic',
        underline: !!s.underline,
        strike: !!s.linethrough,
        fontSize: Math.round(Number(s.fontSize) || 16),
        textAlign: s.textAlign || 'left',
        verticalAlign: s.verticalAlign || 'top',
        fontFamily: s.fontFamily || 'Arial',
        fontColor: s.fill,
      },
    });
  }, [onRichTextEditorChange, onCalloutTextStyleChange, isCallout, reactCalloutId, broadcastLiveBounds]);

  // ---------------------------------------------------------------------
  // Commit / cancel
  // ---------------------------------------------------------------------
  const commitAndClose = useCallback((opts = {}) => {
    if (committedRef.current) return;
    committedRef.current = true;
    // The formatting bridge represents an actively-mounted editor, not the
    // last editor state. Clear it at the commit boundary so a same-gesture
    // selection (notably a callout leader) cannot inherit the stale text strip
    // while React is still unmounting this overlay.
    if (typeof onRichTextEditorChange === 'function') onRichTextEditorChange(null);
    const s = styleRef.current;
    const g = geomRef.current;
    const text = readText();
    const naturalInnerH = measureNaturalInnerHeight();
    if (text == null) {
      // The editable is already detached and we never observed its text — there
      // is nothing to commit, and writing anything here could only destroy the
      // annotation. Close without touching the document.
      if (typeof onEditCancel === 'function') onEditCancel();
      return;
    }

    let json = null;
    if (isNewText) {
      const lines = text.split('\n');
      const perLine = s.fontSize * s.lineHeight * 1.13;
      const renderedLines = Math.max(lines.length, perLine > 0 ? Math.round(naturalInnerH / perLine) : 1);
      json = buildNewTextCommitJSON({
        text,
        left: g.left,
        top: g.top,
        innerWrapWidth: g.outerW - 2 * pad,
        maxLineWidth: measureLineWidth(text, s),
        lineCount: renderedLines,
        naturalInnerHeight: naturalInnerH,
        style: s,
        fill: s.fill,
        stroke: s.stroke || '#000000',
        strokeWidth: s.strokeWidth ?? 1,
        selectedModuleId,
        stampRegionId: shouldStampActiveRegionId({
          regionId: activeRegionId,
          spaceId: selectedSpaceId,
          pageNumber,
          spaces,
          isRegionOverlayEnabled,
        }),
        activeRegionId,
      });
      if (!json) {
        // Blank new text — discard, same as the fabric path.
        if (typeof onEditCancel === 'function') onEditCancel();
        return;
      }
      json = stampAnnotationCreationIdentity(json, { authorId });
    } else {
      json = buildExistingTextCommitJSON({
        original: originalRef.current,
        text,
        naturalInnerHeight: naturalInnerH,
        isCallout,
        style: s,
      });
      if (!json) {
        if (typeof onEditCancel === 'function') onEditCancel();
        return;
      }
    }

    const updated = deepClone(annotations || { objects: [] });
    if (!Array.isArray(updated.objects)) updated.objects = [];
    if (isNewText) updated.objects.push(json);
    else updated.objects[annotationIndex] = json;

    if (opts.flush) {
      flushSync(() => onEditCommit(updated));
    } else {
      onEditCommit(updated);
    }
  }, [annotations, annotationIndex, isNewText, isCallout, onEditCommit, onEditCancel, onRichTextEditorChange, pad, authorId,
    // KAL-88 scope-stamp inputs — keep the commit closure stamping from
    // current values (the unmount flush reads via commitRef, which tracks
    // this callback).
    pageNumber, selectedModuleId, selectedSpaceId, activeRegionId, spaces, isRegionOverlayEnabled]);

  const cancelAndClose = useCallback(() => {
    if (committedRef.current) return;
    committedRef.current = true;
    if (typeof onRichTextEditorChange === 'function') onRichTextEditorChange(null);
    if (typeof onEditCancel === 'function') onEditCancel();
  }, [onEditCancel, onRichTextEditorChange]);

  const commitRef = useRef(commitAndClose);
  useEffect(() => { commitRef.current = commitAndClose; }, [commitAndClose]);
  const cancelRef = useRef(cancelAndClose);
  useEffect(() => { cancelRef.current = cancelAndClose; }, [cancelAndClose]);

  // Mount: seed text, focus, select-all for existing text (parity with the
  // fabric path's enterEditing + selectAll), initial broadcasts.
  //
  // When the editor was opened by a double-click / double-tap we then collapse
  // that select-all to a caret at the click point (Drawboard parity: you land
  // between the letters you clicked). This CANNOT be done in the same tick:
  // the editor's final on-page position is applied after this effect, so a
  // synchronous caretRangeFromPoint resolves against a stale box and always
  // answers offset 0 (observed live 2026-09-15). Retry for a few frames until
  // the box actually contains the click point; if it never does, the select-all
  // above simply stands — every failure path is the old behaviour.
  useEffect(() => {
    const el = editableRef.current;
    let caretFrame = 0;
    if (el) {
      el.textContent = isNewText ? '' : String(annotationData?.text ?? '');
      // preventScroll — 2026-09-15. Focusing a contentEditable makes the browser
      // reveal it, and the editor mounts before its final on-page box is
      // applied, so the reveal was computed against the wrong rectangle: a
      // double-click on a callout near the bottom of a page at ~195% jumped the
      // viewer ~430px and scrolled the callout the user had just aimed at clean
      // off the screen.
      //
      // Intended UX: opening an editor never moves the page. You double-clicked
      // something you could see; it stays where it is. The caret placement
      // below (and the browser's own caret-follow while typing) still reveals
      // the caret when it truly leaves the viewport.
      el.focus({ preventScroll: true });
      if (!isNewText && el.firstChild) {
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(selectAllRange(el));
        if (caretAnchor) {
          const placeCaret = (attempt) => {
            caretFrame = 0;
            const node = editableRef.current;
            if (!node || committedRef.current) return;
            const point = caretPointFor(node, caretAnchor);
            const range = point ? caretRangeAt(node, point) : null;
            if (!range) {
              if (attempt < 3) caretFrame = requestAnimationFrame(() => placeCaret(attempt + 1));
              return;
            }
            const live = window.getSelection();
            live?.removeAllRanges();
            live?.addRange(range);
          };
          caretFrame = requestAnimationFrame(() => placeCaret(0));
        }
      }
    }
    broadcastLiveBounds();
    publishBridge();
    return () => {
      if (caretFrame) cancelAnimationFrame(caretFrame);
      // Unmount = commit, not cancel (tool switch, page virtualization,
      // zoom-driven remount) — mirror of the fabric onBeforeDispose flush.
      commitRef.current({ flush: true });
      if (typeof onRichTextEditorChange === 'function') onRichTextEditorChange(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Escape cancels (capture, before app-level hotkeys); click-outside commits.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cancelRef.current();
      }
    };
    const onDocPointerDown = (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.closest('[data-text-edit-overlay]')) return;
      // Formatting sub-row + mini toolbar buttons must not commit-and-close
      // (same opt-out attribute contract as FabricEditCanvas).
      if (t.closest('[data-rich-text-toolbar]') || t.closest('[data-mini-toolbar]') || t.closest('[data-font-color-picker]')) return;
      commitRef.current();
    };
    document.addEventListener('keydown', onKeyDown, true);
    // POINTERDOWN, not only mousedown. The editor can now be opened while the
    // Pan tool is armed (double-click to edit, 2026-09-15), and the pdf.js
    // scroller preventDefault()s pointerdown while panning — which per the
    // Pointer Events spec suppresses the compatibility mouse events entirely.
    // With a mousedown-only listener, clicking away in Pan never committed and
    // the editor stayed open (observed live). mousedown is kept as a belt-and-
    // braces second path; commitAndClose is idempotent via committedRef.
    document.addEventListener('pointerdown', onDocPointerDown, true);
    document.addEventListener('mousedown', onDocPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onDocPointerDown, true);
      document.removeEventListener('mousedown', onDocPointerDown, true);
    };
  }, []);

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------
  const s = styleRef.current;
  const g = geomRef.current;
  const outerH = liveOuterH;
  const innerW = Math.max(0, g.outerW - 2 * pad);
  const descender = s.fontSize * 0.35;

  const contentStyle = isCallout
    ? buildCalloutTextContentStyle({
      innerWidth: innerW,
      boxHeightWithDescenders: outerH + descender,
      textAlign: s.textAlign,
      fontSize: s.fontSize,
      fontFamily: s.fontFamily,
      // UX (2026-07-17): pass the style flags through so the editor shows
      // bold/italic/underline/strikethrough live — the committed SVG render
      // now draws them too (buildCalloutTextContentStyle), so edit and view
      // stay visually identical (no style pop when leaving edit mode).
      fontWeight: s.fontWeight,
      fontStyle: s.fontStyle,
      underline: s.underline,
      linethrough: s.linethrough,
      color: s.fill,
      lineHeight: s.lineHeight,
    })
    : buildPlainTextContentStyle({
      innerWidth: innerW,
      innerDisplayHeight: Math.max(0, outerH - 2 * pad) + descender,
      fontSize: s.fontSize,
      fontFamily: s.fontFamily,
      fontWeight: s.fontWeight,
      fontStyle: s.fontStyle,
      color: s.fill,
      textAlign: s.textAlign,
      verticalAlign: s.verticalAlign,
      underline: s.underline,
      linethrough: s.linethrough,
      lineHeight: s.lineHeight,
    });

  return (
    <div
      ref={wrapperRef}
      data-text-edit-overlay
      data-page-number={pageNumber}
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'visible',
        pointerEvents: 'none',
        zIndex: 101,
        // UX (2026-07-17): the editor overlay must never act as the viewer's
        // scroll anchor. Callout text is vertically centered (justifyContent
        // 'center' in buildCalloutTextContentStyle), so each wrap transiently
        // shifts the text block up half a line during the forced layout in
        // broadcastLiveBounds (scrollHeight read runs before React commits the
        // grown container height); Chrome's scroll anchoring compensated by
        // scrolling the WHOLE PAGE up ~8px per wrap while typing in a callout.
        // Plain text is top-aligned so its text block never moves — that's why
        // textboxes never scrolled. Opting the overlay subtree out of anchor
        // candidacy makes callout typing behave exactly like textbox typing:
        // page stays still while the box is visible, and native caret-follow
        // (untouched by overflow-anchor) still reveals the caret when it truly
        // crosses the viewport edge — same as the textbox path. Verified with
        // scrollTop instrumentation both ways; do NOT re-add anchoring here.
        overflowAnchor: 'none',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: pageWidth,
          height: pageHeight,
          transform: `scale(${effScale.x}, ${effScale.y})`,
          transformOrigin: '0 0',
          pointerEvents: 'none',
        }}
      >
        <div
          onMouseDown={(e) => {
            // Clicks in the gutter/padding keep focus in the editor.
            if (e.target !== editableRef.current) {
              e.preventDefault();
              // preventScroll: clicking the box's own padding must not move the
              // page under the user's finger.
              editableRef.current?.focus({ preventScroll: true });
            }
          }}
          style={{
            position: 'absolute',
            left: g.left,
            top: g.top,
            width: g.outerW,
            height: outerH,
            transform: g.angle ? `rotate(${g.angle}deg)` : undefined,
            transformOrigin: 'center center',
            pointerEvents: 'auto',
            cursor: 'text',
            // The SVG paints border/background from the liveBounds broadcast;
            // this box stays chromeless so there is exactly one visible box.
            background: 'transparent',
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: pad,
              top: padY,
              ...contentStyle,
              // The editor must never clip the caret while a growth broadcast
              // is in flight; the SVG box clips the committed view instead.
              overflow: 'visible',
            }}
          >
            <div
              ref={editableRef}
              contentEditable="plaintext-only"
              suppressContentEditableWarning
              spellCheck={false}
              onInput={() => {
                broadcastLiveBounds();
                publishBridge();
              }}
              style={{
                width: '100%',
                outline: 'none',
                caretColor: '#007AFF',
                minHeight: '1em',
                // Never let the flex column squeeze the editor's box below
                // its content — vertical centering must center the REAL text
                // block, and height measurement reads this element.
                flexShrink: 0,
                // Inherit every text property from the shared style contract
                // container above — declaring none here is the point.
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
