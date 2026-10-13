// RULED 2026-09-29 owner: cleaner History. "The blue outline doesn't fully
// encompass it; the floating Restore / Deleted tags don't look proper; on the
// page just have it highlighted. In the History column I want it clearer
// whether an entry was deleted, just modified, or created: deleted = red,
// edited = green, new = blue."
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HISTORY_STATUS_LEGEND, describeHistoryRow, historyStatusOf } from '../src/utils/historyFeed.js';
import { historyAnnotationInkBox } from '../src/utils/historyGeometry.js';
import { measureInkScreenRect } from '../src/components/revisions/historyPageOverlay.js';

test('every line kind has one status color: added blue, edited green, deleted red, restored teal', () => {
  assert.equal(historyStatusOf('created'), 'created');
  assert.equal(historyStatusOf('placed'), 'created');
  assert.equal(historyStatusOf('deleted'), 'deleted');
  assert.equal(historyStatusOf('restored'), 'restored');
  for (const kind of ['moved', 'resized', 'rotated', 'recolored', 'erased', 'textEdited', 'locked', 'unlocked', 'tookOff', 'edited']) {
    assert.equal(historyStatusOf(kind), 'edited', kind);
  }
  for (const kind of ['undo', 'redo', 'synced', 'nonsense', undefined]) assert.equal(historyStatusOf(kind), 'other');
  assert.deepEqual(HISTORY_STATUS_LEGEND.map((item) => item.id), ['created', 'edited', 'deleted', 'restored']);
  const deleted = describeHistoryRow({
    id: 'd', client_event_id: 'd', event_type: 'annotation_deleted', summary: 'Maya deleted a rectangle',
    payload: {}, occurred_at: '2026-09-29T10:00:00Z',
  });
  assert.equal(deleted.status, 'deleted');
});

test('the stored-box fallback covers the stroke', () => {
  assert.deepEqual(
    historyAnnotationInkBox({ type: 'rect', left: 10, top: 20, width: 100, height: 50, strokeWidth: 8 }),
    { x: 6, y: 16, width: 108, height: 58 },
  );
  assert.equal(historyAnnotationInkBox(null), null);
});

// A tiny fake DOM: enough of getComputedStyle / getBBox / getScreenCTM to
// check the measuring rules without a browser.
const NS = 'http://www.w3.org/2000/svg';
function fakeDoc(styles) {
  return { defaultView: { getComputedStyle: (el) => ({ display: 'inline', visibility: 'visible', opacity: '1', vectorEffect: 'none', ...styles.get(el) }) } };
}
function leaf(tag, bbox, ctm = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) {
  return { namespaceURI: NS, localName: tag, children: [], parentElement: null, getBBox: () => bbox, getScreenCTM: () => ctm };
}
function group(children) {
  const g = { namespaceURI: NS, localName: 'g', children, parentElement: null };
  children.forEach((c) => { c.parentElement = g; });
  return g;
}

test('what you see is measured with its stroke; invisible hit targets are skipped', () => {
  // A 40-wide pen line from (100,100) to (200,100): getBoundingClientRect
  // says 0 px tall; the ink is 40 tall and reaches 20 past each end.
  const pen = leaf('path', { x: 100, y: 100, width: 100, height: 0 });
  const hit = leaf('path', { x: 0, y: 0, width: 1000, height: 1000 });
  const root = group([pen, hit]);
  const styles = new Map([
    [pen, { fill: 'none', stroke: 'rgb(255, 0, 0)', strokeWidth: '40px', strokeOpacity: '1', fillOpacity: '1' }],
    [hit, { fill: 'none', stroke: 'transparent', strokeWidth: '24px', strokeOpacity: '1', fillOpacity: '1' }],
    [root, {}],
  ]);
  assert.deepEqual(measureInkScreenRect(fakeDoc(styles), [root]), { l: 80, t: 80, r: 220, b: 120 });
});

test('a rotated, stroked rectangle is measured through its transform', () => {
  // 80 x 40 rect, stroke 10, rotated 90 degrees about the origin.
  const rect = leaf('rect', { x: 0, y: 0, width: 80, height: 40 }, { a: 0, b: 1, c: -1, d: 0, e: 0, f: 0 });
  const styles = new Map([[rect, { fill: 'none', stroke: '#00f', strokeWidth: '10px', strokeOpacity: '1', fillOpacity: '1' }]]);
  const r = measureInkScreenRect(fakeDoc(styles), [rect]);
  assert.deepEqual({ l: Math.round(r.l), t: Math.round(r.t), r: Math.round(r.r), b: Math.round(r.b) }, { l: -45, t: -5, r: 5, b: 85 });
});

test('a hidden or fully faded part never widens the box', () => {
  const shown = leaf('rect', { x: 0, y: 0, width: 10, height: 10 });
  const faded = leaf('rect', { x: 500, y: 500, width: 10, height: 10 });
  const root = group([shown, faded]);
  const styles = new Map([
    [shown, { fill: '#000', fillOpacity: '1', stroke: 'none', strokeWidth: '0' }],
    [faded, { fill: '#000', fillOpacity: '1', stroke: 'none', strokeWidth: '0', opacity: '0' }],
    [root, {}],
  ]);
  assert.deepEqual(measureInkScreenRect(fakeDoc(styles), [root]), { l: 0, t: 0, r: 10, b: 10 });
});

test('the page\'s own hover / selection glow never counts as the mark (the highlight never jumps)', () => {
  const ink = leaf('rect', { x: 10, y: 10, width: 100, height: 50 });
  const glow = leaf('rect', { x: 10, y: 10, width: 100, height: 50 });
  const cloudGlow = leaf('path', { x: 0, y: 0, width: 200, height: 200 });
  cloudGlow.hasAttribute = (name) => name === 'data-cloud-glow';
  const root = group([ink, glow, cloudGlow]);
  const styles = new Map([
    [ink, { fill: 'none', stroke: 'rgb(0, 0, 0)', strokeWidth: '2px', strokeOpacity: '1', fillOpacity: '1' }],
    [glow, { fill: 'none', stroke: 'rgb(74, 144, 226)', strokeWidth: '10px', strokeOpacity: '0.4', fillOpacity: '1', pointerEvents: 'none' }],
    [cloudGlow, { fill: 'none', stroke: 'rgb(74, 144, 226)', strokeWidth: '12px', strokeOpacity: '0.666', fillOpacity: '1', pointerEvents: 'none' }],
    [root, {}],
  ]);
  assert.deepEqual(measureInkScreenRect(fakeDoc(styles), [root]), { l: 9, t: 9, r: 111, b: 61 });
});

test('page overlay source: a plain highlight — no draw-on, no pulse, no floating tags or pills', () => {
  const overlay = readFileSync(new URL('../src/components/revisions/historyPageOverlay.js', import.meta.url), 'utf8');
  assert.doesNotMatch(overlay, /@keyframes/, 'no animation beyond the fade');
  assert.doesNotMatch(overlay, /dh-tag|dh-pin\b|Deleted \(/, 'no "Deleted" / "Before" tags on the page');
  assert.doesNotMatch(overlay, /box-shadow/, 'the Restore on the page has no shadow');
  assert.doesNotMatch(overlay, /#15161a|rgba\(19,20,23/, 'no black pill');
  assert.match(overlay, /transition: opacity \$\{HISTORY_HIGHLIGHT_FADE_MS\}ms/);
  assert.match(overlay, /HISTORY_HIGHLIGHT_FADE_MS = 150/);
  assert.match(overlay, /getBBox\(\)/, 'measured from the rendered geometry');
});

test('panel source: status dot + legend, details and buttons only on the selected line, one quiet Load older', () => {
  const panel = readFileSync(new URL('../src/components/revisions/RevisionsPanel.jsx', import.meta.url), 'utf8');
  assert.match(panel, /data-status=\{e\.status\}/);
  assert.match(panel, /data-testid="document-history-legend"/);
  assert.match(panel, /\{selected && renderDetail\(e, first\)\}/);
  assert.match(panel, /if \(selected && isDeleted\)/);
  assert.doesNotMatch(panel, /Showing back to/);
  assert.match(panel, /className="dh-more"/);
  assert.doesNotMatch(panel, /personColor/, 'one dot per line: the status');
});
