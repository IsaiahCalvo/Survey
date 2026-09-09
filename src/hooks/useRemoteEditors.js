// src/hooks/useRemoteEditors.js
// Phase 29 — Read Yjs awareness state for remote editors of annotations.
//
// Source: .planning/phases/29-fabric-yjs-binding-per-user-undo/29-CONTEXT.md
//   "Awareness signal (minimal Phase 29 lane)" — the only awareness data Phase
//   29 consumes is "which annotation is each remote user currently editing".
//   Plan 29-05 publishes the LOCAL user's editingAnnotationId on FabricEditCanvas
//   mount via awareness.setLocalStateField. Plan 29-06's useRemoteEditors reads
//   OTHER users' editingAnnotationId.
//
// Graceful degradation contract:
//   Phase 28 SupabaseYjsProvider awareness wiring may be partial / absent on
//   any given doc mount. This hook returns an empty Map in that case rather
//   than throwing — CollaboratorOutlineOverlay then renders nothing. The
//   CrdtFeatureFlag kill-switch and the null-context branch in YDocProvider
//   both yield ydoc=null; this hook handles those cleanly.
//
// Why a hook (not a service / module-scoped subscriber):
//   React components want a re-render whenever awareness state changes. The
//   useState + awareness.on('change', ...) pattern delivers that without a
//   bespoke pub/sub layer. Plan 29-04's useAnnotationsCRDT uses the same
//   useSyncExternalStore-adjacent shape; this hook is intentionally similar
//   so consumers can compose them.

import { useState, useEffect } from 'react';
import { useYDoc } from './useYDoc.js';

/**
 * Read remote-editor awareness state.
 *
 * @returns {Map<string, { userId: string, colorSlot: number, name: string }>}
 *   Map keyed by annoId; one entry per remote user currently editing that anno.
 *   Returns an empty Map when:
 *     - no Y.Doc is mounted (kill-switch active OR no docId yet),
 *     - getAwareness() reports no awareness on the mounted transport,
 *     - no remote users are editing anything,
 *     - all editors are the local user (filtered out by clientID).
 */
export function useRemoteEditors() {
  const { ydoc, getAwareness, generationAwarenessScope } = useYDoc();
  // Initial state is a fresh empty Map per mount. Map identity changes on every
  // update so React's setState shallow compare always re-renders; that is OK
  // because the consumer (CollaboratorOutlineOverlay) memoizes the rect math.
  const [editors, setEditors] = useState(() => new Map());

  useEffect(() => {
    if (!ydoc && !generationAwarenessScope) {
      setEditors(new Map());
      return;
    }
    // KAL-274 — awareness comes exclusively through the typed getAwareness()
    // accessor on the YDoc context (the transport handle's y-protocols
    // Awareness instance). The old untyped globalThis.__crdtAwareness probe
    // had no writer anywhere and is gone. When no transport with awareness is
    // mounted, we degrade to an empty Map and the outline overlay renders
    // nothing.
    const awareness = (typeof getAwareness === 'function' ? getAwareness() : null) ?? null;
    if (!awareness) {
      setEditors(new Map());
      return;
    }

    const update = () => {
      const next = new Map();
      const states = awareness.getStates?.();
      if (!states) {
        setEditors(next);
        return;
      }
      // Walk all awareness states. Skip self by clientID — the local user's
      // own outline would be visually noisy and is explicitly excluded by
      // 29-UI-SPEC.md §2.
      for (const [clientId, state] of states.entries()) {
        if (clientId === awareness.clientID) continue;
        const editingId = state?.editingAnnotationId;
        if (!editingId) continue;
        next.set(editingId, {
          userId: state?.user?.id ?? `client-${clientId}`,
          colorSlot: state?.user?.colorSlot ?? 1,
          name: state?.user?.name ?? 'collaborator',
        });
      }
      setEditors(next);
    };

    // Compute initial state synchronously so the first render is correct.
    update();
    awareness.on?.('change', update);
    return () => {
      // Awareness providers expose `off` (yjs/awareness convention). Defensive
      // optional chaining guards against any test fake that doesn't implement it.
      awareness.off?.('change', update);
    };
  }, [ydoc, getAwareness, generationAwarenessScope]);

  return editors;
}
