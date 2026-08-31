import { performance } from 'node:perf_hooks';
import { GCProfiler, getHeapStatistics } from 'node:v8';

import {
  applyAnnotationHistoryAction,
  buildAnnotationHistoryAction,
  invertAnnotationHistoryAction,
} from '../../src/utils/annotationLocalHistory.js';
import {
  getAnnotationStorageKey,
  setAnnotationStorageKey,
} from '../../src/utils/annotationStorageIdentity.js';
import { erasePageAnnotations } from '../../src/utils/pageSpaceEraser.js';
import { createProductionPaperInk } from '../../src/utils/productionPaperInk.js';

const CHECKPOINTS = new Set([1, 10, 50, 100, 200, 500]);

// `process.memoryUsage().heapUsed` and `.rss` are opportunistic readings: they
// report whatever V8 and the OS happen to be holding at the sample instant, so
// they answer "how much garbage had V8 not collected yet" and "how many pages
// had the allocator not returned yet" — questions about the host, not about the
// eraser. They are still reported for diagnostics, but the budget assertions
// use the two host-independent readings below instead.
//
// retainedHeapBytes(): the settled live set, read only after a forced full GC.
// Two collections in a row because the first one clears weak refs and frees the
// bulk, and the second collects whatever that pass made unreachable, so the
// number is the geometry the eraser is actually holding on to.
function retainedHeapBytes() {
  if (typeof global.gc !== 'function') return null;
  global.gc();
  global.gc();
  return process.memoryUsage().heapUsed;
}

// Total bytes allocated across the run, recovered from a conservation identity:
// between collections `usedHeapSize` only ever grows by allocation, so
//   allocated = Σ(bytes each GC reclaimed) + (heap at the end − heap at the start).
// The result depends on what the code allocates, not on when V8 decided to
// collect it, which is exactly the property the peak readings lack.
function totalAllocatedBytesFrom(profile, startHeapBytes, endHeapBytes) {
  if (!profile) return null;
  const reclaimed = profile.statistics.reduce((total, entry) => {
    const before = entry?.beforeGC?.heapStatistics?.usedHeapSize;
    const after = entry?.afterGC?.heapStatistics?.usedHeapSize;
    if (!Number.isFinite(before) || !Number.isFinite(after)) return total;
    return total + Math.max(0, before - after);
  }, 0);
  return reclaimed + Math.max(0, endHeapBytes - startHeapBytes);
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) * fraction)];
}

function ringArea(ring) {
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
  return twiceArea / 2;
}

function geometryArea(polygons) {
  return (polygons || []).reduce((total, [outer, ...holes]) => (
    total
    + Math.abs(ringArea(outer || []))
    - holes.reduce((sum, hole) => sum + Math.abs(ringArea(hole)), 0)
  ), 0);
}

function geometryVertices(polygons) {
  return (polygons || []).reduce((total, polygon) => (
    total + polygon.reduce(
      (sum, ring) => sum + Math.max(0, ring.length - 1),
      0,
    )
  ), 0);
}

function pointInRing({ x, y }, ring) {
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

function pointInGeometry(point, polygons) {
  return (polygons || []).some(([outer, ...holes]) => (
    pointInRing(point, outer)
    && !holes.some((hole) => pointInRing(point, hole))
  ));
}

function copyPageWithStorageKeys(page, clone = structuredClone(page)) {
  (page?.objects || []).forEach((object, index) => {
    const storageKey = getAnnotationStorageKey(object);
    if (storageKey != null && clone?.objects?.[index]) {
      setAnnotationStorageKey(clone.objects[index], storageKey);
    }
  });
  return clone;
}

function gestureFor({
  family,
  x,
  centerY,
  width,
  radius,
  samples,
}) {
  const top = centerY - width / 2;
  const interpolate = (start, end) => Array.from(
    { length: samples },
    (_, index) => {
      const t = samples === 1 ? 0 : index / (samples - 1);
      return {
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
      };
    },
  );

  if (family === 'crossing') {
    return interpolate(
      { x, y: centerY - width - radius * 2 },
      { x, y: centerY + width + radius * 2 },
    );
  }
  if (family === 'backtracking') {
    const controls = [
      { x: x - radius, y: top - radius + 1 },
      { x: x + radius, y: top + radius },
      { x: x - radius / 2, y: top - radius + 1 },
      { x: x + radius / 2, y: top + radius },
      { x, y: top - radius + 1 },
    ];
    return Array.from({ length: samples }, (_, index) => {
      const position = (index / Math.max(1, samples - 1)) * (controls.length - 1);
      const segment = Math.min(controls.length - 2, Math.floor(position));
      const t = position - segment;
      return {
        x: controls[segment].x + (controls[segment + 1].x - controls[segment].x) * t,
        y: controls[segment].y + (controls[segment + 1].y - controls[segment].y) * t,
      };
    });
  }

  const depth = family === 'tangent' ? 0 : family === 'deep' ? radius * 1.5 : 2;
  return interpolate(
    { x, y: top - radius + depth },
    { x, y: top - radius + depth },
  );
}

function snapshotMetrics(page, commitTimes, commitCpuTimes, peak) {
  const annotation = page.objects[0];
  const polygons = annotation?.polygons || [];
  // A busy test host can stop this child between two wall-clock reads. That
  // pause is not eraser work. CPU time can over-count parallel GC work, so the
  // smaller paired reading is the safest bound on work done by each commit.
  const commitWorkTimes = commitTimes.map((wallMs, index) => (
    Math.min(wallMs, commitCpuTimes[index] ?? wallMs)
  ));
  return {
    components: polygons.length,
    vertices: geometryVertices(polygons),
    area: geometryArea(polygons),
    serializedBytes: Buffer.byteLength(JSON.stringify(page)),
    p50CommitMs: percentile(commitTimes, 0.5),
    p95CommitMs: percentile(commitTimes, 0.95),
    maxCommitMs: Math.max(0, ...commitTimes),
    p95CommitWorkMs: percentile(commitWorkTimes, 0.95),
    maxCommitWorkMs: Math.max(0, ...commitWorkTimes),
    lastCommitMs: commitTimes.at(-1) || 0,
    p95CommitCpuMs: percentile(commitCpuTimes, 0.95),
    maxCommitCpuMs: Math.max(0, ...commitCpuTimes),
    peakHeapBytes: peak.heap,
    peakRssBytes: peak.rss,
    peakRetainedHeapBytes: peak.retained,
  };
}

export function runComplexityScenario({
  family = 'shallow',
  count = 500,
  tool = 'pen',
  width = 20,
  radius = 4,
  samples = 8,
  // Off for the in-process callers (they assert geometry, and forced GCs would
  // just make the 140-case matrix slower). The bounded child turns it on.
  measureMemory = false,
} = {}) {
  const spacing = Math.max(radius * 2 + width * 0.75, 9);
  const endpointMargin = radius * 2 + width + 10;
  const centerY = 100;
  const endX = endpointMargin * 2 + Math.max(0, count - 1) * spacing;
  const identity = {
    id: 'complexity-ink',
    annotationId: 'complexity-ink',
    authorId: 'author-1',
    ownerId: 'owner-1',
    meta: {
      permission: 'write',
      storageIdentity: 'stable-storage-row',
      concurrentRevision: 17,
    },
  };
  const collaborator = {
    type: 'rect',
    id: 'collaborator-shape',
    authorId: 'author-2',
    left: -100,
    top: -100,
    width: 10,
    height: 10,
    fill: '#00f',
    meta: { concurrentRevision: 31 },
  };
  const original = createProductionPaperInk({
    ...identity,
    tool,
    points: [{ x: 0, y: centerY }, { x: endX, y: centerY }],
    color: '#d11b2d',
    width,
  });
  setAnnotationStorageKey(original, identity.meta.storageIdentity);
  setAnnotationStorageKey(collaborator, 'collaborator-storage-row');
  let page = { version: '5.3.0', objects: [original, collaborator] };
  const undoSnapshot = copyPageWithStorageKeys(page);
  const commitTimes = [];
  const commitCpuTimes = [];
  const checkpoints = {};
  const peak = { heap: 0, rss: 0, retained: 0 };
  let changedCommits = 0;
  const profiler = measureMemory ? new GCProfiler() : null;
  const startHeapBytes = measureMemory ? process.memoryUsage().heapUsed : 0;
  profiler?.start();

  for (let index = 0; index < count; index += 1) {
    const x = endpointMargin + index * spacing;
    const points = gestureFor({
      family,
      x,
      centerY,
      width,
      radius,
      samples,
    });
    const started = performance.now();
    const cpuStarted = process.cpuUsage();
    const result = erasePageAnnotations({
      pageAnnotations: page,
      eraserPoints: points,
      eraserRadius: radius,
      mode: 'partial',
      canErase: (annotation) => annotation.authorId !== 'author-2',
    });
    commitTimes.push(performance.now() - started);
    const cpuElapsed = process.cpuUsage(cpuStarted);
    commitCpuTimes.push((cpuElapsed.user + cpuElapsed.system) / 1_000);
    page = result.pageAnnotations;
    if (result.didChange) changedCommits += 1;
    const memory = process.memoryUsage();
    peak.heap = Math.max(peak.heap, memory.heapUsed);
    peak.rss = Math.max(peak.rss, memory.rss);
    if (CHECKPOINTS.has(index + 1)) {
      if (measureMemory) {
        // Sampled at the checkpoints rather than every commit: a full GC per
        // commit would add seconds to the run, and retention only has to be
        // watched on the growth curve, where a leak shows up as a rising floor.
        peak.retained = Math.max(peak.retained, retainedHeapBytes() ?? 0);
      }
      checkpoints[index + 1] = snapshotMetrics(
        page,
        commitTimes,
        commitCpuTimes,
        peak,
      );
    }
  }

  // Read the heap before stopping: materialising the profile allocates, and
  // that allocation belongs to the harness, not to the eraser.
  const endHeapBytes = measureMemory ? process.memoryUsage().heapUsed : 0;
  const totalAllocatedBytes = measureMemory
    ? totalAllocatedBytesFrom(profiler.stop(), startHeapBytes, endHeapBytes)
    : null;

  const redoSnapshot = copyPageWithStorageKeys(page);
  const historyAction = buildAnnotationHistoryAction({
    pageNumber: 1,
    previousPage: undoSnapshot,
    nextPage: redoSnapshot,
  });
  const finalByPage = { 1: copyPageWithStorageKeys(redoSnapshot) };
  const undoneByPage = historyAction
    ? applyAnnotationHistoryAction(
      finalByPage,
      invertAnnotationHistoryAction(historyAction),
    )
    : finalByPage;
  const redoneByPage = historyAction
    ? applyAnnotationHistoryAction(undoneByPage, historyAction)
    : undoneByPage;
  const reloaded = JSON.parse(JSON.stringify(redoneByPage[1]));
  copyPageWithStorageKeys(redoneByPage[1], reloaded);
  const reloadUndoneByPage = historyAction
    ? applyAnnotationHistoryAction(
      { 1: reloaded },
      invertAnnotationHistoryAction(historyAction),
    )
    : { 1: reloaded };
  const reloadRedoneByPage = historyAction
    ? applyAnnotationHistoryAction(reloadUndoneByPage, historyAction)
    : reloadUndoneByPage;
  const survivor = reloaded.objects[0];
  const lastBiteX = endpointMargin + Math.max(0, count - 1) * spacing;
  const biteProbe = family === 'crossing'
    ? { x: lastBiteX, y: centerY }
    : { x: lastBiteX, y: centerY - width / 2 + Math.min(1, radius / 2) };
  const finalMetrics = snapshotMetrics(reloaded, commitTimes, commitCpuTimes, peak);

  return {
    scenario: { family, count, tool, width, radius, samples },
    checkpoints,
    ...finalMetrics,
    totalAllocatedBytes,
    changedCommits,
    coverage: {
      lastBiteRemoved: family === 'tangent'
        ? true
        : !pointInGeometry(biteProbe, survivor?.polygons),
      startEndpointPreserved: pointInGeometry(
        { x: 1, y: centerY },
        survivor?.polygons,
      ),
      endEndpointPreserved: pointInGeometry(
        { x: endX - 1, y: centerY },
        survivor?.polygons,
      ),
    },
    identity: {
      id: survivor?.id,
      annotationId: survivor?.annotationId,
      authorId: survivor?.authorId,
      ownerId: survivor?.ownerId,
      meta: survivor?.meta,
      collaborator: reloaded.objects.find((entry) => entry.id === collaborator.id),
    },
    history: {
      actionType: historyAction?.type || null,
      undoRestoresOriginal: JSON.stringify(undoneByPage[1]) === JSON.stringify(undoSnapshot),
      redoRestoresFinal: JSON.stringify(redoneByPage[1]) === JSON.stringify(redoSnapshot),
      redoSurvivesReload: JSON.stringify(redoneByPage[1]) === JSON.stringify(reloaded),
      reloadUndoRestoresOriginal:
        JSON.stringify(reloadUndoneByPage[1]) === JSON.stringify(undoSnapshot),
      reloadRedoRestoresFinal:
        JSON.stringify(reloadRedoneByPage[1]) === JSON.stringify(redoSnapshot),
    },
  };
}

const isDirectRun = process.argv[1]
  && import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (isDirectRun) {
  const [family, count, tool, width, radius, samples] = process.argv.slice(2);
  const result = runComplexityScenario({
    family,
    count: Number(count),
    tool,
    width: Number(width),
    radius: Number(radius),
    samples: Number(samples),
    measureMemory: true,
  });
  if (typeof global.gc === 'function') global.gc();
  result.finalHeapBytes = process.memoryUsage().heapUsed;
  result.heapLimitBytes = getHeapStatistics().heap_size_limit;
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
