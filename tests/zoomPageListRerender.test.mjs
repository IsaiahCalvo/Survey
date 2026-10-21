import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createValueSignal } from '../src/utils/valueSignal.js';

const SRC = readFileSync(new URL('../src/components/PdfjsViewerContainer.jsx', import.meta.url), 'utf8');

test('value signal notifies on change only, and unsubscribes', () => {
  const s = createValueSignal(1);
  let n = 0;
  const off = s.subscribe(() => { n += 1; });
  s.set(1);
  assert.equal(n, 0);
  s.set(1.25);
  assert.equal(n, 1);
  assert.equal(s.get(), 1.25);
  off();
  s.set(2);
  assert.equal(n, 1);
});

test('the page list does not rebuild on each live-zoom frame', () => {
  const memoStart = SRC.indexOf('const pageNodes = useMemo(');
  const deps = SRC.slice(SRC.indexOf('}), [', memoStart), SRC.indexOf(']);', memoStart));
  assert.ok(memoStart > 0 && deps.length > 0);
  assert.doesNotMatch(deps, /liveZoom|tileLiveZoomSignal/);
});

test('DetailTile reads the live-zoom signal from the store, published after commit', () => {
  assert.match(SRC, /const liveZoomSignal = useSyncExternalStore\(liveZoomSignalStore\.subscribe, liveZoomSignalStore\.get\);/);
  assert.match(SRC, /liveZoomSignalStore=\{tileLiveZoomSignalStoreRef\.current\}/);
  assert.match(SRC, /useLayoutEffect\(\(\) => \{ tileLiveZoomSignalStoreRef\.current\.set\(tileLiveZoomSignal\); \}, \[tileLiveZoomSignal\]\);/);
});
