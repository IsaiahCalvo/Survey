// History-engine helpers — pure serialization / diff / classification utilities
// for the undo-redo + document-history machinery.
//
// Lifted verbatim out of PDFViewer. Every function here captured nothing from
// component scope (each was `useCallback(fn, [])` — a permanently stable
// reference), so they move to plain module functions with no behavior change:
// callers and effect dependency arrays still see stable references.

import { HISTORY_OBJECT_CHANGE_PREVIEW_LIMIT, HISTORY_PAGE_PREVIEW_LIMIT, getHistoryObjectDiffType, getHistoryObjectSignature, hashHistoryString, toHistoryObjectDebug } from '../viewerShared';
import { normalizePageRegions } from './annotationVisibilityRules';

export function normalizeHistoryReason(reason) {
  if (typeof reason !== 'string') return 'unspecified';
  const trimmed = reason.trim();
  return trimmed || 'unspecified';
}

export function getHistoryFingerprint(value) {
  const serialized = JSON.stringify(value ?? null);
  return {
    serialized,
    hash: hashHistoryString(serialized),
    bytes: serialized.length
  };
}

export function summarizeAnnotationPageTransitionForDebug(previousPageState, nextPageState) {
  const previousObjects = Array.isArray(previousPageState?.objects) ? previousPageState.objects : [];
  const nextObjects = Array.isArray(nextPageState?.objects) ? nextPageState.objects : [];
  const changedObjectsPreview = [];
  let changedObjectsCount = 0;
  const objectCount = Math.max(previousObjects.length, nextObjects.length);

  for (let index = 0; index < objectCount; index += 1) {
    const previousObject = previousObjects[index];
    const nextObject = nextObjects[index];
    if (!previousObject && !nextObject) continue;

    const previousDebug = previousObject ? toHistoryObjectDebug(previousObject, index) : null;
    const nextDebug = nextObject ? toHistoryObjectDebug(nextObject, index) : null;
    const previousSignature = previousDebug ? getHistoryObjectSignature(previousDebug) : null;
    const nextSignature = nextDebug ? getHistoryObjectSignature(nextDebug) : null;

    if (previousSignature === nextSignature) {
      continue;
    }

    changedObjectsCount += 1;
    if (changedObjectsPreview.length < HISTORY_OBJECT_CHANGE_PREVIEW_LIMIT) {
      changedObjectsPreview.push({
        index,
        changeType: getHistoryObjectDiffType(previousDebug, nextDebug),
        before: previousDebug,
        after: nextDebug
      });
    }
  }

  return {
    previousObjectCount: previousObjects.length,
    nextObjectCount: nextObjects.length,
    changedObjectsCount,
    changedObjectsPreview
  };
}

export function getHistoryDebugRows(events) {
  return events.map((event) => {
    const pageNumber = event.pageNumber ?? event.context?.pageNumber ?? '';
    const source = event.source || event.context?.source || event.context?.saveContext?.source || '';
    const interactionId = event.interactionId || event.context?.interactionId || event.context?.saveContext?.interactionId || '';
    const checkpointPolicy = event.checkpointPolicy || event.context?.checkpointPolicy || event.context?.saveContext?.checkpointPolicy || '';
    const changedPages = Array.isArray(event?.delta?.changedPagesPreview)
      ? event.delta.changedPagesPreview.join(', ')
      : '';
    const changedObjectsCount =
      event.changedObjectsCount ??
      event.pageTransition?.changedObjectsCount ??
      event.context?.changedObjectsCount ??
      '';
    return {
      seq: event.seq,
      at: event.at,
      type: event.type,
      reason: event.reason || event.undoneReason || event.redoReason || '',
      source,
      interactionId,
      checkpointPolicy,
      page: pageNumber,
      checkpointId: event.checkpointId || '',
      undoDepth: event.undoDepth ?? '',
      redoDepth: event.redoDepth ?? '',
      changedPages,
      changedObjects: changedObjectsCount,
      snapshotHash: event.snapshotHash || event.currentSnapshotHash || event.previousPageHash || '',
      restoreHash: event.restoreSnapshotHash || event.nextPageHash || '',
      noEffect: event.noEffect ? 'yes' : ''
    };
  });
}

export function migrateHistorySpaces(historySpaces = []) {
  return historySpaces.map(space => ({
    ...space,
    assignedPages: (space.assignedPages || []).map(page => {
      return {
        ...page,
        regions: normalizePageRegions(page.regions || [])
      };
    })
  }));
}

export function isLegacyAnnotationHistoryMeta(meta) {
  const reason = typeof meta?.reason === 'string' ? meta.reason : '';
  return reason.startsWith('callouts:')
    || reason.startsWith('highlight:')
    || reason === 'delete:batch'
    || reason === 'annotations:save';
}

export function getYjsHistoryTarget(stackItem) {
  const diagnostics = (() => {
    try {
      const value = stackItem?.meta?.get?.('historyDiagnostics');
      return Array.isArray(value) ? value : [];
    } catch (_err) {
      return [];
    }
  })();
  for (const diagnostic of diagnostics) {
    const id = diagnostic?.annotationId
      || diagnostic?.changedKeys?.find?.((entry) => typeof entry?.key === 'string' && entry.key)?.key
      || null;
    if (!id) continue;
    const annotationType = String(diagnostic?.annotationType || '').toLowerCase();
    const stack = String(diagnostic?.stack || diagnostic?.parentStack || '').toLowerCase();
    const path = Array.isArray(diagnostic?.path) ? diagnostic.path : [];
    const isCallout = annotationType === 'callout' || stack === 'callouts' || path[0] === 'callouts';
    return {
      id,
      kind: isCallout ? 'callout' : 'fabric',
      pageNumber: diagnostic?.pageNumber ?? stackItem?.meta?.get?.('pageNumber') ?? null,
      diagnostic,
    };
  }
  return null;
}

export function normalizeCanvasJsonForHistory(value) {
  const transientKeys = new Set([
    '_originalHasControls',
    '_originalHasBorders',
    '_lastLeft',
    '_lastTop',
    '_dragSessionId',
    'hasBorders',
    'hasControls',
    'lockMovementX',
    'lockMovementY',
    'lockScalingFlip',
    'perPixelTargetFind',
    'targetFindTolerance',
    'hoverCursor',
    'moveCursor',
    'selectable',
    'evented',
    'dirty',
    'cacheKey',
    'isMoving'
  ]);

  const walk = (node) => {
    if (Array.isArray(node)) {
      return node.map(walk);
    }
    if (!node || typeof node !== 'object') {
      return node;
    }

    const normalized = {};
    Object.entries(node).forEach(([key, child]) => {
      if (transientKeys.has(key)) {
        return;
      }
      normalized[key] = walk(child);
    });

    // Callout control handles are shown/hidden during selection only.
    if (normalized.partType === 'knee' || normalized.partType === 'arrowTip') {
      normalized.opacity = 0;
    }

    return normalized;
  };

  return walk(value);
}

export function summarizeHistorySnapshot(snapshot) {
    const annotationsState = snapshot?.annotationsByPage || {};
    const pageEntries = Object.entries(annotationsState);
    let annotationObjectCount = 0;
    const pageObjectCounts = {};

    pageEntries.forEach(([pageKey, pageState]) => {
      const objectCount = Array.isArray(pageState?.objects) ? pageState.objects.length : 0;
      annotationObjectCount += objectCount;
      if (objectCount > 0) {
        pageObjectCounts[pageKey] = objectCount;
      }
    });

    const spacesState = Array.isArray(snapshot?.spaces) ? snapshot.spaces : [];
    let assignedPagesCount = 0;
    let regionCount = 0;
    spacesState.forEach((space) => {
      const assignedPages = Array.isArray(space?.assignedPages) ? space.assignedPages : [];
      assignedPagesCount += assignedPages.length;
      assignedPages.forEach((page) => {
        regionCount += Array.isArray(page?.regions) ? page.regions.length : 0;
      });
    });

    const sortedPageEntries = Object.entries(pageObjectCounts)
      .sort((a, b) => Number(a[0]) - Number(b[0]));

    const pageObjectCountsPreview = Object.entries(pageObjectCounts)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .slice(0, HISTORY_PAGE_PREVIEW_LIMIT)
      .reduce((acc, [pageKey, count]) => {
        acc[pageKey] = count;
        return acc;
      }, {});

    const pageStateHashPreview = sortedPageEntries
      .slice(0, HISTORY_PAGE_PREVIEW_LIMIT)
      .reduce((acc, [pageKey, count]) => {
        const fingerprint = getHistoryFingerprint(annotationsState[pageKey] || null);
        acc[pageKey] = `${count}:${fingerprint.hash}`;
        return acc;
      }, {});

    const annotationsFingerprint = getHistoryFingerprint(annotationsState);

    return {
      annotationsPageCount: pageEntries.length,
      annotationObjectCount,
      surveyMarkerCount: Object.keys(snapshot?.surveyMarkers || {}).length,
      spacesCount: spacesState.length,
      assignedPagesCount,
      regionCount,
      nonEmptyAnnotationPages: Object.keys(pageObjectCounts).length,
      pageObjectCountsPreview,
      pageStateHashPreview,
      annotationsStateHash: annotationsFingerprint.hash,
      annotationsStateBytes: annotationsFingerprint.bytes
    };
  }
