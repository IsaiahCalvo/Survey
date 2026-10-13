// One drop zone for PDFs dragged in from the computer (see src/utils/fileDrop.js).
//
//   const { dropProps, overlay } = useFileDropZone({ enabled, resolveTarget, onDropFiles });
//   <div {...dropProps}>…</div>
//   <FileDropOverlay overlay={overlay} />
//
// resolveTarget(event) -> { key, kind, el, ...payload } | null — what a drop at
// this point would do, and which element to outline. onDropFiles(files, target)
// gets every dropped file (PDF or not); the caller splits and reports.
//
// Rules:
//  - Desktop only: in the phone layout (utils/layoutMode.js) the zone does nothing and
//    the stray-drop guard in main.jsx just refuses the file.
//  - Only drags that carry 'Files' count. Page thumbnails, dnd-kit rows and
//    other in-app drags never show the overlay.
//  - dragenter/dragleave are counted, so moving over child elements does not
//    flicker the overlay.
//  - An inner drop target that already claimed the drag (a survey note's photo
//    drop calls preventDefault on dragover) wins: the overlay steps aside.
//  - A drop or drag end anywhere, leaving the window, or a quiet watchdog
//    (no dragover for 2 s, e.g. Escape pressed) clears the overlay, so it can
//    never get stuck on.
import { useCallback, useEffect, useRef, useState } from 'react';
import { dropOverlayCopy, isFileDrag, isPhoneLayout, nextDragDepth } from '../utils/fileDrop.js';

const QUIET_RESET_MS = 2000;

const rectOf = (el) => {
  if (!el || typeof el.getBoundingClientRect !== 'function') return null;
  const r = el.getBoundingClientRect();
  return { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
};

const sameRect = (a, b) => (
  a === b
  || (a && b && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height)
);

export default function useFileDropZone({ enabled = true, resolveTarget, onDropFiles }) {
  const depthRef = useRef(0);
  const lastOverRef = useRef(0);
  const [state, setState] = useState(null); // null | { claimed } | { target, rect }
  const resolveRef = useRef(resolveTarget);
  const dropRef = useRef(onDropFiles);
  resolveRef.current = resolveTarget;
  dropRef.current = onDropFiles;

  const reset = useCallback(() => {
    depthRef.current = 0;
    setState(null);
  }, []);

  const active = state !== null;

  useEffect(() => {
    if (!enabled) reset();
  }, [enabled, reset]);

  useEffect(() => {
    if (!active || typeof window === 'undefined') return undefined;
    // Capture phase: an inner target that stops propagation on drop must
    // still end this zone's overlay.
    const end = () => reset();
    const onLeave = (event) => {
      if (event.relatedTarget) return;
      const { clientX: x, clientY: y } = event;
      if (x <= 0 || y <= 0 || x >= window.innerWidth || y >= window.innerHeight) reset();
    };
    const timer = window.setInterval(() => {
      if (Date.now() - lastOverRef.current > QUIET_RESET_MS) reset();
    }, 500);
    window.addEventListener('drop', end, true);
    window.addEventListener('dragend', end, true);
    window.addEventListener('dragleave', onLeave, true);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('drop', end, true);
      window.removeEventListener('dragend', end, true);
      window.removeEventListener('dragleave', onLeave, true);
    };
  }, [active, reset]);

  const refresh = useCallback((event) => {
    lastOverRef.current = Date.now();
    const claimed = Boolean(event.nativeEvent?.defaultPrevented ?? event.defaultPrevented);
    if (claimed) {
      setState((prev) => (prev?.claimed ? prev : { claimed: true }));
      return null;
    }
    event.preventDefault();
    const target = resolveRef.current?.(event) ?? null;
    const copy = dropOverlayCopy(target);
    try { event.dataTransfer.dropEffect = copy.accept ? 'copy' : 'none'; } catch { /* read-only */ }
    const rect = copy.accept ? rectOf(target?.el) : null;
    const key = target?.key ?? null;
    setState((prev) => (
      prev && !prev.claimed && (prev.target?.key ?? null) === key && sameRect(prev.rect, rect)
        ? prev
        : { target, rect }
    ));
    return target;
  }, []);

  const onDragEnter = useCallback((event) => {
    if (!enabled || !isFileDrag(event.dataTransfer) || isPhoneLayout()) return;
    depthRef.current = nextDragDepth(depthRef.current, 'dragenter');
    refresh(event);
  }, [enabled, refresh]);

  const onDragOver = useCallback((event) => {
    if (!enabled || !isFileDrag(event.dataTransfer) || isPhoneLayout()) return;
    if (depthRef.current === 0) depthRef.current = 1; // entered before enabling
    refresh(event);
  }, [enabled, refresh]);

  const onDragLeave = useCallback((event) => {
    if (!enabled || !isFileDrag(event.dataTransfer) || isPhoneLayout()) return;
    depthRef.current = nextDragDepth(depthRef.current, 'dragleave');
    if (depthRef.current === 0) reset();
  }, [enabled, reset]);

  const onDrop = useCallback((event) => {
    if (!enabled || !isFileDrag(event.dataTransfer) || isPhoneLayout()) return;
    if (event.nativeEvent?.defaultPrevented ?? event.defaultPrevented) { reset(); return; }
    event.preventDefault();
    const target = resolveRef.current?.(event) ?? null;
    reset();
    if (!dropOverlayCopy(target).accept) return;
    const files = Array.from(event.dataTransfer?.files || []);
    if (files.length) dropRef.current?.(files, target);
  }, [enabled, reset]);

  const overlay = state && !state.claimed
    ? { ...dropOverlayCopy(state.target), rect: state.rect, kind: state.target?.kind ?? null }
    : null;

  return {
    dropProps: enabled ? { onDragEnter, onDragOver, onDragLeave, onDrop } : {},
    overlay,
    hoveredKey: overlay ? (state.target?.key ?? null) : null,
  };
}
