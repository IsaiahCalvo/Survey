/**
 * Callout Edit Adapter — Phase 14 Plan 14-01
 *
 * Pure utility module that bridges two shapes:
 *   - React callout (normalized 0-1 coords, stored in App.jsx:11024 `callouts[]`)
 *   - Fabric.js JSON group (page coords, loaded by FabricEditCanvas.jsx:1937
 *     `loadCalloutAnnotation` via fabric.util.enlivenObjects)
 *
 * Exports three pure functions:
 *   - sanitizeFontFamily(raw) — strips CSS fallback stacks to a single font
 *     name. Required because Fabric.js Textbox measures chars at
 *     CACHE_FONT_SIZE=400px and the browser may resolve different fonts in a
 *     fallback chain at 400px vs actual display size, producing wrong widths
 *     and cursor drift. See CLAUDE.md 2026-04-08 gotcha + Phase 14-RESEARCH.md
 *     Pitfall 2.
 *   - toFabricGroup(reactCallout, pageSize) — returns a plain JSON-serializable
 *     shape with `objects: [...]` array + `reactCalloutId` metadata, suitable
 *     for assignment to `FabricEditCanvas` `annotationsRef.current`. NOT a
 *     live fabric.Group instance — kept pure for testability and to avoid
 *     Fabric.js Group positioning side effects that would break the 1e-6
 *     round-trip precision requirement (Pitfall 7 in 14-RESEARCH.md).
 *   - fromFabricGroup(groupOrJson, pageSize, originalReactCallout) — reverse
 *     adapter; reads updated positions from the group's `objects[]` array and
 *     normalizes back to 0-1 coords. Accepts either the pure JSON shape
 *     produced by toFabricGroup OR a live fabric.Group exposing .getObjects().
 *   - buildCalloutRenderSpec(callout, index, pageSize, calculateConnection) —
 *     NOT in the plan's export list but added as a pure testable helper. The
 *     JSX `renderCallout` in svgAnnotationRenderers.jsx wraps this helper with
 *     React.createElement, so unit tests (which cannot load .jsx directly from
 *     Node --test) verify the contract via this function. The JSX wrapper is
 *     a thin 1:1 mapping: spec.type → element tag, spec.attrs → props,
 *     spec.children → recursive wrap.
 *
 * Zero component imports — pure utility. Fabric.js is intentionally NOT
 * imported here to keep the module JSX/React-free and Node --test compatible.
 */

/**
 * Strip a CSS fallback stack down to a single font name.
 *
 * Examples:
 *   'Inter, Arial, sans-serif'  →  'Inter'
 *   '"Helvetica Neue", Arial'   →  'Helvetica Neue'   (quotes stripped)
 *   '   Times New Roman  '      →  'Times New Roman'  (trimmed)
 *   null / undefined            →  'Arial'            (safe default)
 *
 * @param {string|null|undefined} raw
 * @returns {string}
 */
import { deepClone } from './deepClone.js';
// Shared arrowhead spec — ONE home for the head math (lineRenderHelpers.js),
// consumed identically by the arrow tool, the live JSX renderCallout, the
// canvas painter, the PDF export, and this testable spec builder. Pure JS.
import {
  ARROWHEAD_STYLES,
  buildArrowheadRenderSpec,
  calloutLineDashArray,
} from './lineRenderHelpers.js';

export function sanitizeFontFamily(raw) {
  if (raw == null) return 'Arial';
  const first = String(raw).split(',')[0];
  if (!first) return 'Arial';
  const stripped = first.trim().replace(/^['"]+|['"]+$/g, '').trim();
  return stripped.length > 0 ? stripped : 'Arial';
}

/**
 * Convert a React callout (normalized 0-1 coords) into a plain JSON shape
 * suitable for `FabricEditCanvas.annotationsRef.current` — the same format
 * `loadCalloutAnnotation` already expects for legacy PAL Fabric-Group callouts.
 *
 * Returns an object with:
 *   - objects: array of 4 plain JSON Fabric objects (line1, line2, textbox,
 *     arrowTip circle) in PAGE coordinates. The textbox IS the visible box —
 *     it carries its own stroke/rx/ry and is the single source of truth for
 *     the callout's text-card bounds. Phase 15 UAT-2 (2026-04-17): the
 *     previous 5-object shape had a separate `rect` child that did not resize
 *     as the Fabric Textbox grew during edit, producing a visible
 *     rect/textbox disconnect while typing. The unified model mirrors regular
 *     text annotations (FabricTextCanvas :148-164), so the box-is-the-textbox.
 *   - reactCalloutId: the original React callout.id, stashed for Plan 14-03's
 *     App.jsx commit wrapper to route save-backs to setCallouts
 *   - reactCalloutSnapshot: frozen copy of the input for round-trip fidelity
 *     (used by fromFabricGroup as fallback for unchanged fields)
 *
 * @param {object} reactCallout — see src/components/Callout/types.js
 * @param {{width:number, height:number}} pageSize
 * @returns {{objects:Array, reactCalloutId:string, reactCalloutSnapshot:object, getObjects:function}}
 */
export function toFabricGroup(reactCallout, pageSize) {
  const { width: W, height: H } = pageSize;
  const at = reactCallout.arrowTip;
  const k = reactCallout.knee;
  const tb = reactCallout.textBoxPosition;
  const tbW = reactCallout.textBoxWidth * W;
  const tbH = reactCallout.textBoxHeight * H;
  const tbX = tb.x * W;
  const tbY = tb.y * H;
  const style = reactCallout.style || {};

  // Phase 15 UAT-2 (2026-04-17): same 2-tier lookup as renderCallout
  // (svgAnnotationRenderers.jsx :725) + buildCalloutRenderSpec (:322). Legacy
  // callouts stored with style.lineColor but no style.borderColor would render
  // a colored border in view and a slate-default border in edit without this
  // fallback.
  const stroke = style.borderColor || style.lineColor || '#1e293b';
  const strokeWidth = style.lineThickness || 2;
  // UX (2026-07-17): carry style.lineStyle into the edit-overlay children so
  // a dashed/dotted callout keeps its dash while being edited (Fabric lines
  // honor strokeDashArray). Absent lineStyle → no key, legacy shape intact.
  const editLeaderDash = calloutLineDashArray(style.lineStyle);
  const editDashProps = editLeaderDash ? { strokeDashArray: editLeaderDash } : {};

  // Plain JSON Fabric object shapes. `fabric.util.enlivenObjects` in
  // loadCalloutAnnotation will materialize these into live instances with
  // `type: 'line' | 'rect' | 'circle' | 'textbox'` as the discriminator.
  const line1 = {
    type: 'line',
    // Fabric serializes line endpoints as x1/y1/x2/y2 at the object level
    x1: tbX + tbW / 2,
    y1: tbY + tbH / 2,
    x2: k.x * W,
    y2: k.y * H,
    stroke,
    strokeWidth,
    strokeUniform: true,
    ...editDashProps,
    data: { calloutPart: 'line1' },
  };
  const line2 = {
    type: 'line',
    x1: k.x * W,
    y1: k.y * H,
    x2: at.x * W,
    y2: at.y * H,
    stroke,
    strokeWidth,
    strokeUniform: true,
    ...editDashProps,
    data: { calloutPart: 'line2' },
  };
  const tipDot = {
    type: 'circle',
    left: at.x * W - 3,
    top: at.y * H - 3,
    radius: 3,
    fill: stroke,
    data: { calloutPart: 'arrowTip' },
  };
  // Phase 15 UAT-2 (2026-04-17): textbox IS the box. No separate rect child.
  // The textbox carries its own stroke/rx/ry — when the user types and the
  // Textbox auto-grows vertically, the visible border grows with it (same
  // source of truth). Matches regular text annotations (FabricTextCanvas
  // defaults :148-164) + renderText's borderless-textbox render path
  // (svgAnnotationRenderers.jsx :623-675).
  const textbox = {
    type: 'textbox',
    // UX: textbox sits at the full callout box bounds (no +8/+4 padding
    // offset). Breathing room between text and border comes from the inner
    // div's CSS padding in renderCallout (:851-854). Fabric Textbox height
    // cannot be pinned (always auto-sizes to content); this is now the whole
    // callout box's height too.
    left: tbX,
    top: tbY,
    width: tbW,
    height: tbH,
    fontSize: style.fontSize || 14,
    // UX 2026-04-20: callout cursor drift fix. Fabric 5.5.2 Textbox uses
    // lineHeight * _fontSizeMult for cursor y-offset but measured glyph
    // metrics for text y-offset, producing ~0.23 px drift per wrapped
    // line at lineHeight=1.16 default. Pinning lineHeight=1 (the same
    // value the plain-text annotation edit path uses in
    // FabricEditCanvas.jsx) collapses both formulas to fontSize *
    // _fontSizeMult so cursor and glyphs step in lockstep through any
    // number of wrapped lines. The SVG view-mode CSS line-height in
    // svgAnnotationRenderers.jsx uses the same `lineHeight * 1.13`
    // formula — updating lineHeight here keeps view and edit in sync.
    lineHeight: 1,
    // Pitfall 2: single-name fontFamily only — strip fallback stacks
    fontFamily: sanitizeFontFamily(style.fontFamily),
    // Respect author-specified alignment from imported PDFs.
    textAlign: style.textAlign || 'left',
    fontWeight: style.bold ? 'bold' : 'normal',
    // UX (2026-07-17): carry the remaining stored style flags into the edit
    // textbox. This child seeds TextEditOverlay's styleRef at edit entry, so
    // without these the editor (and its formatting toolbar state) silently
    // dropped italic/underline/strikethrough that the committed SVG render
    // now draws (buildCalloutTextContentStyle parity fix).
    fontStyle: style.italic ? 'italic' : 'normal',
    underline: !!style.underline,
    linethrough: !!style.strikethrough,
    fill: style.fontColor || '#1e293b',
    text: reactCallout.text || '',
    // UX: splitByGrapheme matches regular text annotation behavior
    // (loadTextAnnotation:1360) — text wraps at the fixed width and the
    // Textbox grows vertically.
    splitByGrapheme: true,
    // UX: callout box styling — textbox owns its own border and corners.
    // strokeWidth matches the SVG rect's rendered border thickness
    // (renderCallout line 808: Math.max(1, lineThickness * 0.7)).
    stroke,
    strokeWidth: Math.max(1, strokeWidth * 0.7),
    strokeUniform: true,
    // UX (2026-07-17): box border shares the leader's line style in edit
    // mode too (shapes' Style-picker precedent).
    ...editDashProps,
    rx: 0,
    ry: 0,
    // UX: transparent selection chrome — same pattern as regular text
    // annotations. The textbox's own stroke is the only visible outline.
    // backgroundColor stays empty per user 2026-04-17 decision: callouts
    // are clear inside for now (mini-toolbar later controls fill).
    cursorColor: '#007AFF',
    editingBorderColor: 'transparent',
    borderColor: 'transparent',
    backgroundColor: '',
    textBackgroundColor: '',
    hasBorders: false,
    hasControls: false,
    data: { calloutPart: 'textBox' },
  };

  // Order: [line1, line2, textbox, tipDot]. fromFabricGroup reads by
  // data.calloutPart to stay robust to child-array ordering changes in
  // App.jsx's onEditCommit synthesis.
  const objects = [line1, line2, textbox, tipDot];

  // Plan 14-03's App.jsx commit wrapper uses `reactCalloutId` to route the
  // save back to setCallouts instead of setAnnotationsByPage. Mirror the
  // `{ data: { type: 'callout' } }` convention that loadCalloutAnnotation
  // already uses to identify callout groups.
  const groupResult = {
    objects,
    reactCalloutId: reactCallout.id,
    reactCalloutSnapshot: deepClone(reactCallout),
    data: { type: 'callout' },
  };

  // Convenience accessor for tests/wiring. Non-enumerable because Fabric 7
  // enlivenObjects drops groups when plain JSON includes function-valued props.
  Object.defineProperty(groupResult, 'getObjects', {
    value() { return this.objects; },
    enumerable: false,
    configurable: true,
  });

  // UX 2026-04-22: diagnostic log gated behind window.__CALLOUT_LIFECYCLE_DIAG = true.
  // Dumps the full React->Fabric edit-entry snapshot so any divergence between
  // imported and native callouts at edit time is captured in one log line.
  try {
    if (typeof window !== 'undefined' && window.__CALLOUT_LIFECYCLE_DIAG) {
      console.log('[CalloutLifecycle state->edit]', JSON.stringify({
        ts: new Date().toISOString(),
        stage: 'react-to-fabric-edit-entry',
        calloutId: reactCallout.id,
        isPdfImported: !!reactCallout.isPdfImported,
        pdfAnnotationId: reactCallout.pdfAnnotationId || null,
        pageSize: { width: W, height: H },
        reactSnapshot: reactCallout,
        textboxSpec: {
          left: textbox.left, top: textbox.top,
          width: textbox.width, height: textbox.height,
          fontFamily: textbox.fontFamily, fontSize: textbox.fontSize,
          lineHeight: textbox.lineHeight, textAlign: textbox.textAlign,
          splitByGrapheme: textbox.splitByGrapheme, fill: textbox.fill,
          stroke: textbox.stroke, strokeWidth: textbox.strokeWidth,
        },
      }));
    }
  } catch (_e) { /* diag must never throw */ }

  return groupResult;
}

/**
 * Reverse adapter: convert an edited Fabric group (plain JSON or live
 * fabric.Group) back to the React callout shape (normalized 0-1 coords).
 *
 * For the 1e-6 round-trip precision requirement, the math is integer-clean:
 * multiply by W/H in toFabricGroup, divide by the same W/H in fromFabricGroup.
 * No intermediate rounding, no accumulation errors, regardless of cycle count.
 *
 * @param {{getObjects?:function, objects?:Array, _objects?:Array}} fabricGroup
 * @param {{width:number, height:number}} pageSize
 * @param {object} originalReactCallout — merged-into as the baseline; fields
 *   not present in the group are inherited from this object.
 * @returns {object} — updated React callout in normalized coords
 */
export function fromFabricGroup(fabricGroup, pageSize, originalReactCallout) {
  const { width: W, height: H } = pageSize;
  // Prefer .getObjects() (live fabric.Group) → .objects (plain shape from
  // toFabricGroup) → ._objects (legacy fabric.Group private field) in that
  // order. Keeps the adapter compatible with both shapes.
  let children;
  if (typeof fabricGroup.getObjects === 'function') {
    children = fabricGroup.getObjects();
  } else if (Array.isArray(fabricGroup.objects)) {
    children = fabricGroup.objects;
  } else if (Array.isArray(fabricGroup._objects)) {
    children = fabricGroup._objects;
  } else {
    children = [];
  }

  // Phase 15 UAT-2 (2026-04-17): read by data.calloutPart marker, not by
  // index. App.jsx's onEditCommit synthesis rebuilds the children array from
  // [...nonTextChildren, editedTextbox], which may reorder from toFabricGroup's
  // original [line1, line2, textbox, tipDot]. Part-marker lookup is robust to
  // both shapes and to any future re-ordering.
  const findByPart = (partName) =>
    children.find((c) => c && c.data && c.data.calloutPart === partName) || {};
  // Legacy-shape fallback: old 5-object groups (pre-UAT-2) used part='textBox'
  // on the rect and part='text' on the textbox. When a textbox isn't found by
  // part='textBox', try part='text'. If still not found, fall back to finding
  // any type==='textbox' child (covers live fabric.Group instances that may
  // strip the data marker during enliven).
  let textbox = findByPart('textBox');
  if (!textbox.type) textbox = findByPart('text');
  if (!textbox.type) {
    textbox = children.find((c) => c && c.type === 'textbox') || {};
  }
  // Line1: textbox-center → knee. Line1.x2/y2 is the knee point.
  const line1 = findByPart('line1');
  // Line2: knee → arrowTip. Line2.x2/y2 is the arrow tip point.
  const line2 = findByPart('line2');

  // Knee comes from line1's end (x2, y2) — that's where line1 meets line2.
  // ArrowTip comes from line2's end (x2, y2) — that's where the callout points.
  const kneePx = { x: line1.x2 ?? 0, y: line1.y2 ?? 0 };
  const arrowTipPx = { x: line2.x2 ?? 0, y: line2.y2 ?? 0 };
  // Textbox IS the box. Read bounds directly from the textbox. Fabric Textbox
  // auto-sizes height to content, so this reflects whatever final dimensions
  // the Textbox ended with after user typed.
  const tbLeft = textbox.left ?? 0;
  const tbTop = textbox.top ?? 0;
  const scaleX = textbox.scaleX ?? 1;
  const scaleY = textbox.scaleY ?? 1;
  const tbWidth = (textbox.width ?? 0) * scaleX;
  const tbHeight = (textbox.height ?? 0) * scaleY;

  const commitResult = {
    ...originalReactCallout,
    arrowTip: { x: arrowTipPx.x / W, y: arrowTipPx.y / H },
    knee: { x: kneePx.x / W, y: kneePx.y / H },
    textBoxPosition: { x: tbLeft / W, y: tbTop / H },
    textBoxWidth: tbWidth / W,
    textBoxHeight: tbHeight / H,
    text: textbox.text ?? originalReactCallout.text ?? '',
  };

  // UX 2026-04-22: diagnostic log gated behind window.__CALLOUT_LIFECYCLE_DIAG = true.
  // Dumps the Fabric->React commit snapshot so any drift on save (position,
  // text, bounds) is captured alongside the edit-entry log above.
  try {
    if (typeof window !== 'undefined' && window.__CALLOUT_LIFECYCLE_DIAG) {
      console.log('[CalloutLifecycle edit->commit]', JSON.stringify({
        ts: new Date().toISOString(),
        stage: 'fabric-edit-to-react-commit',
        calloutId: originalReactCallout?.id || null,
        isPdfImported: !!originalReactCallout?.isPdfImported,
        pdfAnnotationId: originalReactCallout?.pdfAnnotationId || null,
        pageSize: { width: W, height: H },
        fabricChildrenSummary: {
          childCount: children.length,
          parts: children.map((c) => c?.data?.calloutPart || c?.type || 'unknown'),
        },
        textboxSnapshot: {
          left: tbLeft, top: tbTop,
          rawWidth: textbox.width ?? 0, rawHeight: textbox.height ?? 0,
          scaleX, scaleY,
          scaledWidth: tbWidth, scaledHeight: tbHeight,
          text: textbox.text,
          fontFamily: textbox.fontFamily, fontSize: textbox.fontSize,
        },
        linePixels: { knee: kneePx, arrowTip: arrowTipPx },
        originalReactCallout,
        committedReactCallout: commitResult,
      }));
    }
  } catch (_e) { /* diag must never throw */ }

  return commitResult;
}

/**
 * Build a pure-data spec tree describing the SVG elements that `renderCallout`
 * in svgAnnotationRenderers.jsx should emit. The JSX renderer wraps this spec
 * with React.createElement calls 1:1 — every spec node maps to one element.
 *
 * Spec shape:
 *   {
 *     type: 'g' | 'line' | 'rect' | 'circle' | 'foreignObject' | 'div',
 *     key?: string,
 *     attrs: { 'data-callout-*'?: string, x?: number, ... },
 *     style?: object,   // for foreignObject inner div
 *     children?: Array  // recursive
 *   }
 *
 * Returning a pure spec (not a React element) keeps this helper Node-testable
 * — tests/calloutRenderer.test.mjs verifies the spec tree without needing a
 * .jsx file or jsdom.
 *
 * @param {object|null} callout
 * @param {number} index
 * @param {{width:number, height:number}|null} pageSize
 * @param {Function} calculateConnection
 * @returns {object|null}
 */
export function buildCalloutRenderSpec(callout, index, pageSize, calculateConnection) {
  if (!callout || !callout.arrowTip || !callout.knee) return null;
  const pw = pageSize?.width ?? 0;
  const ph = pageSize?.height ?? 0;

  // Normalized (0-1) → page coords
  const arrowTip = {
    x: callout.arrowTip.x * pw,
    y: callout.arrowTip.y * ph,
  };
  const knee = {
    x: callout.knee.x * pw,
    y: callout.knee.y * ph,
  };
  const textBox = {
    x: (callout.textBoxPosition?.x ?? callout.textBox?.x ?? 0) * pw,
    y: (callout.textBoxPosition?.y ?? callout.textBox?.y ?? 0) * ph,
    width: Math.max(18, (callout.textBoxWidth ?? callout.textBox?.width ?? 0.1) * pw),
    height: Math.max(18, (callout.textBoxHeight ?? callout.textBox?.height ?? 0.05) * ph),
  };

  // Style extraction — defaults aligned with renderCallout + Fabric edit
  // overlay post-Phase-15-UAT-2 (2026-04-17). Mirrors renderCallout :725-727
  // exactly so view and edit render identically.
  const lineColor = callout.style?.borderColor || callout.style?.lineColor || '#1e293b';
  const lineThickness = Math.max(1, callout.style?.lineThickness || 2);
  const fillColor = callout.style?.fillColor || 'transparent';
  const fillOpacity = Math.max(0.08, Math.min(1, callout.style?.fillOpacity ?? 0.4));
  const borderOpacity = Math.max(0.2, Math.min(1, callout.style?.borderOpacity ?? 1));
  // Pitfall 2: sanitize fontFamily at the render surface (single-name only)
  const safeFontFamily = sanitizeFontFamily(callout.style?.fontFamily);

  // Connection geometry — routes line1 from textbox-edge to knee, handles
  // shouldHideLine1 when the knee lies inside the textbox.
  const connection = calculateConnection(
    textBox.x, textBox.y, textBox.width, textBox.height,
    knee, arrowTip, lineThickness
  );

  const key = `callout-${callout.id || index}`;

  // Shared line style — non-scaling stroke + round line caps for feel parity
  // with the rest of the annotation renderers.
  // UX (2026-07-17): style.lineStyle ('solid'|'dashed'|'dotted') emits the
  // shared dash pattern on both leader segments — mirrors the live JSX
  // renderCallout exactly (shapes' Style-picker semantics; arrowhead stays
  // solid). Absent lineStyle → no strokeDasharray key (legacy spec shape
  // byte-identical).
  const specLeaderDash = calloutLineDashArray(callout.style?.lineStyle);
  const lineStrokeAttrs = {
    stroke: lineColor,
    strokeWidth: lineThickness,
    strokeLinecap: 'round',
    vectorEffect: 'non-scaling-stroke',
    ...(specLeaderDash ? { strokeDasharray: specLeaderDash.join(' ') } : {}),
  };

  const children = [];

  // Line 1 — textbox edge → knee. Skipped when the knee lies inside the box
  // (connector routing simplifies to a single line2 segment in that case).
  if (!connection.shouldHideLine1) {
    children.push({
      type: 'line',
      key: 'line1',
      // UX: data-callout-part='line1' enables Phase 17 collision math to
      // hit-test the first connector segment for clamp logic. (CALL-10)
      attrs: {
        'data-callout-part': 'line1',
        x1: connection.line1Start.x,
        y1: connection.line1Start.y,
        x2: connection.effectiveKnee.x,
        y2: connection.effectiveKnee.y,
        ...lineStrokeAttrs,
      },
    });
  }

  // UX: arrowhead — same resolution + shared spec the live JSX renderCallout
  // uses (svgAnnotationRenderers.jsx): explicit style.arrowheadStyle wins,
  // else default to solid triangle so callouts share the arrow tool's default
  // look. Angle is the tangent of line2 (effective knee → arrowTip).
  const arrowheadStyle = callout.style?.arrowheadStyle ?? ARROWHEAD_STYLES.SOLID_TRIANGLE;
  const arrowAngleDeg = (
    Math.atan2(arrowTip.y - connection.line2Start.y, arrowTip.x - connection.line2Start.x)
    * 180
  ) / Math.PI;
  const arrowheadSpec = buildArrowheadRenderSpec(
    arrowheadStyle, arrowTip.x, arrowTip.y, arrowAngleDeg, lineColor, lineThickness
  );
  // UX: shorten line2 into the back of the head for the triangle styles so
  // the line tail doesn't poke through the point — same formula the live
  // renderer and the arrow tool use (offset by headSize/3 along the tangent).
  let line2EndX = arrowTip.x;
  let line2EndY = arrowTip.y;
  if (arrowheadStyle === ARROWHEAD_STYLES.SOLID_TRIANGLE
      || arrowheadStyle === ARROWHEAD_STYLES.OPEN_TRIANGLE) {
    const headSize = Math.max(8, lineThickness * 3);
    const angleRad = (arrowAngleDeg * Math.PI) / 180;
    line2EndX = arrowTip.x - (headSize / 3) * Math.cos(angleRad);
    line2EndY = arrowTip.y - (headSize / 3) * Math.sin(angleRad);
  }

  // Line 2 — knee → arrowTip. Always rendered (the arrow direction line).
  children.push({
    type: 'line',
    key: 'line2',
    // UX: data-callout-part='line2' enables Phase 18 Liang-Barsky auto-routing
    // to identify the tip-direction segment. (CALL-10)
    attrs: {
      'data-callout-part': 'line2',
      x1: connection.line2Start.x,
      y1: connection.line2Start.y,
      x2: line2EndX,
      y2: line2EndY,
      ...lineStrokeAttrs,
    },
  });

  // Arrowhead — one of the 6 shared styles (or nothing for NONE). Mirrors the
  // live JSX renderArrowheadEl mapping 1:1: spec.kind → element tag + attrs.
  // Replaced the old placeholder filled-circle 'arrowTip' node when callouts
  // adopted the arrow tool's shared arrowhead machinery.
  const arrowheadNode = (() => {
    switch (arrowheadSpec.kind) {
      case 'solidTriangle':
      case 'openTriangle':
      case 'diamond':
      case 'square':
        return { type: 'polygon', key: 'arrowhead', attrs: { ...arrowheadSpec.polygon } };
      case 'openCircle':
        return { type: 'circle', key: 'arrowhead', attrs: { ...arrowheadSpec.circle } };
      case 'vShape':
        return { type: 'polyline', key: 'arrowhead', attrs: { ...arrowheadSpec.polyline } };
      case 'slash':
      case 'horizontalLine':
        return { type: 'line', key: 'arrowhead', attrs: { ...arrowheadSpec.line } };
      default:
        return null;
    }
  })();
  if (arrowheadNode) children.push(arrowheadNode);

  // Text box — rounded rectangle with fill + border, hit-testable for drag.
  children.push({
    type: 'rect',
    key: 'textBox',
    // UX: data-callout-part='textBox' — Phase 14 drag target + Phase 17
    // collision clamp hit-test surface. (CALL-10)
    attrs: {
      'data-callout-part': 'textBox',
      x: textBox.x,
      y: textBox.y,
      width: textBox.width,
      height: textBox.height,
      fill: fillColor,
      fillOpacity: fillOpacity,
      stroke: lineColor,
      strokeWidth: Math.max(1, lineThickness * 0.7),
      // UX (2026-07-17): box border shares the leader's line style —
      // shapes' precedent (the Style picker dashes a rect's outline).
      ...(specLeaderDash ? { strokeDasharray: specLeaderDash.join(' ') } : {}),
      rx: 0,
      ry: 0,
      vectorEffect: 'non-scaling-stroke',
    },
  });

  // Text content — always render the foreignObject (even when text is empty)
  // so the data-callout-part='text' hit-test surface exists for double-click
  // edit-mode entry. Empty-text hide behavior lives in the foreignObject's
  // inner div (it's just a blank string).
  children.push({
    type: 'foreignObject',
    key: 'text',
    // UX: data-callout-part='text' — double-click edit-mode entry hit-test
    // surface. Phase 14 Area 2c dispatches onRequestEditMode(id, 'callout')
    // when this element is double-clicked. (CALL-10)
    attrs: {
      'data-callout-part': 'text',
      x: textBox.x,
      y: textBox.y,
      width: textBox.width,
      height: textBox.height,
    },
    children: [
      {
        type: 'div',
        key: 'text-inner',
        attrs: {
          xmlns: 'http://www.w3.org/1999/xhtml',
        },
        // UX: inner div style mirrors renderText at svgAnnotationRenderers.jsx:457
        // — single-name fontFamily prevents Fabric.js cursor drift (CLAUDE.md
        // 2026-04-08 gotcha), antialiased + grayscale font smoothing for visual
        // parity with renderText. Phase 15 UAT-2 (2026-04-17): padding dropped
        // to 0 to match Fabric edit overlay's flush-left default — text position
        // is now identical between view and edit.
        style: {
          width: '100%',
          height: '100%',
          fontSize: `${callout.style?.fontSize || 12}px`,
          fontFamily: safeFontFamily,
          // UX (2026-07-17): spec twin of the renderCallout fix — the stored
          // bold/italic/underline/strikethrough flags render on the committed
          // callout (they previously saved but never drew). Keeps this
          // Node-testable spec aligned with the JSX inner-div style.
          fontWeight: callout.style?.bold ? 'bold' : 'normal',
          fontStyle: callout.style?.italic ? 'italic' : 'normal',
          textDecoration: [
            callout.style?.underline ? 'underline' : null,
            callout.style?.strikethrough ? 'line-through' : null,
          ].filter(Boolean).join(' ') || 'none',
          color: callout.style?.fontColor || callout.style?.textColor || '#000',
          overflow: 'visible',
          wordWrap: 'break-word',
          whiteSpace: 'pre-wrap',
          boxSizing: 'border-box',
          padding: 0,
          WebkitFontSmoothing: 'antialiased',
          MozOsxFontSmoothing: 'grayscale',
        },
        text: callout.text || '',
      },
    ],
  });

  // Outer <g> wrapper — carries data-callout-id for event delegation.
  return {
    type: 'g',
    key,
    // UX: data-callout-id enables Phase 17/18 event delegation for hit-testing
    // (same pattern as v2.2 EDIT-13 data-rotation-handle='mtr' delegation).
    // (CALL-10)
    attrs: {
      'data-callout-id': callout.id,
      opacity: borderOpacity,
    },
    children,
  };
}
