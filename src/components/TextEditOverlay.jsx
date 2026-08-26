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
  dashArrayFromLineBorderStyle,
  boxFillFromToolbar,
} from '../utils/textEditCommit.js';
import { composeAnnotationColor } from '../utils/annotationCreationCommit.js';
import { stampAnnotationCreationIdentity } from '../utils/annotationStorageIdentity.js';
import { shouldStampActiveRegionId } from '../utils/annotationVisibilityRules.js';
import { setCalloutEditDraft, clearCalloutEditDraft } from '../utils/calloutBlankCommit.js';

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

/** Survives overlay remount / unmount-flush after the contenteditable is gone. */
const editDraftByTarget = new Map();

function editDraftKey({ reactCalloutId, annotationData, isNewText }) {
  if (reactCalloutId) return `callout:${reactCalloutId}`;
  const id = annotationData?.id || annotationData?.data?.id;
  if (id) return `anno:${id}`;
  return isNewText ? 'new-text' : null;
}

function replaceTextInPageJson(annotations, annotationIndex, json, original, { isCallout = false } = {}) {
  const updated = deepClone(annotations || { objects: [] });
  if (!Array.isArray(updated.objects)) updated.objects = [];
  const targetId = (original?.data && original.data.id)
    ?? original?.id
    ?? (json?.data && json.data.id)
    ?? json?.id
    ?? null;
  const lookedUp = targetId != null
    ? updated.objects.findIndex((obj) => String(
      (obj?.data && obj.data.id) ?? obj?.id ?? ''
    ) === String(targetId))
    : -1;
  let liveIndex = lookedUp >= 0 ? lookedUp : annotationIndex;
  if (liveIndex == null || liveIndex < 0 || liveIndex >= updated.objects.length) {
    if (isCallout && updated.objects.length > 0) liveIndex = 0;
    else return null;
  }
  updated.objects[liveIndex] = json;
  return updated;
}

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
  textBoxWidth,
  newTextStyle = null,
  strokeColor,
  strokeOpacity,
  strokeWidth,
  fillColor,
  fillOpacity,
  lineBorderStyle = null,
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
  onTextStyleChange,
  onEditCommit,
  onEditCancel,
}) {
  const isCallout = !!reactCalloutId;
  const pad = TEXT_PADDING;
  const padY = isCallout ? 0 : pad;
  const draftKey = editDraftKey({ reactCalloutId, annotationData, isNewText });
  const draftTextRef = useRef(draftKey ? (editDraftByTarget.get(draftKey) ?? '') : '');
  const persistDraft = (text) => {
    draftTextRef.current = text;
    if (draftKey) editDraftByTarget.set(draftKey, text);
    if (reactCalloutId) setCalloutEditDraft(reactCalloutId, text);
  };
  const clearDraft = () => {
    draftTextRef.current = '';
    if (draftKey) editDraftByTarget.delete(draftKey);
    if (reactCalloutId) clearCalloutEditDraft(reactCalloutId);
  };

  // ---------------------------------------------------------------------
  // Immutable-per-mount edit context (the mount key remounts per target).
  // ---------------------------------------------------------------------
  const originalRef = useRef(null);
  const styleRef = useRef(null);
  const geomRef = useRef(null);
  const liveStyleAppliedRef = useRef(false);
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
        // Next-draw Color Border must ride the first box. Hardcoding
        // '#000000' dropped the toolbar until the user touched Border again
        // (selected-patch).
        // Next-draw Color Border + Border Opacity must ride the first box.
        // Hardcoding hex-only dropped the fade until Opacity was re-touched
        // (selected-patch composeColorForPatch).
        stroke: composeAnnotationColor(
          (typeof strokeColor === 'string' && strokeColor) ? strokeColor : '#000000',
          strokeOpacity,
        ),
        // Next-draw Width must ride the first box. Hardcoding 1 dropped the
        // toolbar until the user touched Width again (selected-patch).
        strokeWidth: Math.max(1, Number(strokeWidth) || 1),
        // Next-draw Style must ride the first box. Envelope null dropped
        // Dashed/Dotted until the user touched Style again (selected-patch).
        strokeDashArray: dashArrayFromLineBorderStyle(lineBorderStyle),
        // Next-draw Color Fill must ride the first box. Envelope '' dropped
        // a user-set Fill until the user touched Fill again (selected-patch
        // backgroundColor). Empty-default opacity 0 stays '' — do not invent
        // a first-create Fill on an empty-default textbox.
        backgroundColor: boxFillFromToolbar(fillColor, fillOpacity),
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
  const readText = () => {
    const el = editableRef.current;
    if (!el) return draftTextRef.current || (draftKey ? (editDraftByTarget.get(draftKey) || '') : '');
    // contentEditable=plaintext-only keeps '\n' text nodes under
    // white-space:pre-wrap; innerText also folds any stray <br> to '\n'.
    let t = el.innerText ?? '';
    t = t.replace(/\r\n?/g, '\n');
    // A trailing newline artifact appears when the last child is a <br>.
    if (t.endsWith('\n') && !(el.textContent || '').endsWith('\n')) t = t.slice(0, -1);
    persistDraft(t);
    return t;
  };

  const measureNaturalInnerHeight = () => {
    const el = editableRef.current;
    if (!el) return 0;
    // scrollHeight is untransformed layout units — page units under the
    // scaled page-space container — and reports CONTENT height even when
    // the flex container would squeeze the item's box (getBoundingClientRect
    // measures the flexed box, which under-reported by whole lines).
    return el.scrollHeight;
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
      ...(isNewText ? {
        stroke: s.stroke,
        strokeWidth: s.strokeWidth || 1,
        strokeDashArray: s.strokeDashArray || null,
        isCreating: true,
      } : {}),
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
      } else if (!isNewText && typeof onTextStyleChange === 'function') {
        const liveJson = buildExistingTextCommitJSON({
          original: originalRef.current,
          text: readText(),
          naturalInnerHeight: measureNaturalInnerHeight(),
          isCallout: false,
          style: styleRef.current,
        });
        const updated = liveJson
          ? replaceTextInPageJson(annotations, annotationIndex, liveJson, originalRef.current)
          : null;
        if (updated) {
          liveStyleAppliedRef.current = true;
          onTextStyleChange(updated);
        }
      }
      forceRender((n) => n + 1);
      // Style changes reflow the text — re-measure + rebroadcast after paint.
      requestAnimationFrame(() => { broadcastLiveBounds(); publishBridge(); });
      editableRef.current?.focus();
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
  }, [onRichTextEditorChange, onCalloutTextStyleChange, onTextStyleChange, isCallout, isNewText, reactCalloutId, broadcastLiveBounds, annotations, annotationIndex]);

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
        // Prefer live toolbar Color Border + Opacity at commit. styleRef is
        // mount-once; a missing first-render strokeColor used to freeze
        // '#000000' even after the next-draw prop arrived, and hex-only
        // dropped a next-draw fade.
        stroke: composeAnnotationColor(
          (typeof strokeColor === 'string' && strokeColor) ? strokeColor : (s.stroke || '#000000'),
          strokeOpacity,
        ),
        strokeWidth: s.strokeWidth ?? 1,
        // Prefer live toolbar Style at commit. styleRef is mount-once; a
        // missing first-render lineBorderStyle used to freeze envelope null.
        strokeDashArray: dashArrayFromLineBorderStyle(lineBorderStyle) ?? s.strokeDashArray ?? null,
        // Prefer live toolbar Color Fill at commit. styleRef is mount-once;
        // a missing first-render fillOpacity used to freeze envelope ''.
        // Empty-default opacity 0 still stamps ''.
        backgroundColor: boxFillFromToolbar(fillColor, fillOpacity) || s.backgroundColor || '',
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
      if (!json && isCallout && originalRef.current) {
        // E2E-ADV-01: new-callout chrome commit can flush after the
        // contenteditable is gone. Keep the textbox envelope and let
        // PDFViewer resolve typed / draft text instead of cancel-deleting.
        json = {
          ...deepClone(originalRef.current),
          text,
        };
      }
      if (!json) {
        // P1-28: blank existing text deletes the annotation, matching the
        // fabric discard-on-empty contract.
        const updated = deepClone(annotations || { objects: [] });
        if (!Array.isArray(updated.objects)) updated.objects = [];
        const targetId = (originalRef.current?.data && originalRef.current.data.id)
          ?? originalRef.current?.id
          ?? null;
        const liveIndex = targetId != null
          ? updated.objects.findIndex((obj) => String(
            (obj?.data && obj.data.id) ?? obj?.id ?? ''
          ) === String(targetId))
          : annotationIndex;
        const removeAt = liveIndex >= 0 ? liveIndex : annotationIndex;
        if (removeAt >= 0 && removeAt < updated.objects.length) {
          updated.objects.splice(removeAt, 1);
          if (opts.flush) flushSync(() => onEditCommit(updated));
          else onEditCommit(updated);
          return;
        }
        if (typeof onEditCancel === 'function') onEditCancel();
        return;
      }
    }

    const updated = deepClone(annotations || { objects: [] });
    if (!Array.isArray(updated.objects)) updated.objects = [];
    if (isNewText) updated.objects.push(json);
    else {
      // P1-07: re-resolve by stable id. A teammate insert/delete while the
      // editor is open shifts indices; writing the frozen index can replace
      // an unrelated annotation.
      const targetId = (originalRef.current?.data && originalRef.current.data.id)
        ?? originalRef.current?.id
        ?? (json?.data && json.data.id)
        ?? json?.id
        ?? null;
      const lookedUp = targetId != null
        ? updated.objects.findIndex((obj) => String(
          (obj?.data && obj.data.id) ?? obj?.id ?? ''
        ) === String(targetId))
        : -1;
      // Callout textboxes from toFabricGroup only carry data.calloutPart.
      // ensureTextAnnotationId may mint a fresh id on commit; looking that
      // up fails and used to onEditCancel — which deletes a brand-new
      // callout (E2E-ADV-01). Fall back to the frozen index / the single
      // transient textbox instead of cancel-deleting.
      let liveIndex = lookedUp >= 0 ? lookedUp : annotationIndex;
      if (liveIndex == null || liveIndex < 0 || liveIndex >= updated.objects.length) {
        if (isCallout && updated.objects.length > 0) {
          liveIndex = 0;
        } else {
          if (typeof onEditCancel === 'function') onEditCancel();
          return;
        }
      }
      updated.objects[liveIndex] = json;
    }

    const skipStyleReplay = !isNewText
      && liveStyleAppliedRef.current
      && String(text) === String(originalRef.current?.text ?? '');
    const commitOpts = skipStyleReplay ? { checkpointPolicy: 'skip' } : undefined;
    if (opts.flush) {
      flushSync(() => onEditCommit(updated, commitOpts));
    } else {
      onEditCommit(updated, commitOpts);
    }
    clearDraft();
  }, [annotations, annotationIndex, isNewText, isCallout, onEditCommit, onEditCancel, onRichTextEditorChange, pad, authorId, strokeColor, strokeOpacity, fillColor, fillOpacity, lineBorderStyle,
    // KAL-88 scope-stamp inputs — keep the commit closure stamping from
    // current values (the unmount flush reads via commitRef, which tracks
    // this callback).
    pageNumber, selectedModuleId, selectedSpaceId, activeRegionId, spaces, isRegionOverlayEnabled]);

  const cancelAndClose = useCallback(() => {
    if (committedRef.current) return;
    committedRef.current = true;
    if (draftKey) editDraftByTarget.delete(draftKey);
    if (typeof onRichTextEditorChange === 'function') onRichTextEditorChange(null);
    if (typeof onEditCancel === 'function') onEditCancel();
  }, [onEditCancel, onRichTextEditorChange, draftKey]);

  const commitRef = useRef(commitAndClose);
  useEffect(() => { commitRef.current = commitAndClose; }, [commitAndClose]);
  const cancelRef = useRef(cancelAndClose);
  useEffect(() => { cancelRef.current = cancelAndClose; }, [cancelAndClose]);

  // Mount: seed text, focus, select-all for existing text (parity with the
  // fabric path's enterEditing + selectAll), initial broadcasts.
  useEffect(() => {
    const el = editableRef.current;
    if (el) {
      const seeded = (draftKey && editDraftByTarget.get(draftKey))
        || (isNewText ? '' : String(annotationData?.text ?? ''));
      el.textContent = seeded;
      persistDraft(seeded);
      el.focus();
      if (!isNewText && el.firstChild) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
    broadcastLiveBounds();
    publishBridge();
    return () => {
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
    const onDocMouseDown = (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.closest('[data-text-edit-overlay]')) return;
      // Formatting sub-row + mini toolbar buttons must not commit-and-close
      // (same opt-out attribute contract as FabricEditCanvas).
      if (
        t.closest('[data-rich-text-toolbar]')
        || t.closest('[data-mini-toolbar]')
        || t.closest('[data-font-color-picker]')
        || t.closest('[data-testid="compact-color-picker"]')
        || t.closest('[data-mobile-tool-properties]')
        || t.closest('.mobile-styled-select__menu')
      ) return;
      commitRef.current();
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('mousedown', onDocMouseDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('mousedown', onDocMouseDown, true);
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
      data-first-create-stroke={isNewText ? ((typeof strokeColor === 'string' && strokeColor) ? strokeColor : (styleRef.current?.stroke || '')) : undefined}
      data-first-create-stroke-opacity={isNewText ? String(Number.isFinite(Number(strokeOpacity)) ? Number(strokeOpacity) : 100) : undefined}
      data-first-create-stroke-paint={isNewText ? composeAnnotationColor(
        (typeof strokeColor === 'string' && strokeColor) ? strokeColor : (styleRef.current?.stroke || '#000000'),
        strokeOpacity,
      ) : undefined}
      data-first-create-dash={isNewText
        ? (dashArrayFromLineBorderStyle(lineBorderStyle) || []).join(',')
        : undefined}
      data-first-create-fill={isNewText ? ((typeof fillColor === 'string' && fillColor) ? fillColor : '') : undefined}
      data-first-create-fill-opacity={isNewText ? String(Number.isFinite(Number(fillOpacity)) ? Number(fillOpacity) : 0) : undefined}
      data-first-create-fill-paint={isNewText ? (boxFillFromToolbar(fillColor, fillOpacity) || '') : undefined}
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
              editableRef.current?.focus();
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
