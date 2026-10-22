import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveDrawSnap, drawSnapEventOptions } from '../src/utils/drawSnap.js';

test('a pen / touch line start 2.3,1.9 CSS px off another line end snaps onto it (#1130)', () => {
  const inv = 612 / 326; // page units per CSS px at fit width on a 390 px phone
  const end = { x: 240 * inv, y: 560 * inv };
  const press = { x: end.x + 2.3 * inv, y: end.y + 1.9 * inv };
  for (const pointerType of ['pen', 'touch']) {
    const r = resolveDrawSnap(null, press, { ...drawSnapEventOptions({ pointerType }, inv), candidates: [end] });
    assert.deepEqual(r.point, end, pointerType);
    assert.ok(r.endpoint, `${pointerType} shows the ring`);
  }
});

test('with Line / Arrow armed, a pen / finger press on the selected line end starts the next line (mouse keeps the grabber)', () => {
  const src = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');
  assert.match(src, /const lineToolChainsFromEnd = \(e, handleId\) => \(handleId === 'p1' \|\| handleId === 'p2'\)\s*\n\s*&& \(activeTool === 'line' \|\| activeTool === 'arrow'\)\s*\n\s*&& \(e\.pointerType === 'pen' \|\| e\.pointerType === 'touch'\);/);
  // The pad and both end dots fall through to the layer's creation handler.
  assert.equal((src.match(/if \(lineToolChainsFromEnd\(e, (handleId|'p1'|'p2')\)\) return;/g) || []).length, 3);
  // The start of a new line goes through the snap.
  assert.match(src, /const start = \(tool === 'line' \|\| tool === 'arrow'\) \? resolveCreationSnap\(null, point, e\) : point;/);
  const walk = readFileSync(new URL('../.github/native-flows/android-snap.sh', import.meta.url), 'utf8');
  assert.match(walk, /BY=\$\(\(\$2 \+ TOP \+ 5\)\)/);
  assert.match(walk, /Line A moved when line B started on its end/);
});
