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
 *   - objects: array of 5 plain JSON Fabric objects (line1, line2, rect,
 *     arrowTip circle, textbox) in PAGE coordinates
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

  const stroke = style.borderColor || '#1e293b';
  const strokeWidth = style.lineThickness || 2;

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
    data: { calloutPart: 'line2' },
  };
  const rect = {
    type: 'rect',
    left: tbX,
    top: tbY,
    width: tbW,
    height: tbH,
    fill: style.fillColor || '#ffffff',
    stroke,
    strokeWidth,
    rx: 4,
    ry: 4,
    strokeUniform: true,
    data: { calloutPart: 'textBox' },
  };
  const tipDot = {
    type: 'circle',
    left: at.x * W - 3,
    top: at.y * H - 3,
    radius: 3,
    fill: stroke,
    data: { calloutPart: 'arrowTip' },
  };
  const textbox = {
    type: 'textbox',
    left: tbX + 4,
    top: tbY + 4,
    width: Math.max(8, tbW - 8),
    fontSize: style.fontSize || 14,
    // Pitfall 2: single-name fontFamily only — strip fallback stacks
    fontFamily: sanitizeFontFamily(style.fontFamily),
    fontWeight: style.bold ? 'bold' : 'normal',
    fill: style.fontColor || '#1e293b',
    text: reactCallout.text || '',
    data: { calloutPart: 'text' },
  };

  const objects = [line1, line2, rect, tipDot, textbox];

  // Plan 14-03's App.jsx commit wrapper uses `reactCalloutId` to route the
  // save back to setCallouts instead of setAnnotationsByPage. Mirror the
  // `{ data: { type: 'callout' } }` convention that loadCalloutAnnotation
  // already uses to identify callout groups.
  return {
    objects,
    reactCalloutId: reactCallout.id,
    reactCalloutSnapshot: JSON.parse(JSON.stringify(reactCallout)),
    data: { type: 'callout' },
    // Convenience accessor so tests (and Plan 14-03 wiring code) can call
    // .getObjects() uniformly whether this is a plain shape or a live group.
    getObjects() { return this.objects; },
  };
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

  // Index-addressed child ordering (locked by toFabricGroup):
  //   [0] line1   — textbox-center → knee
  //   [1] line2   — knee → arrowTip
  //   [2] rect    — textbox
  //   [3] tipDot  — circle at arrowTip (redundant, not used for position)
  //   [4] textbox — text content
  const line1 = children[0] || {};
  const line2 = children[1] || {};
  const rect = children[2] || {};
  const textbox = children[4] || {};

  // Knee comes from line1's end (x2, y2) — that's where line1 meets line2.
  // ArrowTip comes from line2's end (x2, y2) — that's where the callout points.
  const kneePx = { x: line1.x2 ?? 0, y: line1.y2 ?? 0 };
  const arrowTipPx = { x: line2.x2 ?? 0, y: line2.y2 ?? 0 };
  // Rect carries textbox position + dimensions. Honor scaleX/scaleY if present
  // (live fabric.Group may have applied user resize before commit).
  const rectLeft = rect.left ?? 0;
  const rectTop = rect.top ?? 0;
  const scaleX = rect.scaleX ?? 1;
  const scaleY = rect.scaleY ?? 1;
  const rectWidth = (rect.width ?? 0) * scaleX;
  const rectHeight = (rect.height ?? 0) * scaleY;

  return {
    ...originalReactCallout,
    arrowTip: { x: arrowTipPx.x / W, y: arrowTipPx.y / H },
    knee: { x: kneePx.x / W, y: kneePx.y / H },
    textBoxPosition: { x: rectLeft / W, y: rectTop / H },
    textBoxWidth: rectWidth / W,
    textBoxHeight: rectHeight / H,
    text: textbox.text ?? originalReactCallout.text ?? '',
  };
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

  // Style extraction — keep the existing defaults and clamps from the legacy
  // renderCallout (lines 516-521 of svgAnnotationRenderers.jsx).
  const lineColor = callout.style?.borderColor || callout.style?.lineColor || '#4A90E2';
  const lineThickness = Math.max(1, callout.style?.lineThickness || 2);
  const fillColor = callout.style?.fillColor || 'rgba(255, 255, 255, 0.22)';
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
  const lineStrokeAttrs = {
    stroke: lineColor,
    strokeWidth: lineThickness,
    strokeLinecap: 'round',
    vectorEffect: 'non-scaling-stroke',
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
      x2: arrowTip.x,
      y2: arrowTip.y,
      ...lineStrokeAttrs,
    },
  });

  // ArrowTip indicator — small filled circle at the arrow endpoint. Phase 15
  // ARROW-04 will replace this with the 6-style arrowhead picker output.
  children.push({
    type: 'circle',
    key: 'arrowTip',
    // UX: data-callout-part='arrowTip' — Phase 17 CALL-01 30px collision clamp
    // hit-test surface. (CALL-10)
    attrs: {
      'data-callout-part': 'arrowTip',
      cx: arrowTip.x,
      cy: arrowTip.y,
      r: Math.max(2, lineThickness + 0.4),
      fill: lineColor,
    },
  });

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
      rx: 4,
      ry: 4,
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
        // parity with renderText. (CALL-10)
        style: {
          width: '100%',
          height: '100%',
          fontSize: `${callout.style?.fontSize || 12}px`,
          fontFamily: safeFontFamily,
          color: callout.style?.fontColor || callout.style?.textColor || '#000',
          overflow: 'visible',
          wordWrap: 'break-word',
          whiteSpace: 'pre-wrap',
          boxSizing: 'border-box',
          padding: '4px',
          display: 'flex',
          alignItems: 'center',
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
