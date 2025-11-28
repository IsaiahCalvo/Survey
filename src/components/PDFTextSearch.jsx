import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

const createResultId = (() => {
  let counter = 0;
  return () => {
    counter += 1;
    return `search-${Date.now()}-${counter}`;
  };
})();

const clampValue = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);

const createSnippet = (text, start, end, radius = 60) => {
  if (!text || typeof text !== 'string') {
    return { snippet: '', matchIndex: -1 };
  }
  const snippetStart = Math.max(0, start - radius);
  const snippetEnd = Math.min(text.length, end + radius);
  const prefix = snippetStart > 0 ? '…' : '';
  const suffix = snippetEnd < text.length ? '…' : '';
  const snippetText = `${prefix}${text.slice(snippetStart, snippetEnd)}${suffix}`;
  const highlightOffset = prefix ? 1 : 0;
  const matchIndex = highlightOffset + (start - snippetStart);
  return { snippet: snippetText, matchIndex };
};

const buildRectanglesForMatch = (pageData, matchStart, matchLength) => {
  const { items, ranges, viewportTransform } = pageData;
  if (!items || !ranges || !viewportTransform) {
    return [];
  }

  const matchEnd = matchStart + matchLength;
  const rects = [];

  for (let i = 0; i < ranges.length; i += 1) {
    const range = ranges[i];
    if (range.end <= matchStart) continue;
    if (range.start >= matchEnd) break;

    const textItem = items[range.itemIndex];
    if (!textItem || !textItem.str || !textItem.transform) continue;

    const overlapStart = Math.max(range.start, matchStart);
    const overlapEnd = Math.min(range.end, matchEnd);
    const relativeStart = overlapStart - range.start;
    const relativeLength = overlapEnd - overlapStart;
    if (relativeLength <= 0) continue;

    const glyphCount = Math.max(textItem.str.length, 1);
    const horizontalScale = clampValue(textItem.width, glyphCount * 2) / glyphCount;

    const transformed = pdfjsLib.Util.transform(viewportTransform, textItem.transform);
    const fontHeight = Math.hypot(clampValue(transformed[2]), clampValue(transformed[3])) || clampValue(textItem.height, 12);

    const baseLeft = transformed[4];
    const baseTop = transformed[5] - fontHeight;

    const rectLeft = baseLeft + horizontalScale * relativeStart;
    const rectWidth = Math.max(horizontalScale * relativeLength, 2);

    rects.push({
      x: rectLeft,
      y: baseTop,
      width: rectWidth,
      height: Math.max(fontHeight, 6)
    });
  }

  return rects;
};

export const usePDFTextSearch = (pdfDoc) => {
  const cacheRef = useRef({});
  const [results, setResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [lastQuery, setLastQuery] = useState('');

  // Reset cache when PDF changes
  useEffect(() => {
    cacheRef.current = {};
    setResults([]);
    setLastQuery('');
  }, [pdfDoc]);

  const loadPageData = useCallback(async (pageNumber) => {
    if (!pdfDoc) return null;
    if (cacheRef.current[pageNumber]) {
      return cacheRef.current[pageNumber];
    }

    const page = await pdfDoc.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1 });

    let fullText = '';
    const ranges = [];

    (textContent.items || []).forEach((item, index) => {
      const str = item?.str || '';
      const start = fullText.length;
      fullText += str;
      ranges.push({ start, end: start + str.length, itemIndex: index });
    });

    const data = {
      text: fullText,
      items: textContent.items || [],
      ranges,
      viewportTransform: viewport.transform
    };

    cacheRef.current[pageNumber] = data;
    return data;
  }, [pdfDoc]);

  const searchText = useCallback(async (rawQuery) => {
    if (!pdfDoc) {
      setResults([]);
      return [];
    }
    const trimmed = (rawQuery || '').trim();
    if (!trimmed) {
      setResults([]);
      setLastQuery('');
      return [];
    }

    setIsSearching(true);
    setLastQuery(trimmed);

    const normalizedQuery = trimmed.toLowerCase();
    const aggregated = [];

    for (let pageNumber = 1; pageNumber <= pdfDoc.numPages; pageNumber += 1) {
      const pageData = await loadPageData(pageNumber);
      if (!pageData || !pageData.text) continue;

      const normalizedText = pageData.text.toLowerCase();
      let searchIndex = normalizedText.indexOf(normalizedQuery);

      while (searchIndex !== -1) {
        const { snippet, matchIndex } = createSnippet(
          pageData.text,
          searchIndex,
          searchIndex + normalizedQuery.length
        );
        const rectangles = buildRectanglesForMatch(pageData, searchIndex, normalizedQuery.length);

        aggregated.push({
          id: createResultId(),
          pageNumber,
          startIndex: searchIndex,
          length: normalizedQuery.length,
          snippet,
          snippetMatchIndex: matchIndex,
          rectangles
        });

        searchIndex = normalizedText.indexOf(normalizedQuery, searchIndex + normalizedQuery.length);
      }
    }

    setResults(aggregated);
    setIsSearching(false);
    return aggregated;
  }, [pdfDoc, loadPageData]);

  const clearSearch = useCallback(() => {
    setResults([]);
    setLastQuery('');
  }, []);

  const resultsByPage = useMemo(() => {
    if (!results || results.length === 0) {
      return {};
    }
    return results.reduce((acc, result) => {
      if (!acc[result.pageNumber]) {
        acc[result.pageNumber] = [];
      }
      acc[result.pageNumber].push(result);
      return acc;
    }, {});
  }, [results]);

  return {
    searchText,
    clearSearch,
    results,
    resultsByPage,
    isSearching,
    lastQuery
  };
};

export default usePDFTextSearch;

