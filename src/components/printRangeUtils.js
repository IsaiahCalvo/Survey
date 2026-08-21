/**
 * Print-panel page-range helpers. Kept out of PrintPanel.jsx so Node tests
 * can import them without loading the React/CSS panel.
 */

export function parseRange(str, totalPages) {
  const out = new Set();
  if (!str || typeof str !== 'string') return out;
  const parts = str.split(',').map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      let a = Math.max(1, parseInt(m[1], 10));
      let b = Math.min(totalPages, parseInt(m[2], 10));
      if (a > b) [a, b] = [b, a];
      for (let i = a; i <= b; i++) out.add(i);
    } else {
      const n = parseInt(part, 10);
      if (Number.isFinite(n) && n >= 1 && n <= totalPages) out.add(n);
    }
  }
  return out;
}

export function filterRangeChars(raw) {
  return (raw || '').replace(/[^0-9,\-\s]/g, '');
}

export function clampRangeToMax(raw, max) {
  if (!Number.isFinite(max) || max <= 0) return raw;
  // Clear uses a lone "0" as "include nothing". Do not rewrite it to page 1.
  if (/^0+$/.test(String(raw || '').trim())) return '0';
  return (raw || '').replace(/\d+/g, (match) => {
    const n = parseInt(match, 10);
    if (!Number.isFinite(n)) return match;
    if (n < 1) return '1';
    if (n > max) return String(max);
    return match;
  });
}

export function sanitizeRangeInput(raw, max) {
  const cleaned = filterRangeChars(raw);
  if (!cleaned.trim()) return '';
  if (/^0+$/.test(cleaned.trim())) return '0';
  const segments = cleaned.split(',').map((seg) => {
    const trimmed = seg.trim();
    if (!trimmed) return '';
    const m = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      let a = parseInt(m[1], 10);
      let b = parseInt(m[2], 10);
      if (Number.isFinite(max) && max > 0) {
        a = Math.min(Math.max(1, a), max);
        b = Math.min(Math.max(1, b), max);
      }
      if (a > b) [a, b] = [b, a];
      return `${a}-${b}`;
    }
    if (Number.isFinite(max) && max > 0 && /^\d+$/.test(trimmed)) {
      const n = Math.min(Math.max(1, parseInt(trimmed, 10)), max);
      return String(n);
    }
    return trimmed;
  }).filter((s) => s !== '');
  return segments.join(', ');
}

export function compactRange(set) {
  const arr = Array.from(set).sort((a, b) => a - b);
  if (!arr.length) return '';
  const runs = [];
  let start = arr[0];
  let prev = arr[0];
  for (let i = 1; i <= arr.length; i++) {
    const cur = arr[i];
    if (cur === prev + 1) {
      prev = cur;
    } else {
      runs.push(start === prev ? `${start}` : `${start}-${prev}`);
      start = cur;
      prev = cur;
    }
  }
  return runs.join(', ');
}

export function parseCustomInches(raw, fallback) {
  const n = parseFloat(String(raw ?? '').replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(200, Math.max(1, Math.round(n * 100) / 100));
}

/** Copies stepper: empty/NaN/0 → 1; ceiling 999. */
export function clampCopies(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return 1;
  return Math.min(999, Math.max(1, n));
}

/** Print-panel content rotate: 90° steps, stored mod 360. */
export function applyPageRotation(current, deltaDegrees) {
  const cur = Number(current) || 0;
  const delta = Number(deltaDegrees) || 0;
  return (((cur + delta) % 360) + 360) % 360;
}
