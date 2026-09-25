// w37 (2026-09-25): a headless "screen" for the undo/redo regression suite.
//
// It keeps undo/redo the way PDFViewer does — two lanes interleaved by one
// checkpoint counter:
//   * local annotation history: field-level steps built by the real
//     annotationLocalHistory.js from the screen's page before and after a
//     save (a drag's step limited to its own frames' fields, exactly like
//     handleSaveAnnotations' previewBaseline + gesture-touch record);
//   * the legacy lane: eraser gestures (the real durable erase commit and its
//     lane transition) and Survey Marker snapshots;
// and follows the same rules through the same shared helpers
// (utils/historyStacks.js): newest step first across lanes, a new step
// clears Redo in both lanes, a dead step is dropped and the same press takes
// the next one, a Survey Marker step never restores marks.
//
// The screen writes through a REAL annotation document handle (the store
// every screen shares: tests/helpers/liveSyncFakeCloud.mjs), so a remote
// collaborator's rows, reloads and the per-field store merge are all real.
import {
  applyAnnotationHistoryAction,
  buildAnnotationHistoryAction,
  createGestureTouchRecord,
  filterAnnotationHistoryActionByOwner,
  invertAnnotationHistoryAction,
  recordGestureTouchesFromAction,
  restrictAnnotationHistoryActionFields,
} from '../../src/utils/annotationLocalHistory.js';
import {
  historyActionChangedPages,
  runHistoryPress,
  scopeLegacyRestoreToOwnSlices,
  shouldRedoLocalBeforeLegacy,
  shouldUndoLocalBeforeLegacy,
} from '../../src/utils/historyStacks.js';
import { isLegacyAnnotationHistoryMeta } from '../../src/utils/historyHelpers.js';
import { jsonEqual } from '../../src/utils/jsonEqual.js';
import { buildEraseIntent, classifyEraseObjectKind, eraseObjectDomain } from '../../src/utils/annotationEraseTransaction.js';
import { prepareEraseIntentForCommit } from '../../src/utils/annotationEraseCommitPlan.js';

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

// Order-insensitive fingerprint of what page N shows: id -> the mark with its
// keys sorted (a restored mark may carry the same fields in another order).
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, canonical(value[key])]));
  }
  return value;
};
export function pageSignature(byPage, pageNumber = 1) {
  const objects = byPage?.[pageNumber]?.objects || byPage?.[String(pageNumber)]?.objects || [];
  const out = {};
  for (const object of objects) {
    const id = String(object?.data?.id ?? object?.id ?? '');
    out[id] = JSON.stringify(canonical(object));
  }
  return out;
}

export function createHistoryScreen(handle, userId, { documentOwnerId = null } = {}) {
  let seq = 0;
  let byPage = clone(handle.getByPage()) || {};
  let surveyMarkers = clone(handle.getSurveyMarkers?.() || {}) || {};
  const localUndo = [];
  let localRedo = [];
  let legacyUndo = []; // { meta, entry }
  let legacyRedo = []; // [0] = next redo, like PDFViewer
  const events = [];
  let previewBaseline = null;
  let touches = null;
  let eraseCount = 0;

  const capture = () => handle.applyByPage(byPage);
  const setScreen = (next) => {
    byPage = next;
    capture();
  };
  const pageOf = (source, pageNumber) => source?.[pageNumber] || source?.[String(pageNumber)] || { objects: [] };

  const pushLocal = (action) => {
    if (!action) return;
    const scoped = filterAnnotationHistoryActionByOwner(action, userId, documentOwnerId);
    if (!scoped) return;
    seq += 1;
    localUndo.push({ ...scoped, __historyMeta: { checkpointId: seq } });
    localRedo = [];
    legacyRedo = []; // w37: a new step clears Redo in both lanes.
  };
  const pushLegacy = (meta, entry) => {
    seq += 1;
    legacyUndo.push({ meta: { ...meta, checkpointId: seq }, entry });
    legacyRedo = [];
    localRedo = []; // w37: a new step clears Redo in both lanes.
  };

  const applyLocal = (action) => {
    const scoped = filterAnnotationHistoryActionByOwner(action, userId, documentOwnerId);
    if (!scoped) return 'out-of-scope';
    const next = applyAnnotationHistoryAction(byPage, scoped);
    if (!historyActionChangedPages(byPage, next, scoped, jsonEqual)) return 'unchanged';
    setScreen(next);
    return 'applied';
  };

  const applyLegacy = (item, direction) => {
    if (item.entry.kind === 'erase') {
      const result = handle.applyEraseHistoryTransition(item.entry.transition, direction);
      if (result.status !== 'applied' && result.status !== 'noop') return { outcome: 'conflict' };
      setScreen(clone(result.byPage));
      return { outcome: result.status === 'noop' ? 'noop' : 'applied' };
    }
    if (item.entry.kind === 'snapshot') {
      const current = { annotationsByPage: clone(byPage), surveyMarkers: clone(surveyMarkers) };
      const target = scopeLegacyRestoreToOwnSlices(item.meta, current, item.entry.snapshot);
      byPage = clone(target.annotationsByPage);
      surveyMarkers = clone(target.surveyMarkers);
      handle.applySurveyMarkers?.(surveyMarkers);
      capture();
      return { outcome: 'applied', swapped: current };
    }
    return { outcome: 'dead' };
  };

  const undoOnce = () => {
    const local = localUndo[localUndo.length - 1] || null;
    const legacy = legacyUndo[legacyUndo.length - 1] || null;
    if (local && shouldUndoLocalBeforeLegacy(local, legacy?.meta || null)) {
      const outcome = applyLocal(invertAnnotationHistoryAction(local));
      localUndo.pop();
      if (outcome === 'applied') {
        localRedo.push(local);
        events.push({ undo: 'local', type: local.type });
        return 'applied';
      }
      events.push({ undoSkipped: 'local', outcome });
      return 'skipped';
    }
    if (legacy) {
      legacyUndo.pop();
      if (!isLegacyAnnotationHistoryMeta(legacy.meta)) {
        events.push({ undoSkipped: 'legacy-unknown' });
        return 'skipped';
      }
      const { outcome, swapped } = applyLegacy(legacy, 'undo');
      if (outcome === 'conflict' || outcome === 'dead') {
        events.push({ undoSkipped: 'legacy', outcome });
        return 'skipped';
      }
      legacyRedo.unshift(legacy.entry.kind === 'snapshot'
        ? { meta: legacy.meta, entry: { kind: 'snapshot', snapshot: swapped } }
        : legacy);
      events.push({ undo: 'legacy', kind: legacy.entry.kind, outcome });
      return outcome === 'noop' ? 'skipped' : 'applied';
    }
    return 'none';
  };

  const redoOnce = () => {
    const local = localRedo[localRedo.length - 1] || null;
    const legacy = legacyRedo[0] || null;
    if (local && shouldRedoLocalBeforeLegacy(local, legacy?.meta || null)) {
      const outcome = applyLocal(local);
      localRedo.pop();
      if (outcome === 'applied') {
        localUndo.push(local);
        events.push({ redo: 'local', type: local.type });
        return 'applied';
      }
      events.push({ redoSkipped: 'local', outcome });
      return 'skipped';
    }
    if (legacy) {
      legacyRedo.shift();
      if (!isLegacyAnnotationHistoryMeta(legacy.meta)) return 'skipped';
      const { outcome, swapped } = applyLegacy(legacy, 'redo');
      if (outcome === 'conflict' || outcome === 'dead') {
        events.push({ redoSkipped: 'legacy', outcome });
        return 'skipped';
      }
      legacyUndo.push(legacy.entry.kind === 'snapshot'
        ? { meta: legacy.meta, entry: { kind: 'snapshot', snapshot: swapped } }
        : legacy);
      events.push({ redo: 'legacy', kind: legacy.entry.kind, outcome });
      return outcome === 'noop' ? 'skipped' : 'applied';
    }
    return 'none';
  };

  return {
    handle,
    userId,
    events,
    get byPage() { return byPage; },
    get surveyMarkers() { return surveyMarkers; },
    objects(pageNumber = 1) { return pageOf(byPage, pageNumber).objects || []; },
    mark(id, pageNumber = 1) {
      return (pageOf(byPage, pageNumber).objects || []).find((o) => String(o?.data?.id ?? o?.id) === String(id)) || null;
    },
    signature(pageNumber = 1) { return pageSignature(byPage, pageNumber); },
    depths() {
      return { localUndo: localUndo.length, localRedo: localRedo.length, legacyUndo: legacyUndo.length, legacyRedo: legacyRedo.length };
    },
    /** The screen repaints what the store holds (a remote update arrived). */
    refresh() {
      byPage = clone(handle.getByPage());
      surveyMarkers = clone(handle.getSurveyMarkers?.() || surveyMarkers);
      // useAnnotationDoc captures after every render, including a repaint.
      capture();
    },
    /** One-save gesture on a page: create, recolour, text edit, delete, paste, nudge. */
    save(pageNumber, mutate) {
      const previousPage = clone(pageOf(byPage, pageNumber));
      const nextObjects = mutate(clone(previousPage.objects || []));
      const nextPage = { ...previousPage, objects: nextObjects };
      pushLocal(buildAnnotationHistoryAction({ pageNumber, previousPage, nextPage }));
      setScreen({ ...byPage, [pageNumber]: nextPage });
    },
    /**
     * A drag / resize / slider gesture: every frame is a live save
     * (checkpointPolicy 'skip'), the last one is the release. One step,
     * limited to the fields the gesture's own frames wrote.
     */
    gesture(pageNumber, frames) {
      previewBaseline = clone(pageOf(byPage, pageNumber));
      touches = createGestureTouchRecord();
      frames.forEach((mutate, index) => {
        const current = clone(pageOf(byPage, pageNumber));
        const nextPage = { ...current, objects: mutate(clone(current.objects || [])) };
        recordGestureTouchesFromAction(
          buildAnnotationHistoryAction({ pageNumber, previousPage: current, nextPage }),
          touches,
        );
        setScreen({ ...byPage, [pageNumber]: nextPage });
        if (index === frames.length - 1) {
          pushLocal(restrictAnnotationHistoryActionFields(
            buildAnnotationHistoryAction({ pageNumber, previousPage: previewBaseline, nextPage }),
            touches,
          ));
          previewBaseline = null;
          touches = null;
        }
      });
    },
    /**
     * One eraser gesture (whole or partial, one or several marks) through the
     * real durable erase commit. `plan(objects)` returns the targets:
     * [{ id, after }] with after = null for a whole-mark erase.
     */
    async erase(pageNumber, plan, { mode = 'partial' } = {}) {
      eraseCount += 1;
      const page = pageOf(byPage, pageNumber);
      const objects = page.objects || [];
      const targets = plan(objects).map(({ id, after }) => {
        const index = objects.findIndex((o) => String(o?.data?.id) === String(id));
        const before = objects[index];
        return {
          domain: eraseObjectDomain(before),
          storageKey: String(id),
          kind: classifyEraseObjectKind(before),
          operation: after ? 'replace' : 'delete',
          pageNumber,
          index,
          before,
          after: after || null,
        };
      });
      const intent = prepareEraseIntentForCommit({
        intent: buildEraseIntent({
          mutationId: `${userId}-erase-${eraseCount}-${Math.random().toString(36).slice(2, 8)}`,
          pageNumber,
          renderer: 'svg',
          gesture: { points: [{ x: 20, y: 20 }], radius: 4, mode },
          targets,
        }),
        annotationsByPage: byPage,
        userId,
        includeDeleteHistory: false,
      });
      const result = await handle.commitEraseIntent(intent, { permissionContext: { mode: 'local-only' } });
      if (result.status !== 'committed') return result;
      pushLegacy({ reason: 'eraser:gesture' }, { kind: 'erase', transition: result.historyTransition });
      setScreen(clone(result.byPage));
      return result;
    },
    /** A Survey Marker gesture: legacy snapshot step (surveyMarkers only). */
    surveyMarker(reason, mutate) {
      pushLegacy({ reason }, {
        kind: 'snapshot',
        snapshot: { annotationsByPage: clone(byPage), surveyMarkers: clone(surveyMarkers) },
      });
      surveyMarkers = mutate(clone(surveyMarkers));
      handle.applySurveyMarkers?.(surveyMarkers);
    },
    /** A checkpoint Undo does not restore (was: 'excel:auto-sync'). */
    pushUnknownLegacyStep(reason = 'excel:auto-sync') {
      pushLegacy({ reason }, { kind: 'unknown' });
    },
    undo() { return runHistoryPress(undoOnce); },
    redo() { return runHistoryPress(redoOnce); },
  };
}
