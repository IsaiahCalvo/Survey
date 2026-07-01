// src/components/collab/ReadOnlyGate.jsx
// Phase 28 — Read-only mode gate. Blocker 1 fix from Plan 28-06: the original
// plan put the read-only gating in App.jsx; this component moves it OUT of
// App.jsx so the 28-CONTEXT.md narrow waiver (single import + single provider
// wrap) is NOT exercised. App.jsx ends Phase 28 with only the existing Plan
// 27-05 <YDocProvider> mount line — zero diff.
//
// Source:
//   - .planning/phases/28-transport-spike-auth-validator/28-UI-SPEC.md
//     Component Inventory section 3 (visual treatment + keyboard suppression)
//   - .planning/phases/28-transport-spike-auth-validator/28-CONTEXT.md
//     Kicked-out collaborator UX decisions
//
// Mounted inside YDocProvider's render tree as a sibling of <StorageFailureBanner>
// and <ReSignInModal>. Reads accessRevoked from useYDoc(). Renders null — all side
// effects are window-level + body-attribute, so no DOM tree changes propagate
// through React.
//
// Effects when accessRevoked = true:
//   1. body[data-readonly="true"] is set — CSS in ReadOnlyGate.css dims the
//      existing toolbar via [data-readonly="true"] descendant selectors. App.jsx
//      and the toolbar component never learn about read-only mode.
//   2. window-capture-phase keydown listener installed — suppresses Cmd+Z /
//      Cmd+Shift+Z (undo / redo) and Delete / Backspace (annotation deletion)
//      while accessRevoked is true. Cmd+S explicitly passes through (preserves
//      commit 477fe90e UX patch — saving is not a mutation in read-only mode).
//   3. window dispatchEvent('phase28:readonly-activated') — App.jsx or the
//      PDFViewer MAY listen and clear activeTool, but Phase 28 doesn't require
//      the listener. The visual dim from (1) is the primary contract.
//
// Why a window-capture-phase listener (not a React keydown handler):
// the toolbar's existing keyboard handlers may be attached to specific DOM
// nodes inside <PageAnnotationLayer> (Always-Protected) or <SVGAnnotationLayer>
// (Always-Protected). A window-capture-phase listener intercepts events BEFORE
// they reach those handlers — preventDefault() + stopPropagation() suppresses
// the mutation without touching the protected components. Capture phase (third
// arg to addEventListener = true) ensures we run before bubble-phase handlers
// regardless of where they're attached.

import { useEffect } from 'react';
import { useYDoc } from '../../hooks/useYDoc.js';
import { resolveReadOnlyReason } from '../../lib/collab/documentRole.js';
import './ReadOnlyGate.css';

/**
 * Read-only mode gate. Mounted as a sibling of StorageFailureBanner inside
 * YDocProvider. Renders null — all effects are body-attribute + window
 * keydown listener.
 *
 * 2026-07-01 — generalized from the single accessRevoked trigger to a reason
 * resolved by resolveReadOnlyReason:
 *   - 'revoked' — Phase 28 kicked-out path (accessRevoked), unchanged.
 *   - 'viewer'  — the user's effective role on this document is 'viewer'
 *     (get_my_document_role RPC, resolved once per open in YDocProvider).
 * The presentation (dim + keystroke suppression) is identical for both; only
 * the banner copy differs (YDocProvider renders permission_revoked vs
 * viewer_access). 'revoked' wins when both are true.
 *
 * @returns {null}
 */
export function ReadOnlyGate() {
  const { accessRevoked, docRole } = useYDoc();
  const readOnlyReason = resolveReadOnlyReason({ accessRevoked, docRole });

  useEffect(() => {
    if (!readOnlyReason) {
      // UX: defensive cleanup. If a previous mount left body[data-readonly]
      // set (e.g. the read-only reason flipped truthy → null within the same
      // session), remove it now. Otherwise the toolbar would stay dimmed even
      // though the user is back to read-write.
      if (typeof document !== 'undefined') {
        document.body?.removeAttribute('data-readonly');
      }
      return undefined;
    }

    // 1. UX: set body[data-readonly] so the existing toolbar dims via the
    //    CSS rule shipped in ReadOnlyGate.css. Body-attribute approach reaches
    //    the toolbar from above without React state plumbing — App.jsx's
    //    render tree is unchanged.
    if (typeof document !== 'undefined') {
      document.body?.setAttribute('data-readonly', 'true');
    }

    // 2. UX: window-capture-phase keydown listener — suppresses mutation
    //    keystrokes while keeping read affordances (Cmd+S, page-nav, scroll,
    //    zoom keystrokes) fully functional.
    const onKeyDown = (e) => {
      // UX: Cmd+S MUST pass through. Commit 477fe90e is the load-bearing
      // Cmd+S UX patch for this project — saving (offline state, sync state)
      // is allowed for kicked-out users so they can preserve their place
      // before closing the document. Explicit pass-through, not implicit.
      if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
        return;
      }

      // UX: Cmd+Z / Cmd+Shift+Z (undo / redo) suppressed. The user can no
      // longer mutate state; rolling back a previous mutation would be a
      // mutation against the now-locked document.
      if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // UX: Delete / Backspace (annotation deletion) suppressed — but only
      // when the event target is NOT an editable input. The ReSignInModal
      // mounts as a sibling alongside this gate; users must be able to type
      // a password (Backspace) without our keydown handler swallowing it.
      // Same goes for any future text input that lives inside the read-only
      // shell (e.g. a dashboard search box).
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const t = e.target;
        const tag = t?.tagName?.toLowerCase?.();
        const isEditable =
          tag === 'input' ||
          tag === 'textarea' ||
          t?.isContentEditable === true;
        if (isEditable) return;
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // Future extension: drawing-tool keystrokes (P / E / L / etc.) could
      // be added to this list if those ever get wired at window level. Today
      // the canvas drawing tools attach handlers to canvas nodes themselves,
      // and pointer-events:none on the toolbar (CSS) already blocks tool
      // selection, so the keyboard list above covers the v2.4 mutation surface.
    };

    // Capture phase (third arg = true) so we run BEFORE bubble-phase handlers
    // attached anywhere in the descendant tree. This is how we suppress
    // mutations without editing the Always-Protected canvas/SVG components.
    window.addEventListener('keydown', onKeyDown, true);

    // 3. Best-effort active-tool clear via custom event. App.jsx or PDFViewer
    //    MAY listen for this event in a future phase to clear the active tool;
    //    Phase 28 does not require the listener — pointer-events:none on the
    //    toolbar already prevents the user from triggering a tool selection,
    //    so the event is purely a forward-looking convenience.
    try {
      window.dispatchEvent(new CustomEvent('phase28:readonly-activated'));
    } catch {
      // Older browsers without the CustomEvent constructor — swallow rather
      // than crashing the read-only entry path on a non-essential dispatch.
    }

    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      if (typeof document !== 'undefined') {
        document.body?.removeAttribute('data-readonly');
      }
    };
  }, [readOnlyReason]);

  return null;
}

export default ReadOnlyGate;
