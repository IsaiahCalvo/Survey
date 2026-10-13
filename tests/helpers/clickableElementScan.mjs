// Finds clickable non-button elements in JSX source (KAL-66).
//
// A `<div|span|li|td|tr|img|svg ... onClick=...>` opening tag is "keyboard
// ready" when it spreads keyboardControlProps(...) or carries both a tabIndex
// and an onKeyDown of its own. Everything else is reported, with the line it
// starts on, so tests can hold the count of mouse-only elements at a known set
// (scrims, click-through containers) and catch any new mouse-only control.
import fs from 'node:fs';
import path from 'node:path';

const TAG = /<(div|span|li|td|tr|img|svg|section|p)\b/g;

// End of a JSX opening tag starting at `from`: the first `>` outside braces,
// strings, template literals and comments.
function openingTagEnd(src, from) {
  let depth = 0;
  let quote = null;
  for (let i = from; i < src.length; i += 1) {
    const c = src[i];
    if (quote) {
      if (c === '\\') { i += 1; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) return -1; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 1; if (i <= 0) return -1; continue; }
    if (c === '"' || c === "'" || c === '`') { if (depth > 0 || c === '"' || c === "'") quote = c; continue; }
    if (c === '{') depth += 1;
    else if (c === '}') depth -= 1;
    else if (depth === 0 && c === '>') return i;
  }
  return -1;
}

// Stop-propagation-only handlers (`onClick={(e) => e.stopPropagation()}`) are
// a dialog card shielding its scrim, not a control.
const STOP_ONLY = /onClick=\{\s*\(?\s*(e|ev|event)\s*\)?\s*=>\s*\{?\s*\1\.stopPropagation\(\);?\s*\}?\s*\}/;

export function scanSource(src) {
  const found = [];
  TAG.lastIndex = 0;
  let m;
  while ((m = TAG.exec(src))) {
    const end = openingTagEnd(src, m.index + m[0].length);
    if (end < 0) continue;
    const tag = src.slice(m.index, end + 1);
    if (!/\sonClick=/.test(tag) || STOP_ONLY.test(tag)) continue;
    const ready = /keyboardControlProps\(/.test(tag)
      || (/\stabIndex=/.test(tag) && /\sonKeyDown=/.test(tag))
      // dnd-kit's sortable `attributes` give role="button" + tabIndex 0 and
      // its `listeners` carry the keyboard sensor.
      || (/\{\.\.\.(attributes|sortableAttributes)\}/.test(tag) && /\{\.\.\.(listeners|sortableListeners)\}/.test(tag));
    if (ready) continue;
    found.push({ line: src.slice(0, m.index).split('\n').length, tag: m[1] });
  }
  return found;
}

export function scanTree(root, dir = 'src') {
  const out = {};
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
        walk(p);
      } else if (/\.(jsx|tsx)$/.test(entry.name)) {
        const hits = scanSource(fs.readFileSync(p, 'utf8'));
        if (hits.length) out[path.relative(root, p).split(path.sep).join('/')] = hits;
      }
    }
  };
  walk(path.join(root, dir));
  return out;
}
