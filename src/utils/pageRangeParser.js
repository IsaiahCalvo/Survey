/**
 * pageRangeParser.js — parses and formats human-typed PDF page-range strings.
 *
 * Exports parsePageRangeInput (turns "1,3,5-7" into a sorted unique page array
 * plus validation errors, clamped to {min,max}) and formatPageList (the inverse,
 * collapsing a page array back into compact "1, 3, 5-7" range notation).
 * Used by print/export dialogs that accept a page-selection field.
 */
export const sanitizePageRangeInput = (input) => {
  if (typeof input !== 'string') {
    return '';
  }

  let sanitized = '';
  let atNumberStart = true;

  for (const char of input) {
    if (char >= '0' && char <= '9') {
      if (char === '0' && atNumberStart) {
        continue;
      }
      sanitized += char;
      atNumberStart = false;
      continue;
    }

    if (char === ',' || char === '-') {
      sanitized += char;
      atNumberStart = true;
    }
  }

  return sanitized;
};

export const parsePageRangeInput = (input, options = {}) => {
  const { min = 1, max = Infinity } = options;
  const pages = new Set();
  const errors = [];
  let hasOutOfRangeError = false;
  const validRangeText = Number.isFinite(max) ? `${min}-${max}` : `${min}+`;
  const addOutOfRangeError = () => {
    if (hasOutOfRangeError) return;
    errors.push(`This page range is out of the valid range (${validRangeText}).`);
    hasOutOfRangeError = true;
  };

  if (!input || typeof input !== 'string') {
    return { pages: [], errors: ['No page numbers provided.'] };
  }

  const segments = input
    .split(/[,;]+/)
    .map(seg => seg.trim())
    .filter(Boolean);

  if (segments.length === 0) {
    return { pages: [], errors: ['No page numbers provided.'] };
  }

  segments.forEach(segment => {
    if (/^\d+$/.test(segment)) {
      const pageNum = Number(segment);
      if (!Number.isInteger(pageNum) || pageNum < min || pageNum > max) {
        addOutOfRangeError();
        return;
      }
      pages.add(pageNum);
      return;
    }

    const rangeMatch = segment.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      let start = Number(rangeMatch[1]);
      let end = Number(rangeMatch[2]);

      if (!Number.isInteger(start) || !Number.isInteger(end)) {
        errors.push(`Range "${segment}" contains non-integer values.`);
        return;
      }

      if (start > end) {
        [start, end] = [end, start];
      }

      if (start < min || end > max) {
        addOutOfRangeError();
      }

      const boundedStart = Math.max(start, min);
      const boundedEnd = Math.min(end, max);
      for (let page = boundedStart; page <= boundedEnd; page += 1) {
        pages.add(page);
      }
      return;
    }

    errors.push(`Unable to parse "${segment}". Use formats like "5" or "5-7".`);
  });

  return {
    pages: Array.from(pages).sort((a, b) => a - b),
    errors
  };
};

