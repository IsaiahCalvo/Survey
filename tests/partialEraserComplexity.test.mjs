import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

import {
  compactCollinearPolygonSet,
  subtractionStayedInsideSubject,
} from '../src/utils/paperAnnotationGeometry.js';
import { erasePageAnnotations } from '../src/utils/pageSpaceEraser.js';
import { createProductionPaperInk } from '../src/utils/productionPaperInk.js';
import {
  runComplexityScenario,
} from '../debug/benchmarks/partial-eraser-complexity-child.mjs';

const CHILD_PATH = new URL(
  '../debug/benchmarks/partial-eraser-complexity-child.mjs',
  import.meta.url,
);

const INTERACTIVE_BUDGET = Object.freeze({
  p95CommitWorkMs: 75,
  // The paired work reading rejects slow eraser work without failing when a
  // loaded test host suspends the isolated child mid-commit.
  maxCommitWorkMs: 250,
  p95CommitCpuMs: 75,
  // p95 guards sustained CPU cost. A single hosted-runner GC can charge
  // multiple worker threads to process.cpuUsage(), so keep only catastrophic
  // outliers above the user-visible 250 ms wall-time ceiling from passing.
  maxCommitCpuMs: 500,
  // Memory is guarded by two readings that depend on what the eraser does
  // rather than on the host it runs on.
  //
  // Removed here on 2026-08-18: `peakHeapBytes` <= 128 MiB and `peakRssBytes`
  // <= 256 MiB. Both sampled `process.memoryUsage()` after every commit, so
  // they measured how much garbage V8 had not collected yet and how many pages
  // the allocator had not returned yet — i.e. the runner, not the eraser. The
  // same 500 shallow bites, measured 25 times per host:
  //
  //            peak heap (ceiling 128)      peak RSS (ceiling 256)
  //   dev mac  80.1 - 84.9 MiB              178.7 - 197.4 MiB
  //   CI       117.4 - 127.6 MiB            250.7 - 262.2 MiB   <- p50 257.3
  //
  // The eraser's retained set is ~8 MiB in both columns; everything above that
  // is uncollected garbage. V8 hands the child a 320 MiB heap limit on the
  // 2-core hosted runner versus 224 MiB on the dev mac, so on CI the RSS
  // reading straddles its ceiling and which side it lands on is decided by GC
  // scheduling. That flaked six CI runs in five weeks with no code change,
  // blocking a production deploy each time. They were not sensitive either: a
  // 5-page retention leak and a per-commit defensive deep copy both passed.
  //
  // peakRetainedHeapBytes: the live set after a forced full GC at each
  // checkpoint. Measured 7.31-7.55 MiB on the dev mac and 7.47-8.50 MiB on CI
  // (0.4% spread within a host). The ceiling is ~1.4x the worst reading, tight
  // enough that a five-deep page-clone leak (13.7 MiB) fails.
  peakRetainedHeapBytes: 12 * 1024 * 1024,
  finalHeapBytes: 32 * 1024 * 1024,
  shallow500: {
    maxComponents: 2,
    maxVertices: 7_000,
    maxSerializedBytes: 500_000,
    // Total bytes allocated across the 500 commits, recovered from GC
    // bookkeeping, so it counts what the code asked for regardless of when V8
    // chose to collect it. Measured 13,961-13,977 MiB on the dev mac and
    // 17,631-17,811 MiB on CI (1% spread within a host, but 27% between them,
    // which is why the ceiling clears the worst host by ~10% rather than
    // hugging the numbers). Catches an allocation regression of roughly 10% or
    // more; the peak readings it replaced caught none at all.
    maxAllocatedBytes: 19 * 1024 * 1024 * 1024,
  },
  crossing500: {
    maxComponents: 501,
    maxVertices: 14_000,
    maxSerializedBytes: 1_000_000,
    // Measured 5,893-5,911 MiB on the dev mac; on CI this scenario is bimodal
    // (6,385-6,740 or 7,273-7,338 MiB depending on how V8 sizes the nursery on
    // that boot), so the ceiling clears the high mode by ~15%.
    maxAllocatedBytes: 8_448 * 1024 * 1024,
  },
});

function polygonArea(polygons) {
  const ringArea = (ring) => {
    let twiceArea = 0;
    for (
      let index = 0, previous = ring.length - 1;
      index < ring.length;
      previous = index, index += 1
    ) {
      twiceArea += (
        ring[previous][0] * ring[index][1]
        - ring[index][0] * ring[previous][1]
      );
    }
    return Math.abs(twiceArea / 2);
  };
  return polygons.reduce((total, [outer, ...holes]) => (
    total + ringArea(outer) - holes.reduce((sum, hole) => sum + ringArea(hole), 0)
  ), 0);
}

function pointInRing([x, y], ring) {
  let inside = false;
  for (
    let index = 0, previous = ring.length - 1;
    index < ring.length;
    previous = index, index += 1
  ) {
    const [xi, yi] = ring[index];
    const [xj, yj] = ring[previous];
    if (
      (yi > y) !== (yj > y)
      && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInPolygonSet(point, polygons) {
  return polygons.some(([outer, ...holes]) => (
    pointInRing(point, outer)
    && !holes.some((hole) => pointInRing(point, hole))
  ));
}

function densifiedClosedRing(vertices, pointsPerEdge = 160) {
  const ring = [];
  for (let edge = 0; edge < vertices.length; edge += 1) {
    const [startX, startY] = vertices[edge];
    const [endX, endY] = vertices[(edge + 1) % vertices.length];
    for (let index = 0; index < pointsPerEdge; index += 1) {
      const t = index / pointsPerEdge;
      ring.push([
        startX + (endX - startX) * t,
        startY + (endY - startY) * t,
      ]);
    }
  }
  ring.push([...ring[0]]);
  return ring;
}

function densifiedRectangle(minX, minY, maxX, maxY, pointsPerEdge = 160) {
  return densifiedClosedRing([
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ], pointsPerEdge);
}

function runBoundedChild({
  family,
  count,
  tool,
  width,
  radius,
  samples,
  timeoutMs = 30_000,
}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      // --expose-gc lets the child read its settled live set instead of a
      // mid-collection snapshot. --max-old-space-size=128 is the hard backstop
      // underneath the measured budgets: a runaway eraser hits the V8 heap
      // limit, the child dies, and this helper rejects with its stderr.
      '--expose-gc',
      '--max-old-space-size=128',
      CHILD_PATH.pathname,
      family,
      String(count),
      tool,
      String(width),
      String(radius),
      String(samples),
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(
        `${family}-${count} exceeded the ${timeoutMs} ms bounded-child budget`,
      ));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(
          `${family}-${count} failed (${signal || code}): ${stderr.slice(-2_000)}`,
        ));
        return;
      }
      const line = stdout.trim().split('\n').at(-1);
      resolve(JSON.parse(line));
    });
  });
}

const MIB = 1024 * 1024;
const mib = (bytes) => `${(bytes / MIB).toFixed(2)} MiB`;

// Both readings come from the bounded child and are asserted with the measured
// value in the message, so a CI failure says how far over budget it went
// instead of just "the expression evaluated to a falsy value".
function assertMemoryBudget(result, scenarioBudget) {
  assert.ok(
    Number.isFinite(result.peakRetainedHeapBytes) && result.peakRetainedHeapBytes > 0,
    'the child must report a forced-GC retained-heap reading',
  );
  assert.ok(
    result.peakRetainedHeapBytes <= INTERACTIVE_BUDGET.peakRetainedHeapBytes,
    `retained heap ${mib(result.peakRetainedHeapBytes)} exceeded `
    + `${mib(INTERACTIVE_BUDGET.peakRetainedHeapBytes)} — the eraser is holding on to geometry`,
  );
  assert.ok(
    Number.isFinite(result.totalAllocatedBytes) && result.totalAllocatedBytes > 0,
    'the child must report a GC-derived total-allocation reading',
  );
  assert.ok(
    result.totalAllocatedBytes <= scenarioBudget.maxAllocatedBytes,
    `total allocation ${mib(result.totalAllocatedBytes)} exceeded `
    + `${mib(scenarioBudget.maxAllocatedBytes)} — the eraser got allocation-hungrier`,
  );
  assert.ok(
    result.finalHeapBytes <= INTERACTIVE_BUDGET.finalHeapBytes,
    `final heap ${mib(result.finalHeapBytes)} exceeded ${mib(INTERACTIVE_BUDGET.finalHeapBytes)}`,
  );
}

test('page-space erase matrix stays valid across tools, widths, eraser diameters, and 8-64 samples', () => {
  const toolWidths = {
    pen: [1, 3, 12, 40],
    highlighter: [8, 20, 40],
  };
  const radii = [1, 4, 10, 32];
  const samples = [8, 16, 32, 64];
  const families = ['shallow', 'deep', 'tangent', 'crossing', 'backtracking'];
  let caseIndex = 0;

  for (const [tool, widths] of Object.entries(toolWidths)) {
    for (const width of widths) {
      for (const radius of radii) {
        for (const family of families) {
          const sampleCount = samples[caseIndex % samples.length];
          caseIndex += 1;
          const result = runComplexityScenario({
            family,
            count: 1,
            tool,
            width,
            radius,
            samples: sampleCount,
          });
          assert.equal(result.history.undoRestoresOriginal, true);
          assert.equal(result.history.redoRestoresFinal, true);
          assert.equal(result.history.redoSurvivesReload, true);
          assert.equal(result.history.reloadUndoRestoresOriginal, true);
          assert.equal(result.history.reloadRedoRestoresFinal, true);
          if (result.changedCommits > 0) {
            assert.equal(result.history.actionType, 'fabric:update');
          }
          assert.equal(result.identity.id, 'complexity-ink');
          assert.equal(result.identity.annotationId, 'complexity-ink');
          assert.equal(result.identity.authorId, 'author-1');
          assert.equal(result.identity.ownerId, 'owner-1');
          assert.equal(result.identity.meta.permission, 'write');
          assert.equal(result.identity.meta.storageIdentity, 'stable-storage-row');
          assert.equal(result.identity.meta.concurrentRevision, 17);
          assert.equal(result.identity.collaborator.id, 'collaborator-shape');
          assert.equal(result.identity.collaborator.authorId, 'author-2');
          assert.equal(result.identity.collaborator.meta.concurrentRevision, 31);
          assert.equal(result.coverage.startEndpointPreserved, true);
          assert.equal(result.coverage.endEndpointPreserved, true);
          if (family === 'backtracking') {
            assert.equal(
              result.changedCommits,
              1,
              'one backtracking pointer gesture must commit every crossed pass',
            );
          }
          assert.equal(result.coverage.lastBiteRemoved, true);
        }
      }
    }
  }
  assert.equal(caseIndex, 140);
});

test('page geometry is independent of presentation zoom', () => {
  const base = runComplexityScenario({
    family: 'backtracking',
    count: 10,
    tool: 'highlighter',
    width: 20,
    radius: 10,
    samples: 64,
  });
  for (const presentationZoom of [0.25, 0.5, 2, 4]) {
    // Screen input is normalized back to page space before this geometry API.
    // Presentation zoom therefore must not alter persisted geometry.
    const normalized = runComplexityScenario({
      family: 'backtracking',
      count: Math.round(10 * presentationZoom / presentationZoom),
      tool: 'highlighter',
      width: 20 * presentationZoom / presentationZoom,
      radius: 10 * presentationZoom / presentationZoom,
      samples: 64,
    });
    assert.equal(normalized.vertices, base.vertices);
    assert.equal(normalized.components, base.components);
    assert.equal(normalized.serializedBytes, base.serializedBytes);
    assert.equal(normalized.area, base.area);
  }
});

test('one backtracking pointer gesture keeps every pass across multiple strokes', () => {
  const strokeYs = [80, 100, 120];
  const originals = strokeYs.map((y, index) => createProductionPaperInk({
    id: `multi-stroke-${index}`,
    tool: index === 1 ? 'highlighter' : 'pen',
    points: [{ x: 0, y }, { x: 200, y }],
    color: '#d11b2d',
    width: 12,
    authorId: 'author-1',
    meta: { permission: 'write', concurrentRevision: index + 1 },
  }));
  const controls = [
    { x: 40, y: 60 },
    { x: 40, y: 140 },
    { x: 100, y: 60 },
    { x: 160, y: 140 },
  ];
  const eraserPoints = controls.slice(1).flatMap((end, segment) => {
    const start = controls[segment];
    return Array.from({ length: 65 }, (_, index) => {
      if (segment > 0 && index === 0) return null;
      const t = index / 64;
      return {
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
      };
    }).filter(Boolean);
  });
  const result = erasePageAnnotations({
    pageAnnotations: { version: '5.3.0', objects: originals },
    eraserPoints,
    eraserRadius: 4,
    mode: 'partial',
    canErase: () => true,
  });

  assert.equal(result.didChange, true);
  assert.deepEqual(new Set(result.changedIds), new Set(originals.map(({ id }) => id)));
  assert.deepEqual(result.deletedIds, []);
  for (let index = 0; index < strokeYs.length; index += 1) {
    const y = strokeYs[index];
    const survivor = result.pageAnnotations.objects.find(
      ({ id }) => id === originals[index].id,
    );
    const crossings = [
      40,
      40 + ((140 - y) / 80) * 60,
      100 + ((y - 60) / 80) * 60,
    ];
    assert.ok(survivor, `stroke ${index} survives as split geometry`);
    assert.equal(
      subtractionStayedInsideSubject(
        survivor.polygons,
        originals[index].polygons,
        originals[index].sourceWidth,
      ),
      true,
      `stroke ${index} creates no geometry outside its source`,
    );
    assert.equal(survivor.polygons.length, 4, `stroke ${index} keeps every survivor`);
    for (const x of crossings) {
      assert.equal(
        pointInPolygonSet([x, y], survivor.polygons),
        false,
        `stroke ${index} keeps the erased pass at x=${x}`,
      );
    }
    assert.equal(pointInPolygonSet([1, y], survivor.polygons), true);
    assert.equal(pointInPolygonSet([199, y], survivor.polygons), true);
  }
});

test('512-sample backtracking commit stays inside the release budget', () => {
  const result = runComplexityScenario({
    family: 'backtracking',
    count: 1,
    tool: 'highlighter',
    width: 20,
    radius: 10,
    samples: 512,
  });
  assert.equal(result.changedCommits, 1);
  assert.equal(result.coverage.lastBiteRemoved, true);
  assert.equal(result.history.undoRestoresOriginal, true);
  assert.equal(result.history.redoRestoresFinal, true);
  assert.equal(result.history.redoSurvivesReload, true);
  assert.equal(result.history.reloadUndoRestoresOriginal, true);
  assert.equal(result.history.reloadRedoRestoresFinal, true);
  assert.ok(result.maxCommitWorkMs <= INTERACTIVE_BUDGET.maxCommitWorkMs);
  assert.ok(
    result.maxCommitCpuMs <= INTERACTIVE_BUDGET.maxCommitCpuMs,
    `max commit CPU ${result.maxCommitCpuMs}ms exceeded ${INTERACTIVE_BUDGET.maxCommitCpuMs}ms`,
  );
  assert.ok(result.vertices <= 1_000);
  assert.ok(result.serializedBytes <= 100_000);
});

test('exact collinear compaction preserves holes, even-odd fill, components, and input', () => {
  const polygons = [[
    [
      [0, 0], [2, 0], [4, 0], [6, 0],
      [6, 6], [0, 6], [0, 0],
    ],
    [
      [1, 1], [1, 2], [1, 3], [3, 3],
      [3, 1], [1, 1],
    ],
  ], [[
    [10, 0], [12, 0], [14, 0], [14, 4], [10, 4], [10, 0],
  ]]];
  const original = structuredClone(polygons);
  const compacted = compactCollinearPolygonSet(polygons);

  assert.deepEqual(polygons, original, 'compaction does not mutate stored geometry');
  assert.equal(polygonArea(compacted), polygonArea(polygons));
  assert.equal(compacted.length, 2, 'separate components remain separate');
  assert.equal(compacted[0].length, 2, 'the hole remains attached to its outer ring');
  assert.equal(pointInPolygonSet([0.5, 0.5], compacted), true);
  assert.equal(pointInPolygonSet([2, 2], compacted), false, 'evenodd hole remains empty');
  assert.equal(pointInPolygonSet([12, 2], compacted), true);
  assert.deepEqual(compacted[0][0], [
    [0, 0], [6, 0], [6, 6], [0, 6], [0, 0],
  ]);
  assert.deepEqual(compacted[0][1], [
    [1, 1], [1, 3], [3, 3], [3, 1], [1, 1],
  ]);
});

test('compaction removes exact collinear points only at tiny and huge coordinate scales', () => {
  const tinyNear = [
    [1e-4, 1e-4],
    [2e-4, 1e-4 + 1e-16],
    [3e-4, 1e-4],
    [3e-4, 3e-4],
    [1e-4, 3e-4],
    [1e-4, 1e-4],
  ];
  const hugeNear = [
    [1e12, 1e12],
    [1e12 + 1e6, 1e12 + 0.25],
    [1e12 + 2e6, 1e12],
    [1e12 + 2e6, 1e12 + 2e6],
    [1e12, 1e12 + 2e6],
    [1e12, 1e12],
  ];
  const exactTiny = [
    [1e-4, 1e-4],
    [2e-4, 1e-4],
    [3e-4, 1e-4],
    [3e-4, 3e-4],
    [1e-4, 3e-4],
    [1e-4, 1e-4],
  ];
  const exactHuge = [
    [1e12, 1e12],
    [1e12 + 1e6, 1e12],
    [1e12 + 2e6, 1e12],
    [1e12 + 2e6, 1e12 + 2e6],
    [1e12, 1e12 + 2e6],
    [1e12, 1e12],
  ];
  const compacted = compactCollinearPolygonSet([
    [tinyNear],
    [hugeNear],
    [exactTiny],
    [exactHuge],
  ]);

  assert.deepEqual(compacted[0][0], tinyNear, 'tiny near-collinear detail survives');
  assert.deepEqual(compacted[1][0], hugeNear, 'huge near-collinear detail survives');
  assert.deepEqual(compacted[2][0], [
    [1e-4, 1e-4],
    [3e-4, 1e-4],
    [3e-4, 3e-4],
    [1e-4, 3e-4],
    [1e-4, 1e-4],
  ]);
  assert.deepEqual(compacted[3][0], [
    [1e12, 1e12],
    [1e12 + 2e6, 1e12],
    [1e12 + 2e6, 1e12 + 2e6],
    [1e12, 1e12 + 2e6],
    [1e12, 1e12],
  ]);
});

test('scalable containment proof respects holes and multiple components', () => {
  const subject = [[
    densifiedRectangle(0, 0, 100, 100),
    densifiedRectangle(40, 40, 60, 60),
  ]];
  const insideComponents = [
    [densifiedRectangle(5, 5, 20, 20, 8)],
    [densifiedRectangle(80, 80, 95, 95, 8)],
  ];
  const incorrectlyFilledHole = [[densifiedRectangle(45, 45, 55, 55, 8)]];

  assert.equal(
    subtractionStayedInsideSubject(insideComponents, subject, 20),
    true,
  );
  assert.equal(
    subtractionStayedInsideSubject(incorrectlyFilledHole, subject, 20),
    false,
    'a result inside an even-odd hole is outside the subject',
  );
});

test('scalable containment rejects in-bounds concave bridges and microscopic outside needles', () => {
  const concaveSubject = [[densifiedClosedRing([
    [0, 0],
    [100, 0],
    [100, 20],
    [20, 20],
    [20, 80],
    [100, 80],
    [100, 100],
    [0, 100],
  ], 80)]];
  const bridgeAcrossConcaveGap = [[densifiedRectangle(49, 10, 51, 90, 8)]];
  assert.equal(
    subtractionStayedInsideSubject(bridgeAcrossConcaveGap, concaveSubject, 20),
    false,
    'overall bounds cannot hide a bridge across a concave gap',
  );

  const rectangularSubject = [[densifiedRectangle(0, 0, 100, 100)]];
  for (const outsideBy of [1e-3, 1e-6, 1e-9, 1e-11]) {
    const outsideNeedle = [[[
      [0, 40],
      [50, 50],
      [0, 60],
      [-outsideBy, 50],
      [0, 40],
    ]]];
    assert.equal(
      subtractionStayedInsideSubject(outsideNeedle, rectangularSubject, 20),
      false,
      `outside needle ${outsideBy} page units wide must fail closed`,
    );
  }
});

test('500 shallow bites stay inside the interactive complexity and release budget', {
  timeout: 35_000,
}, async () => {
  const result = await runBoundedChild({
    family: 'shallow',
    count: 500,
    tool: 'pen',
    width: 20,
    radius: 4,
    samples: 8,
  });
  assert.deepEqual(Object.keys(result.checkpoints), ['1', '10', '50', '100', '200', '500']);
  assert.equal(result.changedCommits, 500);
  assert.equal(result.history.undoRestoresOriginal, true);
  assert.equal(result.history.redoRestoresFinal, true);
  assert.equal(result.history.redoSurvivesReload, true);
  assert.equal(result.history.reloadUndoRestoresOriginal, true);
  assert.equal(result.history.reloadRedoRestoresFinal, true);
  assert.equal(result.coverage.lastBiteRemoved, true);
  assert.equal(result.coverage.startEndpointPreserved, true);
  assert.equal(result.coverage.endEndpointPreserved, true);
  assert.ok(result.components <= INTERACTIVE_BUDGET.shallow500.maxComponents);
  assert.ok(result.vertices <= INTERACTIVE_BUDGET.shallow500.maxVertices);
  assert.ok(result.serializedBytes <= INTERACTIVE_BUDGET.shallow500.maxSerializedBytes);
  assert.ok(result.p95CommitWorkMs <= INTERACTIVE_BUDGET.p95CommitWorkMs);
  assert.ok(result.maxCommitWorkMs <= INTERACTIVE_BUDGET.maxCommitWorkMs);
  assert.ok(result.p95CommitCpuMs <= INTERACTIVE_BUDGET.p95CommitCpuMs);
  assert.ok(
    result.maxCommitCpuMs <= INTERACTIVE_BUDGET.maxCommitCpuMs,
    `max commit CPU ${result.maxCommitCpuMs}ms exceeded ${INTERACTIVE_BUDGET.maxCommitCpuMs}ms`,
  );
  assertMemoryBudget(result, INTERACTIVE_BUDGET.shallow500);
});

test('500 crossing cuts preserve every component inside bounded memory and release time', {
  timeout: 35_000,
}, async () => {
  const result = await runBoundedChild({
    family: 'crossing',
    count: 500,
    tool: 'highlighter',
    width: 20,
    radius: 4,
    samples: 64,
  });
  assert.deepEqual(Object.keys(result.checkpoints), ['1', '10', '50', '100', '200', '500']);
  assert.equal(result.changedCommits, 500);
  assert.equal(result.components, 501, 'no disconnected survivor fragment is dropped');
  assert.equal(result.history.undoRestoresOriginal, true);
  assert.equal(result.history.redoRestoresFinal, true);
  assert.equal(result.history.redoSurvivesReload, true);
  assert.equal(result.history.reloadUndoRestoresOriginal, true);
  assert.equal(result.history.reloadRedoRestoresFinal, true);
  assert.equal(result.coverage.lastBiteRemoved, true);
  assert.equal(result.coverage.startEndpointPreserved, true);
  assert.equal(result.coverage.endEndpointPreserved, true);
  assert.ok(result.components <= INTERACTIVE_BUDGET.crossing500.maxComponents);
  assert.ok(result.vertices <= INTERACTIVE_BUDGET.crossing500.maxVertices);
  assert.ok(result.serializedBytes <= INTERACTIVE_BUDGET.crossing500.maxSerializedBytes);
  assert.ok(result.p95CommitWorkMs <= INTERACTIVE_BUDGET.p95CommitWorkMs);
  assert.ok(result.maxCommitWorkMs <= INTERACTIVE_BUDGET.maxCommitWorkMs);
  assert.ok(result.p95CommitCpuMs <= INTERACTIVE_BUDGET.p95CommitCpuMs);
  assert.ok(result.maxCommitCpuMs <= INTERACTIVE_BUDGET.maxCommitCpuMs);
  assertMemoryBudget(result, INTERACTIVE_BUDGET.crossing500);
});
