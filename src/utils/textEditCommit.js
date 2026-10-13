/**
 * textEditCommit.js — commit-JSON builders for same-surface text editing.
 *
 * TextEditOverlay (the HTML contentEditable editor that replaced
 * FabricEditCanvas for editType 'text') commits page JSON directly. These
 * builders replicate what FabricEditCanvas.commitAndClose emitted for
 * textboxes — `new fabric.Textbox(...).toObject(CUSTOM_PROPS)` for new text,
 * clone-and-update for existing text — field for field, so downstream
 * consumers (SVG renderers, hit testing, sync fingerprints, PDF export,
 * undo deltas, the reactCalloutId group rebuild) see byte-stable shapes.
 *
 * Pure JS — Node test runner imports this directly.
 */
import { applyScope } from './annotationCreationCommit.js';

// TEXT_PADDING lives in svgAnnotationRenderers.jsx (a .jsx module the Node
// test runner can't import); the value is the annotation text-gutter contract
// shared by renderText/renderCallout/FabricEditCanvas since Plan 15-04.
export const TEXT_PADDING = 6;

// fabric 7.4 Textbox serialization envelope (verified against
// `new Textbox(...).toObject(CUSTOM_PROPS)` on the installed package).
// originX/originY are pinned to left/top: fabric 7 defaults to 'center', but
// every renderer/hit-test path in this app treats left/top as the outer
// top-left corner. Frozen — on a fabric upgrade, add new fields CONSCIOUSLY.
export const FABRIC_TEXTBOX_ENVELOPE = Object.freeze({
  version: '7.4.0',
  originX: 'left',
  originY: 'top',
  strokeDashArray: null,
  strokeLineCap: 'butt',
  strokeDashOffset: 0,
  strokeLineJoin: 'miter',
  strokeMiterLimit: 4,
  strokeUniform: true,
  scaleX: 1,
  scaleY: 1,
  angle: 0,
  flipX: false,
  flipY: false,
  opacity: 1,
  shadow: null,
  visible: true,
  backgroundColor: '',
  fillRule: 'nonzero',
  paintFirst: 'fill',
  globalCompositeOperation: 'source-over',
  skewX: 0,
  skewY: 0,
  lineHeight: 1.16,
  charSpacing: 0,
  styles: [],
  pathStartOffset: 0,
  pathSide: 'left',
  pathAlign: 'baseline',
  overline: false,
  textBackgroundColor: '',
  direction: 'ltr',
  textDecorationThickness: 66.667,
  minWidth: 20,
  splitByGrapheme: true,
});

const createAnnotationId = (prefix = 'anno') => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

/** Same contract as FabricEditCanvas.ensureJsonAnnotationId. */
export function ensureTextAnnotationId(json, prefix = 'anno') {
  if (!json || typeof json !== 'object') return;
  const existing = json?.data?.id || json?.data?.annoId || json?.id || json?.annotationId;
  if (!json.data || typeof json.data !== 'object') {
    json.data = {};
  }
  if (!json.data.id) {
    json.data.id = existing || createAnnotationId(prefix);
  }
}

const deepClone = (value) => JSON.parse(JSON.stringify(value));

/**
 * Style fields the editor can change mid-edit. Applied onto commit JSON in
 * one place so new-text and existing-text agree on the writable set.
 * verticalAlign is included deliberately: renderText consumes it, and the
 * fabric path silently dropped it on commit (not in CUSTOM_PROPS).
 */
const applyTextStyle = (json, style = {}) => {
  if (!style || typeof style !== 'object') return json;
  if (style.fontSize != null) json.fontSize = Math.max(6, Math.min(200, Math.round(Number(style.fontSize) || 16)));
  if (style.fontFamily) json.fontFamily = style.fontFamily;
  if (style.fontWeight) json.fontWeight = style.fontWeight;
  if (style.fontStyle) json.fontStyle = style.fontStyle;
  if (style.underline != null) json.underline = !!style.underline;
  if (style.linethrough != null) json.linethrough = !!style.linethrough;
  if (style.textAlign) json.textAlign = style.textAlign;
  if (style.verticalAlign) json.verticalAlign = style.verticalAlign;
  if (typeof style.fill === 'string' && style.fill.length > 0) json.fill = style.fill;
  return json;
};

/**
 * Brand-new textbox commit JSON.
 *
 * Width contract (mirrors FabricEditCanvas Task 3 "tight-width fit"):
 *  - single rendered line → outer width hugs the measured content
 *    (ceil(maxLineWidth + 2) + 2*TEXT_PADDING);
 *  - multi-line → keep the wrap target the user saw
 *    (innerWrapWidth + 2*TEXT_PADDING).
 * Height is always naturalInnerHeight + 2*TEXT_PADDING (outer).
 * left/top are the OUTER border corner in page space.
 *
 * Returns null for blank text — matching the fabric path's discard branch.
 */
export function buildNewTextCommitJSON({
  text,
  left,
  top,
  innerWrapWidth,
  maxLineWidth = 0,
  lineCount = 1,
  naturalInnerHeight,
  style = {},
  fill = '#007AFF',
  stroke = '#000000',
  strokeWidth = 1,
  // KAL-88 — Decision 11 companion: survey/region scope stamps, same inputs
  // as the shape/line/freehand builders in annotationCreationCommit.js.
  selectedModuleId = null,
  stampRegionId = false,
  activeRegionId = null,
  // w43 (2026-09-26): the bump size when the Style picker is on Cloud as the
  // box is drawn - the new text box's border is then the house revision cloud
  // (data.pdfCloudIntensity, the field clouded shapes use). null = plain.
  cloudIntensity = null,
}) {
  if (!text || String(text).trim() === '') return null;
  const pad = TEXT_PADDING;
  const width = (lineCount <= 1 && maxLineWidth > 0)
    ? Math.ceil(maxLineWidth + 2) + 2 * pad
    : (Number(innerWrapWidth) || 0) + 2 * pad;

  const json = {
    ...FABRIC_TEXTBOX_ENVELOPE,
    type: 'Textbox',
    left: Number(left) || 0,
    top: Number(top) || 0,
    width,
    height: (Number(naturalInnerHeight) || 0) + 2 * pad,
    fill,
    stroke,
    strokeWidth,
    fontSize: 16,
    fontWeight: 'normal',
    fontFamily: 'Helvetica',
    fontStyle: 'normal',
    text: String(text),
    textAlign: 'left',
    underline: false,
    linethrough: false,
  };
  applyTextStyle(json, style);
  const cloud = Number(cloudIntensity);
  if (cloudIntensity != null && Number.isFinite(cloud)) {
    json.data = { ...(json.data || {}), pdfCloudIntensity: Math.max(1, cloud) };
  }
  applyScope(json, { selectedModuleId, stampRegionId, activeRegionId });
  ensureTextAnnotationId(json, 'Textbox');
  return json;
}

/**
 * Existing-textbox commit JSON: clone the stored annotation (preserving every
 * custom prop the envelope carries — id/data/scope stamps/import markers) and
 * update only what the editor changed.
 *
 * Size contract (mirrors the fabric re-edit path):
 *  - width never changes during a text edit (the wrap target is locked);
 *  - height = max(naturalInnerHeight + 2*padY, stored) — grow, never shrink;
 *    callouts use padY=0 (no vertical gutter).
 *  - legacy scaleX/scaleY fold into width/height (renderText consumes
 *    width*scaleX), then reset to 1.
 *  - rotated boxes keep their ROTATED top-left corner fixed when height
 *    changes (same trig compensation the fabric path applied).
 *
 * Returns null if `original` is missing.
 */
export function buildExistingTextCommitJSON({
  original,
  text,
  naturalInnerHeight,
  isCallout = false,
  style = {},
}) {
  if (!original || typeof original !== 'object') return null;
  const pad = TEXT_PADDING;
  const padY = isCallout ? 0 : pad;
  const json = deepClone(original);

  const scaleX = Math.abs(Number(original.scaleX) || 1);
  const scaleY = Math.abs(Number(original.scaleY) || 1);
  const origW = (Number(original.width) || 0) * scaleX;
  const origH = (Number(original.height) || 0) * scaleY;

  json.text = String(text ?? '');
  json.width = origW;
  json.height = Math.max((Number(naturalInnerHeight) || 0) + 2 * padY, origH);
  json.scaleX = 1;
  json.scaleY = 1;
  applyTextStyle(json, style);

  // Keep the rotated top-left corner anchored when height changes (text
  // wrapping): renderText rotates about (left+W/2, top+H/2), so a height
  // delta shifts the pivot and would visibly jump the box. Same math as the
  // fabric commit path: left' = left - dH/2*sin(a); top' = top - dH/2*(1-cos(a)).
  const angle = Number(json.angle) || 0;
  const dh = json.height - origH;
  if (angle !== 0 && dh !== 0) {
    const rad = (angle * Math.PI) / 180;
    json.left = (Number(json.left) || 0) - (dh / 2) * Math.sin(rad);
    json.top = (Number(json.top) || 0) - (dh / 2) * (1 - Math.cos(rad));
  }

  ensureTextAnnotationId(json, json.type || 'Textbox');
  return json;
}
