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
import { createPortal, flushSync } from 'react-dom';
import { isTextColorValue } from '../utils/textColorOpacity';
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
import Icon from '../Icons';

const DEFAULT_FONT_FAMILY = 'Helvetica';

// ---------------------------------------------------------------------------
// Confirm / discard buttons under the open editor.
//
// UX 2026-09-16 — Drawboard PDF parity. Drawboard puts an explicit round tick
// and cross pair (measured: 25x25, sitting under the text box) on every open
// text editor, so committing and discarding are both one obvious tap instead of
// folklore about which key does what. Survey showed nothing at all.
//
// The visible circles are 24px and the tap targets are 44px (Apple's minimum,
// and the number the phone research pass called out as the thing Survey keeps
// missing). Both numbers are SCREEN pixels, deliberately: these are controls,
// like selection handles and marquees, not annotation ink, so they stay the
// same physical size at every zoom (CLAUDE.md — only annotation visuals scale
// in page units).
// RULED 2026-09-23 (owner: "sized a little smaller ... not colliding with
// the text box"): 20px discs with a 10px glyph, clear of the box frame.
const ACTION_BUTTON_VISUAL = 20;
const ACTION_TOUCH_TARGET = 44;
const ACTION_PAIR_GAP = 8;
const ACTION_PAIR_WIDTH = ACTION_TOUCH_TARGET * 2 + ACTION_PAIR_GAP;
// UX 2026-09-16 — the tick and the cross are the SHARED Icon set's 'check' and
// 'close', not hand-drawn glyphs. They were first shipped hand-drawn on 12x12
// and 13x13 boxes at stroke 1.8 / 1.9 (3.6 and 3.8 once normalised onto the
// house 24 grid) — over twice the house 1.5 weight, and the matched pair did not
// even match itself. Drawing them through <Icon> puts them on the one grid and
// the one weight every other glyph in the app uses, at ONE box size, so the pair
// reads as part of the set. Never inline these two again.
const ACTION_GLYPH_SIZE = 10;
// Gap between the bottom of the text box and the top of the tap targets. The
// visible circle is centred in its 44px pad, so the ink-to-ink gap reads as
// ACTION_BOX_GAP + 10, close to Drawboard's ~18px.
const ACTION_BOX_GAP = 4;
const ACTION_EDGE_MARGIN = 6;
// UX 2026-09-23 (owner: "that should never happen"): the tick/cross pair is
// part of the page, so it paints above the page and the text box and BELOW
// every bar, sheet, menu and modal. It used to sit at 2147483000, so with the
// phone's Font color sheet open the two discs showed on top of the sheet. The
// pair lives in a body portal (it has to escape the page's clipping), and the
// viewer tab wrapper that holds the page and the editor is a stacking context
// at z 5000 on desktop and phone alike (AppShell). Every chrome host starts at
// 5400 on desktop (Tooltip.jsx) and 5600 on the phone (rail 5600/5750, dock
// 5850, header 5900, sheets and backdrops 6400-7400 in mobilePdfViewer.css),
// so 5100 is one step above the page and under all of them.
const ACTION_PAIR_Z_INDEX = 5100;

const deepClone = (value) => JSON.parse(JSON.stringify(value));

// Nearest scrollable ancestor — used only for the on-screen-keyboard reveal.
const findScrollableAncestor = (node) => {
  let el = node?.parentElement || null;
  while (el && el !== document.body && el !== document.documentElement) {
    const style = window.getComputedStyle(el);
    const overflowY = style.overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay')
      && el.scrollHeight > el.clientHeight + 1) return el;
    el = el.parentElement;
  }
  return document.scrollingElement || document.documentElement;
};

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
  const boxRef = useRef(null);
  const committedRef = useRef(false);
  // Screen position of the tick/cross pair, in client px (see ACTION_* above).
  const [actionAnchor, setActionAnchor] = useState(null);

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
    // `meta` is the colour picker's drag phase (CompactColorPicker): a
    // callout's text colour drag previews per frame and records one undo step
    // on release (PDFViewer handleCalloutTextStyleChange).
    const applyStyle = (key, val, meta) => {
      styleRef.current = { ...styleRef.current, [key]: val };
      if (isCallout && typeof onCalloutTextStyleChange === 'function') {
        const patch = calloutStylePatch(key, val);
        if (patch) onCalloutTextStyleChange(reactCalloutId, patch, meta);
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
      // #rrggbb, or rgba() when the text colour carries an opacity
      // (utils/textColorOpacity, UX 2026-09-23).
      setFontColor: (c, meta) => applyStyle('fill', isTextColorValue(c) ? c : '#000000', meta),
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
        // Callout text is always vertically centred (buildCalloutTextContentStyle),
        // so the bar hides top / middle / bottom for it.
        supportsVerticalAlign: !isCallout,
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

  // ---------------------------------------------------------------------
  // Tick / cross placement (screen space).
  //
  // The pair is portaled to <body> and positioned with fixed coordinates read
  // off the live box, rather than being laid out inside the page-space div:
  // a `transform` on any ancestor makes `position: fixed` resolve against that
  // ancestor instead of the viewport, and the page-space div is scaled. Fixed
  // coordinates also keep the buttons a constant 24/44px at every zoom.
  //
  // visualViewport is the source of truth for "what the user can actually
  // see". On a phone the on-screen keyboard shrinks the visual viewport
  // without changing window.innerHeight, so plain viewport maths would park
  // the tick and cross underneath the keyboard. Clamped here: the pair prefers
  // to sit under the box, flips above it when the keyboard has taken that
  // space, and as a last resort pins to the bottom of the visible area.
  // ---------------------------------------------------------------------
  useLayoutEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const box = boxRef.current;
      if (!box || committedRef.current) return;
      const rect = box.getBoundingClientRect();
      const vv = typeof window !== 'undefined' ? window.visualViewport : null;
      const vLeft = vv?.offsetLeft ?? 0;
      const vTop = vv?.offsetTop ?? 0;
      const vWidth = vv?.width ?? window.innerWidth;
      const vHeight = vv?.height ?? window.innerHeight;

      let left = rect.left + (rect.width / 2) - (ACTION_PAIR_WIDTH / 2);
      left = Math.max(
        vLeft + ACTION_EDGE_MARGIN,
        Math.min(vLeft + vWidth - ACTION_PAIR_WIDTH - ACTION_EDGE_MARGIN, left),
      );

      const below = rect.bottom + ACTION_BOX_GAP;
      const highestAllowed = vTop + ACTION_EDGE_MARGIN;
      const lowestAllowed = vTop + vHeight - ACTION_TOUCH_TARGET - ACTION_EDGE_MARGIN;
      let top = below;
      if (below > lowestAllowed) {
        // No room under the box. Try directly above it — but only if THAT
        // lands inside the visible strip too. On a phone with the keyboard up,
        // a box sitting low on the page has no room above it either (both
        // sides are behind the keyboard), and the pair must still be tappable,
        // so it pins to the last row of visible screen.
        const above = rect.top - ACTION_BOX_GAP - ACTION_TOUCH_TARGET;
        top = (above >= highestAllowed && above <= lowestAllowed) ? above : lowestAllowed;
      }
      top = Math.max(highestAllowed, Math.min(lowestAllowed, top));

      setActionAnchor((prev) => (
        prev && prev.left === left && prev.top === top ? prev : { left, top }
      ));
    };
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(measure);
    };
    measure();
    // The page can move under the box without any scroll/resize event (a zoom
    // settle, a fit change, the viewer re-laying out), which left the pair
    // parked ON the box (owner 2026-09-23). A light per-frame check keeps it
    // under the box; measure() only sets state when the spot really changes.
    let follow = 0;
    const followLoop = () => { measure(); follow = requestAnimationFrame(followLoop); };
    follow = requestAnimationFrame(followLoop);
    const box = boxRef.current;
    const ro = box ? new ResizeObserver(schedule) : null;
    if (ro && box) ro.observe(box);
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', schedule);
    window.visualViewport?.addEventListener?.('resize', schedule);
    window.visualViewport?.addEventListener?.('scroll', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      cancelAnimationFrame(follow);
      ro?.disconnect();
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('orientationchange', schedule);
      window.visualViewport?.removeEventListener?.('resize', schedule);
      window.visualViewport?.removeEventListener?.('scroll', schedule);
    };
  }, [liveOuterH, effScale.x, effScale.y]);

  // On-screen keyboard reveal.
  //
  // UX 2026-09-16 — on a phone the keyboard slides up over the bottom of the
  // screen. If the box you are typing in is down there you end up typing blind.
  // When visualViewport reports that the keyboard has taken real estate (the
  // >=80px test keeps a browser URL bar collapse from counting), scroll the
  // viewer by the SMALLEST amount that brings the box and its tick/cross back
  // into the visible strip.
  //
  // This does not contradict the "opening an editor never moves the page" rule
  // above: that rule is about focus-time reveal, where the browser guesses
  // against a box whose final position has not landed yet. This fires only on a
  // real keyboard-open event, moves by a measured minimum, and never runs on
  // desktop (no keyboard inset, so it returns immediately).
  //
  // When the whole document already fits the screen there is nothing to scroll
  // and this does nothing — the keyboard simply covers part of the page, as it
  // does in every app. The tick/cross pair is clamped separately above, so it
  // stays reachable either way.
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return undefined;
    let frame = 0;
    const reveal = () => {
      frame = 0;
      const box = boxRef.current;
      if (!box || committedRef.current) return;
      const keyboardInset = window.innerHeight - (vv.height + vv.offsetTop);
      if (keyboardInset < 80) return;
      const needed = ACTION_BOX_GAP + ACTION_TOUCH_TARGET + ACTION_EDGE_MARGIN;
      const rect = box.getBoundingClientRect();
      const overflow = (rect.bottom + needed) - (vv.offsetTop + vv.height);
      if (overflow <= 0) return;
      const scroller = findScrollableAncestor(box);
      if (scroller) scroller.scrollTop += overflow;
    };
    // 2026-09-22: deferred one frame so the keyboard controller
    // (src/mobile/keyboardViewport.js) has published --keyboard-inset first.
    // That inset is what grows the PDF scroller's range; scrolling in the same
    // tick as the resize clamps short of the keyboard for a box on the last
    // line of the last page, and the caret stays hidden.
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(reveal);
    };
    vv.addEventListener('resize', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      vv.removeEventListener('resize', schedule);
    };
  }, []);

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

  // Escape COMMITS (capture, before app-level hotkeys); click-outside commits.
  //
  // UX 2026-09-16 — Drawboard PDF contract: Escape closes the editor and KEEPS
  // what you typed. Measured in the Drawboard web reference pass: "Escape —
  // KEEPS the text; box stays with the typed content." Survey used to throw the
  // text away, which is the one text behaviour a user cannot recover from.
  // Discarding is now reachable only through the explicit cross button beside
  // the tick, where the user is asking for it. An empty new box still
  // disappears: commitAndClose routes blank new text to onEditCancel, so
  // Escape on an untouched box leaves no stray annotation behind.
  //
  // flush: true — PDFViewer's select-family "clear everything" Escape listener
  // is registered on window/capture, so it runs BEFORE this document/capture
  // one and can null editingAnnotation in the same event. Committing
  // synchronously puts the annotation in the page JSON before React unmounts
  // this overlay, so persistence never depends on the unmount flush winning a
  // race against a detached editable.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        commitRef.current({ flush: true });
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
          ref={boxRef}
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
      {/* UX 2026-09-17 (revision-2 palette): the tick/cross pair below is the
          app's ONE light-surface control — a white disc and a blue disc drawn on
          the page, not on app chrome. tokens.css is a dark-surface set: its
          lightest ink is 1.8:1 on white and --text-disabled "fails contrast on
          purpose", so neither can ring or fill a control a user must see and tap.
          The rings and the cross therefore keep their literals (#cbd5e1 ring and
          #475569 cross on white, #1d4ed8 ring on the #2563eb tick). Guarded by
          tests/textEditActionDiscPalette.test.mjs. */}
      {actionAnchor && typeof document !== 'undefined' && createPortal(
        (
          <div
            // data-text-edit-overlay: the outside-click commit handler treats
            // anything inside the overlay as "still editing". The pair lives in
            // a body portal, so it has to carry the marker itself or tapping
            // the cross would commit on the way down and then find nothing to
            // cancel.
            data-text-edit-overlay
            data-text-edit-actions
            style={{
              position: 'fixed',
              left: actionAnchor.left,
              top: actionAnchor.top,
              width: ACTION_PAIR_WIDTH,
              height: ACTION_TOUCH_TARGET,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: ACTION_PAIR_GAP,
              pointerEvents: 'auto',
              zIndex: ACTION_PAIR_Z_INDEX,
            }}
            onPointerDown={(e) => { e.stopPropagation(); }}
            // preventDefault on mousedown keeps the caret and selection exactly
            // where they were — the button must not pull focus out of the
            // editable before it acts. pointerdown is deliberately NOT
            // cancelled: cancelling it suppresses the click these buttons run on.
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
          >
            <button
              type="button"
              // UX: cross = discard. Reverts to the text the box had when this
              // edit began; on a brand-new box (or a brand-new callout) there
              // was no earlier text, so the box is removed instead. Matches
              // Drawboard, which pairs its tick with a cross that throws the
              // edit away.
              title="Discard changes"
              aria-label="Discard changes"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); cancelRef.current(); }}
              style={ACTION_TAP_PAD_STYLE}
            >
              <span style={actionDiscStyle('#ffffff', '#cbd5e1')}>
                <Icon name="close" size={ACTION_GLYPH_SIZE} color="#475569" />
              </span>
            </button>
            <button
              type="button"
              // UX: tick = keep. Same commit the Escape key and a click outside
              // the box perform, given its own button so committing is never a
              // guess. Drawboard reference: round tick under the open text box.
              title="Keep text"
              aria-label="Keep text"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); commitRef.current({ flush: true }); }}
              style={ACTION_TAP_PAD_STYLE}
            >
              <span style={actionDiscStyle('#2563eb', '#1d4ed8')}>
                <Icon name="check" size={ACTION_GLYPH_SIZE} color="#ffffff" />
              </span>
            </button>
          </div>
        ),
        document.body,
      )}
    </div>
  );
}

// The 44px tap target itself is invisible — the user sees only the 24px disc
// the button wraps (see ACTION_* constants and the Drawboard note above).
const ACTION_TAP_PAD_STYLE = {
  width: ACTION_TOUCH_TARGET,
  height: ACTION_TOUCH_TARGET,
  padding: 0,
  margin: 0,
  border: 'none',
  background: 'transparent',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  outline: 'none',
  WebkitTapHighlightColor: 'transparent',
};

function actionDiscStyle(background, borderColor) {
  return {
    width: ACTION_BUTTON_VISUAL,
    height: ACTION_BUTTON_VISUAL,
    borderRadius: '50%',
    background,
    border: `1px solid ${borderColor}`,
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 1px 3px rgba(15,23,42,0.28)',
  };
}
