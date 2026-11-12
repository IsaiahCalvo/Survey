/**
 * Counter numbering — derives the displayed number for each counter pin
 * from its position within its series (grouped by `data.seriesId`,
 * sorted by `data.createdAt`).
 *
 * Counters are stored as Fabric Circle objects with
 *   data: { type: 'counter', createdAt, seriesId, seriesStart, displayNumber }
 *
 * Series-aware rules:
 *   - Pins are grouped by `data.seriesId`. Pins missing a seriesId are
 *     treated as their own one-off "legacy" group keyed by '__legacy__' —
 *     this only matters in the brief window before the wipe-on-load
 *     migration removes them, but it keeps renumberCounters defensive.
 *   - Within each group, pins are sorted by `createdAt` ascending.
 *   - displayNumber for the i-th pin in a group is
 *       (seriesStart || 1) + i
 *     so the first pin shows seriesStart and subsequent pins increment by 1.
 *
 * Copy-on-write: page objects are never edited. A page whose counters get a
 * new number is replaced IN THE PASSED MAP by a new page object (new objects
 * array, new counter objects; every other mark shared). Pages whose numbers
 * are already right keep their identity. Returns the same map reference, so
 * callers must pass a map they own (every caller passes a fresh shallow copy).
 *
 * Why (Codex review, release PR, 2026-10-13): undo / redo snapshots share
 * unchanged pages by object identity (utils/historySnapshotShare.js). The old
 * version reassigned `obj.data` on the live counter objects, so a page whose
 * numbers changed (a counter added or removed on another page) kept its
 * identity and the next snapshot reused its stale copy — undo / redo could
 * then restore old numbers. It could also edit a restored snapshot page.
 */

const LEGACY_KEY = '__legacy__';

export function renumberCounters(annotationsByPage) {
  if (!annotationsByPage || typeof annotationsByPage !== 'object') {
    return annotationsByPage;
  }

  const groups = new Map();
  for (const pageKey of Object.keys(annotationsByPage)) {
    const page = annotationsByPage[pageKey];
    if (!page || !Array.isArray(page.objects)) continue;
    page.objects.forEach((obj, index) => {
      if (obj && obj.data && obj.data.type === 'counter') {
        const key = obj.data.seriesId || LEGACY_KEY;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ obj, pageKey, index });
      }
    });
  }

  // pageKey -> objects array copy, made the first time a counter on that page
  // needs a new number.
  const replacedObjects = new Map();
  for (const [, list] of groups) {
    list.sort((a, b) => {
      const at = (a.obj.data && a.obj.data.createdAt) || 0;
      const bt = (b.obj.data && b.obj.data.createdAt) || 0;
      return at - bt;
    });

    // seriesStart of the EARLIEST pin in the group is the source of truth.
    // We mirror it onto every pin so any one is sufficient to reconstruct
    // the series start (defensive against partial deletes).
    const first = list[0] && list[0].obj;
    const startBasis = (first && first.data && Number(first.data.seriesStart)) || 1;

    list.forEach(({ obj, pageKey, index }, i) => {
      const displayNumber = startBasis + i;
      if (obj.data.displayNumber === displayNumber && obj.data.seriesStart === startBasis) return;
      let objects = replacedObjects.get(pageKey);
      if (!objects) {
        objects = annotationsByPage[pageKey].objects.slice();
        replacedObjects.set(pageKey, objects);
      }
      objects[index] = {
        ...obj,
        data: { ...obj.data, displayNumber, seriesStart: startBasis },
      };
    });
  }

  for (const [pageKey, objects] of replacedObjects) {
    annotationsByPage[pageKey] = { ...annotationsByPage[pageKey], objects };
  }

  return annotationsByPage;
}

/**
 * Builds the per-page saves needed to remove one complete counter series.
 * Only pages containing matching pins are returned, and the input map is
 * never mutated.
 */
export function buildCounterSeriesDeletionUpdates(annotationsByPage, seriesId) {
  if (!annotationsByPage || typeof annotationsByPage !== 'object' || !seriesId) {
    return { updates: [], removedCount: 0 };
  }

  const updates = [];
  let removedCount = 0;

  for (const pageKey of Object.keys(annotationsByPage)) {
    const page = annotationsByPage[pageKey];
    if (!page || !Array.isArray(page.objects)) continue;

    const objects = page.objects.filter((obj) => !(
      obj?.data?.type === 'counter' && obj.data.seriesId === seriesId
    ));
    const pageRemovedCount = page.objects.length - objects.length;
    if (pageRemovedCount === 0) continue;

    removedCount += pageRemovedCount;
    updates.push({
      pageKey,
      json: { ...page, objects },
      removedCount: pageRemovedCount,
    });
  }

  return { updates, removedCount };
}

/**
 * Returns the ordered list of counter series found across all pages.
 * Series order is by the earliest createdAt of any pin in the series, so
 * "Count 1" is always the oldest series, "Count 2" the next, etc. — unless the
 * counts were dragged into another order in the counts list (beta
 * 'counter-list'): then each pin carries data.seriesOrder and that wins; a
 * count started since then has none and follows the ordered ones.
 *
 * Each entry: { seriesId, color, numberColor, label, count, firstCreatedAt, order }
 */
export function getCounterSeriesList(annotationsByPage) {
  if (!annotationsByPage || typeof annotationsByPage !== 'object') {
    return [];
  }

  const groups = new Map();
  for (const pageKey of Object.keys(annotationsByPage)) {
    const page = annotationsByPage[pageKey];
    if (!page || !Array.isArray(page.objects)) continue;
    for (const obj of page.objects) {
      if (!obj || !obj.data || obj.data.type !== 'counter') continue;
      if (!obj.data.seriesId) continue; // skip legacy pins entirely
      const key = obj.data.seriesId;
      if (!groups.has(key)) {
        groups.set(key, {
          seriesId: key,
          color: obj.fill || '#ef4444',
          numberColor: obj.data.numberColor || '#ffffff',
          firstCreatedAt: Number(obj.data.createdAt) || 0,
          // The earliest pin's seriesStart: the number the count starts at.
          start: Math.max(1, Math.floor(Number(obj.data.seriesStart) || 1)),
          name: String(obj.data.seriesName || '').trim(),
          order: null,
          count: 0,
        });
      }
      const entry = groups.get(key);
      entry.count += 1;
      const order = Number(obj.data.seriesOrder);
      if (obj.data.seriesOrder != null && Number.isFinite(order) && entry.order == null) entry.order = order;
      if (!entry.name && obj.data.seriesName) entry.name = String(obj.data.seriesName).trim();
      const ts = Number(obj.data.createdAt) || 0;
      if (ts && ts < entry.firstCreatedAt) {
        entry.firstCreatedAt = ts;
        entry.start = Math.max(1, Math.floor(Number(obj.data.seriesStart) || 1));
      }
      // Fabric copies fill onto every pin, so any non-empty fill is valid.
      if (obj.fill) entry.color = obj.fill;
      if (obj.data.numberColor) entry.numberColor = obj.data.numberColor;
    }
  }

  const sorted = Array.from(groups.values()).sort((a, b) => {
    if (a.order != null && b.order != null && a.order !== b.order) return a.order - b.order;
    if ((a.order != null) !== (b.order != null)) return a.order != null ? -1 : 1;
    return a.firstCreatedAt - b.firstCreatedAt;
  });

  return sorted.map((entry, i) => ({
    ...entry,
    label: entry.name || `Count ${i + 1}`,
  }));
}

/**
 * The page writes that put the counts in `orderedIds` order (the counts list's
 * drag to reorder): every pin gets data.seriesOrder, its count's place. A count
 * still named by its place ("Count 2") keeps that name as its own, so moving
 * it does not quietly rename it or the others. Pages with nothing to change
 * are left out. `orderedIds` must name every count exactly once.
 *
 * Returns { ok, reason?, updates: [{ pageKey, json }] }.
 */
export function buildCounterSeriesOrderUpdates(annotationsByPage, orderedIds) {
  const list = getCounterSeriesList(annotationsByPage);
  const ids = Array.isArray(orderedIds) ? orderedIds.map(String) : [];
  if (
    ids.length !== list.length
    || new Set(ids).size !== ids.length
    || list.some((series) => !ids.includes(String(series.seriesId)))
  ) {
    return { ok: false, reason: 'series-changed', updates: [] };
  }
  const place = new Map(ids.map((id, index) => [id, index]));
  const labelOf = new Map(list.map((series) => [String(series.seriesId), series.label]));
  const updates = [];
  for (const pageKey of Object.keys(annotationsByPage || {})) {
    const page = annotationsByPage[pageKey];
    if (!page || !Array.isArray(page.objects)) continue;
    let touched = false;
    const objects = page.objects.map((obj) => {
      if (obj?.data?.type !== 'counter' || !obj.data.seriesId) return obj;
      const id = String(obj.data.seriesId);
      if (!place.has(id)) return obj;
      const seriesOrder = place.get(id);
      const seriesName = String(obj.data.seriesName || '').trim() || labelOf.get(id);
      if (obj.data.seriesOrder === seriesOrder && obj.data.seriesName === seriesName) return obj;
      touched = true;
      return { ...obj, data: { ...obj.data, seriesOrder, seriesName } };
    });
    if (touched) updates.push({ pageKey, json: { ...page, objects } });
  }
  return { ok: true, updates };
}

export function resolveCounterSeriesPaint(
  counterSeriesList,
  activeSeriesId,
  fallbackFill = '#ef4444',
  fallbackNumberColor = '#ffffff',
) {
  const activeSeries = (counterSeriesList || []).find(
    (series) => series?.seriesId === activeSeriesId,
  );
  return {
    fill: activeSeries?.color || fallbackFill,
    numberColor: activeSeries?.numberColor || fallbackNumberColor,
  };
}

/**
 * The colours a new count may take: the shared colour picker's own cells
 * (CompactColorPicker PRESET_COLORS without black and white, then the grid's
 * 56% lightness row), so a new count's colour always shows CHECKED in its
 * picker (owner 2026-11-12: "the pin doesn't have the selected color actually
 * shown with the checkboxes"). tests/counterNumbering.test.mjs pins them to
 * the picker's cells.
 */
export const COUNTER_SERIES_PALETTE = Object.freeze([
  '#ff0000', '#0000ff', '#f97316', '#22c55e', '#0ea5e9', '#a855f7',
  '#ee2f2f', '#eed22f', '#65ee2f', '#2fee9c', '#2f9cee', '#652fee', '#ee2fd2',
]);

const normaliseHex = (color) => {
  if (typeof color !== 'string') return null;
  const value = color.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(value)) return value;
  if (/^#[0-9a-f]{3}$/.test(value)) return `#${value.slice(1).split('').map((c) => c + c).join('')}`;
  const rgb = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!rgb) return null;
  return `#${rgb.slice(1, 4).map((n) => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, '0')).join('')}`;
};

const hueDistance = (a, b) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/**
 * Picks the next series color: the hue in the middle of the largest gap on
 * the 0-360 ring between existing series hues, snapped to the nearest palette
 * colour no count uses yet (any palette colour once all are used).
 *
 * existingColors: array of CSS hex/rgb(a) strings.
 * Returns: a lowercase #rrggbb from COUNTER_SERIES_PALETTE.
 */
export function pickNextSeriesColor(existingColors) {
  const hues = (existingColors || [])
    .map(colorToHue)
    .filter((h) => h !== null)
    .sort((a, b) => a - b);

  // First series starts at red (matches the previous default fill).
  let target = 0;
  if (hues.length > 0) {
    // Find the largest gap between consecutive hues on the ring.
    let bestGap = -1;
    for (let i = 0; i < hues.length; i += 1) {
      const a = hues[i];
      const b = i === hues.length - 1 ? hues[0] + 360 : hues[i + 1];
      const gap = b - a;
      if (gap > bestGap) {
        bestGap = gap;
        target = (a + gap / 2) % 360;
      }
    }
  }

  const used = new Set((existingColors || []).map(normaliseHex).filter(Boolean));
  const free = COUNTER_SERIES_PALETTE.filter((hex) => !used.has(hex));
  const pool = free.length ? free : COUNTER_SERIES_PALETTE;
  let best = pool[0];
  let bestDistance = Infinity;
  for (const hex of pool) {
    const distance = hueDistance(colorToHue(hex), target);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = hex;
    }
  }
  return best;
}

// ---------- color helpers ----------

function colorToHue(color) {
  if (typeof color !== 'string') return null;
  const value = color.trim();
  let channels;
  if (value.startsWith('#')) {
    const hex = value.slice(1);
    if (hex.length !== 3 && hex.length !== 6) return null;
    const full =
      hex.length === 3
        ? hex
          .split('')
          .map((c) => c + c)
          .join('')
        : hex;
    channels = [
      parseInt(full.slice(0, 2), 16),
      parseInt(full.slice(2, 4), 16),
      parseInt(full.slice(4, 6), 16),
    ];
  } else {
    const match = value.match(
      /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*[\d.]+)?\s*\)$/i,
    );
    if (!match) return null;
    channels = match.slice(1, 4).map(Number);
  }
  if (channels.some((channel) => !Number.isFinite(channel))) return null;
  const [r, g, b] = channels.map((channel) => Math.max(0, Math.min(255, channel)) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return h;
}

