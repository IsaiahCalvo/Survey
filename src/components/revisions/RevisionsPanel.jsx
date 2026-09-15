// KAL-48 — Revisions panel (v1).
//
// Minimum-viable UI for first-class document revisions. Mounts as a sibling of
// <PDFViewer> inside the YDocProvider tree so App.jsx stays nearly diff-free.
// Renders its own floating launcher button + drawer; no other component needs
// to know about it.
//
// Behaviour:
//   - "Revisions (N)" launcher at viewport bottom-right while a document is
//     open. Clicking opens the drawer.
//   - Drawer lists revisions newest-first. Each row shows:
//       v<N> · <label> · <yyyy-mm-dd hh:mm> · <annotation count>
//     and three actions: "Open read-only", "Restore" (owner-only), "Copy id".
//   - Bottom of drawer: "Save as Revision" button (owner-only). Prompts for an
//     optional label using window.prompt — fine for v1; a styled modal can
//     come later.
//   - "Open read-only" sets body[data-readonly="true"] (same mechanism as
//     ReadOnlyGate, so the existing toolbar dim CSS applies) and shows a
//     banner along the top of the viewport: "Viewing revision N (created ...).
//     Return to current."
//
// Ownership check is done with a single supabase select against
// `documents.user_id` — matches the helper logic and avoids touching
// useYDoc state.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../supabaseClient';
import Icon from '../../Icons';
import {
  createRevision,
  listRevisions,
  getRevision,
  restoreRevision,
} from '../../services/documentRevisionService';
import {
  getDocumentHistoryStorageStatus,
  listDocumentHistoryEvents,
  subscribeDocumentHistoryStorage,
} from '../../services/documentHistoryService';
import { resolveRegionRestoreCascade, describeHistoryEventSubject } from '../../services/annotationTrashHistory';
import { claimBodyReadOnly } from '../../utils/readOnlyBodyReasons.js';

const DRAWER_WIDTH = 360;
const HISTORY_SPOTLIGHT_STYLE_ID = 'document-history-spotlight-style';

function ensureSpotlightStyle() {
  if (typeof document === 'undefined' || document.getElementById(HISTORY_SPOTLIGHT_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = HISTORY_SPOTLIGHT_STYLE_ID;
  style.textContent = `
    @keyframes document-history-pulse-glow {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.7; }
    }
  `;
  document.head.appendChild(style);
}

function historyPathToD(path) {
  if (!Array.isArray(path)) return '';
  return path
    .filter(Array.isArray)
    .map((command) => command.map((part) => (typeof part === 'number' ? Number(part.toFixed(2)) : part)).join(' '))
    .join(' ');
}

function historyPointsToString(points) {
  if (!Array.isArray(points)) return '';
  return points
    .map((point) => {
      if (Array.isArray(point)) return `${Number(point[0]) || 0},${Number(point[1]) || 0}`;
      return `${Number(point?.x) || 0},${Number(point?.y) || 0}`;
    })
    .join(' ');
}

function getHistoryPathBounds(path) {
  if (!Array.isArray(path)) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  path.forEach((seg) => {
    if (!Array.isArray(seg)) return;
    for (let i = 1; i + 1 < seg.length; i += 2) {
      const x = Number(seg[i]);
      const y = Number(seg[i + 1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  });
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  return { minX, minY, maxX, maxY };
}

function isDeleteHistoryEvent(event) {
  const text = [
    event?.summary,
    event?.payload?.actionType,
    event?.payload?.rawActionType,
  ].filter(Boolean).join(' ').toLowerCase();
  return text.includes('delete') || text.includes('deleted') || text.includes('fabric:delete');
}

function historyEventId(event) {
  return event?.client_event_id || event?.id;
}

function originBadge(origin) {
  if (origin === 'auto-pre-restore') {
    return { label: 'auto', color: '#8a8a8a' };
  }
  if (origin === 'sign-off') {
    return { label: 'sign-off', color: '#7ea8ff' };
  }
  return { label: 'manual', color: '#5fbf7f' };
}

function formatDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${y}-${mo}-${da} ${hh}:${mm}`;
  } catch {
    return iso;
  }
}

function historyStorageMessage(status, isGuest) {
  if (!status) return null;
  if (status.errorCode === 'DOCUMENT_HISTORY_EVENT_CONFLICT') {
    return 'A conflicting history event was not saved. The earlier saved event was kept.';
  }
  const isFull = status.protectedFull
    || status.errorCode === 'DOCUMENT_HISTORY_PROTECTED_CAP_EXCEEDED'
    || String(status.errorCode || '').toLowerCase().includes('quota');
  if (isFull) return 'Local history storage is full. New history may not be kept on this device.';
  if (!status.available) {
    return 'Local history storage is unavailable. New history may not be kept on this device.';
  }
  if (status.pendingCount > 0) {
    if (isGuest) {
      return `Across your documents, ${status.pendingCount} local history ${status.pendingCount === 1 ? 'item is' : 'items are'} stored only on this device.`;
    }
    return `For this account, ${status.pendingCount} local history ${status.pendingCount === 1 ? 'item is' : 'items are'} not yet backed up.`;
  }
  return null;
}

export default function RevisionsPanel({
  documentId,
  user,
  embedded = false,
  // UX 2026-07-12 — mobileMode restyles the timeline rows to the demo's mobile
  // version-history rows (min-height 50, radius 8, 9px green dot, bolder title;
  // VersionHistoryDrawer / styles.ts:1994-2025) while keeping the full real
  // revision data + restore controls (superset). Desktop rendering is untouched.
  mobileMode = false,
  // History-audit P1: when embedded, the sidebar keeps this panel mounted
  // behind display:none. isActive=false means the History tab is deselected
  // or the rail is collapsed — preview/spotlight state must be torn down so
  // body[data-readonly] and the spotlight SVG can't outlive the panel.
  isActive = true,
  onClose = null,
  onNavigateToPage = null,
  onRestoreHistoryActivity = null,
  onCascadeRestoreRegion = null,
  // Decision 10 (KAL-90): before jumping to the entry's page, restore the full
  // context the mark belongs to (survey/region mode + selected category).
  onRestoreHistoryContext = null,
}) {
  const [open, setOpen] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [revisions, setRevisions] = useState([]);
  const [historyEvents, setHistoryEvents] = useState([]);
  const [historyStorageStatus, setHistoryStorageStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [viewingRevision, setViewingRevision] = useState(null);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState(null);
  const [selectedEventId, setSelectedEventId] = useState(null);
  const [selectedEventDetail, setSelectedEventDetail] = useState(null);
  // KAL-313 CONFIRM-CASCADE: pending cascade restore { regionEvent, spaceEvent }
  // Set when Restore is clicked for an orphaned region whose space has a restorable record.
  const [cascadePending, setCascadePending] = useState(null);
  const hasLoadedRef = useRef(false);
  const refreshTimeoutRef = useRef(null);
  const spotlightFrameRef = useRef(null);
  const activeSpotlightRef = useRef(null);
  // Embedded panels stay mounted while hidden. Only the visible History
  // panel needs list reads, event refreshes, or the polling fallback.
  const shouldLoadHistory = isActive && (embedded || open);
  const actorUserId = user?.id || null;
  const historyScope = useMemo(
    () => (actorUserId ? { actorUserId } : { guestScopeId: 'device-local' }),
    [actorUserId],
  );
  const scopeRef = useRef(null);
  const lifecycleRef = useRef({ key: null, generation: 0, mounted: true });
  const requestEpochRef = useRef(0);
  const lifecycleKey = `${documentId || ''}\u0000${actorUserId || ''}\u0000${shouldLoadHistory ? '1' : '0'}`;
  if (lifecycleRef.current.key !== lifecycleKey) {
    lifecycleRef.current.key = lifecycleKey;
    lifecycleRef.current.generation += 1;
  }
  scopeRef.current = {
    documentId,
    actorUserId,
    shouldLoadHistory,
    generation: lifecycleRef.current.generation,
  };

  const isCurrentScope = useCallback((scope) => {
    const current = scopeRef.current;
    return Boolean(
      scope?.shouldLoadHistory
      && current?.shouldLoadHistory
      && current.documentId === scope.documentId
      && current.actorUserId === scope.actorUserId
      && current.generation === scope.generation
      && lifecycleRef.current.mounted
    );
  }, []);

  useEffect(() => {
    lifecycleRef.current.mounted = true;
    return () => {
      lifecycleRef.current.mounted = false;
      lifecycleRef.current.generation += 1;
      requestEpochRef.current += 1;
    };
  }, []);

  // Resolve ownership once per (documentId, user) — matches the open-coded
  // owner check in _kal48_can_access: project owner OR document creator.
  useEffect(() => {
    let cancelled = false;
    setIsOwner(false);
    if (!documentId || !actorUserId || !shouldLoadHistory || !supabase?.from) return;
    const scope = { ...scopeRef.current };
    (async () => {
      try {
        const { data, error } = await supabase
          .from('documents')
          .select('user_id, project_id, projects!documents_project_id_fkey(user_id)')
          .eq('id', documentId)
          .maybeSingle();
        if (cancelled || !isCurrentScope(scope)) return;
        if (error || !data) {
          setIsOwner(false);
          return;
        }
        const creatorOwner = data.user_id === user.id && !data.project_id;
        const projectOwner = data?.projects?.user_id === user.id;
        setIsOwner(Boolean(creatorOwner || projectOwner || data.user_id === user.id));
      } catch (_error) {
        if (cancelled || !isCurrentScope(scope)) return;
        setIsOwner(false);
      }
    })();
    return () => { cancelled = true; };
  }, [actorUserId, documentId, isCurrentScope, shouldLoadHistory]);

  // A hidden panel or a changed document/account must reject every older
  // request. Clear the old view before the next scoped load can paint.
  useLayoutEffect(() => {
    requestEpochRef.current += 1;
    hasLoadedRef.current = false;
    setRevisions([]);
    setHistoryEvents([]);
    setHistoryStorageStatus(null);
    setIsOwner(false);
    setLoading(false);
    setErr(null);
    setViewingRevision(null);
    setBusy(false);
    setStatusMsg(null);
    setSelectedEventId(null);
    setSelectedEventDetail(null);
    setCascadePending(null);
  }, [actorUserId, documentId, shouldLoadHistory]);

  // Load list when drawer opens, when embedded in the left rail, or after a mutation.
  const refresh = useCallback(async (options = {}) => {
    if (!shouldLoadHistory) return;
    const scope = { ...scopeRef.current };
    const epoch = ++requestEpochRef.current;
    const silent = options?.silent === true || hasLoadedRef.current;
    if (!documentId) {
      setRevisions([]);
      setHistoryEvents([]);
      hasLoadedRef.current = false;
      return;
    }
    if (!silent) setLoading(true);
    setErr(null);
    try {
      const [revisionResult, events, storageStatus] = await Promise.all([
        actorUserId
          ? Promise.resolve().then(() => listRevisions(documentId)).then((rows) => ({ rows })).catch(() => ({ rows: [] }))
          : Promise.resolve({ rows: [] }),
        listDocumentHistoryEvents(documentId, { limit: 200, ...historyScope }),
        Promise.resolve()
          .then(() => getDocumentHistoryStorageStatus(historyScope))
          .catch((error) => ({
            available: false,
            pendingCount: 0,
            protectedBytes: 0,
            confirmedCacheBytes: 0,
            legacyUnscopedAvailable: false,
            errorCode: error?.code || 'DOCUMENT_HISTORY_LOCAL_UNAVAILABLE',
          })),
      ]);
      if (!isCurrentScope(scope) || epoch !== requestEpochRef.current) return;
      setRevisions(revisionResult.rows);
      setHistoryEvents(events);
      setHistoryStorageStatus(storageStatus);
      hasLoadedRef.current = true;
    } catch (e) {
      if (!isCurrentScope(scope) || epoch !== requestEpochRef.current) return;
      setRevisions([]);
      setHistoryEvents([]);
      setHistoryStorageStatus(null);
      setViewingRevision(null);
      setSelectedEventId(null);
      setSelectedEventDetail(null);
      setCascadePending(null);
      setErr(e.message);
    } finally {
      if (isCurrentScope(scope) && epoch === requestEpochRef.current) setLoading(false);
    }
  }, [actorUserId, documentId, historyScope, isCurrentScope, shouldLoadHistory]);

  useEffect(() => {
    if (shouldLoadHistory) refresh({ silent: hasLoadedRef.current });
  }, [shouldLoadHistory, refresh]);

  useEffect(() => {
    if (!documentId || !shouldLoadHistory) return undefined;
    const handleRecorded = () => {
      requestEpochRef.current += 1;
      if (refreshTimeoutRef.current) window.clearTimeout(refreshTimeoutRef.current);
      refreshTimeoutRef.current = window.setTimeout(() => {
        refresh({ silent: true });
      }, 900);
    };
    const unsubscribe = subscribeDocumentHistoryStorage(historyScope, handleRecorded);
    const intervalId = window.setInterval(() => refresh({ silent: true }), 10000);
    return () => {
      unsubscribe();
      window.clearInterval(intervalId);
      if (refreshTimeoutRef.current) {
        window.clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
    };
  }, [documentId, historyScope, shouldLoadHistory, refresh]);

  // body[data-readonly] mirroring — set when viewing a prior revision.
  // Ownership-aware (history-audit P1): if the attribute was ALREADY set when
  // this effect ran (ReadOnlyGate's access-revoked state uses the same body
  // attribute), the panel does not own it and must not remove it on cleanup —
  // only clear what the panel itself set.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    if (viewingRevision) {
      const token = Symbol('revision-readonly');
      return claimBodyReadOnly(token, document);
    }
    return undefined;
  }, [viewingRevision]);

  const handleSave = useCallback(async () => {
    if (!documentId || busy) return;
    const scope = { ...scopeRef.current };
    const label = window.prompt('Label for this revision (optional):', '');
    if (label === null) return; // user cancelled
    setBusy(true);
    setStatusMsg(null);
    try {
      const row = await createRevision(documentId, { label: label || null });
      if (!isCurrentScope(scope)) return;
      setStatusMsg(`Saved revision v${row.revision_number}.`);
      await refresh();
    } catch (e) {
      if (!isCurrentScope(scope)) return;
      setStatusMsg(`Save failed: ${e.message}`);
    } finally {
      if (isCurrentScope(scope)) setBusy(false);
    }
  }, [documentId, refresh, busy, isCurrentScope]);

  const handleOpenReadOnly = useCallback(async (rev) => {
    if (busy) return;
    const scope = { ...scopeRef.current };
    setBusy(true);
    setStatusMsg(null);
    try {
      const full = await getRevision(rev.id);
      if (!isCurrentScope(scope)) return;
      setViewingRevision({
        ...rev,
        snapshot: full?.snapshot_json || null,
      });
    } catch (e) {
      if (!isCurrentScope(scope)) return;
      setStatusMsg(`Open failed: ${e.message}`);
    } finally {
      if (isCurrentScope(scope)) setBusy(false);
    }
  }, [busy, isCurrentScope]);

  const handleReturnToCurrent = useCallback(() => {
    setViewingRevision(null);
  }, []);

  const findPageElement = useCallback((pageNumber, fallback = null) => {
    if (typeof document === 'undefined') return fallback;
    if (fallback?.isConnected) return fallback;
    if (!Number.isFinite(pageNumber)) return fallback?.isConnected ? fallback : null;
    const selectors = [
      `.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`,
      `[data-page-number="${pageNumber}"]`,
      `[id$="_pageDiv_${pageNumber - 1}"]`,
    ];
    return selectors
      .map((selector) => {
        try { return document.querySelector(selector); } catch (_err) { return null; }
      })
      .find((element) => {
        const rect = element?.getBoundingClientRect?.();
        return rect && rect.width > 0 && rect.height > 0;
      }) || null;
  }, []);

  // History-audit P3: the spotlight draws annotation geometry in SVG viewBox
  // units (page PDF units), so it REQUIRES the annotation layer's non-zero
  // native viewBox. There is no screen-pixel fallback — falling back to
  // hostRect dimensions produced misaligned highlights. If the SVG hasn't
  // painted yet (zero/absent viewBox), skip the spotlight rather than misalign.
  const resolveSpotlightHost = useCallback((pageElement, pageNumber = null) => {
    if (!pageElement) return null;
    // Decision 10 (KAL-90): in the pdf.js viewer the annotation SVG lives in an
    // overlay portal, NOT inside the page div — its data-svg-annotation-layer
    // attribute value is the page number, so fall back to a document query.
    const normalizedPage = Number(pageNumber);
    const annotationSvg = (pageElement.matches?.('svg[data-svg-annotation-layer]')
      ? pageElement
      : pageElement.querySelector?.('svg[data-svg-annotation-layer]'))
      || (Number.isFinite(normalizedPage) && normalizedPage > 0
        ? document.querySelector(`svg[data-svg-annotation-layer="${normalizedPage}"]`)
        : null);
    if (!annotationSvg) return null;
    const nativeViewBox = annotationSvg.viewBox?.baseVal;
    if (!nativeViewBox || !(nativeViewBox.width > 0) || !(nativeViewBox.height > 0)) return null;
    const hostElement = annotationSvg;
    const hostRect = hostElement.getBoundingClientRect();
    return {
      hostElement,
      hostRect,
      viewBoxWidth: nativeViewBox.width,
      viewBoxHeight: nativeViewBox.height,
    };
  }, []);

  // History-audit P3: the spotlight SVG lives in a document-body portal with
  // position:fixed, sized from the annotation layer's getBoundingClientRect()
  // each frame. No reparenting into the page container and NO
  // overlayParent.style.position mutation — that restacked the page's children
  // and could push canvas layers behind other positioned elements (S5).
  const syncSpotlightOverlay = useCallback((active) => {
    if (typeof document === 'undefined' || !active?.svg) return false;
    const pageElement = findPageElement(active.pageNumber, active.pageElement);
    if (!pageElement) return false;
    active.pageElement = pageElement;
    const host = resolveSpotlightHost(pageElement, active.pageNumber);
    if (!host?.hostElement?.isConnected) return false;
    const { svg } = active;
    const { hostRect, viewBoxWidth, viewBoxHeight } = host;
    if (svg.parentElement !== document.body) document.body.appendChild(svg);
    if (hostRect.width <= 0 || hostRect.height <= 0) {
      svg.style.display = 'none';
      return true;
    }
    svg.style.display = 'block';
    svg.setAttribute('viewBox', `0 0 ${viewBoxWidth} ${viewBoxHeight}`);
    svg.style.left = `${hostRect.left}px`;
    svg.style.top = `${hostRect.top}px`;
    svg.style.width = `${hostRect.width}px`;
    svg.style.height = `${hostRect.height}px`;
    return true;
  }, [findPageElement, resolveSpotlightHost]);

  const stopSpotlightTracking = useCallback(() => {
    if (typeof window !== 'undefined' && spotlightFrameRef.current) {
      window.cancelAnimationFrame(spotlightFrameRef.current);
      spotlightFrameRef.current = null;
    }
    if (typeof document !== 'undefined') {
      document.getElementById('document-history-spotlight')?.remove();
      document.getElementById('document-history-spotlight-svg')?.remove();
    }
    activeSpotlightRef.current = null;
  }, []);

  const startSpotlightTracking = useCallback((svg, pageElement, pageNumber) => {
    if (typeof window === 'undefined' || !svg) return;
    if (spotlightFrameRef.current) {
      window.cancelAnimationFrame(spotlightFrameRef.current);
      spotlightFrameRef.current = null;
    }
    activeSpotlightRef.current = { svg, pageElement, pageNumber };
    const tick = () => {
      const active = activeSpotlightRef.current;
      if (!active || active.svg !== svg) return;
      if (!syncSpotlightOverlay(active)) {
        svg.remove();
        activeSpotlightRef.current = null;
        spotlightFrameRef.current = null;
        return;
      }
      spotlightFrameRef.current = window.requestAnimationFrame(tick);
    };
    tick();
  }, [syncSpotlightOverlay]);

  useEffect(() => () => stopSpotlightTracking(), [stopSpotlightTracking]);

  // History-audit P1: tear down preview + spotlight whenever the panel stops
  // being visible. Embedded panels are hidden via display:none (still mounted),
  // so without this the revision preview's body[data-readonly] kept the toolbar
  // dimmed indefinitely and a stale spotlight SVG could cover fresh drawings.
  useEffect(() => {
    const hidden = embedded ? !isActive : !open;
    if (hidden) {
      stopSpotlightTracking();
      setViewingRevision(null);
    }
  }, [embedded, isActive, open, stopSpotlightTracking]);

  const createPageSpotlightSvg = useCallback((pageElement, pageNumber = null) => {
    if (typeof document === 'undefined' || !pageElement) return null;
    ensureSpotlightStyle();
    stopSpotlightTracking();
    const host = resolveSpotlightHost(pageElement, pageNumber);
    if (!host) return null; // annotation SVG absent or viewBox not painted — skip, never misalign
    const { hostRect, viewBoxWidth, viewBoxHeight } = host;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'document-history-spotlight-svg';
    svg.setAttribute('viewBox', `0 0 ${viewBoxWidth} ${viewBoxHeight}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    // History-audit P3: fixed-position document-body portal at viewport coords.
    // No page-container reparenting, no overlayParent.style.position mutation.
    Object.assign(svg.style, {
      position: 'fixed',
      left: `${hostRect.left}px`,
      top: `${hostRect.top}px`,
      width: `${hostRect.width}px`,
      height: `${hostRect.height}px`,
      overflow: 'visible',
      pointerEvents: 'none',
      zIndex: 9999,
    });
    document.body.appendChild(svg);
    const normalizedPageNumber = Number(pageNumber);
    startSpotlightTracking(
      svg,
      pageElement,
      Number.isFinite(normalizedPageNumber) && normalizedPageNumber > 0 ? normalizedPageNumber : null,
    );
    return svg;
  }, [resolveSpotlightHost, startSpotlightTracking, stopSpotlightTracking]);

  const renderAnnotationSpotlight = useCallback((pageElement, annotation, pageNumber = null) => {
    if (typeof document === 'undefined' || !pageElement || !annotation) return false;
    const svg = createPageSpotlightSvg(pageElement, pageNumber);
    if (!svg) return false;
    const type = String(annotation.type || annotation.data?.type || annotation.pdfAnnotationType || '').toLowerCase();
    const strokeWidth = Math.max(6, Number(annotation.strokeWidth || 2) + 4);
    const addGlowAttrs = (node) => {
      node.setAttribute('fill', 'none');
      node.setAttribute('stroke', '#d8a84e');
      node.setAttribute('stroke-opacity', '0.4');
      node.setAttribute('stroke-width', `${strokeWidth}`);
      node.setAttribute('stroke-linecap', 'round');
      node.setAttribute('stroke-linejoin', 'round');
      node.setAttribute('vector-effect', annotation.strokeUniform ? 'non-scaling-stroke' : 'none');
      node.style.pointerEvents = 'none';
      node.style.animation = 'document-history-pulse-glow 900ms ease-in-out infinite';
    };
    let node = null;
    if (annotation.path) {
      const pathD = historyPathToD(annotation.path);
      if (pathD) {
        node = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        node.setAttribute('d', pathD);
        const left = Number(annotation.left ?? 0);
        const top = Number(annotation.top ?? 0);
        const angle = Number(annotation.angle ?? 0);
        const scaleX = Number(annotation.scaleX ?? 1);
        const scaleY = Number(annotation.scaleY ?? 1);
        const pathOffsetX = Number(annotation.pathOffset?.x || 0);
        const pathOffsetY = Number(annotation.pathOffset?.y || 0);
        const bounds = getHistoryPathBounds(annotation.path);
        const rotCenterX = bounds
          ? scaleX * ((bounds.minX + bounds.maxX) / 2 - pathOffsetX)
          : 0;
        const rotCenterY = bounds
          ? scaleY * ((bounds.minY + bounds.maxY) / 2 - pathOffsetY)
          : 0;
        let transform = `translate(${Number.isFinite(left) ? left : 0}, ${Number.isFinite(top) ? top : 0})`;
        if (Number.isFinite(angle) && angle !== 0) transform += ` rotate(${angle}, ${rotCenterX}, ${rotCenterY})`;
        if ((Number.isFinite(scaleX) && scaleX !== 1) || (Number.isFinite(scaleY) && scaleY !== 1)) {
          transform += ` scale(${Number.isFinite(scaleX) ? scaleX : 1}, ${Number.isFinite(scaleY) ? scaleY : 1})`;
        }
        transform += ` translate(${-pathOffsetX}, ${-pathOffsetY})`;
        node.setAttribute('transform', transform);
      }
    } else if (Array.isArray(annotation.points) && annotation.points.length > 1) {
      node = document.createElementNS('http://www.w3.org/2000/svg', type.includes('polygon') ? 'polygon' : 'polyline');
      node.setAttribute('points', historyPointsToString(annotation.points));
    } else if (type.includes('line') || ['line', 'arrow'].includes(type)) {
      node = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      const left = Number(annotation.left) || 0;
      const top = Number(annotation.top) || 0;
      node.setAttribute('x1', `${left + (Number(annotation.x1) || 0)}`);
      node.setAttribute('y1', `${top + (Number(annotation.y1) || 0)}`);
      node.setAttribute('x2', `${left + (Number(annotation.x2) || 0)}`);
      node.setAttribute('y2', `${top + (Number(annotation.y2) || 0)}`);
    } else if (type.includes('circle') || type.includes('ellipse')) {
      node = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
      const left = Number(annotation.left) || 0;
      const top = Number(annotation.top) || 0;
      const width = Math.max(8, Math.abs((Number(annotation.width) || 0) * (Number(annotation.scaleX) || 1)));
      const height = Math.max(8, Math.abs((Number(annotation.height) || 0) * (Number(annotation.scaleY) || 1)));
      node.setAttribute('cx', `${left + width / 2}`);
      node.setAttribute('cy', `${top + height / 2}`);
      node.setAttribute('rx', `${width / 2}`);
      node.setAttribute('ry', `${height / 2}`);
    } else {
      node = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      const left = Number(annotation.left);
      const top = Number(annotation.top);
      const width = Math.abs((Number(annotation.width) || 0) * (Number(annotation.scaleX) || 1));
      const height = Math.abs((Number(annotation.height) || 0) * (Number(annotation.scaleY) || 1));
      if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
        svg.remove();
        return false;
      }
      node.setAttribute('x', `${left}`);
      node.setAttribute('y', `${top}`);
      node.setAttribute('width', `${width}`);
      node.setAttribute('height', `${height}`);
      node.setAttribute('rx', '2');
      node.setAttribute('ry', '2');
    }
    if (!node) {
      svg.remove();
      return false;
    }
    addGlowAttrs(node);
    const angle = Number(annotation.angle);
    if (Number.isFinite(angle) && angle !== 0 && !annotation.path) {
      const left = Number(annotation.left) || 0;
      const top = Number(annotation.top) || 0;
      const width = Math.abs((Number(annotation.width) || 0) * (Number(annotation.scaleX) || 1));
      const height = Math.abs((Number(annotation.height) || 0) * (Number(annotation.scaleY) || 1));
      node.setAttribute('transform', `rotate(${angle} ${left + width / 2} ${top + height / 2})`);
    }
    svg.appendChild(node);
    return true;
  }, [createPageSpotlightSvg]);

  const renderDomPathFallbackSpotlight = useCallback((target, pageNumber = null) => {
    if (typeof document === 'undefined' || !target) return false;
    const path = target.matches?.('path, line, polyline, polygon, rect, circle, ellipse')
      ? target
      : target.querySelector?.('path, line, polyline, polygon, rect, circle, ellipse');
    // Decision 10 (KAL-90): overlay layers render annotations in a portal that
    // is NOT a DOM descendant of the page div (e.g. Survey Marker <g> nodes),
    // so closest() can come up empty — fall back to resolving the page element
    // by the event's page number. Both SVGs share the page-dimension viewBox,
    // so the cloned geometry stays aligned.
    const normalizedPage = Number(pageNumber);
    const pageElement = target.closest?.('.survey-pdfjs-page-div, [data-page-number], [id*="_pageDiv_"]')
      || (Number.isFinite(normalizedPage) && normalizedPage > 0
        ? document.querySelector(`.survey-pdfjs-page-div[data-page-number="${normalizedPage}"]`)
          || document.querySelector(`[data-page-number="${normalizedPage}"]`)
        : null);
    if (!path || !pageElement) return false;
    const clone = path.cloneNode(false);
    const svg = createPageSpotlightSvg(pageElement, Number.isFinite(normalizedPage) && normalizedPage > 0 ? normalizedPage : null);
    if (!svg) return false;
    clone.removeAttribute('fill');
    clone.setAttribute('fill', 'none');
    clone.setAttribute('stroke', '#d8a84e');
    clone.setAttribute('stroke-opacity', '0.4');
    clone.setAttribute('stroke-width', `${Math.max(6, Number(path.getAttribute('stroke-width') || 2) + 4)}`);
    clone.setAttribute('stroke-linecap', 'round');
    clone.setAttribute('stroke-linejoin', 'round');
    clone.style.pointerEvents = 'none';
    clone.style.animation = 'document-history-pulse-glow 900ms ease-in-out infinite';
    svg.appendChild(clone);
    return true;
  }, [createPageSpotlightSvg]);

  const spotlightAnnotation = useCallback((annotationId, pageNumber = null) => {
    if (typeof document === 'undefined' || !annotationId) return false;
    const escaped = typeof CSS !== 'undefined' && CSS.escape
      ? CSS.escape(annotationId)
      : String(annotationId).replace(/"/g, '\\"');
    const selectors = [
      `[data-annotation-id="${escaped}"]`,
      `[data-shape-id="${escaped}"]`,
      `[data-callout-id="${escaped}"]`,
      `[data-survey-marker-id="${escaped}"]`,
      `#highlight-item-${escaped}`,
    ];
    const target = selectors
      .map((selector) => {
        try { return document.querySelector(selector); } catch (_err) { return null; }
      })
      .find(Boolean);
    if (!target) return false;
    return renderDomPathFallbackSpotlight(target, pageNumber);
  }, [renderDomPathFallbackSpotlight]);

  const spotlightHistoryPreview = useCallback((pageNumber, event) => {
    if (typeof document === 'undefined' || !Number.isFinite(pageNumber)) return false;
    const pageSelectors = [
      `.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`,
      `[data-page-number="${pageNumber}"]`,
      `[id$="_pageDiv_${pageNumber - 1}"]`,
    ];
    const pageElement = pageSelectors
      .map((selector) => {
        try { return document.querySelector(selector); } catch (_err) { return null; }
      })
      .find((element) => {
        const rect = element?.getBoundingClientRect?.();
        return rect && rect.width > 0 && rect.height > 0;
      });
    if (!pageElement) return false;
    const previewAnnotation = event?.payload?.previewAnnotation;
    if (previewAnnotation && renderAnnotationSpotlight(pageElement, previewAnnotation, pageNumber)) {
      return true;
    }
    return false;
  }, [renderAnnotationSpotlight]);

  const handleRestore = useCallback(async (rev) => {
    if (busy) return;
    const scope = { ...scopeRef.current };
    const ok = window.confirm(
      `Restore v${rev.revisionNumber}? The current state will be saved as an auto revision first, then overwritten by this snapshot.`,
    );
    if (!ok) return;
    setBusy(true);
    setStatusMsg(null);
    try {
      const pre = await restoreRevision(rev.id);
      if (!isCurrentScope(scope)) return;
      setStatusMsg(
        `Restored v${rev.revisionNumber}. Previous state saved as v${pre.revision_number}.`,
      );
      setViewingRevision(null);
      await refresh();
    } catch (e) {
      if (!isCurrentScope(scope)) return;
      setStatusMsg(`Restore failed: ${e.message}`);
    } finally {
      if (isCurrentScope(scope)) setBusy(false);
    }
  }, [busy, refresh, isCurrentScope]);

  const handleActivityClick = useCallback((event) => {
    if (!event) return;
    const scope = { ...scopeRef.current };
    setSelectedEventId(historyEventId(event) || null);
    setSelectedEventDetail(event);
    // Decision 10 (KAL-90): restore the exact context the mark belongs to —
    // survey/region mode and the selected template/module/category — BEFORE
    // the page jump, so the mark is actually visible when we land on it.
    let contextRestored = false;
    if (typeof onRestoreHistoryContext === 'function') {
      try {
        contextRestored = Boolean(onRestoreHistoryContext(event));
      } catch (_err) {
        // Context restore is best-effort; the page jump below must still run.
      }
    }
    const pageNumber = Number(event.page_number ?? event.payload?.pageNumber);
    if (Number.isFinite(pageNumber) && pageNumber > 0 && typeof onNavigateToPage === 'function') {
      onNavigateToPage(pageNumber, { fallback: 'nearest', bypassActiveSpace: true });
      // Decision 10 (KAL-90): the context restore above can re-render the page
      // (space activation mounts the mark's overlay), so the mark may not be in
      // the DOM yet on the first attempt — retry the spotlight briefly instead
      // of giving up after one shot.
      const trySpotlight = (attempt) => {
        if (!isCurrentScope(scope)) return;
        const didSpotlight = spotlightHistoryPreview(pageNumber, event)
          || spotlightAnnotation(event.annotation_id || event.payload?.annotationId, pageNumber);
        if (!didSpotlight && attempt < 6) {
          window.setTimeout(() => trySpotlight(attempt + 1), 250);
          return;
        }
        const restoredSuffix = contextRestored ? ' Context restored.' : '';
        setStatusMsg(didSpotlight
          ? `${isDeleteHistoryEvent(event) ? 'Showing where the deleted item was' : 'Showing the edited item'} on page ${pageNumber}.${restoredSuffix}`
          : `Showing page ${pageNumber} for this history item.${restoredSuffix}`);
      };
      window.setTimeout(() => trySpotlight(1), 250);
      return;
    }
    if (!isCurrentScope(scope)) return;
    setStatusMsg('This history item is not tied to a specific page.');
  }, [isCurrentScope, onNavigateToPage, onRestoreHistoryContext, spotlightAnnotation, spotlightHistoryPreview]);

  const handleRestoreActivity = useCallback(async (event) => {
    if (!event || typeof onRestoreHistoryActivity !== 'function' || busy) return;
    const scope = { ...scopeRef.current };
    setBusy(true);
    setStatusMsg(null);
    try {
      const result = await Promise.resolve(onRestoreHistoryActivity(event));
      if (!isCurrentScope(scope)) return;
      if (result?.ok) {
        // KAL-313 follow-up: name the restored subject for space entries.
        const spaceName = event.event_type === 'space_deleted'
          ? (event.payload?.spaceName ?? event.payload?.restoreAction?.spaceName)
          : null;
        setStatusMsg(event.event_type === 'space_deleted'
          ? `Restored space${spaceName ? ` "${spaceName}"` : ''}.`
          : `Restored deleted item${result.pageNumber ? ` on page ${result.pageNumber}` : ''}.`);
        await refresh({ silent: true });
      } else if (result?.reason === 'cascade-confirm') {
        // KAL-313 CONFIRM-CASCADE: the region's parent space is gone.
        // Decide whether we can offer a cascade restore or must show blocked UI.
        const { spaceId } = result;
        const cascade = resolveRegionRestoreCascade({
          spaceId,
          liveSpaces: [], // not available here — we use historyEvents to find the space record
          historyEvents,
        });
        if (cascade === 'cascade') {
          // Find the space_deleted event for the confirm dialog
          const spaceEvent = historyEvents.find(
            (ev) =>
              ev.event_type === 'space_deleted' &&
              ev.payload?.restoreAction?.spaceId === spaceId,
          );
          // Show the themed confirm modal instead of proceeding
          setCascadePending({ regionEvent: event, spaceEvent });
          setStatusMsg(null);
        } else {
          // 'blocked' — no space restore record available
          setStatusMsg("Cannot restore — its space was deleted and has no restore record.");
        }
      } else if (result?.reason === 'restore-noop') {
        setStatusMsg('Item is already present — no restore needed.');
      } else {
        setStatusMsg('Restore unavailable for this history item.');
      }
    } catch (e) {
      if (!isCurrentScope(scope)) return;
      setStatusMsg(`Restore failed: ${e.message}`);
    } finally {
      if (isCurrentScope(scope)) setBusy(false);
    }
  }, [busy, onRestoreHistoryActivity, refresh, historyEvents, isCurrentScope]);

  // KAL-313: Execute the confirmed cascade restore (space first, then region).
  const handleCascadeConfirm = useCallback(async () => {
    if (!cascadePending || typeof onCascadeRestoreRegion !== 'function') return;
    const scope = { ...scopeRef.current };
    const { regionEvent, spaceEvent } = cascadePending;
    setCascadePending(null);
    setBusy(true);
    setStatusMsg(null);
    try {
      const result = await Promise.resolve(onCascadeRestoreRegion(spaceEvent, regionEvent));
      if (!isCurrentScope(scope)) return;
      if (result?.ok) {
        setStatusMsg(`Restored space and region${result.pageNumber ? ` on page ${result.pageNumber}` : ''}.`);
        await refresh({ silent: true });
      } else {
        setStatusMsg('Cascade restore failed — please try again.');
      }
    } catch (e) {
      if (!isCurrentScope(scope)) return;
      setStatusMsg(`Cascade restore failed: ${e.message}`);
    } finally {
      if (isCurrentScope(scope)) setBusy(false);
    }
  }, [cascadePending, onCascadeRestoreRegion, refresh, isCurrentScope]);

  if (!documentId) return null;

  const timelineItems = useMemo(() => {
    const items = [
      ...revisions.map((rev) => ({
        id: `revision:${rev.id}`,
        kind: 'revision',
        at: rev.createdAt,
        _ms: new Date(rev.createdAt || 0).getTime(),
        revision: rev,
      })),
      ...historyEvents.map((event) => ({
        id: `event:${historyEventId(event)}`,
        kind: 'event',
        at: event.occurred_at || event.created_at,
        _ms: new Date(event.occurred_at || event.created_at || 0).getTime(),
        event,
      })),
    ];
    items.sort((a, b) => b._ms - a._ms);
    return items;
  }, [revisions, historyEvents]);

  const panel = (
    <div
      data-testid="kal48-revisions-panel"
      style={{
        position: embedded ? 'relative' : 'fixed',
        right: embedded ? 'auto' : 0,
        top: embedded ? 'auto' : 0,
        bottom: embedded ? 'auto' : 0,
        width: embedded ? '100%' : DRAWER_WIDTH,
        height: embedded ? '100%' : 'auto',
        background: embedded ? '#12151c' : '#1a1a1a',
        color: '#e9e6df',
        zIndex: embedded ? 'auto' : 9050,
        boxShadow: embedded ? 'none' : '-4px 0 16px rgba(0,0,0,0.5)',
        display: 'flex',
        flexDirection: 'column',
        borderLeft: embedded ? 0 : '1px solid #2a3140',
      }}
    >
      <div
        style={{
          padding: 14,
          borderBottom: '1px solid #2a3140',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <strong style={{ fontSize: 14 }}>Version history</strong>
        {!embedded && (
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              if (onClose) onClose();
            }}
            style={{
              background: 'transparent',
              color: '#8d96a6',
              border: '1px solid #3a4252',
              borderRadius: 4,
              padding: '2px 8px',
              cursor: 'pointer',
            }}
            aria-label="Close version history panel"
          >
            <Icon name="close" size={17} />
          </button>
        )}
      </div>

      <div className={mobileMode ? 'mobile-revisions-panel' : undefined} style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
        {historyStorageMessage(historyStorageStatus, !actorUserId) && (
          <div data-testid="document-history-storage-status" style={{ padding: 10, color: '#d8c28a', fontSize: 11 }}>
            {historyStorageMessage(historyStorageStatus, !actorUserId)}
          </div>
        )}
        {historyStorageStatus?.legacyUnscopedAvailable && (
          <div data-testid="document-history-legacy-notice" style={{ padding: 10, color: '#8d96a6', fontSize: 11 }}>
            Older local history stays on this device but is not shown in this history view.
          </div>
        )}
        {loading && <div style={{ padding: 10, fontSize: 12, color: '#8d96a6' }}>Loading…</div>}
        {err && <div style={{ padding: 10, color: '#ff8a8a', fontSize: 12 }}>Error: {err}</div>}
        {!loading && !err && timelineItems.length === 0 && (
          <div style={{ padding: 10, color: '#8d96a6', fontSize: 12 }}>
            No history yet. Edit the document or save a named version to start the timeline.
          </div>
        )}
        {timelineItems.map((item) => {
          if (item.kind === 'event') {
            const event = item.event;
            const eventId = historyEventId(event);
            const isSelected = selectedEventId === eventId;
            const isDeleted = isDeleteHistoryEvent(event);
            // KAL-313 / history F2 (2026-06-11): bulk-delete rows carry their
            // restore data in payload.objects (per-object restoreActions), not
            // payload.restoreAction — the viewer's restore dispatch already
            // handles them (isBulkAnnotationDeleteEvent branch). Offer Restore
            // for both shapes.
            const canRestoreDeleted = Boolean(onRestoreHistoryActivity) && Boolean(
              event.payload?.restoreAction
              || (event.event_type === 'annotations_bulk_deleted'
                && Array.isArray(event.payload?.objects)
                && event.payload.objects.length > 0),
            );
            return (
              <div
                key={item.id}
                data-testid={`document-history-event-${eventId}`}
                role="button"
                tabIndex={0}
                onClick={() => handleActivityClick(event)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleActivityClick(event);
                  }
                }}
                style={{
                  padding: 10,
                  marginBottom: 6,
                  borderRadius: 6,
                  border: isSelected ? '1px solid #6f8fcb' : '1px solid #1f2430',
                  background: isSelected ? '#243044' : '#202020',
                  cursor: 'pointer',
                  outline: 'none',
                  contentVisibility: 'auto',
                  containIntrinsicSize: '0 60px',
                }}
                title={event.page_number ? `Go to page ${event.page_number}` : 'History item'}
              >
                <div style={{ fontSize: 12, color: '#e0ddd6', lineHeight: 1.35 }}>
                  {event.summary}
                </div>
                <div style={{ fontSize: 11, color: '#8d96a6', marginTop: 5 }}>
                  {formatDate(event.occurred_at || event.created_at)}
                  {event.is_undoable ? ' · undoable edit' : ''}
                  {event.page_number ? ` · page ${event.page_number}` : ''}
                  {isDeleted ? ' · deleted' : ''}
                </div>
                {isDeleted && (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 10, color: canRestoreDeleted ? '#d8c28a' : '#9b8b8b' }}>
                      {canRestoreDeleted ? 'Restorable deleted item' : 'Restore unavailable'}
                    </span>
                    {canRestoreDeleted && (
                      <button
                        type="button"
                        data-testid={`document-history-restore-${eventId}`}
                        disabled={busy}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRestoreActivity(event);
                        }}
                        style={{
                          fontSize: 11,
                          background: '#3a3220',
                          color: '#ffe0a3',
                          border: '1px solid #6f5624',
                          borderRadius: 4,
                          padding: '3px 8px',
                          cursor: busy ? 'wait' : 'pointer',
                        }}
                      >
                        Restore
                      </button>
                    )}
                  </div>
                )}
                {isSelected && selectedEventDetail && (
                  <div
                    style={{
                      marginTop: 8,
                      paddingTop: 8,
                      borderTop: '1px solid rgba(255,255,255,0.08)',
                      fontSize: 11,
                      color: '#aeb8ca',
                      display: 'grid',
                      gap: 3,
                    }}
                  >
                    <div>
                      {isDeleted
                        ? 'Clicking shows where the deleted item was; Restore brings back this item only.'
                        : 'Clicking activity shows the current item or a stored visual preview, not a full-document snapshot.'}
                    </div>
                    {(() => {
                      // KAL-313 follow-up: label by event type — "Space: <name>" /
                      // "Region in <space>" — never "Annotation: <id>" for non-annotations.
                      const subjectLine = describeHistoryEventSubject(event);
                      return subjectLine ? <div>{subjectLine}</div> : null;
                    })()}
                  </div>
                )}
              </div>
            );
          }

          const rev = item.revision;
          const badge = originBadge(rev.origin);
          return (
            <div
              key={item.id}
              data-testid={`kal48-revision-row-${rev.revisionNumber}`}
              role="button"
              tabIndex={0}
              onClick={() => handleOpenReadOnly(rev)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleOpenReadOnly(rev);
                }
              }}
              style={{
                padding: 10,
                marginBottom: 6,
                borderRadius: 6,
                border: '1px solid #3c4b3c',
                background: '#222820',
                cursor: busy ? 'wait' : 'pointer',
                contentVisibility: 'auto',
                containIntrinsicSize: '0 60px',
              }}
              title={`Open version v${rev.revisionNumber} read-only`}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>v{rev.revisionNumber}</span>
                <span
                  style={{
                    fontSize: 10,
                    background: badge.color,
                    color: '#111',
                    padding: '1px 6px',
                    borderRadius: 3,
                    fontWeight: 600,
                  }}
                >
                  {badge.label}
                </span>
                {rev.label && <span style={{ fontSize: 12, color: '#e8e2d4' }}>{rev.label}</span>}
              </div>
              <div style={{ fontSize: 11, color: '#8d96a6', marginBottom: 6 }}>
                {formatDate(rev.createdAt)} · restore point · {rev.annotationCount} annotation(s)
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  data-testid={`kal48-open-v${rev.revisionNumber}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOpenReadOnly(rev);
                  }}
                  disabled={busy}
                  style={{
                    fontSize: 11,
                    background: '#181c24',
                    color: '#e9e6df',
                    border: '1px solid #3a4252',
                    borderRadius: 4,
                    padding: '3px 8px',
                    cursor: busy ? 'wait' : 'pointer',
                  }}
                >
                  Open read-only
                </button>
                {isOwner && (
                  <button
                    type="button"
                    data-testid={`kal48-restore-v${rev.revisionNumber}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRestore(rev);
                    }}
                    disabled={busy}
                    style={{
                      fontSize: 11,
                      background: '#3a2e2e',
                      color: '#ffdada',
                      border: '1px solid #6e3e3e',
                      borderRadius: 4,
                      padding: '3px 8px',
                      cursor: busy ? 'wait' : 'pointer',
                    }}
                  >
                    Restore
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ borderTop: '1px solid #2a3140', padding: 10 }}>
        {statusMsg && (
          <div data-testid="kal48-status" style={{ fontSize: 11, color: '#9ec', marginBottom: 6 }}>
            {statusMsg}
          </div>
        )}
        {isOwner && (
          <button
            type="button"
            data-testid="kal48-save-revision"
            onClick={handleSave}
            disabled={busy}
            style={{
              width: '100%',
              background: '#d8a84e',
              color: '#15110a',
              border: '1px solid #b6904a',
              borderRadius: 6,
              padding: '8px 12px',
              fontSize: 12,
              fontWeight: 600,
              cursor: busy ? 'wait' : 'pointer',
            }}
          >
            Save version
          </button>
        )}
        {!isOwner && (
          <div style={{ fontSize: 11, color: '#8d96a6' }}>
            Only the document owner can save or restore versions.
          </div>
        )}
      </div>
    </div>
  );

  // KAL-313 CONFIRM-CASCADE modal — shared across embedded and non-embedded renders.
  // Uses same backdrop/card styling as ConfirmDeleteModal (collab family, bg-secondary palette).
  const cascadeModal = cascadePending ? (
    <div
      data-testid="cascade-restore-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cascade-restore-heading"
      onClick={(e) => { if (e.target === e.currentTarget) setCascadePending(null); }}
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        zIndex: 9200,
        // UX (KAL-62): the app's one modal scrim — warm-dark dim plus an 8px
        // blur, so a cascade-restore confirm carries the same weight as every
        // other dialog rather than a flat black dim.
        background: 'rgba(13, 15, 20, 0.55)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        animation: 'confirm-delete-modal-fade-in 120ms cubic-bezier(0,0,0.2,1)',
      }}
    >
      <div
        style={{
          background: 'var(--bg-secondary, #12151c)',
          border: '1px solid var(--border-primary, #2a3140)',
          borderRadius: 8,
          boxShadow: 'var(--shadow-lg, 0 8px 24px rgba(0,0,0,0.5))',
          width: '100%',
          maxWidth: 480,
          margin: '0 16px',
          padding: 24,
          fontFamily: 'var(--font-primary, -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          color: '#e9e6df',
        }}
      >
        <h2
          id="cascade-restore-heading"
          style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#e9e6df' }}
        >
          Restore this region?
        </h2>
        <p style={{ margin: 0, fontSize: 14, color: '#c8c4bc', lineHeight: 1.5 }}>
          {"This region's space was deleted too. Restore both?"}
          {cascadePending.spaceEvent?.payload?.spaceName
            ? ` (Space: "${cascadePending.spaceEvent.payload.spaceName}")`
            : ''}
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button
            type="button"
            data-testid="cascade-restore-cancel"
            onClick={() => setCascadePending(null)}
            style={{
              fontSize: 13,
              background: 'transparent',
              color: '#c8c4bc',
              border: '1px solid #5a6473',
              borderRadius: 4,
              padding: '6px 14px',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="cascade-restore-confirm"
            onClick={handleCascadeConfirm}
            style={{
              fontSize: 13,
              background: '#3a3220',
              color: '#ffe0a3',
              border: '1px solid #6f5624',
              borderRadius: 4,
              padding: '6px 14px',
              cursor: 'pointer',
            }}
          >
            Restore both
          </button>
        </div>
      </div>
    </div>
  ) : null;

  // History F3 (2026-06-11): the "Viewing revision … / Return to current"
  // banner used to render only in the legacy drawer mode — the embedded
  // sidebar panel (the only mode actually mounted since the History tab moved
  // into PDFSidebar) opened revisions read-only with NO visible state banner
  // and NO way back besides hiding the panel. Render it in both modes.
  const viewingBanner = viewingRevision ? (
    <div
      data-testid="kal48-readonly-banner"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        background: '#5e4a1f',
        color: '#fff8dd',
        padding: '8px 16px',
        zIndex: 9100,
        fontSize: 12,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid #7e6630',
      }}
    >
      <span>
        Viewing revision v{viewingRevision.revisionNumber}
        {viewingRevision.label ? ` — ${viewingRevision.label}` : ''} · created {formatDate(viewingRevision.createdAt)} · {viewingRevision.snapshot?.annotations?.length ?? viewingRevision.annotationCount} annotation(s). Edits disabled.
      </span>
      <button
        type="button"
        data-testid="kal48-return-to-current"
        onClick={handleReturnToCurrent}
        style={{
          background: 'transparent',
          color: '#fff8dd',
          border: '1px solid #fff8dd',
          borderRadius: 4,
          padding: '3px 10px',
          cursor: 'pointer',
          fontSize: 12,
        }}
      >
        Return to current
      </button>
    </div>
  ) : null;

  if (embedded) return <>{panel}{viewingBanner}{cascadeModal}</>;

  return (
    <>
      {/* Launcher */}
      <button
        type="button"
        data-testid="kal48-revisions-launcher"
        onClick={() => setOpen((v) => !v)}
        style={{
          position: 'fixed',
          right: 14,
          bottom: 80,
          zIndex: 9000,
          background: '#181c24',
          color: '#e9e6df',
          border: '1px solid #3a4252',
          borderRadius: 8,
          padding: '8px 12px',
          fontSize: 12,
          cursor: 'pointer',
          boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        }}
        title="Document revisions (KAL-48)"
      >
        Revisions{revisions.length ? ` (${revisions.length})` : ''}
      </button>

      {/* Banner — visible while viewing a prior revision */}
      {viewingBanner}

      {/* Drawer */}
      {open && panel}
      {cascadeModal}
    </>
  );
}
