/**
 * Grapheme-cluster segmentation — the one splitter every text wrapper in this
 * app must walk with.
 *
 * Extracted from pdfUnicodeText.js on 2026-09-15 so the Canvas2D annotation
 * painter (and the Web Worker that runs it) can share the exact same splitter
 * without pulling in pdf-lib and the font-coverage tables. pdfUnicodeText.js
 * re-exports from here, so there is still only ONE implementation.
 */

// One emoji is almost never one code point. 👷🏽‍♀️ is five (base + skin tone +
// ZWJ + gender sign + VS16) and 🇯🇵 is two regional indicators; splitting
// either draws nonsense. `Intl.Segmenter` is the only correct splitter and is
// available in every runtime this app ships to.
// Made on first use, not at import: building one costs ~15 ms of main-thread
// time (about 60 ms on a 4x-slowed CPU), and this module is imported by the
// home screen, which never splits text.
let graphemeSegmenter;
function getGraphemeSegmenter() {
  if (graphemeSegmenter !== undefined) return graphemeSegmenter;
  try {
    graphemeSegmenter = typeof Intl !== 'undefined' && Intl.Segmenter
      ? new Intl.Segmenter('und', { granularity: 'grapheme' })
      : null;
  } catch {
    graphemeSegmenter = null;
  }
  return graphemeSegmenter;
}

// 2026-09-15: the fallback for a runtime WITHOUT `Intl.Segmenter` used to be a
// bare per-code-point walk, which splits every flag, keycap, skin tone and ZWJ
// sequence — the exact failure this splitter exists to prevent, handed straight
// to the line wrapper. So the fallback now glues a cluster back together from
// the pieces that can ONLY ever be continuations of the character before them:
// combining marks (which is what carries Thai tone marks, Hebrew niqqud and the
// U+20E3 keycap enclosure), the variation selectors, the skin-tone modifiers,
// the tag characters that spell out a subdivision flag, and whatever follows a
// ZWJ. It is not the whole of UAX #29 — it is the part of it that emoji and
// combining marks depend on, which is the part a wrap boundary destroys.
const CLUSTER_EXTEND = /^[\p{M}\u200D\uFE0E\uFE0F\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]$/u;
// Regional indicators pair up and no further: 🇯🇵 is exactly two of them, so a
// third starts the next flag instead of growing this one.
const REGIONAL_INDICATOR = /^[\u{1F1E6}-\u{1F1FF}]$/u;
const ZERO_WIDTH_JOINER = '\u200D';

function segmentGraphemesWithoutIntl(source) {
  const clusters = [];
  let joinNext = false;
  for (const character of source) {
    const last = clusters.length - 1;
    const previous = last >= 0 ? clusters[last] : null;
    if (previous !== null && (joinNext || CLUSTER_EXTEND.test(character))) {
      clusters[last] = previous + character;
    } else if (
      previous !== null
      && REGIONAL_INDICATOR.test(character)
      && REGIONAL_INDICATOR.test(previous)
    ) {
      clusters[last] = previous + character;
    } else {
      clusters.push(character);
    }
    joinNext = character === ZERO_WIDTH_JOINER;
  }
  return clusters;
}

export function segmentGraphemes(text) {
  const source = String(text ?? '');
  if (!source) return [];
  const segmenter = getGraphemeSegmenter();
  if (!segmenter) return segmentGraphemesWithoutIntl(source);
  return [...segmenter.segment(source)].map((entry) => entry.segment);
}
