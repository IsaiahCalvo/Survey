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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../supabaseClient';
import {
  createRevision,
  listRevisions,
  getRevision,
  restoreRevision,
} from '../../services/documentRevisionService';
import { listDocumentHistoryEvents } from '../../services/documentHistoryService';

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

export default function RevisionsPanel({
  documentId,
  user,
  embedded = false,
  onClose = null,
  onNavigateToPage = null,
  onRestoreHistoryActivity = null,
}) {
  const [open, setOpen] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [revisions, setRevisions] = useState([]);
  const [historyEvents, setHistoryEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [viewingRevision, setViewingRevision] = useState(null);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState(null);
  const [selectedEventId, setSelectedEventId] = useState(null);
  const [selectedEventDetail, setSelectedEventDetail] = useState(null);
  const hasLoadedRef = useRef(false);
  const refreshTimeoutRef = useRef(null);
  const spotlightFrameRef = useRef(null);
  const activeSpotlightRef = useRef(null);

  // Resolve ownership once per (documentId, user) — matches the open-coded
  // owner check in _kal48_can_access: project owner OR document creator.
  useEffect(() => {
    let cancelled = false;
    setIsOwner(false);
    if (!documentId || !user?.id) return;
    (async () => {
      const { data, error } = await supabase
        .from('documents')
        .select('user_id, project_id, projects!documents_project_id_fkey(user_id)')
        .eq('id', documentId)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setIsOwner(false);
        return;
      }
      const creatorOwner = data.user_id === user.id && !data.project_id;
      const projectOwner = data?.projects?.user_id === user.id;
      setIsOwner(Boolean(creatorOwner || projectOwner || data.user_id === user.id));
    })();
    return () => { cancelled = true; };
  }, [documentId, user?.id]);

  // Load list when drawer opens, when embedded in the left rail, or after a mutation.
  const refresh = useCallback(async (options = {}) => {
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
      const [rows, events] = await Promise.all([
        listRevisions(documentId),
        listDocumentHistoryEvents(documentId, { limit: 200 }),
      ]);
      setRevisions(rows);
      setHistoryEvents(events);
      hasLoadedRef.current = true;
    } catch (e) {
      setErr(e.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [documentId]);

  useEffect(() => {
    if (embedded || open) refresh({ silent: hasLoadedRef.current });
  }, [embedded, open, refresh]);

  useEffect(() => {
    if (!documentId || (!embedded && !open)) return undefined;
    const handleRecorded = (event) => {
      if (event?.detail?.documentId && event.detail.documentId !== documentId) return;
      const row = event?.detail?.row;
      if (row?.client_event_id) {
        setHistoryEvents((prev) => {
          const list = Array.isArray(prev) ? prev : [];
          return [
            row,
            ...list.filter((entry) => entry?.client_event_id !== row.client_event_id),
          ].sort((a, b) => new Date(b.occurred_at || b.created_at || 0) - new Date(a.occurred_at || a.created_at || 0));
        });
      }
      if (refreshTimeoutRef.current) window.clearTimeout(refreshTimeoutRef.current);
      refreshTimeoutRef.current = window.setTimeout(() => {
        refresh({ silent: true });
      }, 900);
    };
    window.addEventListener('document-history:event-recorded', handleRecorded);
    const intervalId = window.setInterval(() => refresh({ silent: true }), 10000);
    return () => {
      window.removeEventListener('document-history:event-recorded', handleRecorded);
      window.clearInterval(intervalId);
      if (refreshTimeoutRef.current) {
        window.clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
    };
  }, [documentId, embedded, open, refresh]);

  // body[data-readonly] mirroring — set when viewing a prior revision.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    if (viewingRevision) {
      document.body?.setAttribute('data-readonly', 'true');
      return () => document.body?.removeAttribute('data-readonly');
    }
    return undefined;
  }, [viewingRevision]);

  const handleSave = useCallback(async () => {
    if (!documentId || busy) return;
    const label = window.prompt('Label for this revision (optional):', '');
    if (label === null) return; // user cancelled
    setBusy(true);
    setStatusMsg(null);
    try {
      const row = await createRevision(documentId, { label: label || null });
      setStatusMsg(`Saved revision v${row.revision_number}.`);
      await refresh();
    } catch (e) {
      setStatusMsg(`Save failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }, [documentId, refresh, busy]);

  const handleOpenReadOnly = useCallback(async (rev) => {
    if (busy) return;
    setBusy(true);
    setStatusMsg(null);
    try {
      const full = await getRevision(rev.id);
      setViewingRevision({
        ...rev,
        snapshot: full?.snapshot_json || null,
      });
    } catch (e) {
      setStatusMsg(`Open failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const handleReturnToCurrent = useCallback(() => {
    setViewingRevision(null);
  }, []);

  const findPageElement = useCallback((pageNumber, fallback = null) => {
    if (typeof document === 'undefined') return fallback;
    if (fallback?.isConnected) return fallback;
    if (!Number.isFinite(pageNumber)) return fallback?.isConnected ? fallback : null;
    const selectors = [
      `.e-pv-page-div[data-page-number="${pageNumber}"]`,
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

  const resolveSpotlightHost = useCallback((pageElement) => {
    if (!pageElement) return null;
    const annotationSvg = pageElement.matches?.('svg[data-svg-annotation-layer]')
      ? pageElement
      : pageElement.querySelector?.('svg[data-svg-annotation-layer]');
    const hostElement = annotationSvg || pageElement;
    const hostRect = hostElement.getBoundingClientRect();
    const nativeViewBox = annotationSvg?.viewBox?.baseVal;
    const overlayParent = hostElement.parentElement || pageElement;
    return {
      hostElement,
      overlayParent,
      hostRect,
      viewBoxWidth: nativeViewBox?.width || hostRect.width,
      viewBoxHeight: nativeViewBox?.height || hostRect.height,
    };
  }, []);

  const syncSpotlightOverlay = useCallback((active) => {
    if (typeof document === 'undefined' || !active?.svg) return false;
    const pageElement = findPageElement(active.pageNumber, active.pageElement);
    if (!pageElement) return false;
    active.pageElement = pageElement;
    const host = resolveSpotlightHost(pageElement);
    if (!host?.hostElement?.isConnected || !host.overlayParent?.isConnected) return false;
    const { svg } = active;
    const { hostElement, overlayParent, hostRect, viewBoxWidth, viewBoxHeight } = host;
    if (svg.parentElement !== overlayParent) overlayParent.appendChild(svg);
    if (hostRect.width <= 0 || hostRect.height <= 0) {
      svg.style.display = 'none';
      return true;
    }
    const parentPosition = window.getComputedStyle(overlayParent).position;
    if (parentPosition === 'static') overlayParent.style.position = 'relative';
    svg.style.display = 'block';
    svg.setAttribute('width', hostElement.getAttribute('width') || `${hostRect.width}`);
    svg.setAttribute('height', hostElement.getAttribute('height') || `${hostRect.height}`);
    svg.setAttribute('viewBox', `0 0 ${viewBoxWidth} ${viewBoxHeight}`);
    svg.style.left = hostElement.style.left || `${hostElement.offsetLeft || 0}px`;
    svg.style.top = hostElement.style.top || `${hostElement.offsetTop || 0}px`;
    svg.style.width = hostElement.style.width || hostElement.getAttribute('width') || `${hostElement.offsetWidth || hostRect.width}px`;
    svg.style.height = hostElement.style.height || hostElement.getAttribute('height') || `${hostElement.offsetHeight || hostRect.height}px`;
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

  useEffect(() => {
    if (!embedded && !open) stopSpotlightTracking();
  }, [embedded, open, stopSpotlightTracking]);

  const createPageSpotlightSvg = useCallback((pageElement, pageNumber = null) => {
    if (typeof document === 'undefined' || !pageElement) return null;
    ensureSpotlightStyle();
    stopSpotlightTracking();
    const host = resolveSpotlightHost(pageElement);
    if (!host) return null;
    const { hostElement, overlayParent, hostRect, viewBoxWidth, viewBoxHeight } = host;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'document-history-spotlight-svg';
    svg.setAttribute('width', hostElement.getAttribute('width') || `${hostRect.width}`);
    svg.setAttribute('height', hostElement.getAttribute('height') || `${hostRect.height}`);
    svg.setAttribute('viewBox', `0 0 ${viewBoxWidth} ${viewBoxHeight}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    const parentPosition = window.getComputedStyle(overlayParent).position;
    if (parentPosition === 'static') overlayParent.style.position = 'relative';
    Object.assign(svg.style, {
      position: 'absolute',
      left: hostElement.style.left || `${hostElement.offsetLeft || 0}px`,
      top: hostElement.style.top || `${hostElement.offsetTop || 0}px`,
      width: hostElement.style.width || hostElement.getAttribute('width') || `${hostElement.offsetWidth || hostRect.width}px`,
      height: hostElement.style.height || hostElement.getAttribute('height') || `${hostElement.offsetHeight || hostRect.height}px`,
      overflow: 'visible',
      pointerEvents: 'none',
      zIndex: 9999,
    });
    overlayParent.appendChild(svg);
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
      node.setAttribute('stroke', '#4a90e2');
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

  const renderDomPathFallbackSpotlight = useCallback((target) => {
    if (typeof document === 'undefined' || !target) return false;
    const path = target.matches?.('path, line, polyline, polygon, rect, circle, ellipse')
      ? target
      : target.querySelector?.('path, line, polyline, polygon, rect, circle, ellipse');
    const pageElement = target.closest?.('.e-pv-page-div, [data-page-number], [id*="_pageDiv_"]');
    if (!path || !pageElement) return false;
    const clone = path.cloneNode(false);
    const svg = createPageSpotlightSvg(pageElement);
    if (!svg) return false;
    clone.removeAttribute('fill');
    clone.setAttribute('fill', 'none');
    clone.setAttribute('stroke', '#4a90e2');
    clone.setAttribute('stroke-opacity', '0.4');
    clone.setAttribute('stroke-width', `${Math.max(6, Number(path.getAttribute('stroke-width') || 2) + 4)}`);
    clone.setAttribute('stroke-linecap', 'round');
    clone.setAttribute('stroke-linejoin', 'round');
    clone.style.pointerEvents = 'none';
    clone.style.animation = 'document-history-pulse-glow 900ms ease-in-out infinite';
    svg.appendChild(clone);
    return true;
  }, [createPageSpotlightSvg]);

  const spotlightAnnotation = useCallback((annotationId) => {
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
    return renderDomPathFallbackSpotlight(target);
  }, [renderDomPathFallbackSpotlight]);

  const spotlightHistoryPreview = useCallback((pageNumber, event) => {
    if (typeof document === 'undefined' || !Number.isFinite(pageNumber)) return false;
    const pageSelectors = [
      `.e-pv-page-div[data-page-number="${pageNumber}"]`,
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
    const ok = window.confirm(
      `Restore v${rev.revisionNumber}? The current state will be saved as an auto revision first, then overwritten by this snapshot.`,
    );
    if (!ok) return;
    setBusy(true);
    setStatusMsg(null);
    try {
      const pre = await restoreRevision(rev.id);
      setStatusMsg(
        `Restored v${rev.revisionNumber}. Previous state saved as v${pre.revision_number}.`,
      );
      setViewingRevision(null);
      await refresh();
    } catch (e) {
      setStatusMsg(`Restore failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }, [busy, refresh]);

  const handleActivityClick = useCallback((event) => {
    if (!event) return;
    setSelectedEventId(event.client_event_id || event.id || null);
    setSelectedEventDetail(event);
    const pageNumber = Number(event.page_number ?? event.payload?.pageNumber);
    if (Number.isFinite(pageNumber) && pageNumber > 0 && typeof onNavigateToPage === 'function') {
      onNavigateToPage(pageNumber, { fallback: 'nearest', bypassActiveSpace: true });
      window.setTimeout(() => {
        const didSpotlight = spotlightHistoryPreview(pageNumber, event)
          || spotlightAnnotation(event.annotation_id || event.payload?.annotationId);
        setStatusMsg(didSpotlight
          ? `${isDeleteHistoryEvent(event) ? 'Showing where the deleted item was' : 'Showing the edited item'} on page ${pageNumber}.`
          : `Showing page ${pageNumber} for this history item.`);
      }, 250);
      return;
    }
    setStatusMsg('This history item is not tied to a specific page.');
  }, [onNavigateToPage, spotlightAnnotation, spotlightHistoryPreview]);

  const handleRestoreActivity = useCallback(async (event) => {
    if (!event || typeof onRestoreHistoryActivity !== 'function' || busy) return;
    setBusy(true);
    setStatusMsg(null);
    try {
      const result = onRestoreHistoryActivity(event);
      if (result?.ok) {
        setStatusMsg(`Restored deleted item${result.pageNumber ? ` on page ${result.pageNumber}` : ''}.`);
        await refresh({ silent: true });
      } else {
        setStatusMsg('Restore unavailable for this history item.');
      }
    } catch (e) {
      setStatusMsg(`Restore failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }, [busy, onRestoreHistoryActivity, refresh]);

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
        id: `event:${event.id}`,
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
        background: embedded ? '#252525' : '#1a1a1a',
        color: '#e9e6df',
        zIndex: embedded ? 'auto' : 9050,
        boxShadow: embedded ? 'none' : '-4px 0 16px rgba(0,0,0,0.5)',
        display: 'flex',
        flexDirection: 'column',
        borderLeft: embedded ? 0 : '1px solid #333',
      }}
    >
      <div
        style={{
          padding: 14,
          borderBottom: '1px solid #333',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <strong style={{ fontSize: 14 }}>Version History</strong>
        {!embedded && (
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              if (onClose) onClose();
            }}
            style={{
              background: 'transparent',
              color: '#bbb',
              border: '1px solid #444',
              borderRadius: 4,
              padding: '2px 8px',
              cursor: 'pointer',
            }}
            aria-label="Close version history panel"
          >
            ×
          </button>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
        {loading && <div style={{ padding: 10, fontSize: 12, color: '#999' }}>Loading…</div>}
        {err && <div style={{ padding: 10, color: '#ff8a8a', fontSize: 12 }}>Error: {err}</div>}
        {!loading && !err && timelineItems.length === 0 && (
          <div style={{ padding: 10, color: '#999', fontSize: 12 }}>
            No history yet. Edit the document or save a named version to start the timeline.
          </div>
        )}
        {timelineItems.map((item) => {
          if (item.kind === 'event') {
            const event = item.event;
            const isSelected = selectedEventId === (event.client_event_id || event.id);
            const isDeleted = isDeleteHistoryEvent(event);
            const canRestoreDeleted = Boolean(event.payload?.restoreAction && onRestoreHistoryActivity);
            return (
              <div
                key={item.id}
                data-testid={`document-history-event-${event.id}`}
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
                  border: isSelected ? '1px solid #6f8fcb' : '1px solid #303030',
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
                <div style={{ fontSize: 11, color: '#888', marginTop: 5 }}>
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
                        data-testid={`document-history-restore-${event.id}`}
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
                    {event.annotation_id && <div>Annotation: {event.annotation_id}</div>}
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
                {rev.label && <span style={{ fontSize: 12, color: '#cfcfcf' }}>{rev.label}</span>}
              </div>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>
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
                    background: '#2d2d2d',
                    color: '#e9e6df',
                    border: '1px solid #444',
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

      <div style={{ borderTop: '1px solid #333', padding: 10 }}>
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
              background: '#3c5a3c',
              color: '#e9f5e9',
              border: '1px solid #4e7e4e',
              borderRadius: 4,
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
          <div style={{ fontSize: 11, color: '#888' }}>
            Only the document owner can save or restore versions.
          </div>
        )}
      </div>
    </div>
  );

  if (embedded) return panel;

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
          background: '#2d2d2d',
          color: '#e9e6df',
          border: '1px solid #444',
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
      {viewingRevision && (
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
      )}

      {/* Drawer */}
      {open && panel}
    </>
  );
}
