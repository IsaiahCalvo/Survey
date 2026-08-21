// Local-interaction bindings for the remote-delete Restore? toast (P1-30 / P2-16).
// The deleted FabricEditCanvas publisher is gone. Union every live seam that
// still exists: the Phase-29 window object (e2e + any later publisher), the
// SVG selection id mirror, and selected SVG nodes (cursor:move).

const PHASE29_KEYS = ['selectedId', 'draggingId', 'scalingId', 'editCanvasId', 'contextMenuId'];

export function collectLocalInteractionIds(windowLike) {
  const ids = new Set();
  if (!windowLike) return ids;

  const state = windowLike.__phase29InteractionState;
  if (state && typeof state === 'object') {
    for (const key of PHASE29_KEYS) {
      const value = state[key];
      if (typeof value === 'string' && value) ids.add(value);
    }
  }

  const selected = windowLike.__selectedAnnotationIds;
  if (Array.isArray(selected)) {
    for (const id of selected) {
      if (typeof id === 'string' && id) ids.add(id);
    }
  }

  const nodes = windowLike.document?.querySelectorAll?.('svg [data-anno-id]');
  if (nodes) {
    for (const el of nodes) {
      if (el?.style?.cursor !== 'move') continue;
      const id = el.getAttribute?.('data-anno-id');
      if (id) ids.add(id);
    }
  }

  return ids;
}

export function isLocallyInteractingWith(annoId, windowLike) {
  if (!annoId) return false;
  return collectLocalInteractionIds(windowLike).has(annoId);
}
