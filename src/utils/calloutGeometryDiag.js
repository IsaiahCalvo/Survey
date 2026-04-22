// Callout geometry diagnostic — records the full state of every callout in
// two places so we can see why the Fabric edit-mode text box differs in
// shape / location from the SVG-rendered callout.
//
// Capture points:
//   A) SVGAnnotationLayer — after render, walks the DOM by data-callout-id and
//      records source data + every rendered element's bounding rect.
//   B) FabricEditCanvas — inside loadCalloutAnnotation after enterEditing(),
//      records the enlivened group + every child's full state.
//
// Drain:
//   window.__calloutGeomBuffer.dump()  → JSON string (used by Save Log)
//   window.__calloutGeomBuffer.clear() → reset
//
// Per feedback_diagnostic_log_depth.md: dump FULL object state at every
// checkpoint so a single log answers yes/no, no follow-up questions.

const initBuffer = () => {
  if (typeof window === 'undefined') return null;
  if (!window.__calloutGeomBuffer) {
    window.__calloutGeomBuffer = {
      svgById: {}, // latest SVG capture per callout id
      fabricById: {}, // latest Fabric capture per callout id
      events: [], // chronological event log (each capture + dblclick markers)
      dump() {
        return JSON.stringify(
          {
            capturedAt: new Date().toISOString(),
            svgCaptures: this.svgById,
            fabricCaptures: this.fabricById,
            diffs: Object.keys(this.svgById).reduce((acc, id) => {
              if (this.fabricById[id]) {
                acc[id] = buildDiff(this.svgById[id], this.fabricById[id]);
              }
              return acc;
            }, {}),
            events: this.events,
          },
          null,
          2,
        );
      },
      clear() {
        this.svgById = {};
        this.fabricById = {};
        this.events = [];
      },
    };
  }
  return window.__calloutGeomBuffer;
};

const safeRect = (el) => {
  if (!el || typeof el.getBoundingClientRect !== 'function') return null;
  const r = el.getBoundingClientRect();
  return {
    x: r.x,
    y: r.y,
    left: r.left,
    top: r.top,
    right: r.right,
    bottom: r.bottom,
    width: r.width,
    height: r.height,
  };
};

const safeAttrs = (el) => {
  if (!el || !el.attributes) return null;
  const out = {};
  for (let i = 0; i < el.attributes.length; i++) {
    const a = el.attributes[i];
    out[a.name] = a.value;
  }
  return out;
};

const safeComputedStyle = (el, props) => {
  if (!el || typeof window === 'undefined' || !window.getComputedStyle) return null;
  const cs = window.getComputedStyle(el);
  const out = {};
  props.forEach((p) => { out[p] = cs.getPropertyValue(p); });
  return out;
};

// --------------------------------------------------------------------------
// A) SVG side capture
// --------------------------------------------------------------------------
export const captureSvgCallout = (callout, pageNumber, extras = {}) => {
  try {
    const buf = initBuffer();
    if (!buf || !callout?.id) return;

    const id = callout.id;
    const root = document.querySelector(`[data-callout-id="${CSS.escape(id)}"]`);
    const foreignObject = root?.querySelector('foreignObject');
    const textDiv = foreignObject?.querySelector('div');
    const textSpans = foreignObject?.querySelectorAll('div, span, p');
    const arrowTipEl = root?.querySelector('[data-callout-part="arrowTip"]');
    const kneeEl = root?.querySelector('[data-callout-part="knee"]');
    const line1El = root?.querySelector('[data-callout-part="line1"]');
    const line2El = root?.querySelector('[data-callout-part="line2"]');
    const textHitEl = root?.querySelector('[data-callout-part="text"]');

    // Fabric-space coords we'd expect from toFabricGroup (so we can see what
    // the adapter WOULD produce if it ran now).
    const src = {
      id: callout.id,
      pageNumber: callout.pageNumber,
      text: callout.text,
      arrowTip: callout.arrowTip, // { x, y } in page/PDF space
      knee: callout.knee,
      textBox: callout.textBox, // { x, y, width, height } in page/PDF space
      style: callout.style, // fontSize, fontFamily, color, fill, stroke, strokeWidth, borderRadius...
      rotation: callout.rotation,
      // Any other top-level fields the callout carries — shallow dump
      _rawKeys: Object.keys(callout),
      _raw: JSON.parse(JSON.stringify(callout)), // full deep snapshot
    };

    // Fix B — record the renderer-derived page-space geometry. Mirrors the
    // exact normalization renderCallout performs in svgAnnotationRenderers.jsx
    // (~line 720-732) so the log tells us what the SVG renderer actually drew.
    // pageSize is passed in via extras from the call site.
    const pageSize = extras?.pageSize || null;
    let rendererDerived = null;
    if (pageSize && callout.arrowTip && callout.knee) {
      const pw = pageSize.width || 0;
      const ph = pageSize.height || 0;
      rendererDerived = {
        pageSize: { width: pw, height: ph },
        arrowTip: { x: callout.arrowTip.x * pw, y: callout.arrowTip.y * ph },
        knee: { x: callout.knee.x * pw, y: callout.knee.y * ph },
        textBox: {
          x: (callout.textBoxPosition?.x ?? callout.textBox?.x ?? 0) * pw,
          y: (callout.textBoxPosition?.y ?? callout.textBox?.y ?? 0) * ph,
          width: Math.max(18, (callout.textBoxWidth ?? callout.textBox?.width ?? 0.1) * pw),
          height: Math.max(18, (callout.textBoxHeight ?? callout.textBox?.height ?? 0.05) * ph),
        },
        // Raw normalized inputs used to derive textBox (so we can see fallback order hits)
        normalizedInputs: {
          textBoxPosition: callout.textBoxPosition || null,
          textBoxWidth: callout.textBoxWidth ?? null,
          textBoxHeight: callout.textBoxHeight ?? null,
          textBox: callout.textBox || null,
        },
      };
    }

    const domCapture = {
      root: {
        tag: root?.tagName,
        attrs: safeAttrs(root),
        rect: safeRect(root),
        computed: safeComputedStyle(root, ['visibility', 'opacity', 'display', 'transform', 'pointer-events']),
      },
      foreignObject: {
        tag: foreignObject?.tagName,
        attrs: safeAttrs(foreignObject),
        rect: safeRect(foreignObject),
      },
      textDiv: {
        tag: textDiv?.tagName,
        rect: safeRect(textDiv),
        text: textDiv?.textContent,
        computed: safeComputedStyle(textDiv, [
          'font-size', 'font-family', 'font-weight', 'line-height',
          'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
          'border-radius', 'background-color', 'color',
          'box-sizing', 'width', 'height', 'white-space',
        ]),
      },
      textSpanCount: textSpans?.length || 0,
      arrowTip: { rect: safeRect(arrowTipEl), attrs: safeAttrs(arrowTipEl) },
      knee: { rect: safeRect(kneeEl), attrs: safeAttrs(kneeEl) },
      line1: { rect: safeRect(line1El), attrs: safeAttrs(line1El) },
      line2: { rect: safeRect(line2El), attrs: safeAttrs(line2El) },
      textHit: { rect: safeRect(textHitEl), attrs: safeAttrs(textHitEl) },
    };

    const capture = {
      side: 'svg',
      timestamp: new Date().toISOString(),
      pageNumber,
      source: src,
      dom: domCapture,
      rendererDerived,
      extras,
    };

    // Fix A — don't clobber the good pre-edit snapshot. When editingCalloutId
    // turns on, SVGAnnotationLayer skips that callout in filteredCallouts, so
    // the re-render fires this capture with an empty DOM (root=null). Preserve
    // the last-known-good snapshot by only overwriting when the new query
    // actually found the root element.
    const priorCapture = buf.svgById[id];
    const newFoundRoot = !!root;
    if (newFoundRoot || !priorCapture) {
      buf.svgById[id] = capture;
    } else {
      // Record that a skip happened so the log still shows the edit-mode event,
      // but don't overwrite the good rects.
      buf.events.push({ kind: 'svg-skip-preserve', id, t: Date.now(), reason: 'no-root-during-edit' });
    }
    buf.events.push({ kind: 'svg-render', id, t: Date.now(), rect: domCapture.foreignObject.rect, foundRoot: newFoundRoot });

    // Keep event log bounded — last 200 events is plenty for one session.
    if (buf.events.length > 200) buf.events.splice(0, buf.events.length - 200);

    // Verbose console dump — single block per callout so the log file is scannable.
    // Guarded by a window flag so you can mute it if it ever gets noisy.
    if (!window.__calloutGeomMute) {
      // eslint-disable-next-line no-console
      console.log(`[CalloutGeom svg p${pageNumber}] id=${id} text=${JSON.stringify(src.text)}`, capture);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[CalloutGeom] captureSvgCallout failed:', err?.message || err);
  }
};

// --------------------------------------------------------------------------
// B) Fabric side capture — called from FabricEditCanvas.loadCalloutAnnotation
//    after enterEditing(). Accepts the enlivened top-level objects array.
// --------------------------------------------------------------------------
export const captureFabricCallout = (calloutId, canvas, enlivenedObjects, extras = {}) => {
  try {
    const buf = initBuffer();
    if (!buf) return;
    if (!calloutId) {
      // Fallback: FabricEditCanvas doesn't receive `editingAnnotation.reactCalloutId`
      // as a prop, so the id isn't always resolvable locally. The SVG side
      // captures ran moments before this; pick the most recently seen SVG
      // callout id and pair the Fabric capture to it. If multiple are in the
      // buffer, we use the one with the newest svg-render event.
      const svgIds = Object.keys(buf.svgById);
      if (svgIds.length === 1) {
        calloutId = svgIds[0];
      } else if (svgIds.length > 1) {
        // Prefer the id that most-recently appeared in the events log.
        const latestByKind = [...buf.events].reverse().find((e) => e.kind === 'svg-render' && svgIds.includes(e.id));
        calloutId = latestByKind ? latestByKind.id : svgIds[svgIds.length - 1];
      } else {
        calloutId = `__no-id__@${Date.now()}`;
      }
    }

    const dumpObj = (obj, index) => {
      if (!obj) return null;
      const coords = (() => {
        try {
          return {
            aCoords: obj.aCoords && JSON.parse(JSON.stringify(obj.aCoords)),
            oCoords: obj.oCoords && JSON.parse(JSON.stringify(obj.oCoords)),
            bbox: obj.getBoundingRect ? obj.getBoundingRect(true, true) : null,
            pointTL: obj.getPointByOrigin ? obj.getPointByOrigin('left', 'top') : null,
            pointCenter: obj.getPointByOrigin ? obj.getPointByOrigin('center', 'center') : null,
          };
        } catch {
          return null;
        }
      })();

      const textExtras = (obj.type === 'textbox' || obj.type === 'i-text') ? {
        text: obj.text,
        fontSize: obj.fontSize,
        fontFamily: obj.fontFamily,
        fontWeight: obj.fontWeight,
        lineHeight: obj.lineHeight,
        charSpacing: obj.charSpacing,
        textAlign: obj.textAlign,
        editable: obj.editable,
        isEditing: obj.isEditing,
        fixedWidth: obj.width,
        fixedHeight: obj.height,
        dynamicMinWidth: obj.dynamicMinWidth,
        splitByGrapheme: obj.splitByGrapheme,
        styles: obj.styles && JSON.parse(JSON.stringify(obj.styles)),
        textLines: obj._textLines && obj._textLines.map((l) => (Array.isArray(l) ? l.join('') : String(l))),
        // Fabric.js measures text in 400px-scaled space; surface that so we can
        // see if fontFamily resolution is mismatching (the 2026-04-08 gotcha).
        measureCache: obj.__charBounds ? 'populated' : 'empty',
      } : null;

      return {
        index,
        type: obj.type,
        reactCalloutId: obj.reactCalloutId || null,
        name: obj.name || null,
        left: obj.left,
        top: obj.top,
        width: obj.width,
        height: obj.height,
        scaleX: obj.scaleX,
        scaleY: obj.scaleY,
        angle: obj.angle,
        skewX: obj.skewX,
        skewY: obj.skewY,
        originX: obj.originX,
        originY: obj.originY,
        fill: obj.fill,
        stroke: obj.stroke,
        strokeWidth: obj.strokeWidth,
        strokeUniform: obj.strokeUniform,
        opacity: obj.opacity,
        visible: obj.visible,
        selectable: obj.selectable,
        evented: obj.evented,
        hasControls: obj.hasControls,
        hasBorders: obj.hasBorders,
        coords,
        textExtras,
      };
    };

    const canvasInfo = canvas ? {
      width: canvas.width,
      height: canvas.height,
      zoom: typeof canvas.getZoom === 'function' ? canvas.getZoom() : null,
      vpt: canvas.viewportTransform ? [...canvas.viewportTransform] : null,
      retina: canvas._retinaScaling || null,
      objectCount: canvas.getObjects ? canvas.getObjects().length : null,
      activeObject: canvas.getActiveObject ? (() => {
        const ao = canvas.getActiveObject();
        if (!ao) return null;
        return {
          type: ao.type,
          isEditing: ao.isEditing,
          left: ao.left, top: ao.top, width: ao.width, height: ao.height,
          scaleX: ao.scaleX, scaleY: ao.scaleY,
        };
      })() : null,
    } : null;

    // Canvas-element screen rect — so we can compare with the SVG foreignObject rect.
    const canvasEl = canvas?.lowerCanvasEl || canvas?.upperCanvasEl || null;
    const canvasScreenRect = safeRect(canvasEl);

    const capture = {
      side: 'fabric',
      timestamp: new Date().toISOString(),
      calloutId,
      canvasInfo,
      canvasScreenRect,
      objects: (enlivenedObjects || []).map((o, i) => dumpObj(o, i)),
      extras,
    };

    buf.fabricById[calloutId] = capture;
    buf.events.push({
      kind: 'fabric-load',
      id: calloutId,
      t: Date.now(),
      activeObjectType: canvasInfo?.activeObject?.type || null,
    });

    if (!window.__calloutGeomMute) {
      // eslint-disable-next-line no-console
      console.log(`[CalloutGeom fabric] id=${calloutId} — ${capture.objects.length} objects`, capture);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[CalloutGeom] captureFabricCallout failed:', err?.message || err);
  }
};

// --------------------------------------------------------------------------
// Diff builder — for each callout where we have both captures, compute the
// key deltas a human (or future-Claude) needs to explain the visual mismatch.
// --------------------------------------------------------------------------
const buildDiff = (svgCap, fabricCap) => {
  if (!svgCap || !fabricCap) return { error: 'missing one side' };

  const svgFO = svgCap.dom?.foreignObject?.rect;
  const svgText = svgCap.dom?.textDiv?.rect;
  const svgCanvas = fabricCap.canvasScreenRect;

  const textboxFab = (fabricCap.objects || []).find((o) =>
    o && (o.type === 'textbox' || o.type === 'i-text'));

  // Text box screen rect in Fabric = canvasScreenRect + (fabric left,top)*zoom,
  // but that requires the zoom + VPT; record both raw and a naive screen
  // projection so the diff is usable without deeper math.
  const naiveFabTextScreen = (svgCanvas && textboxFab) ? {
    left: svgCanvas.left + (textboxFab.left || 0) * (fabricCap.canvasInfo?.zoom || 1),
    top: svgCanvas.top + (textboxFab.top || 0) * (fabricCap.canvasInfo?.zoom || 1),
    width: (textboxFab.width || 0) * (textboxFab.scaleX || 1) * (fabricCap.canvasInfo?.zoom || 1),
    height: (textboxFab.height || 0) * (textboxFab.scaleY || 1) * (fabricCap.canvasInfo?.zoom || 1),
  } : null;

  const delta = (a, b) => (a != null && b != null) ? (b - a) : null;

  // Renderer-derived page-space dims (Fix B). This is what renderCallout
  // ACTUALLY drew — the direct answer to "what box did the SVG choose."
  const rendererDerivedTextBox = svgCap.rendererDerived?.textBox || null;

  // Fabric textbox effective page-space dims. With zoom=1 and identity VPT,
  // Fabric canvas-space ≈ page-space. `width`/`height` are the Fabric-intrinsic
  // dims; scaleX/scaleY scale them. fixedWidth is an alias kept for clarity.
  const fabTextEffective = textboxFab ? {
    left: textboxFab.left,
    top: textboxFab.top,
    width: (textboxFab.width || 0) * (textboxFab.scaleX || 1),
    height: (textboxFab.height || 0) * (textboxFab.scaleY || 1),
  } : null;

  return {
    svg: {
      source: svgCap.source,
      foreignObjectScreen: svgFO,
      textDivScreen: svgText,
      rendererDerivedTextBox, // page-space dims renderCallout drew
      fontSize_computed: svgCap.dom?.textDiv?.computed?.['font-size'],
      fontFamily_computed: svgCap.dom?.textDiv?.computed?.['font-family'],
    },
    fabric: {
      canvasScreen: svgCanvas,
      zoom: fabricCap.canvasInfo?.zoom,
      retina: fabricCap.canvasInfo?.retina,
      textbox: textboxFab,
      effectivePageSpace: fabTextEffective,
      naiveTextScreenRect: naiveFabTextScreen,
    },
    // Page-space mismatch — this is the ground-truth answer: does the Fabric
    // adapter's rect match the SVG renderer's rect? Expected null deltas for
    // byte-identical geometry, non-null deltas for the bug we're chasing.
    deltas_pageSpace: {
      left_svgRenderer_vs_fabric: delta(rendererDerivedTextBox?.x, fabTextEffective?.left),
      top_svgRenderer_vs_fabric: delta(rendererDerivedTextBox?.y, fabTextEffective?.top),
      width_svgRenderer_vs_fabric: delta(rendererDerivedTextBox?.width, fabTextEffective?.width),
      height_svgRenderer_vs_fabric: delta(rendererDerivedTextBox?.height, fabTextEffective?.height),
    },
    deltas_screenPx: {
      left_svgText_vs_fabTextScreen: delta(svgText?.left, naiveFabTextScreen?.left),
      top_svgText_vs_fabTextScreen: delta(svgText?.top, naiveFabTextScreen?.top),
      width_svgText_vs_fabTextScreen: delta(svgText?.width, naiveFabTextScreen?.width),
      height_svgText_vs_fabTextScreen: delta(svgText?.height, naiveFabTextScreen?.height),
      left_svgFO_vs_fabTextScreen: delta(svgFO?.left, naiveFabTextScreen?.left),
      top_svgFO_vs_fabTextScreen: delta(svgFO?.top, naiveFabTextScreen?.top),
    },
    notes: [
      'svg.rendererDerivedTextBox is the page-space rect renderCallout actually drew (derived from normalized callout coords × pageSize).',
      'fabric.effectivePageSpace = (width×scaleX, height×scaleY) — Fabric canvas-space rect of the Textbox child.',
      'deltas_pageSpace.* is the DIRECT page-space mismatch — non-null = bug, null = geometry matches.',
      'svg.textDivScreen is the getBoundingClientRect of the rendered <div> inside <foreignObject>.',
      'fabric.textbox values are in Fabric canvas-space (pre viewportTransform).',
      'deltas_screenPx.* uses a naive projection (canvasScreen.left + left*zoom) — ignore if zoom != 1 with VPT.',
      'If fabric.zoom != 1 or canvas VPT is not identity, cross-check raw numbers by hand.',
    ],
  };
};

export const markDoubleClickEvent = (calloutId, evt) => {
  try {
    const buf = initBuffer();
    if (!buf) return;
    buf.events.push({
      kind: 'dblclick',
      id: calloutId,
      t: Date.now(),
      client: evt ? { x: evt.clientX, y: evt.clientY, target: evt.target?.tagName } : null,
    });
  } catch { /* noop */ }
};

export const getCalloutGeomDump = () => {
  const buf = initBuffer();
  return buf ? buf.dump() : '(buffer unavailable)';
};

export const clearCalloutGeomBuffer = () => {
  const buf = initBuffer();
  if (buf) buf.clear();
};
