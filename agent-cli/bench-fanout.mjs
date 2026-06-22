#!/usr/bin/env node
// agent-cli/bench-fanout.mjs — honest before/after harness for the document-open
// "main-thread stall". It exercises the REAL Y.Doc write bridge
// (src/lib/collab/crdtAnnotationBridge.js applyFabricCommit) over a large
// synthetic annotation set two ways:
//
//   A) "individual" — one applyFabricCommit() per annotation (today's fan-out at
//      useAnnotationCloudSync.js fanOutCrdtForAnnotationsByPage). Each call opens
//      its own ydoc.transact(), so observers/update events fire once PER item.
//   B) "batched"   — the same calls wrapped in ONE outer ydoc.transact(). Yjs
//      merges nested transactions into the outermost, so update fires ONCE.
//
// It reports wall-clock for each path, how many Y.Doc update events each fired,
// and asserts the resulting Y.Map state is IDENTICAL (excluding the display-only
// meta timestamps createdAt/updatedAt, which legitimately differ because batched
// writes all land in one tick). No app drift: we import the actual bridge.
//
// Usage: node agent-cli/bench-fanout.mjs [count]   (default 22000)

import * as Y from 'yjs';
import { applyFabricCommit } from '../src/lib/collab/crdtAnnotationBridge.js';

const COUNT = Number(process.argv[2]) || 22000;
const PAGES = 7;

// Build representative fabric objects: distinct stable id, a type, a page, and a
// path of segments (pen strokes are the heavy, common case in this app).
function makeAnnotations(n) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const segs = [];
    const segCount = 12 + (i % 20); // 12..31 path segments
    for (let s = 0; s < segCount; s += 1) segs.push(['L', s * 1.5, (s * 0.7) % 50]);
    out.push({
      pageNumber: 1 + (i % PAGES),
      type: 'path',
      data: { id: `anno-${i}-0000-4000-8000-000000000000`, type: 'ink' },
      left: (i % 800) + 0.37,
      top: (i % 600) + 0.11,
      width: 40 + (i % 120),
      height: 30 + (i % 90),
      stroke: '#112233',
      strokeWidth: 2,
      path: segs,
    });
  }
  return out;
}

function run(label, annotations, { batched }) {
  const ydoc = new Y.Doc();
  const yMap = ydoc.getMap('annotations');
  const origin = Object.freeze({ source: 'local-fabric', userId: 'u1', deviceId: 'd1' });
  const ctx = { userId: 'u1', deviceId: 'd1' };
  let updates = 0;
  ydoc.on('afterTransaction', () => { updates += 1; });

  const t0 = performance.now();
  if (batched) {
    ydoc.transact(() => {
      for (const obj of annotations) applyFabricCommit(ydoc, yMap, obj, origin, ctx);
    }, origin);
  } else {
    for (const obj of annotations) applyFabricCommit(ydoc, yMap, obj, origin, ctx);
  }
  const ms = performance.now() - t0;
  console.log(`${label.padEnd(12)} ${ms.toFixed(0).padStart(6)} ms   map.size=${yMap.size}   afterTransaction events=${updates}`);
  return { ydoc, yMap, ms };
}

// Compare two annotation Y.Maps for structural + content equality, IGNORING the
// display-only meta timestamps (createdAt/updatedAt) which differ by design.
function diffMaps(a, b) {
  if (a.size !== b.size) return `size mismatch: ${a.size} vs ${b.size}`;
  for (const [id, aAnno] of a.entries()) {
    const bAnno = b.get(id);
    if (!bAnno) return `missing id in B: ${id}`;
    const aFab = JSON.stringify(aAnno.get('fabric')?.toJSON?.() ?? aAnno.get('fabric'));
    const bFab = JSON.stringify(bAnno.get('fabric')?.toJSON?.() ?? bAnno.get('fabric'));
    if (aFab !== bFab) return `fabric mismatch for ${id}`;
    if (aAnno.get('type') !== bAnno.get('type')) return `type mismatch for ${id}`;
    if (aAnno.get('pageNumber') !== bAnno.get('pageNumber')) return `pageNumber mismatch for ${id}`;
    const aMeta = aAnno.get('meta');
    const bMeta = bAnno.get('meta');
    if (aMeta?.get('authorId') !== bMeta?.get('authorId')) return `authorId mismatch for ${id}`;
    if (aMeta?.get('lastEditorId') !== bMeta?.get('lastEditorId')) return `lastEditorId mismatch for ${id}`;
  }
  return null;
}

console.log(`# fan-out bench — ${COUNT} annotations across ${PAGES} pages (real applyFabricCommit)`);
const annotations = makeAnnotations(COUNT);
const A = run('individual', annotations, { batched: false });
const B = run('batched', annotations, { batched: true });

const diff = diffMaps(A.yMap, B.yMap);
console.log('');
if (diff) {
  console.log(`STATE EQUIVALENCE: FAIL — ${diff}`);
  process.exit(1);
}
const speedup = (A.ms / B.ms);
console.log(`STATE EQUIVALENCE: PASS — identical annotation set (ignoring display-only timestamps)`);
console.log(`SPEEDUP: ${speedup.toFixed(1)}x   (${A.ms.toFixed(0)}ms -> ${B.ms.toFixed(0)}ms)`);
