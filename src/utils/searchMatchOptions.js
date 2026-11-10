/**
 * searchMatchOptions.js — where a query matches in a page's text, with the
 * search panel's Match case and Whole word options (Nightly, flag
 * 'search-options'; Drawboard PDF Pro trial audit 2026-11-09).
 *
 * With both options off this is the panel's old rule exactly: case folded,
 * every start, overlapping hits included.
 */
const WORD_CHAR = /[\p{L}\p{N}_]/u;

export function searchMatchStarts(text, query, { matchCase = false, wholeWord = false } = {}) {
  if (!text || !query) return [];
  const hay = matchCase ? text : text.toLowerCase();
  const needle = matchCase ? query : query.toLowerCase();
  const starts = [];
  for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + 1)) {
    if (wholeWord) {
      const before = at > 0 ? hay[at - 1] : '';
      const after = hay[at + needle.length] || '';
      if ((before && WORD_CHAR.test(before)) || (after && WORD_CHAR.test(after))) continue;
    }
    starts.push(at);
  }
  return starts;
}

/** The match length in the page text, for the same options. */
export function searchMatchLength(query, { matchCase = false } = {}) {
  return (matchCase ? query : query.toLowerCase()).length;
}
