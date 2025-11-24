export const parsePageRangeInput = (input, options = {}) => {
  const { min = 1, max = Infinity } = options;
  const pages = new Set();
  const errors = [];

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
        errors.push(`Page ${segment} is outside the valid range (${min}-${max}).`);
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

      for (let page = start; page <= end; page += 1) {
        if (page < min || page > max) {
          errors.push(`Page ${page} in range "${segment}" is outside the valid range (${min}-${max}).`);
          continue;
        }
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

export const formatPageList = (pageEntries = []) => {
  if (!Array.isArray(pageEntries) || pageEntries.length === 0) {
    return '';
  }

  const sorted = [...pageEntries].sort((a, b) => a - b);
  const ranges = [];
  let start = sorted[0];
  let prev = sorted[0];

  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i];
    if (current === prev + 1) {
      prev = current;
      continue;
    }

    if (start === prev) {
      ranges.push(String(start));
    } else {
      ranges.push(`${start}-${prev}`);
    }

    start = current;
    prev = current;
  }

  if (start === prev) {
    ranges.push(String(start));
  } else {
    ranges.push(`${start}-${prev}`);
  }

  return ranges.join(', ');
};

