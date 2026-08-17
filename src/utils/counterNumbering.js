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
 * Mutates the passed annotationsByPage map in place (each counter's
 * `data.displayNumber` is reassigned). Returns the same reference.
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
    for (const obj of page.objects) {
      if (obj && obj.data && obj.data.type === 'counter') {
        const key = obj.data.seriesId || LEGACY_KEY;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(obj);
      }
    }
  }

  for (const [, list] of groups) {
    list.sort((a, b) => {
      const at = (a.data && a.data.createdAt) || 0;
      const bt = (b.data && b.data.createdAt) || 0;
      return at - bt;
    });

    // seriesStart of the EARLIEST pin in the group is the source of truth.
    // We mirror it onto every pin so any one is sufficient to reconstruct
    // the series start (defensive against partial deletes).
    const startBasis = (list[0] && list[0].data && Number(list[0].data.seriesStart)) || 1;

    list.forEach((obj, i) => {
      obj.data = {
        ...obj.data,
        displayNumber: startBasis + i,
        seriesStart: startBasis,
      };
    });
  }

  return annotationsByPage;
}

/**
 * Returns the ordered list of counter series found across all pages.
 * Series order is by the earliest createdAt of any pin in the series, so
 * "Count 1" is always the oldest series, "Count 2" the next, etc.
 *
 * Each entry: { seriesId, color, numberColor, label, count, firstCreatedAt }
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
          count: 0,
        });
      }
      const entry = groups.get(key);
      entry.count += 1;
      const ts = Number(obj.data.createdAt) || 0;
      if (ts && ts < entry.firstCreatedAt) entry.firstCreatedAt = ts;
      // Fabric copies fill onto every pin, so any non-empty fill is valid.
      if (obj.fill) entry.color = obj.fill;
      if (obj.data.numberColor) entry.numberColor = obj.data.numberColor;
    }
  }

  const sorted = Array.from(groups.values()).sort(
    (a, b) => a.firstCreatedAt - b.firstCreatedAt
  );

  return sorted.map((entry, i) => ({
    ...entry,
    label: `Count ${i + 1}`,
  }));
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
 * Picks the next series color by finding the largest hue gap on the
 * 0-360 ring between existing series hues, then returning the midpoint.
 * Saturation/lightness are fixed at S=70%, L=50% per design.
 *
 * existingColors: array of CSS hex/rgb(a) strings.
 * Returns: a hex string for the next color.
 */
export function pickNextSeriesColor(existingColors) {
  const hues = (existingColors || [])
    .map(colorToHue)
    .filter((h) => h !== null)
    .sort((a, b) => a - b);

  if (hues.length === 0) {
    // First series — start at red (matches the previous default fill).
    return hslToHex(0, 70, 50);
  }

  // Find the largest gap between consecutive hues on the ring.
  let bestGap = -1;
  let bestMid = 0;
  for (let i = 0; i < hues.length; i += 1) {
    const a = hues[i];
    const b = i === hues.length - 1 ? hues[0] + 360 : hues[i + 1];
    const gap = b - a;
    if (gap > bestGap) {
      bestGap = gap;
      bestMid = (a + gap / 2) % 360;
    }
  }

  return hslToHex(bestMid, 70, 50);
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

function hslToHex(h, s, l) {
  const sN = s / 100;
  const lN = l / 100;
  const c = (1 - Math.abs(2 * lN - 1)) * sN;
  const hh = ((h % 360) + 360) % 360;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = lN - c / 2;
  let rp;
  let gp;
  let bp;
  if (hh < 60) [rp, gp, bp] = [c, x, 0];
  else if (hh < 120) [rp, gp, bp] = [x, c, 0];
  else if (hh < 180) [rp, gp, bp] = [0, c, x];
  else if (hh < 240) [rp, gp, bp] = [0, x, c];
  else if (hh < 300) [rp, gp, bp] = [x, 0, c];
  else [rp, gp, bp] = [c, 0, x];
  const r = Math.round((rp + m) * 255);
  const g = Math.round((gp + m) * 255);
  const b = Math.round((bp + m) * 255);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}
