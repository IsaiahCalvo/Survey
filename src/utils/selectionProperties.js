/*
 * Nightly 'properties-panel': Drawboard PDF's "Expand menu" properties panel
 * (checked live 2026-11-10, /mnt/project-files/drawboard-trial/deep/expand-panel.md).
 * The pure part: what the Transform boxes read and how a typed value turns
 * into a change.
 *
 * Units are page points from the page's top-left, Y down. X and Y are the
 * top-left of the box round the picked marks as they sit on the page (a
 * turned mark's outer box); W and H are one mark's own size before its turn
 * (the group's box for several); R is one mark's turn in degrees, clockwise.
 */
import { getAnnotationBBox, getAnnotationWorldAABB } from './svgBoundingBox.js';

export const PROPERTIES_PANEL_EVENT = 'survey:properties-panel';
export const TRANSFORM_SELECTION_EVENT = 'survey:transform-selection';
export const MIN_TYPED_SIZE = 1;

/** Up to 2 decimals, no trailing zeros ("300.71", "72", "0.5"). */
export function formatPt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const rounded = Math.round(n * 100) / 100;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

/**
 * Degrees into 0 to 359.99 (400 reads 40, -30 reads 330). 0 stays 0:
 * Drawboard shows 360 after a typed 0, a slip not to copy.
 */
export function wrapDegrees(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const wrapped = ((n % 360) + 360) % 360;
  return Math.round(wrapped * 100) / 100 === 360 ? 0 : Math.round(wrapped * 100) / 100;
}

/** A typed number, or null when the box holds no number. */
export function parseTyped(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed || !/^[-+]?(\d+\.?\d*|\.\d+)$/.test(trimmed)) return null;
  return Number(trimmed);
}

export function headerCountText(count) {
  const n = Math.max(0, Number(count) || 0);
  return `${n} annotation${n === 1 ? '' : 's'} selected`;
}

const KIND_NAMES = Object.freeze({
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  circle: 'Ellipse',
  polygon: 'Polygon',
  polyline: 'Polyline',
  line: 'Line',
  arrow: 'Arrow',
  pen: 'Pen',
  highlighter: 'Highlighter',
  tape: 'Tape',
  text: 'Text',
  callout: 'Callout',
  counter: 'Counter',
  stamp: 'Stamp',
  image: 'Image',
  measure: 'Measurement',
  surveyMarker: 'Survey Marker',
  'text-markup': 'Text markup',
});

/** The kind a picked object reads as in the header. */
export function kindOfObject(object, typeKey = null) {
  if (typeKey === 'callout') return 'callout';
  if (typeKey === 'surveyMarker') return 'surveyMarker';
  if (!object) return null;
  const data = object.data || {};
  if (data.type === 'text-markup') return 'text-markup';
  if (data.type === 'counter') return 'counter';
  if (data.measure || data.measurement || data.type === 'measurement') return 'measure';
  if (data.type === 'stamp' || data.stamp) return 'stamp';
  const type = String(object.type || '').toLowerCase();
  if (type === 'path') {
    if (data.tape === true) return 'tape';
    return object.tool === 'highlighter' || data.tool === 'highlighter' ? 'highlighter' : 'pen';
  }
  if (type === 'line' || type === 'group') {
    const head = data.arrowheadStyle;
    return head && head !== 'none' ? 'arrow' : 'line';
  }
  if (type === 'textbox' || type === 'i-text' || type === 'text') return 'text';
  if (type === 'image') return 'image';
  return KIND_NAMES[type] ? type : 'rect';
}

/** "Arrow", or "Mixed subjects" when the pick holds several kinds. */
export function kindLabel(kinds) {
  const list = [...new Set((kinds || []).filter(Boolean))];
  if (!list.length) return '';
  if (list.length > 1) return 'Mixed subjects';
  return KIND_NAMES[list[0]] || 'Mark';
}

/** The box round several page boxes, or null. */
export function unionPageBox(boxes) {
  const list = (boxes || []).filter((b) => b && [b.left, b.top, b.width, b.height].every(Number.isFinite));
  if (!list.length) return null;
  const left = Math.min(...list.map((b) => b.left));
  const top = Math.min(...list.map((b) => b.top));
  const right = Math.max(...list.map((b) => b.left + b.width));
  const bottom = Math.max(...list.map((b) => b.top + b.height));
  return { left, top, width: right - left, height: bottom - top };
}

/** Marks a typed W / H can resize: the ones sized by width x scale. */
const SIZABLE_TYPES = new Set(['rect', 'ellipse', 'image', 'textbox']);
export function canTypeSize(object) {
  if (!object || object.data?.type === 'counter' || object.data?.type === 'text-markup') return false;
  return SIZABLE_TYPES.has(String(object.type || '').toLowerCase());
}

/** Marks a typed R can turn (a counter turns its pointer, not its body). */
export function canTypeTurn(object) {
  if (!object || object.data?.type === 'counter' || object.data?.type === 'text-markup') return false;
  const type = String(object.type || '').toLowerCase();
  return type !== 'path' || object.data?.tape !== true;
}

/**
 * What the Transform boxes read for the picked objects (page objects, plus
 * page boxes for picked marks that are not page objects, such as callouts).
 * Returns { x, y, w, h, r, rMixed, single, sizable, turnable } or null.
 */
export function readTransform(objects, extraBoxes = []) {
  const list = (objects || []).filter(Boolean);
  const worldBoxes = list.map((object) => getAnnotationWorldAABB(object));
  const outer = unionPageBox([...worldBoxes, ...(extraBoxes || [])]);
  if (!outer) return null;
  const count = list.length + (extraBoxes || []).length;
  if (count === 1 && list.length === 1) {
    const local = getAnnotationBBox(list[0]);
    const angle = wrapDegrees(local.angle || 0) ?? 0;
    return {
      x: outer.left,
      y: outer.top,
      w: local.width,
      h: local.height,
      r: angle,
      rMixed: false,
      single: true,
      sizable: canTypeSize(list[0]),
      turnable: canTypeTurn(list[0]),
    };
  }
  const angles = list.map((object) => wrapDegrees(getAnnotationBBox(object).angle || 0) ?? 0);
  const same = angles.length > 0 && angles.every((a) => a === angles[0]) && !(extraBoxes || []).length;
  return {
    x: outer.left,
    y: outer.top,
    w: outer.width,
    h: outer.height,
    r: same ? angles[0] : null,
    rMixed: !same,
    single: false,
    sizable: false,
    turnable: false,
  };
}

/** A typed X or Y as a move: { dx, dy }, or null when nothing changes. */
export function planTypedMove(read, field, value) {
  if (!read || (field !== 'x' && field !== 'y')) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const delta = n - (field === 'x' ? read.x : read.y);
  if (Math.abs(delta) < 0.005) return null;
  return field === 'x' ? { dx: delta, dy: 0 } : { dx: 0, dy: delta };
}

/**
 * A typed W or H on one box mark: the object with its new size, its own
 * top-left held (so an upright mark's X and Y stay). W and H stop at 1.
 */
export function resizeObjectTo(object, field, value) {
  if (!canTypeSize(object) || (field !== 'w' && field !== 'h')) return null;
  const target = Math.max(MIN_TYPED_SIZE, Number(value));
  if (!Number.isFinite(target)) return null;
  const local = getAnnotationBBox(object);
  const current = field === 'w' ? local.width : local.height;
  if (!(current > 0) || Math.abs(current - target) < 0.005) return null;
  const type = String(object.type || '').toLowerCase();
  const next = { ...object };
  if (type === 'textbox') {
    // A text box reflows: its box takes the size, the words do not stretch.
    const scaleKey = field === 'w' ? 'scaleX' : 'scaleY';
    const sizeKey = field === 'w' ? 'width' : 'height';
    next[sizeKey] = target;
    next[scaleKey] = 1;
    return next;
  }
  const factor = target / current;
  if (field === 'w') next.scaleX = (Number(object.scaleX) || 1) * factor;
  else next.scaleY = (Number(object.scaleY) || 1) * factor;
  return next;
}
