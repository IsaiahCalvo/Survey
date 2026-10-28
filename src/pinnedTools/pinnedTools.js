// Pinned tools (Survey Nightly, beta flag 'pinned-tools'; owner 2026-10-22).
//
// A dock of favourite tools, each pin a tool WITH its own settings: three pens
// in three colours and widths are three pins. Drawboard PDF's "Favorites
// toolbar" is the model (its free plan stops at 7; Survey has no limit), and
// walkthu's favourite-tools dock is the starting point for the dock itself:
// it docks on the left, right or bottom of the page area and is dragged
// between them by its grip.
//
// This file is the pure part: which tools can be pinned, what a pin holds, the
// saved list (one per browser, not per document) and the dock's placement
// maths. components/PinnedToolsDock.jsx draws it and arms pins.

export const PINNED_TOOLS_STORAGE_KEY = 'survey:pinned-tools.v1';

// The tools a pin can hold, in tool-bar order. `id` is the pin's own kind;
// `tool` is the tool it arms. Cloud is the Shapes row's Cloud button:
// Rectangle with the Cloud line style.
export const PINNABLE_TOOLS = Object.freeze([
  { id: 'pen', tool: 'pen', label: 'Pen', iconName: 'pen', group: 'Draw' },
  { id: 'highlighter', tool: 'highlighter', label: 'Highlighter', iconName: 'highlighter', group: 'Draw' },
  { id: 'eraser', tool: 'eraser', label: 'Eraser', iconName: 'eraser', group: 'Draw' },
  { id: 'rect', tool: 'rect', label: 'Rectangle', iconName: 'rect', group: 'Shapes' },
  { id: 'ellipse', tool: 'ellipse', label: 'Ellipse', iconName: 'ellipse', group: 'Shapes' },
  { id: 'polygon', tool: 'polygon', label: 'Polygon', iconName: 'polygon', group: 'Shapes' },
  { id: 'cloud', tool: 'rect', label: 'Cloud', iconName: 'shapeCloud', group: 'Shapes', lineStyle: 'cloud' },
  { id: 'polyline', tool: 'polyline', label: 'Polyline', iconName: 'polyline', group: 'Shapes' },
  { id: 'line', tool: 'line', label: 'Line', iconName: 'line', group: 'Shapes' },
  { id: 'arrow', tool: 'arrow', label: 'Arrow', iconName: 'arrow', group: 'Shapes' },
  { id: 'counter', tool: 'counter', label: 'Counter', iconName: 'counter', group: 'Shapes' },
  { id: 'text', tool: 'text', label: 'Text box', iconName: 'textBox', group: 'Text' },
  { id: 'callout', tool: 'callout', label: 'Callout', iconName: 'callout', group: 'Text' },
].map((entry) => Object.freeze(entry)));

const KIND_BY_ID = new Map(PINNABLE_TOOLS.map((entry) => [entry.id, entry]));

// One rule for every pin (owner 2026-10-27, "they all follow the same
// rules"): a pin keeps what the settings row shows for its tool - the colour
// dot, the size box and the Style picker - and shows the colour as its glyph
// and the size in its corner. Which of those a tool has:
// Tools whose line style (solid / dashed / dotted / cloud) is part of the pin.
const LINE_STYLE_TOOLS = new Set(['rect', 'ellipse', 'polygon', 'polyline', 'line', 'arrow', 'callout', 'text']);
const LINE_STYLES = new Set(['solid', 'dashed', 'dotted', 'cloud']);
const CLOUD_LINE_TOOLS = new Set(['ellipse', 'polygon', 'callout', 'text']);
// Tools with a fill as well as a line.
const FILL_TOOLS = new Set(['rect', 'ellipse', 'polygon', 'callout', 'counter']);
// Tools with a size and no colour: the eraser.
const SIZE_ONLY_TOOLS = new Set(['eraser']);

export const pinKind = (id) => KIND_BY_ID.get(id) || null;

/** The pin kind for an armed tool and line style ('rect' + cloud = Cloud). */
export function pinKindForTool(tool, lineStyle) {
  if (tool === 'rect' && lineStyle === 'cloud') return KIND_BY_ID.get('cloud');
  const kind = KIND_BY_ID.get(tool);
  return kind && kind.id !== 'cloud' ? kind : null;
}

const HEX = /^#[0-9a-f]{6}$/i;
const SHORT_HEX = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const cleanColor = (value) => {
  if (typeof value !== 'string') return undefined;
  const text = value.trim().toLowerCase();
  if (HEX.test(text)) return text;
  const short = SHORT_HEX.exec(text);
  return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : undefined;
};
const cleanNumber = (value, min, max) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(max, Math.max(min, Math.round(n * 100) / 100));
};

/**
 * A pin's settings from a tool's remembered settings (PDFViewer's
 * readToolStyle). Only the fields that kind of tool really uses are kept.
 */
export function pinStyleFor(kindId, raw = {}) {
  const kind = pinKind(kindId);
  if (!kind) return {};
  const style = {};
  if (SIZE_ONLY_TOOLS.has(kind.tool)) {
    const size = cleanNumber(raw.strokeWidth, 1, 100);
    if (size !== undefined) style.strokeWidth = Math.round(size);
    return style;
  }
  const strokeColor = cleanColor(raw.strokeColor);
  if (strokeColor) style.strokeColor = strokeColor;
  const strokeOpacity = cleanNumber(raw.strokeOpacity, 0, 100);
  if (strokeOpacity !== undefined) style.strokeOpacity = strokeOpacity;
  const strokeWidth = cleanNumber(raw.strokeWidth, 0.1, 200);
  if (strokeWidth !== undefined) style.strokeWidth = strokeWidth;
  if (FILL_TOOLS.has(kind.tool)) {
    const fillColor = cleanColor(raw.fillColor);
    if (fillColor) style.fillColor = fillColor;
    const fillOpacity = cleanNumber(raw.fillOpacity, 0, 100);
    if (fillOpacity !== undefined) style.fillOpacity = fillOpacity;
  }
  if (kind.lineStyle) style.lineStyle = kind.lineStyle;
  else if (LINE_STYLE_TOOLS.has(kind.tool)) {
    // A clouded rectangle is the Cloud pin, and a line or arrow is never
    // clouded, so those fall back to solid.
    const cloudOk = CLOUD_LINE_TOOLS.has(kind.tool);
    style.lineStyle = LINE_STYLES.has(raw.lineStyle) && (raw.lineStyle !== 'cloud' || cloudOk)
      ? raw.lineStyle
      : 'solid';
  }
  return style;
}

const STYLE_FIELDS = ['strokeColor', 'strokeOpacity', 'strokeWidth', 'fillColor', 'fillOpacity', 'lineStyle'];

/** Whether `style` holds every setting `pinStyle` sets (it may hold more). */
export function pinStyleCovers(style = {}, pinStyle = {}) {
  return STYLE_FIELDS.every((field) => pinStyle[field] === undefined || style[field] === pinStyle[field]);
}

/** Whether two pin styles hold the same settings. */
export function pinStylesEqual(a = {}, b = {}) {
  return STYLE_FIELDS.every((field) => (a[field] ?? null) === (b[field] ?? null));
}

/** The colour a pin's glyph is drawn in: a counter shows its fill. */
export function pinFaceColor(pin) {
  if (!pin?.style) return null;
  return pinKind(pin.kind)?.tool === 'counter'
    ? (pin.style.fillColor || pin.style.strokeColor || null)
    : (pin.style.strokeColor || null);
}

/** The small number in the pin's corner (its width), as Drawboard shows it. */
export function pinBadge(pin) {
  const width = pin?.style?.strokeWidth;
  if (!Number.isFinite(width)) return '';
  return Number(width.toFixed(2)).toString().replace(/^0(?=\.)/, '');
}

/** Plain words for a pin, in the settings row's units: "Pen, red, 3 pt". */
export function pinDescription(pin) {
  const kind = pinKind(pin?.kind);
  if (!kind) return '';
  const parts = [kind.label];
  const color = pinFaceColor(pin);
  if (color) parts.push(colorName(color));
  const badge = pinBadge(pin);
  if (badge) parts.push(`${badge} pt`);
  const lineStyle = pin.style?.lineStyle;
  if (lineStyle && lineStyle !== 'solid' && !kind.lineStyle) parts.push(lineStyle);
  return parts.join(', ');
}

const NAMED_COLORS = {
  '#ff0000': 'red', '#0000ff': 'blue', '#000000': 'black', '#ffffff': 'white',
  '#ffff00': 'yellow', '#00ff00': 'green', '#008000': 'green', '#ef4444': 'red',
  '#c42747': 'crimson', '#1e293b': 'dark slate', '#ffa500': 'orange', '#800080': 'purple',
};
export function colorName(hex) {
  const key = String(hex || '').toLowerCase();
  return NAMED_COLORS[key] || key;
}

/** 0 (black) .. 1 (white): WCAG relative luminance of a #rrggbb colour. */
export function colorLuminance(hex) {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ''));
  if (!match) return 0.5;
  const [r, g, b] = match.slice(1).map((part) => {
    const c = parseInt(part, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

let idCounter = 0;
function newPinId() {
  try {
    if (globalThis.crypto?.randomUUID) return `pin-${globalThis.crypto.randomUUID()}`;
  } catch { /* fall through */ }
  idCounter += 1;
  return `pin-${Date.now().toString(36)}-${idCounter}`;
}

export function makePin(kindId, rawStyle, id = newPinId()) {
  if (!pinKind(kindId)) return null;
  return { id, kind: kindId, style: pinStyleFor(kindId, rawStyle) };
}

export const DOCK_PLACEMENTS = Object.freeze(['left', 'right', 'bottom']);

export const DEFAULT_PINNED_TOOLS_STATE = Object.freeze({
  visible: true,
  placement: 'right',
  // Compact dock: at most COMPACT_DOCK_SLOTS slots, the rest behind "+N".
  compact: false,
  pins: Object.freeze([]),
});

function sanitizePin(raw) {
  if (!raw || typeof raw !== 'object' || !pinKind(raw.kind)) return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 80) : newPinId(),
    kind: raw.kind,
    style: pinStyleFor(raw.kind, raw.style || {}),
  };
}

export function sanitizePinnedToolsState(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_PINNED_TOOLS_STATE, pins: [] };
  const seen = new Set();
  const pins = (Array.isArray(raw.pins) ? raw.pins : [])
    .map(sanitizePin)
    .filter((pin) => pin && !seen.has(pin.id) && seen.add(pin.id));
  return {
    visible: typeof raw.visible === 'boolean' ? raw.visible : DEFAULT_PINNED_TOOLS_STATE.visible,
    placement: DOCK_PLACEMENTS.includes(raw.placement) ? raw.placement : DEFAULT_PINNED_TOOLS_STATE.placement,
    compact: typeof raw.compact === 'boolean' ? raw.compact : DEFAULT_PINNED_TOOLS_STATE.compact,
    pins,
  };
}

/** Move the pin at `from` to `to` (both indexes into the list). */
export function movePin(pins, from, to) {
  if (from === to || from < 0 || from >= pins.length) return pins;
  const next = [...pins];
  const [moved] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, moved);
  return next;
}

/**
 * The store: one list per browser, saved to localStorage. `storage` may be
 * null (private windows can refuse it); the dock then works for the session.
 */
export function createPinnedToolsStore({ storage = safeStorage(), key = PINNED_TOOLS_STORAGE_KEY } = {}) {
  let state = load(storage, key);
  const listeners = new Set();
  const commit = (next) => {
    state = next;
    try { storage?.setItem(key, JSON.stringify(state)); } catch { /* a full or blocked store must not block the dock */ }
    listeners.forEach((listener) => listener());
  };
  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    addPin(pin, index = state.pins.length) {
      const clean = sanitizePin(pin);
      if (!clean) return null;
      const pins = [...state.pins];
      pins.splice(Math.max(0, Math.min(pins.length, index)), 0, clean);
      commit({ ...state, visible: true, pins });
      return clean;
    },
    removePin(id) {
      if (!state.pins.some((pin) => pin.id === id)) return;
      commit({ ...state, pins: state.pins.filter((pin) => pin.id !== id) });
    },
    updatePinStyle(id, rawStyle) {
      let changed = false;
      const pins = state.pins.map((pin) => {
        if (pin.id !== id) return pin;
        const style = pinStyleFor(pin.kind, rawStyle);
        if (pinStylesEqual(style, pin.style)) return pin;
        changed = true;
        return { ...pin, style };
      });
      if (changed) commit({ ...state, pins });
    },
    movePin(id, toIndex) {
      const from = state.pins.findIndex((pin) => pin.id === id);
      const pins = movePin(state.pins, from, toIndex);
      if (pins !== state.pins) commit({ ...state, pins });
    },
    setPlacement(placement) {
      if (!DOCK_PLACEMENTS.includes(placement) || placement === state.placement) return;
      commit({ ...state, placement });
    },
    setCompact(compact) {
      if (Boolean(compact) === state.compact) return;
      commit({ ...state, compact: Boolean(compact) });
    },
    setVisible(visible) {
      if (Boolean(visible) === state.visible) return;
      commit({ ...state, visible: Boolean(visible) });
    },
  };
}

function safeStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

function load(storage, key) {
  try {
    const text = storage?.getItem(key);
    return sanitizePinnedToolsState(text ? JSON.parse(text) : null);
  } catch {
    return sanitizePinnedToolsState(null);
  }
}

// Dock placement while dragging (walkthu chooseFavoriteDockPlacementForBounds):
// the bottom band wins when the dock's bottom edge reaches it; otherwise the
// side the dock's centre is on. `current` keeps the bottom target a few pixels
// longer on the way out, so the dock does not flicker on the band's edge.
export function snapDistances(width, height) {
  return {
    side: Math.max(0, width) * 0.5,
    bottom: Math.min(72, Math.max(48, height * 0.09)),
  };
}

export function chooseDockPlacement(bounds, width, height, current = null, exitBuffer = 10) {
  if (!(width > 0) || !(height > 0)) return null;
  const { side, bottom } = snapDistances(width, height);
  if (bounds.bottom >= height - bottom) return 'bottom';
  if (current === 'bottom' && bounds.bottom >= height - bottom - exitBuffer) return 'bottom';
  const center = (bounds.left + bounds.right) / 2;
  return center <= side ? 'left' : 'right';
}

const smoothstep = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => Math.min(1, Math.max(0, t));

/**
 * The magnet (walkthu getMagnetizedTranslation): how far to pull the carried
 * dock toward the zone it would land in. `bounds` is where the grip alone
 * would put it (box in page-area pixels), `home` the zone's centre. The pull
 * grows smoothly from nothing at the middle of the page area to most of the
 * way at the edge (86% at the sides, 56% for the bottom band), and the sides
 * let go of the dock's height as it nears the bottom band so the two magnets
 * never fight. Returns the { x, y } to add.
 */
export function magnetPull(bounds, target, width, height, home) {
  if (!target || !home || !(width > 0) || !(height > 0)) return { x: 0, y: 0 };
  const { side, bottom } = snapDistances(width, height);
  const raw = target === 'left'
    ? 1 - bounds.left / Math.max(1, side)
    : target === 'right'
      ? (bounds.right - (width - side)) / Math.max(1, side)
      : 1 - (height - bounds.bottom) / Math.max(1, bottom);
  const strength = smoothstep(clamp01(raw)) * (target === 'bottom' ? 0.56 : 0.86);
  if (target === 'bottom') {
    return { x: 0, y: (home.bottom - bounds.bottom) * strength };
  }
  const nearBottom = smoothstep(clamp01((bounds.bottom - (height - bottom * 2)) / Math.max(1, bottom)));
  const pull = strength * (1 - nearBottom);
  const cx = (bounds.left + bounds.right) / 2;
  const cy = (bounds.top + bounds.bottom) / 2;
  return { x: (home.x - cx) * pull, y: (home.y - cy) * pull };
}

/**
 * Where a pin sits in slots once the dragged one lands at `to` (an index
 * among the other pins): the others close up behind it and open a gap in
 * front of it. Returns the slot shift (-1, 0 or 1) for the pin at `index`.
 */
export function reorderShift(index, from, to) {
  if (from < 0 || index === from) return 0;
  const among = index > from ? index - 1 : index;
  const final = among < to ? among : among + 1;
  return final - index;
}

/** How long the drop glide lasts: longer for a longer trip (walkthu's rule). */
export function dropDurationMs(from, to) {
  const dx = (to.left + to.width / 2) - (from.left + from.width / 2);
  const dy = (to.top + to.height / 2) - (from.top + from.height / 2);
  return Math.round(Math.min(320, Math.max(240, 240 + Math.hypot(dx, dy) * 0.18)));
}

// A big dock (owner 2026-10-27: 17 pins was "such a big thing" to move between
// edges): the compact dock is 7 slots long, a carried dock 6, and a docked one
// never runs past its edge. When the pins do not all fit, the last slot is a
// "+N" button that holds the rest, so no pin is ever hidden in a silent scroll.
export const COMPACT_DOCK_SLOTS = 7;
export const CARRIED_DOCK_SLOTS = 6;

/** How many slots fit in `room` px, each `slot` px long (gap included). */
export function slotsThatFit(room, slot, gap = 0) {
  if (!Number.isFinite(room)) return Infinity;
  return Math.max(1, Math.floor((room + gap) / slot));
}

/**
 * How many pins the dock shows: all of them when they fit in `slots`, else
 * one fewer than the slots so the "+N" button takes the last one.
 */
export function visiblePinCount(total, slots = Infinity) {
  if (!(total > 0)) return 0;
  if (total <= slots) return total;
  return Math.max(1, slots - 1);
}

/** Which slot a dragged pin lands in, from the pointer and the pins' boxes. */
export function reorderIndexAt(pointer, rects, vertical) {
  let index = 0;
  for (const rect of rects) {
    const mid = vertical ? rect.top + rect.height / 2 : rect.left + rect.width / 2;
    if ((vertical ? pointer.y : pointer.x) > mid) index += 1;
  }
  return index;
}
