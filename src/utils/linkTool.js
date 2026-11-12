/*
 * Nightly 'link-tool': Drawboard Projects' Hyperlink tool (Insert tab,
 * Shift+H), checked live 2026-11-10 (/mnt/project-files/drawboard-trial/deep/
 * link-tool.md). Drag a box, say where it goes (a website, a page, or an area
 * of the drawing), and the box becomes a link mark.
 *
 * A link mark is a plain rectangle that carries the link in data.link, so it
 * picks, moves, resizes, copies and undoes like any shape. Clicking it only
 * picks it; "Go to ..." on the picked bar follows it. Pure helpers here: the
 * dialog (components/HyperlinkDialog.jsx), the host (components/
 * LinkToolHost.jsx), the renderers and the PDF export read them.
 */
import { FABRIC_BASE_ENVELOPE } from './annotationCreationCommit.js';
import { tagDrawnCenteredStrokeGeometry } from './shapeCommitGeometry.js';
import { normalizeTextLinkUrl } from './pdfTextMarkup.js';
import { LINK_DEFAULT_COLOR, LINK_FILL, isLinkMark, linkMarkForPrint, linkMarkPaint, normalizeLinkStyle } from './linkMarkPaint.js';

export { LINK_DEFAULT_COLOR, LINK_FILL, isLinkMark, linkMarkForPrint, linkMarkPaint, normalizeLinkStyle };

export const LINK_TOOL_ID = 'hyperlink';
export const LINK_BOX_DRAWN_EVENT = 'survey:link-box-drawn';
export const LINK_EDIT_EVENT = 'survey:link-edit';
export const LINK_SUBJECT = 'Hyperlink';
export const LINK_MIN_SIZE = 4;
export const LINK_DEFAULT_WIDTH = 3;

// Drawboard's card: three presets on the bar, seven swatches in all.
export const LINK_COLORS = Object.freeze([
  Object.freeze({ id: 'blue', label: 'Blue', color: '#0066D4' }),
  Object.freeze({ id: 'green', label: 'Green', color: '#118A4E' }),
  Object.freeze({ id: 'black', label: 'Black', color: '#1A1A1A' }),
  Object.freeze({ id: 'red', label: 'Red', color: '#E11D2E' }),
  Object.freeze({ id: 'purple', label: 'Purple', color: '#7C3AED' }),
  Object.freeze({ id: 'orange', label: 'Orange', color: '#D97706' }),
  Object.freeze({ id: 'pink', label: 'Pink', color: '#E5158C' }),
]);

export const LINK_STYLES = Object.freeze([
  Object.freeze({ id: 'box', label: 'Box' }),
  Object.freeze({ id: 'dashed', label: 'Dashed box' }),
  Object.freeze({ id: 'underline', label: 'Underline' }),
  Object.freeze({ id: 'none', label: 'No border' }),
]);

export const LINK_TARGETS = Object.freeze([
  Object.freeze({ id: 'page', label: 'Page' }),
  Object.freeze({ id: 'url', label: 'Website' }),
  Object.freeze({ id: 'area', label: 'Area' }),
]);

/** A clean link target, or null when it does not point anywhere. */
export function normalizeLink(link, numPages = Infinity) {
  if (!link || typeof link !== 'object') return null;
  const inRange = (n) => Number.isInteger(n) && n >= 1 && n <= numPages;
  if (link.kind === 'url') {
    const href = normalizeTextLinkUrl(link.href);
    return href ? { kind: 'url', href } : null;
  }
  if (link.kind === 'page') {
    const page = Math.trunc(Number(link.page));
    return inRange(page) ? { kind: 'page', page } : null;
  }
  if (link.kind === 'area') {
    const page = Math.trunc(Number(link.page));
    const r = link.rect || {};
    const rect = { x: Number(r.x), y: Number(r.y), width: Number(r.width), height: Number(r.height) };
    if (!inRange(page) || !Object.values(rect).every(Number.isFinite)) return null;
    if (!(rect.width >= LINK_MIN_SIZE) || !(rect.height >= LINK_MIN_SIZE)) return null;
    return { kind: 'area', page, rect };
  }
  return null;
}

/**
 * What a person typed in the dialog as a link: { link } or { error }.
 * Drawboard takes any text as a web address; Survey checks it and adds
 * https:// when it is missing. An area target is set by a second drag, so it
 * resolves to { pendingArea: true }.
 */
export function resolveLinkInput(kind, value, numPages) {
  if (kind === 'area') return { pendingArea: true };
  if (kind === 'page') {
    const text = String(value ?? '').trim();
    const page = /^\d+$/.test(text) ? Number(text) : NaN;
    if (!(page >= 1 && page <= numPages)) return { error: `Enter a page from 1 to ${numPages}.` };
    return { link: { kind: 'page', page } };
  }
  const href = normalizeTextLinkUrl(value);
  return href ? { link: { kind: 'url', href } } : { error: 'Enter a web address, like example.com.' };
}

/** The picked bar's "Go to ..." words for a link. */
export function linkGoToLabel(link) {
  if (!link) return 'Go to link';
  if (link.kind === 'page') return `Go to page ${link.page}`;
  if (link.kind === 'area') return 'Go to area';
  if (link.kind === 'url') {
    const text = String(link.href || '').replace(/^https?:\/\//i, '').replace(/\/$/, '');
    return `Go to ${text.length > 32 ? `${text.slice(0, 31)}…` : text}`;
  }
  return 'Go to link';
}

/** The new link mark for a drawn box (page units), or null. */
export function buildLinkMark({ id, box, link, color = LINK_DEFAULT_COLOR, style = 'box', width = LINK_DEFAULT_WIDTH }) {
  if (!id || !box || !(box.width >= LINK_MIN_SIZE) || !(box.height >= LINK_MIN_SIZE)) return null;
  const target = normalizeLink(link);
  if (!target) return null;
  const strokeWidth = Math.max(0.25, Number(width) || LINK_DEFAULT_WIDTH);
  // The drag box IS the link's area (a clickable box, not a drawn outline),
  // so it is kept exactly, with the border centred on its edge.
  const round = (n) => Math.round(n * 100) / 100;
  const json = tagDrawnCenteredStrokeGeometry({
    ...FABRIC_BASE_ENVELOPE,
    type: 'Rect',
    left: round(box.x),
    top: round(box.y),
    width: round(box.width),
    height: round(box.height),
    rx: 0,
    ry: 0,
    fill: LINK_FILL,
    stroke: color || LINK_DEFAULT_COLOR,
    strokeWidth,
    strokeUniform: true,
    id,
    data: { id },
  });
  const linkStyle = normalizeLinkStyle(style);
  return {
    ...json,
    fill: LINK_FILL,
    strokeDashArray: linkStyle === 'dashed' ? [strokeWidth * 4, strokeWidth * 2] : null,
    data: { ...(json.data || {}), link: target, linkStyle, subject: LINK_SUBJECT },
  };
}

/** A link mark with a new target, style or colour (width is kept when the style changes). */
export function applyLinkEdit(obj, { link, style, color } = {}) {
  if (!isLinkMark(obj)) return obj;
  const target = link ? normalizeLink(link) : obj.data.link;
  if (!target) return obj;
  const linkStyle = normalizeLinkStyle(style ?? obj.data.linkStyle);
  const strokeWidth = Number(obj.strokeWidth) || LINK_DEFAULT_WIDTH;
  return {
    ...obj,
    ...(color ? { stroke: color } : {}),
    strokeDashArray: linkStyle === 'dashed' ? [strokeWidth * 4, strokeWidth * 2] : null,
    data: { ...obj.data, link: target, linkStyle },
  };
}

/** The box (page units, top-left origin) an area drag picked, from two corners. */
export function boxFromCorners(a, b) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/**
 * The PDF /Link pieces for a link mark on a page `pageHeight` tall (PDF
 * points, Y up): Rect, QuadPoints, border style, colour, and the action -
 * { uri } for a website, { page, fitR } for an area (the page's own box),
 * { page } for a page.
 */
export function linkExportSpec(obj, pageHeight, { pageUrl = null } = {}) {
  if (!isLinkMark(obj)) return null;
  const link = normalizeLink(obj.data.link);
  if (!link) return null;
  const w = Math.abs((Number(obj.width) || 0) * (Number(obj.scaleX) || 1));
  const h = Math.abs((Number(obj.height) || 0) * (Number(obj.scaleY) || 1));
  const left = Number(obj.left) || 0;
  const top = Number(obj.top) || 0;
  const angle = ((Number(obj.angle) || 0) * Math.PI) / 180;
  const cx = left + (w / 2) * Math.cos(angle) - (h / 2) * Math.sin(angle);
  const cy = top + (w / 2) * Math.sin(angle) + (h / 2) * Math.cos(angle);
  const corner = (dx, dy) => ({
    x: cx + dx * Math.cos(angle) - dy * Math.sin(angle),
    y: pageHeight - (cy + dx * Math.sin(angle) + dy * Math.cos(angle)),
  });
  // QuadPoints order per the PDF spec as viewers read it: top-left, top-right,
  // bottom-left, bottom-right.
  const quad = [corner(-w / 2, -h / 2), corner(w / 2, -h / 2), corner(-w / 2, h / 2), corner(w / 2, h / 2)];
  const xs = quad.map((p) => p.x);
  const ys = quad.map((p) => p.y);
  const round = (n) => Math.round(n * 100) / 100;
  const paint = linkMarkPaint(obj, w, h);
  let action;
  if (link.kind === 'url') action = { uri: link.href };
  else if (link.kind === 'page') action = pageUrl ? { uri: pageUrl(link.page) } : { page: link.page };
  else action = { page: link.page, fitR: link.rect };
  return {
    rect: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(round),
    quadPoints: quad.flatMap((p) => [round(p.x), round(p.y)]),
    borderStyle: paint.style === 'dashed' ? 'D' : paint.style === 'underline' ? 'U' : 'S',
    borderWidth: paint.strokeWidth,
    dash: paint.dash,
    color: paint.stroke,
    action,
  };
}

/** Shift+H, Drawboard's Hyperlink key (by key code, so any layout works). */
// The style and colour last used for a new link (the dialog starts there,
// and the drag preview shows it).
export const LINK_LAST_LOOK_KEY = 'survey.linkTool.look';
export function readLinkLastLook() {
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(LINK_LAST_LOOK_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      return { style: normalizeLinkStyle(saved.style), color: typeof saved.color === 'string' && saved.color ? saved.color : LINK_DEFAULT_COLOR };
    }
  } catch { /* private window or blocked storage: use the default look */ }
  return { style: 'box', color: LINK_DEFAULT_COLOR };
}
export function saveLinkLastLook(look) {
  try {
    globalThis.localStorage?.setItem(LINK_LAST_LOOK_KEY, JSON.stringify({ style: normalizeLinkStyle(look?.style), color: look?.color || LINK_DEFAULT_COLOR }));
  } catch { /* not kept */ }
}

export function isLinkToolKey(event) {
  if (!event || !event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
  return event.code === 'KeyH' || event.key === 'H';
}

/** What the picked bar and the edit dialog read off one link mark. */
export function selectedLinkOf(obj, id = null) {
  if (!isLinkMark(obj)) return null;
  const link = normalizeLink(obj.data.link);
  if (!link) return null;
  return {
    id: id != null ? String(id) : String(obj.id || ''),
    link,
    style: normalizeLinkStyle(obj.data.linkStyle),
    color: typeof obj.stroke === 'string' ? obj.stroke : LINK_DEFAULT_COLOR,
  };
}
