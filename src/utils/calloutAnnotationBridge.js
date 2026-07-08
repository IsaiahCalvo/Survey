/**
 * calloutAnnotationBridge.js — Phase 5a of the Callout Unification plan.
 *
 * Two pure, unwired conversion functions between the two callout representations:
 *
 *   - NORMALIZED shape: the current React `callouts[]` state entry (0-1 fractions
 *     of page dimensions). Field names are legacy-tolerant:
 *       arrowTip | anchor         {x, y}  — tip of the leader arrow
 *       knee                      {x, y}  — bend point of the leader line
 *       textBoxPosition | textBox {x, y}  — top-left of the text card
 *       textBoxWidth | textBox.width       — width  (0-1 fraction)
 *       textBoxHeight | textBox.height     — height (0-1 fraction)
 *       text                               — string content
 *       style                              — optional style object
 *       id                                 — stable string id
 *       pageNumber                         — 1-indexed
 *
 *   - FABRIC annotation object: the page-pixel JSON object suitable for
 *     `annotationsByPage[page].objects[]`. Mirrors counter structure exactly
 *     (see PLAN.md "Unified Target Architecture" table):
 *       data.type === 'callout'
 *       data.id   === callout.id
 *       data.legacyNormalizedCoords — backup of the original 0-1 fractions
 *       objects[] — Fabric child array: [line1, line2, textbox, tipDot]
 *       (same child order and calloutPart markers as toFabricGroup in
 *        calloutEditAdapter.js, which is the proven template)
 *
 * This module is zero-dependency on React, Fabric, or any browser API — it is
 * importable in Node --test without a DOM.
 *
 * REUSE strategy:
 *   - sanitizeFontFamily from calloutEditAdapter.js (strips CSS fallback stacks
 *     to a single font name — required per CLAUDE.md 2026-04-08 gotcha).
 *   - Child-object shape (line1/line2/textbox/tipDot + calloutPart markers)
 *     mirrors calloutEditAdapter.toFabricGroup exactly so the same
 *     fromFabricGroup reader works on both outputs without modification.
 *   - Coordinate convention: arrowTip is line2.x2/y2, knee is line1.x2/y2
 *     (matching fromFabricGroup lines 297-298 in calloutEditAdapter.js).
 *   - textbox left/top are raw page-pixel coords (no group offset).
 *
 * Leader-line geometry preservation contract (PLAN.md §Leader-line geometry):
 *   x_px = x_frac * pageWidthPx
 *   y_px = y_frac * pageHeightPx
 *   (and vice versa for the inverse direction)
 *   data.legacyNormalizedCoords is written on every forward conversion so the
 *   original fractions are always recoverable.
 */

import { sanitizeFontFamily } from './calloutEditAdapter.js';

// ---------------------------------------------------------------------------
// Helpers for reading legacy-tolerant callout fields
// ---------------------------------------------------------------------------

/**
 * Read arrowTip from either `callout.arrowTip` (current) or `callout.anchor`
 * (historical alias used in some PDF-imported callout rows).
 * @param {object} callout
 * @returns {{ x: number, y: number }}
 */
function readArrowTip(callout) {
  const pt = callout.arrowTip ?? callout.anchor;
  return { x: Number(pt?.x ?? 0), y: Number(pt?.y ?? 0) };
}

/**
 * Read textBoxPosition from either `callout.textBoxPosition` (current) or
 * `callout.textBox` (legacy shape where the box was a {x,y,width,height} object)
 * or `callout.label` (the very earliest legacy field name).
 * @param {object} callout
 * @returns {{ x: number, y: number }}
 */
function readTextBoxPosition(callout) {
  if (callout.textBoxPosition) {
    return {
      x: Number(callout.textBoxPosition.x ?? 0),
      y: Number(callout.textBoxPosition.y ?? 0),
    };
  }
  if (callout.textBox) {
    return {
      x: Number(callout.textBox.x ?? 0),
      y: Number(callout.textBox.y ?? 0),
    };
  }
  // `label` was the very earliest legacy field name (seen in computeCalloutBounds
  // in annotationTypeSerializers.js — it stores {left, top, width, height})
  if (callout.label) {
    return {
      x: Number(callout.label.left ?? 0),
      y: Number(callout.label.top ?? 0),
    };
  }
  return { x: 0, y: 0 };
}

/**
 * Read textBoxWidth from `callout.textBoxWidth`, `callout.textBox.width`, or
 * `callout.label.width`. Falls back to 0.1 so the box is never invisible.
 * @param {object} callout
 * @returns {number}
 */
function readTextBoxWidth(callout) {
  if (callout.textBoxWidth != null) return Number(callout.textBoxWidth);
  if (callout.textBox?.width != null) return Number(callout.textBox.width);
  if (callout.label?.width != null) return Number(callout.label.width);
  return 0.1;
}

/**
 * Read textBoxHeight from `callout.textBoxHeight`, `callout.textBox.height`, or
 * `callout.label.height`. Falls back to 0.05.
 * @param {object} callout
 * @returns {number}
 */
function readTextBoxHeight(callout) {
  if (callout.textBoxHeight != null) return Number(callout.textBoxHeight);
  if (callout.textBox?.height != null) return Number(callout.textBox.height);
  if (callout.label?.height != null) return Number(callout.label.height);
  return 0.05;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert a stored (normalized 0-1) callout into a Fabric annotation object
 * suitable for `annotationsByPage[page].objects[]`.
 *
 * @param {object} callout — normalized callout shape (see module header)
 * @param {{ width: number, height: number }} pageSize — page dimensions in
 *   page-pixels (i.e. containerEl.offsetWidth/Height, NOT pageSize * scale —
 *   see CLAUDE.md Gotchas 2026-03-22 for why this distinction matters)
 * @returns {object} — Fabric annotation object with data.type === 'callout'
 */
export function calloutToAnnotationObject(callout, pageSize) {
  if (!callout || typeof callout !== 'object') {
    throw new Error('calloutToAnnotationObject: callout is required');
  }
  if (!pageSize || !Number.isFinite(pageSize.width) || !Number.isFinite(pageSize.height)) {
    throw new Error(
      'calloutToAnnotationObject: pageSize {width, height} in pixels is required'
    );
  }

  const W = pageSize.width;
  const H = pageSize.height;

  // Read normalized fractions (0-1), handling all legacy field name variants
  const arrowTipFrac = readArrowTip(callout);
  const kneeFrac = {
    x: Number(callout.knee?.x ?? 0),
    y: Number(callout.knee?.y ?? 0),
  };
  const tbPosFrac = readTextBoxPosition(callout);
  const tbWFrac = readTextBoxWidth(callout);
  const tbHFrac = readTextBoxHeight(callout);

  // Convert to page-pixel coordinates
  const atX = arrowTipFrac.x * W;
  const atY = arrowTipFrac.y * H;
  const knX = kneeFrac.x * W;
  const knY = kneeFrac.y * H;
  const tbX = tbPosFrac.x * W;
  const tbY = tbPosFrac.y * H;
  const tbW = Math.max(1, tbWFrac * W);
  const tbH = Math.max(1, tbHFrac * H);

  const style = callout.style || {};
  const stroke = style.borderColor || style.lineColor || '#1e293b';
  const strokeWidth = style.lineThickness || 2;

  // Child objects — mirror calloutEditAdapter.toFabricGroup exactly so that
  // calloutEditAdapter.fromFabricGroup can read this output unchanged.
  //
  // Line1: textbox-center → knee  (x2/y2 = knee point)
  // fromFabricGroup reads knee from line1.x2/y2 (calloutEditAdapter.js:297).
  const line1 = {
    type: 'line',
    x1: tbX + tbW / 2,
    y1: tbY + tbH / 2,
    x2: knX,
    y2: knY,
    stroke,
    strokeWidth,
    strokeUniform: true,
    data: { calloutPart: 'line1' },
  };

  // Line2: knee → arrowTip  (x2/y2 = arrowTip point)
  // fromFabricGroup reads arrowTip from line2.x2/y2 (calloutEditAdapter.js:298).
  const line2 = {
    type: 'line',
    x1: knX,
    y1: knY,
    x2: atX,
    y2: atY,
    stroke,
    strokeWidth,
    strokeUniform: true,
    data: { calloutPart: 'line2' },
  };

  // TipDot — small filled circle at the arrow endpoint, visual indicator only.
  const tipDot = {
    type: 'circle',
    left: atX - 3,
    top: atY - 3,
    radius: 3,
    fill: stroke,
    data: { calloutPart: 'arrowTip' },
  };

  // Textbox — the visible callout box. Textbox IS the box (Phase 15 UAT-2
  // convention from calloutEditAdapter.js:134-194): it carries its own stroke.
  const textbox = {
    type: 'textbox',
    left: tbX,
    top: tbY,
    width: tbW,
    height: tbH,
    fontSize: style.fontSize || 14,
    lineHeight: 1,
    // Pitfall 2 (CLAUDE.md 2026-04-08): single-name fontFamily only
    fontFamily: sanitizeFontFamily(style.fontFamily),
    textAlign: style.textAlign || 'left',
    // PLAN.md §5a text-style mapping:
    //   bold: true  → fontWeight: 700
    //   italic: true → fontStyle: 'italic'
    //   underline keeps name
    //   strikethrough → linethrough (Fabric field name)
    fontWeight: style.bold ? 700 : 'normal',
    fontStyle: style.italic ? 'italic' : 'normal',
    underline: !!style.underline,
    linethrough: !!(style.strikethrough || style.linethrough),
    fill: style.fontColor || '#1e293b',
    text: callout.text || '',
    splitByGrapheme: true,
    stroke,
    strokeWidth: Math.max(1, strokeWidth * 0.7),
    strokeUniform: true,
    rx: 0,
    ry: 0,
    cursorColor: '#007AFF',
    editingBorderColor: 'transparent',
    borderColor: 'transparent',
    backgroundColor: '',
    textBackgroundColor: '',
    hasBorders: false,
    hasControls: false,
    data: { calloutPart: 'textBox' },
  };

  const id = callout.id ?? null;

  // Group bounding box covering all children — used by computeBounds() in
  // annotationTypeSerializers.js for the bounds column.
  const groupLeft = Math.min(tbX, knX, atX);
  const groupTop = Math.min(tbY, knY, atY);
  const groupRight = Math.max(tbX + tbW, knX, atX);
  const groupBottom = Math.max(tbY + tbH, knY, atY);

  // R2 keystone (2026-06-28): make the projected/serialized callout object
  // self-describing so a runtime-persisted .fabricObject callout row reloads via
  // the deserializeRowToCallout backward-read shim (reads fabricObject.data.
  // legacyCallout). This makes runtime rows IDENTICAL in shape to what
  // scripts/backfill-callouts-to-fabric.mjs writes — so backfilled and
  // runtime-written rows are indistinguishable, and `shouldDeserializeAsFabricObject`
  // can stay false for callout rows (single load path through callouts[], no
  // nominal-dim re-projection, no double-load). Deep copy: never a live ref into
  // the source callouts[] entry.
  const legacyCallout = JSON.parse(JSON.stringify(callout));
  const authorId = callout.meta?.authorId ?? callout.authorId ?? null;

  return {
    type: 'group',
    objects: [line1, line2, textbox, tipDot],

    // Bounding box for computeBounds()
    left: groupLeft,
    top: groupTop,
    width: groupRight - groupLeft,
    height: groupBottom - groupTop,

    // Preserve PDF-import identity at the fabricObject root so
    // getPdfImportDedupeKey (annotationTypeSerializers.js) dedupes imported
    // callouts the same way it dedupes other imported fabric rows. Only present
    // for imported callouts (mirrors the backfill — non-imported rows stay flagless).
    ...(callout.isPdfImported
      ? { isPdfImported: true, ...(callout.pdfAnnotationId != null ? { pdfAnnotationId: callout.pdfAnnotationId } : {}) }
      : {}),

    // Decision 11 companion — carry the survey/region scope stamps onto the
    // projected object so byPage consumers (eraser canvas, diag captures,
    // proxy payloads) see the same scope the callouts[] entry has. The
    // authoritative copy still round-trips via data.legacyCallout below.
    ...(callout.moduleId != null ? { moduleId: callout.moduleId } : {}),
    ...(callout.regionId != null ? { regionId: callout.regionId } : {}),

    // Required discriminator — mirrors counter's `data: { type: 'counter', ... }`.
    // fabricObjectToDbType() in annotationTypeSerializers.js dispatches on
    // data.type === 'callout' (line 147 of that file).
    data: {
      type: 'callout',
      id,
      // Author chain for the shared canModify delete gate (matches backfill).
      ...(authorId ? { authorId } : {}),
      // Verbatim original normalized callout — the reload payload the
      // deserializeRowToCallout shim recovers. Deep-cloned above.
      legacyCallout,
      // PLAN.md §5a + leader-line preservation contract: backup the original
      // normalized fractions. Never deleted, even after Phase 8 dead-code removal.
      legacyNormalizedCoords: {
        arrowTip: { x: arrowTipFrac.x, y: arrowTipFrac.y },
        knee: { x: kneeFrac.x, y: kneeFrac.y },
        textBoxPosition: { x: tbPosFrac.x, y: tbPosFrac.y },
        textBoxWidth: tbWFrac,
        textBoxHeight: tbHFrac,
      },
    },

    // Convenience accessor matching calloutEditAdapter.toFabricGroup so callers
    // can use .getObjects() uniformly on both plain shapes and live groups.
    getObjects() { return this.objects; },
  };
}

/**
 * Rebuild the callout layer of an `annotationsByPage` map FROM the authoritative
 * `callouts[]` list (Phase 5 keystone shared projector).
 *
 * This is the single canonical, idempotent projection used by BOTH the cloud
 * hydrate seam (useAnnotationDoc) and the local reactive effect (PDFViewer) so
 * the two never drift. It is a PURE function of (non-callout objects, callout
 * list, pageSizes): every page is first copied callout-free (any pre-existing
 * `data.type==='callout'` object is stripped), then each callout is re-projected
 * via `calloutToAnnotationObject`. Re-running it never doubles a callout and a
 * removed callout never leaves a ghost — that is what makes create/edit/delete on
 * the legacy `callouts[]` path reflect immediately in the shared render.
 *
 * Flag gating is the CALLER's responsibility (this module stays zero-dependency
 * on the flag so it remains importable in Node --test). Callers must check
 * `calloutsInSharedStore()` before invoking; with the flag OFF they must not call
 * this so behavior is byte-for-byte unchanged.
 *
 * @param {object} byPage — current annotationsByPage map ({ [page]: { objects } })
 * @param {Array<object>} calloutsList — authoritative normalized callouts[]
 * @param {object} pageSizes — { [page]: { width, height } } unscaled PDF px dims
 * @returns {object} a NEW byPage map with the callout layer rebuilt from source.
 *   When `calloutsList` is empty/non-array the input `byPage` is returned
 *   unchanged (referentially identical) so an empty doc stays a no-op.
 */
export function projectCalloutsIntoByPage(byPage, calloutsList, pageSizes) {
  if (!Array.isArray(calloutsList) || calloutsList.length === 0) return byPage;

  try {
    const sizes = pageSizes || {};
    const src = byPage || {};
    const next = {};
    // Start from a callout-free copy of every existing page so a re-projection
    // can't leave behind a callout the new list no longer contains.
    for (const key of Object.keys(src)) {
      const page = src[key];
      const objects = Array.isArray(page?.objects) ? page.objects : [];
      const nonCallout = objects.filter((o) => !(o?.data?.type === 'callout'));
      next[key] = { ...(page || {}), objects: nonCallout };
    }

    const seenIds = new Set();
    for (const callout of calloutsList) {
      if (!callout) continue;
      const page = callout.pageNumber;
      if (!Number.isFinite(page)) continue;
      // De-dupe by id within the projection (defends against a duplicated row).
      const id = callout.id ?? null;
      if (id != null) {
        if (seenIds.has(id)) continue;
        seenIds.add(id);
      }
      // Per-page unscaled PDF dims; fall back to US-Letter if not yet measured.
      const pageSize = sizes[page] || { width: 612, height: 792 };
      if (!Number.isFinite(pageSize.width) || !Number.isFinite(pageSize.height)) continue;
      const obj = calloutToAnnotationObject(callout, pageSize);
      const existing = next[page];
      const existingObjects = Array.isArray(existing?.objects) ? existing.objects : [];
      next[page] = {
        ...(existing || {}),
        objects: [...existingObjects, obj],
      };
    }

    // Unconditional ghost-cleanup: returning `next` even when nothing projected
    // still strips any stale callout object from a prior projection.
    return next;
  } catch (err) {
    // Never let projection failure blank the annotation layer — fall back to the
    // un-projected byPage (callouts still live in callouts[] dual-rep).
    console.error('[Callout keystone] projectCalloutsIntoByPage failed; using un-projected byPage', err);
    return byPage;
  }
}

/**
 * Inverse: convert a Fabric annotation object (page-pixel coords) back to a
 * normalized (0-1) callout shape.
 *
 * Reads child objects by `data.calloutPart` marker (robust to child-array
 * reordering) — same strategy as calloutEditAdapter.fromFabricGroup.
 *
 * @param {object} obj — Fabric annotation object with data.type === 'callout'
 * @param {{ width: number, height: number }} pageSize — same pixel dimensions
 *   used when the object was created
 * @returns {object} — normalized callout shape
 */
export function annotationObjectToCallout(obj, pageSize) {
  if (!obj || typeof obj !== 'object') {
    throw new Error('annotationObjectToCallout: obj is required');
  }
  if (!pageSize || !Number.isFinite(pageSize.width) || !Number.isFinite(pageSize.height)) {
    throw new Error(
      'annotationObjectToCallout: pageSize {width, height} in pixels is required'
    );
  }

  const W = pageSize.width;
  const H = pageSize.height;

  // Resolve child array — accept live fabric.Group (.getObjects()), plain
  // shape (.objects), or legacy private field (._objects).
  let children;
  if (typeof obj.getObjects === 'function') {
    children = obj.getObjects();
  } else if (Array.isArray(obj.objects)) {
    children = obj.objects;
  } else if (Array.isArray(obj._objects)) {
    children = obj._objects;
  } else {
    children = [];
  }

  // Read by calloutPart marker — same lookup strategy as
  // calloutEditAdapter.fromFabricGroup (lines 278-289).
  const findByPart = (part) =>
    children.find((c) => c && c.data && c.data.calloutPart === part) || {};

  const line1 = findByPart('line1');
  const line2 = findByPart('line2');

  // Textbox: try 'textBox' (current), then 'text' (legacy alias used in pre-
  // UAT-2 5-object groups), then any textbox child (live fabric.Group may strip
  // the data marker on enliven).
  let textbox = findByPart('textBox');
  if (!textbox.type) textbox = findByPart('text');
  if (!textbox.type) {
    textbox = children.find((c) => c && c.type === 'textbox') || {};
  }

  // Knee = line1 end point (x2, y2). Mirror of calloutEditAdapter.fromFabricGroup:297.
  const knX = line1.x2 ?? 0;
  const knY = line1.y2 ?? 0;

  // ArrowTip = line2 end point (x2, y2). Mirror of calloutEditAdapter.fromFabricGroup:298.
  const atX = line2.x2 ?? 0;
  const atY = line2.y2 ?? 0;

  // Textbox position + scaled dimensions (mirror of fromFabricGroup:304-308)
  const tbLeft = textbox.left ?? 0;
  const tbTop = textbox.top ?? 0;
  const scaleX = textbox.scaleX ?? 1;
  const scaleY = textbox.scaleY ?? 1;
  const tbWidth = (textbox.width ?? 0) * scaleX;
  const tbHeight = (textbox.height ?? 0) * scaleY;

  // Reverse the text-style mapping from calloutToAnnotationObject.
  // fontWeight 700 (number) or '700' (string) or 'bold' (string) → bold: true.
  const fw = textbox.fontWeight;
  const isBold = fw === 700 || fw === '700' || fw === 'bold';

  const style = {
    fontFamily: textbox.fontFamily || 'Arial',
    fontSize: textbox.fontSize || 14,
    textAlign: textbox.textAlign || 'left',
    bold: isBold,
    italic: textbox.fontStyle === 'italic',
    underline: !!textbox.underline,
    strikethrough: !!textbox.linethrough,
    fontColor: textbox.fill || '#1e293b',
    borderColor: textbox.stroke || '#1e293b',
    lineThickness: line1.strokeWidth ?? 2,
  };

  return {
    id: obj.data?.id ?? null,
    pageNumber: obj.pageNumber ?? null,

    // Decision 11 companion — recover the survey/region scope stamps so a
    // byPage→callout round trip never strips them.
    ...(obj.moduleId != null ? { moduleId: obj.moduleId } : {}),
    ...(obj.regionId != null ? { regionId: obj.regionId } : {}),

    arrowTip: { x: atX / W, y: atY / H },
    knee: { x: knX / W, y: knY / H },
    textBoxPosition: { x: tbLeft / W, y: tbTop / H },
    textBoxWidth: tbWidth / W,
    textBoxHeight: tbHeight / H,

    text: textbox.text ?? '',
    style,
  };
}
