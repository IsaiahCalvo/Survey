/**
 * How a text box or callout wraps its lines (Drawboard PDF Pro trial audit
 * 2026-11-09: Survey split "confirm" into "c / onfirm"; Drawboard wraps at
 * spaces).
 *
 * Marks made before beta flag 'word-wrap' keep the old break-anywhere wrap,
 * so no saved box re-flows and clips its last line. A mark that asks for word
 * wrap carries it with it:
 *   - a text box: fabric's own switch, `splitByGrapheme: false` (the PDF
 *     export already honoured it);
 *   - a callout: `style.wrapWords: true`.
 *
 * Every surface that lays the text out (screen, live editor, height
 * measurer, canvas proxy, PDF export) reads the mode from here, so they all
 * break lines at the same places. Pure and worker-safe: no DOM, no flags.
 */
import { segmentGraphemes } from './textGraphemes.js';

/** Does this text box (or callout projection) wrap at spaces? */
export function textWrapsWords(obj) {
  return obj?.splitByGrapheme === false;
}

/** Does this callout wrap at spaces? */
export function calloutWrapsWords(callout) {
  return callout?.style?.wrapWords === true;
}

/**
 * The CSS for the wrap. Word wrap breaks at spaces and inside a word only
 * when that one word is wider than the box; it also breaks between CJK
 * characters, which have no spaces.
 */
export function wrapTextCss(wrapWords) {
  return wrapWords
    ? { wordWrap: 'break-word', wordBreak: 'normal', overflowWrap: 'anywhere' }
    : { wordWrap: 'break-word', wordBreak: 'break-all' };
}

// Scripts written without spaces: CSS may break between any two of these
// characters, so the canvas wrapper treats each one as a word of its own.
const NO_SPACE_SCRIPT = /[⺀-鿿ꥠ-꥿가-퟿豈-﫿︰-﹏＀-￯]|[\u{20000}-\u{3FFFF}]/u;

/** A CJK (or other no-space script) cluster: a word of its own when wrapping. */
export function isNoSpaceCluster(cluster) {
  return NO_SPACE_SCRIPT.test(cluster);
}

function tokens(clusters) {
  const out = [];
  for (const cluster of clusters) {
    const space = cluster === ' ' || cluster === '\t';
    const alone = !space && isNoSpaceCluster(cluster);
    const last = out[out.length - 1];
    if (last && !alone && !last.alone && last.space === space) last.clusters.push(cluster);
    else out.push({ space, alone, clusters: [cluster] });
  }
  return out;
}

/**
 * One paragraph (no line breaks) as lines no wider than `maxWidth`.
 * `measure(text)` gives a run's width. Clusters are never split (an emoji is
 * one cluster). Word mode: a run of spaces rides on the line it ends, as in
 * CSS pre-wrap; it is not trimmed, because CSS keeps hanging spaces too.
 */
export function wrapParagraph(paragraph, maxWidth, measure, { wrapWords = false } = {}) {
  const clusters = segmentGraphemes(String(paragraph ?? ''));
  const fits = (value) => {
    try { return measure(value) <= maxWidth; } catch { return true; }
  };
  const lines = [];
  const byCluster = (start, list) => {
    let line = start;
    for (const cluster of list) {
      if (line && !fits(line + cluster)) {
        lines.push(line);
        line = cluster;
      } else {
        line += cluster;
      }
    }
    return line;
  };
  if (!wrapWords) {
    lines.push(byCluster('', clusters));
    return lines;
  }
  let line = '';
  for (const token of tokens(clusters)) {
    const text = token.clusters.join('');
    if (token.space || fits(line + text)) {
      line += text;
      continue;
    }
    if (/\S/.test(line)) {
      lines.push(line);
      line = '';
    }
    line = byCluster(line, token.clusters);
  }
  lines.push(line);
  return lines;
}
