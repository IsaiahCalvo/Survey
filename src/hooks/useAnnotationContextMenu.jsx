// useAnnotationContextMenu — the annotation right-click / second-tap menu.
//
// Extracted verbatim from PDFViewer.jsx (the viewer break-up, phase 2). This
// owns the menu's STATE and LIFECYCLE only:
//   - the annotationContextMenu state cell
//   - the always-on global registration effect (window.__onAnnotationContextMenu,
//     invoked by src/utils/contextMenuDiagnostics.js)
//   - the outside-click / Escape dismiss effect
//
// The menu's render builder is the separate renderAnnotationContextMenu()
// function below. It is a pure view that depends on the viewer's action
// handlers (save / reorder / clipboard / callout cut-copy-paste), so it stays
// parameterized: PDFViewer calls it in its JSX return and passes those
// collaborators in at that point (where they are all defined), which keeps the
// hook itself free of the component's handler graph.
//
// Behavior is identical to the previous inline implementation — this is a pure
// relocation. openAnnotationContextMenu / closeAnnotationContextMenu are
// useCallback-stable so the external callers that omit the setter from their
// dependency arrays keep their referential identity.

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { appDebug } from '../viewerShared.js';
import { deepClone } from '../utils/deepClone.js';
import {
  clampFloatingMenuPosition,
  DESKTOP_RIGHT_RAIL_WIDTH,
  getPageViewportBounds,
} from '../utils/floatingUiGeometry.js';
// Locked permissions model 2026-07-17 — the shape Delete items route through
// PDFViewer's bulk-delete planner (confirm modal for cross-author deletes)
// and the Cut items are restricted to marks the viewer authored (or owner
// mode). Same single source of truth as click hit-test / marquee / planner.
import { canDelete, canModify } from '../lib/collab/permissionScope.js';

export function useAnnotationContextMenu() {
  // UX: annotation right-click menu — anchored to the pointer.
  // { x, y, pageNumber, annotationIndex, calloutId, kind, groupIndices }.
  const [annotationContextMenu, setAnnotationContextMenu] = useState(null);

  const openAnnotationContextMenu = useCallback((descriptor) => {
    // KAL-75 (G4): the annotation context menu is an EDIT menu (Cut / Paste /
    // Delete / z-order call the save path directly) — suppress it entirely on
    // locked/read-only documents. Keyboard Cmd+C still covers copy.
    if (document.body.getAttribute('data-readonly') === 'true') return;
    setAnnotationContextMenu(descriptor);
  }, []);

  const closeAnnotationContextMenu = useCallback(() => {
    setAnnotationContextMenu(null);
  }, []);

  // Register the global annotation right-click handler. contextMenuDiagnostics.js
  // resolves (pageNumber, annotationIndex) from the click target and invokes this
  // — one listener, always on, covers every page without needing PAL to be mounted.
  useEffect(() => {
    window.__onAnnotationContextMenu = ({ pageNumber, annotationIndex, calloutId, kind, groupIndices, event }) => {
      // KAL-75 (G4): locked/read-only documents — this menu's items (Cut /
      // Paste / Delete / z-order) call the save path directly; suppress at
      // THIS entry too (the route from contextMenuDiagnostics lands here,
      // not on openAnnotationContextMenu).
      if (document.body.getAttribute('data-readonly') === 'true') return;
      // Opt-in diagnostic hook for right-click menu routing.
      const snapshot = {
        page: pageNumber,
        kind,
        annoIdx: annotationIndex,
        calloutId,
        groupCount: Array.isArray(groupIndices) ? groupIndices.length : 0,
        clientX: event?.clientX,
        clientY: event?.clientY
      };
      const line = `[CTXDIAG menu-open] ${JSON.stringify(snapshot)}`;
      appDebug(line);
      try {
        if (typeof window !== 'undefined' && typeof window.__ctxDiagMenuOpenWatcher === 'function') {
          window.__ctxDiagMenuOpenWatcher(snapshot);
        }
      } catch { /* ignore */ }
      setAnnotationContextMenu({
        x: event.clientX,
        y: event.clientY,
        pageNumber,
        annotationIndex,
        calloutId,
        kind, // 'page' | 'callout' | 'counter' | 'annotation' | 'group'
        // UX: Phase 19 follow-up — when kind === 'group', this holds the
        // array of selected annotation indices so batch handlers (cut,
        // copy, delete, z-order) can iterate them in one go.
        groupIndices: Array.isArray(groupIndices) ? groupIndices.slice() : null,
      });
    };
    return () => {
      if (window.__onAnnotationContextMenu) delete window.__onAnnotationContextMenu;
    };
  }, []);

  // Dismiss the annotation context menu on outside click or Escape.
  // UX: capture phase + data-annotation-context-menu marker check. Capture
  // fires BEFORE any descendant's stopPropagation (e.g. Pdfjs's own
  // click handlers on its text/annotation layers), which is why the earlier
  // bubble-phase listener silently dropped clicks on Pdfjs surfaces.
  // Marker check replaces the menu-div's own onMouseDown stopPropagation
  // so the logic lives in one place: "is the click target inside the menu?"
  useEffect(() => {
    if (!annotationContextMenu) return undefined;
    const close = (e) => {
      if (e?.target?.closest && e.target.closest('[data-annotation-context-menu]')) return;
      setAnnotationContextMenu(null);
    };
    const onKey = (e) => { if (e.key === 'Escape') setAnnotationContextMenu(null); };
    // Delay attaching so the opening right-click's own mousedown doesn't
    // instantly re-close the menu.
    const t = window.setTimeout(() => {
      window.addEventListener('mousedown', close, true);
      window.addEventListener('keydown', onKey);
    }, 0);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('mousedown', close, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [annotationContextMenu]);

  return { annotationContextMenu, openAnnotationContextMenu, closeAnnotationContextMenu };
}

// renderAnnotationContextMenu — the createPortal render builder for the menu.
// Called from PDFViewer's JSX return with the current menu state, the stable
// closeAnnotationContextMenu callback, and an `actions` bundle of the viewer
// collaborators the menu items invoke. Destructures the bundle at the top so
// the body below is a verbatim copy of the previous inline implementation.
export function renderAnnotationContextMenu(annotationContextMenu, closeAnnotationContextMenu, actions) {
  if (!annotationContextMenu) return null;
  const {
    pasteAnnotationAt,
    pdfjsViewerRef,
    selectedNativeTextMarkupRef,
    setHasUnsavedAnnotations,
    onUnsavedAnnotationsChange,
    tabId,
    handleCutCallout,
    handleCopyCallout,
    handlePasteCallout,
    annotationsByPageRef,
    setClipboardAnnotation,
    handleSaveAnnotations,
    setPendingSvgSelection,
    clipboardAnnotation,
    handleReorderAnnotation,
    // UX: one logical clipboard — the shape Cut/Copy items call this to clear
    // the callout clipboard so the most recent Copy/Cut always wins at paste
    // time (mirrors handleCopyCallout clearing the shape clipboard).
    clearCalloutClipboard = () => {},
    // UX: the callout clipboard value, so every menu's Paste item can paste
    // whichever clipboard is populated (shape OR callout) at the right-click
    // point — one paste rule everywhere.
    clipboardCallout = null,
    // UX: mobile parity (Phase D) — when true, the menu is re-skinned to the
    // demo's touch context-menu chrome (154/176px panel, radius 9, #181B20 /
    // #3C424D, 34px action rows, near-invisible dismiss scrim). Desktop
    // (mobileMode falsy) keeps its exact prior styling — demo ref
    // mobile-expo-go/src/styles.ts:856-902.
    mobileMode = false,
    // Locked permissions model 2026-07-17 — bulk-delete planner bridge
    // (PDFViewer's requestBulkDeleteRef). When provided, the shape Delete
    // items route through it so cross-author deletes ALWAYS get the
    // collaborator-cross-author confirm modal (parity with keyboard Delete /
    // useSVGInteraction.deleteSelected). Optional: legacy mounts without it
    // fall back to the direct splice for the viewer's OWN marks only.
    requestBulkDelete = null,
    // Ownership inputs for the delete/cut partition below. Optional — when
    // either is missing (boot window) the legacy permissive behavior applies.
    viewerId = null,
    documentOwnerId = null,
  } = actions;

  // Own-mark check (author or document owner; boot window is permissive to
  // match canSelectAnnotationByIndex / deleteSelected in useSVGInteraction).
  const canModifyObj = (obj) => {
    if (!obj) return false;
    if (!viewerId || !documentOwnerId) return true;
    return canModify({ annotation: obj, viewerId, documentOwnerId });
  };
  // Foreign-mark deletability: only through the planner's confirm modal, and
  // only when the object carries the stable id the planner is keyed by.
  const canPlanForeignDelete = (obj) => {
    if (!obj || typeof requestBulkDelete !== 'function') return false;
    if (!viewerId || !documentOwnerId) return false;
    if (obj.id == null) return false;
    return canDelete({ annotation: obj, viewerId, documentOwnerId });
  };

  return createPortal((() => {
    const ctx = annotationContextMenu;
    const logStub = (key) => console.log(`[AnnotCtxMenu] ${key} kind=${ctx.kind} page=${ctx.pageNumber} annoIdx=${ctx.annotationIndex} calloutId=${ctx.calloutId}`);
    // Menu item builder. action = wired callback; omit to log a stub.
    // UX: `enabled` (default true) controls the grayed-out / click-blocked
    // state for items like Paste-when-clipboard-empty. Disabled items still
    // render (so users can see the option exists) but clicks are ignored
    // and styling is muted to match Acrobat / Bluebeam / Figma behavior.
    const item = (label, key, action, enabled = true) => ({
      label, key,
      disabled: !enabled,
      onClick: enabled
        ? () => {
            if (action) action(); else logStub(key);
            closeAnnotationContextMenu();
          }
        : undefined,
    });
    // UX: each separator must have a unique key. Previous `const SEP =
    // {..., key: sep-<rand>}` reused the same object across multiple slots
    // in the items array, which made React warn about duplicate children
    // keys. Factory ensures a fresh key per separator.
    let _sepCounter = 0;
    const sep = () => ({ separator: true, key: `sep-${_sepCounter++}` });

    // UX: right-click Paste just delegates to pasteAnnotationAt (declared
    // at top-level alongside handlePasteCallout so Cmd+V can share it).
    // Keeps this render closure small.
    const doPasteAnnotation = () => pasteAnnotationAt(ctx.pageNumber, ctx.x, ctx.y);
    // UX: one paste rule for every menu — paste whichever clipboard is
    // populated (only one ever is; Copy/Cut clears the other) at the
    // right-click point. Shapes center at the point via pasteAnnotationAt;
    // callouts center their text box there via handlePasteCallout's
    // cursor-anchored mode.
    const doPasteAny = () => {
      if (clipboardAnnotation) {
        doPasteAnnotation();
      } else if (clipboardCallout) {
        handlePasteCallout(ctx.pageNumber, { clientX: ctx.x, clientY: ctx.y });
      }
    };
    const hasAnyClipboard = Boolean(clipboardAnnotation || clipboardCallout);

    let items;
    if (ctx.kind === 'textMarkup') {
      items = [
        item('Delete', 'delete', () => {
          const deleted = pdfjsViewerRef.current?.deleteSelectedTextMarkupAnnotation?.();
          if (!deleted) return;
          selectedNativeTextMarkupRef.current = null;
          setHasUnsavedAnnotations(true);
          if (onUnsavedAnnotationsChange) {
            onUnsavedAnnotationsChange(true, tabId);
          }
        }),
      ];
    } else if (ctx.kind === 'callout') {
      // UX: 2026-04-21 — Group / Ungroup items intentionally omitted
      // from the right-click menu. The feature is hidden app-wide until
      // the matrix-per-shape rewrite ships. Handlers above
      // (handleGroupSelected / handleUngroupSelected) stay intact.
      //
      // UX: 2026-07-17 — callout menu parity with the shape menu, audited
      // item by item. Cut / Copy / Paste / Delete are 1:1 with the shape
      // menu (same clipboard rules, same paste-at-point rule, same gated
      // delete). The four z-order items (Bring to front / Bring forward /
      // Send backward / Send to back) are DELIBERATELY EXCLUDED, not
      // missing:
      //   - Cross-type z-order is meaningless by design: callouts render in
      //     their own SVG loop ABOVE all shapes (SVGAnnotationLayer's
      //     dedicated filteredCallouts renderer — a deliberate, tested
      //     layering), so no reorder could ever move a callout below a shape.
      //   - Callout-vs-callout order is fixed too: deriveCalloutsFromByPage
      //     sorts each page's callouts by id (localeCompare) for
      //     deterministic derive/fingerprint round-trips, so the shapes'
      //     handleReorderAnnotation machinery (which permutes
      //     page.objects indices) has zero rendered effect on callouts —
      //     any reorder would be visually dead AND silently reverted by the
      //     next derive. Making it real requires a persisted z-field or the
      //     callout render-loop unification (the dedicated callout-migration
      //     project), not a menu item.
      // Rendering dead/no-op items is worse than omitting them — the menu
      // shows only what actually works on a callout.
      //
      // Resolve the right-clicked callout's projected group object
      // (data.type === 'callout', id at data.id) so the Cut item can run the
      // SAME own-marks-only gate as the shape menu's Cut (locked model
      // 2026-07-17: Cut = Copy + immediate delete with no confirmation
      // surface, so it must never touch a foreign-author mark; to remove
      // another user's callout: Copy + Delete — Delete confirms via the
      // cross-author modal).
      const findCalloutObj = () => {
        const page = annotationsByPageRef.current?.[ctx.pageNumber];
        if (!page?.objects || !ctx.calloutId) return null;
        return page.objects.find(
          (o) => o?.data?.type === 'callout' && o?.data?.id === ctx.calloutId
        ) || null;
      };
      items = [
        item('Cut', 'cut', () => {
          if (!ctx.calloutId) return;
          const obj = findCalloutObj();
          // Own-mark gate (boot window permissive inside canModifyObj —
          // matches the shape Cut item). A callout that can't be resolved
          // from the page projection is a no-op rather than an ungated cut.
          if (!obj || !canModifyObj(obj)) return;
          handleCutCallout(ctx.calloutId);
        }),
        item('Copy', 'copy', () => ctx.calloutId && handleCopyCallout(ctx.calloutId)),
        // UX: paste lands at the right-click point (same cursor-anchored rule
        // as Cmd+V and the shape menu's doPasteAnnotation). ctx.x/y are the
        // right-click's client coords. doPasteAny covers both clipboards.
        item('Paste', 'paste', doPasteAny, hasAnyClipboard),
        // UX: right-click Delete = the SAME gated delete as pressing Delete/
        // Backspace with the callout selected — PDFViewer's
        // handleDeleteSelectedCallouts (canModify ownership check, undo
        // checkpoint, trash history). SVGAnnotationLayer publishes that
        // callback on window.__onDeleteSelectedCallouts (same global-
        // registration pattern as window.__onAnnotationContextMenu above),
        // so the menu never bypasses the ownership gate.
        item('Delete', 'delete', () => {
          if (ctx.calloutId && typeof window.__onDeleteSelectedCallouts === 'function') {
            window.__onDeleteSelectedCallouts([ctx.calloutId]);
          }
        }),
      ];
    } else if (ctx.kind === 'counter') {
      items = [
        item('Continue pin', 'continuePin'),
      ];
    } else if (ctx.kind === 'annotation') {
      items = [
        // UX: Cut = Copy + Delete. Stashes a deep clone of the shape on
        // the clipboard with mode='cut' (so doPasteAnnotation clears the
        // clipboard after the first paste, matching Acrobat/Figma), then
        // splices the original out of the page. Clears selection after
        // the splice the same way right-click Delete does — the index
        // slot now points at a different shape, so keeping it selected
        // would be confusing. If the page or index isn't resolvable this
        // falls through as a no-op rather than corrupting state.
        item('Cut', 'cut', () => {
          const page = annotationsByPageRef.current?.[ctx.pageNumber];
          if (!page?.objects || ctx.annotationIndex == null) return;
          if (ctx.annotationIndex < 0 || ctx.annotationIndex >= page.objects.length) return;
          const obj = page.objects[ctx.annotationIndex];
          if (!obj) return;
          // Locked model 2026-07-17: Cut = Copy + immediate delete with no
          // confirmation surface, so it stays OWN-marks-only (cross-author
          // deletes must always confirm via the modal). To remove another
          // user's shape: Copy + Delete (Delete routes through the modal).
          if (!canModifyObj(obj)) return;
          setClipboardAnnotation({
            object: deepClone(obj),
            sourcePageNumber: ctx.pageNumber,
            mode: 'cut',
          });
          clearCalloutClipboard();
          const next = deepClone(page);
          next.objects.splice(ctx.annotationIndex, 1);
          handleSaveAnnotations(ctx.pageNumber, next, {
            source: 'object:modified',
            action: 'cut',
            checkpointPolicy: 'normal',
          });
          setPendingSvgSelection({
            pageNumber: ctx.pageNumber,
            annotationIndex: null,
            tick: Date.now(),
          });
        }),
        // UX: Copy stashes the targeted shape's Fabric JSON + source page
        // on the clipboardAnnotation state (see ~line 11058). No visual
        // change — Paste is where the user sees the result. Matches the
        // callout clipboard pattern at ~line 11097.
        item('Copy', 'copy', () => {
          const page = annotationsByPageRef.current?.[ctx.pageNumber];
          const obj = page?.objects?.[ctx.annotationIndex];
          if (!obj) return;
          setClipboardAnnotation({
            object: deepClone(obj),
            sourcePageNumber: ctx.pageNumber,
            mode: 'copy',
          });
          clearCalloutClipboard();
        }),
        // UX: Paste drops a clone of the clipboardAnnotation onto the
        // right-clicked page. See doPasteAnnotation() above for the full
        // behavior + live diagnostic dump. Grayed out when the clipboard
        // is empty — matches Acrobat, Drawboard PDF, Bluebeam, Figma.
        item('Paste', 'paste', doPasteAny, hasAnyClipboard),
        // UX: right-click Delete mirrors the keyboard Delete/Backspace path.
        // Locked model 2026-07-17: when PDFViewer provides the bulk-delete
        // planner bridge, the delete routes through it — cross-author deletes
        // ALWAYS confirm via the collaborator-cross-author modal, own deletes
        // follow the planner's existing modes (owner-own-only direct-fires) —
        // exactly like pressing Delete with the shape selected. The splice
        // itself is unchanged and runs as the planner's runDelete. Legacy
        // fallback (no planner, or id-less object): direct splice for OWN
        // marks only; foreign marks are never direct-fired.
        // After the save, broadcast a "clear selection on this page" command
        // via pendingSvgSelection (annotationIndex: null) so the selection
        // doesn't stick to the shape that slides into the deleted index
        // slot after the splice — the user expects everything dismissed.
        item('Delete', 'delete', () => {
          const page = annotationsByPageRef.current?.[ctx.pageNumber];
          if (!page?.objects || ctx.annotationIndex == null) return;
          if (ctx.annotationIndex < 0 || ctx.annotationIndex >= page.objects.length) return;
          const obj = page.objects[ctx.annotationIndex];
          if (!obj) return;
          const own = canModifyObj(obj);
          if (!own && !canPlanForeignDelete(obj)) return;
          const runDelete = () => {
            const next = deepClone(page);
            next.objects.splice(ctx.annotationIndex, 1);
            handleSaveAnnotations(ctx.pageNumber, next, {
              source: 'object:modified',
              action: 'delete',
              checkpointPolicy: 'normal',
            });
            setPendingSvgSelection({
              pageNumber: ctx.pageNumber,
              annotationIndex: null,
              tick: Date.now(),
            });
          };
          if (typeof requestBulkDelete === 'function' && obj.id != null) {
            requestBulkDelete({
              candidateIds: [obj.id],
              snapshotObjects: [deepClone(obj)],
              pageNumber: ctx.pageNumber,
              runDelete,
            });
            return;
          }
          // Own-only fallback (planner absent or id-less own mark) — the
          // guard above already rejected foreign marks on this path.
          runDelete();
        }),
        sep(),
        // UX: z-order — mirrors Illustrator/Figma/Photoshop placement
        // (flat block after Delete, above Group). Handler resolves each
        // direction ('forward' / 'backward' / 'front' / 'back') with a
        // Figma-style overlap-aware target so each press lands the shape
        // past the next spatially-overlapping neighbor. Re-broadcasts
        // the selection at the new slot so the shape
        // stays visibly selected after reorder. Hotkey parity lives in
        // SVGAnnotationLayer's keydown useEffect:
        //   Cmd+Shift+]  → Bring to Front
        //   Cmd+]        → Bring Forward
        //   Cmd+[        → Send Backward
        //   Cmd+Shift+[  → Send to Back
        item('Bring to front', 'bringToFront', () => {
          handleReorderAnnotation(ctx.pageNumber, ctx.annotationIndex, 'front');
        }),
        item('Bring forward', 'bringForward', () => {
          if (ctx.annotationIndex == null) return;
          handleReorderAnnotation(ctx.pageNumber, ctx.annotationIndex, 'forward');
        }),
        item('Send backward', 'sendBackward', () => {
          if (ctx.annotationIndex == null) return;
          handleReorderAnnotation(ctx.pageNumber, ctx.annotationIndex, 'backward');
        }),
        item('Send to back', 'sendToBack', () => {
          handleReorderAnnotation(ctx.pageNumber, ctx.annotationIndex, 'back');
        }),
        // UX: 2026-04-21 — Group / Ungroup items intentionally omitted
        // from the right-click menu. The feature is hidden app-wide
        // until the matrix-per-shape rewrite ships.
      ];
    } else if (ctx.kind === 'group' && Array.isArray(ctx.groupIndices) && ctx.groupIndices.length >= 2) {
      // UX: Phase 19 follow-up — right-click inside the outer dashed
      // box of a multi-selection. Cut/Copy/Paste/Delete and the four
      // z-order items each operate on every selected annotation at
      // once, sorted descending so splicing doesn't shift indices
      // mid-loop. Group / Ungroup stay visual-only until the user
      // gives the go-ahead to wire them (deferred alongside Shift-
      // add and Alt-subtract parity).
      const sortedDesc = [...ctx.groupIndices].sort((a, b) => b - a);
      const sortedAsc = [...ctx.groupIndices].sort((a, b) => a - b);

      // indicesAsc parameter (default: the whole selection) lets Cut collect
      // only the viewer's own members — see the Cut item below.
      const copyAll = (indicesAsc = sortedAsc) => {
        const page = annotationsByPageRef.current?.[ctx.pageNumber];
        if (!page?.objects) return null;
        const collected = [];
        let minLeft = Infinity, minTop = Infinity;
        for (const idx of indicesAsc) {
          const obj = page.objects[idx];
          if (!obj) continue;
          collected.push(deepClone(obj));
          const l = typeof obj.left === 'number' ? obj.left : 0;
          const t = typeof obj.top === 'number' ? obj.top : 0;
          if (l < minLeft) minLeft = l;
          if (t < minTop) minTop = t;
        }
        if (collected.length === 0) return null;
        return {
          objects: collected,
          bbox: {
            left: Number.isFinite(minLeft) ? minLeft : 0,
            top: Number.isFinite(minTop) ? minTop : 0,
          },
          sourcePageNumber: ctx.pageNumber,
        };
      };

      // A group z-order command is one atomic permutation. Calling the
      // single-object reorder callback repeatedly reads changing indices from
      // the live ref and can move a neighbor instead of the selected object.
      // Keep relative order within the selection and commit only once.
      const reorderAll = (direction) => {
        const page = annotationsByPageRef.current?.[ctx.pageNumber];
        if (!page?.objects?.length) return;
        const selected = new Set(sortedAsc);
        let entries = page.objects.map((object, index) => ({ object, selected: selected.has(index) }));
        if (direction === 'front' || direction === 'back') {
          const picked = entries.filter((entry) => entry.selected);
          const rest = entries.filter((entry) => !entry.selected);
          entries = direction === 'front' ? [...rest, ...picked] : [...picked, ...rest];
        } else if (direction === 'forward') {
          for (let index = entries.length - 2; index >= 0; index -= 1) {
            if (entries[index].selected && !entries[index + 1].selected) {
              [entries[index], entries[index + 1]] = [entries[index + 1], entries[index]];
            }
          }
        } else if (direction === 'backward') {
          for (let index = 1; index < entries.length; index += 1) {
            if (entries[index].selected && !entries[index - 1].selected) {
              [entries[index], entries[index - 1]] = [entries[index - 1], entries[index]];
            }
          }
        }
        const next = deepClone(page);
        next.objects = entries.map((entry) => deepClone(entry.object));
        handleSaveAnnotations(ctx.pageNumber, next, {
          source: 'object:modified',
          action: 'reorder-group',
          checkpointPolicy: 'normal',
        });
        setPendingSvgSelection({
          pageNumber: ctx.pageNumber,
          annotationIndices: entries.reduce((indices, entry, index) => (
            entry.selected ? [...indices, index] : indices
          ), []),
          tick: Date.now(),
        });
      };

      items = [
        item('Cut', 'cut', () => {
          const page = annotationsByPageRef.current?.[ctx.pageNumber];
          if (!page?.objects) return;
          // Locked model 2026-07-17: Cut deletes with no confirmation
          // surface, so it operates on the viewer's OWN members only —
          // foreign-author members stay on the page untouched (cross-author
          // deletes must always confirm via the Delete item's modal path).
          // Clipboard matches the splice exactly (own members only) so
          // Paste never duplicates a shape that was left on the page.
          const ownAsc = sortedAsc.filter((idx) => canModifyObj(page.objects[idx]));
          if (ownAsc.length === 0) return;
          const copy = copyAll(ownAsc);
          if (!copy) return;
          setClipboardAnnotation({ ...copy, mode: 'cut' });
          clearCalloutClipboard();
          const next = deepClone(page);
          for (const idx of [...ownAsc].reverse()) {
            if (idx >= 0 && idx < next.objects.length) next.objects.splice(idx, 1);
          }
          handleSaveAnnotations(ctx.pageNumber, next, {
            source: 'object:modified',
            action: 'cut',
            checkpointPolicy: 'normal',
          });
          setPendingSvgSelection({
            pageNumber: ctx.pageNumber,
            annotationIndex: null,
            tick: Date.now(),
          });
        }),
        item('Copy', 'copy', () => {
          const copy = copyAll();
          if (!copy) return;
          setClipboardAnnotation({ ...copy, mode: 'copy' });
          clearCalloutClipboard();
        }),
        item('Paste', 'paste', doPasteAny, hasAnyClipboard),
        // Locked model 2026-07-17: multi-select Delete routes through the
        // bulk-delete planner (parity with keyboard Delete on the same
        // selection) — cross-author members ALWAYS confirm via the modal.
        // Deletable set = own members + foreign members that can be planned
        // (planner present + stable id); anything else stays on the page.
        item('Delete', 'delete', () => {
          const page = annotationsByPageRef.current?.[ctx.pageNumber];
          if (!page?.objects) return;
          const deletable = sortedDesc
            .map((idx) => ({ idx, obj: page.objects[idx] }))
            .filter(({ obj }) => canModifyObj(obj) || canPlanForeignDelete(obj));
          if (deletable.length === 0) return;
          const runDelete = () => {
            const next = deepClone(page);
            for (const { idx } of deletable) {
              if (idx >= 0 && idx < next.objects.length) next.objects.splice(idx, 1);
            }
            handleSaveAnnotations(ctx.pageNumber, next, {
              source: 'object:modified',
              action: 'delete',
              checkpointPolicy: 'normal',
            });
            setPendingSvgSelection({
              pageNumber: ctx.pageNumber,
              annotationIndex: null,
              tick: Date.now(),
            });
          };
          const candidateIds = deletable
            .map(({ obj }) => obj?.id)
            .filter((id) => id != null);
          if (typeof requestBulkDelete === 'function' && candidateIds.length > 0) {
            requestBulkDelete({
              candidateIds,
              snapshotObjects: deletable.map(({ obj }) => deepClone(obj)),
              pageNumber: ctx.pageNumber,
              runDelete,
            });
            return;
          }
          // Own-only fallback: with no planner (or an all-id-less set) the
          // deletable filter above admitted own/boot marks only, so a direct
          // fire can never touch a foreign-author mark.
          runDelete();
        }),
        sep(),
        item('Bring to front', 'bringToFront', () => {
          reorderAll('front');
        }),
        item('Bring forward', 'bringForward', () => {
          reorderAll('forward');
        }),
        item('Send backward', 'sendBackward', () => {
          reorderAll('backward');
        }),
        item('Send to back', 'sendToBack', () => {
          reorderAll('back');
        }),
        // UX: 2026-04-21 — Group / Ungroup items intentionally omitted
        // from the multi-selection right-click menu. The feature is
        // hidden app-wide until the matrix-per-shape rewrite ships.
      ];
    } else {
      // Empty canvas / page — only Paste lives here (for annotation paste).
      // Page-level operations (Cut/Copy/Delete/Rotate/Mirror) belong in the
      // thumbnails sidebar (src/sidebar/PagesPanel.jsx), not the canvas
      // right-click. This matches Acrobat and Bluebeam: right-click a page
      // thumbnail for page ops; right-click the page body for annotation
      // ops. Shares doPasteAnnotation with the annotation menu above.
      items = [
        item('Paste', 'paste', doPasteAny, hasAnyClipboard),
      ];
    }

    // UX: mobile context-menu chrome (Phase D parity). Panel width tracks the
    // demo per menu type: object menus (annotation / group / callout) = 176px,
    // paste/counter/text-markup = 154px (demo App.tsx:866/897 + styles.ts:861).
    const isMobileMenu = !!mobileMode;
    const mobileWidth = (ctx.kind === 'annotation' || ctx.kind === 'group' || ctx.kind === 'callout') ? 176 : 154;
    const mobileTitle = (ctx.kind === 'annotation' || ctx.kind === 'group') ? 'Annotation'
      : ctx.kind === 'callout' ? 'Callout'
      : ctx.kind === 'counter' ? 'Counter'
      : 'Page';

    const panel = (
      <div
        data-annotation-context-menu="true"
        ref={(el) => {
          // UX: keep the menu inside both the visible viewport and the PDF
          // page the user right-clicked. When the cursor is near the right
          // or bottom edge of a page, flip the menu's anchor so its
          // right/bottom corner aligns with the cursor — this keeps the
          // pointer still resting on the clicked item/shape. The viewport
          // also excludes the desktop right rail. If the page element can't
          // be found, use that viewport alone. An 8px margin keeps the menu
          // off each bound.
          if (!el) return;
          const rect = el.getBoundingClientRect();

          // Find the PDF page wrapper for ctx.pageNumber, then cut its rect
          // to the visible viewport. The helper uses the viewport if no page
          // can be found.
          let pageRect = null;
          if (ctx.pageNumber != null) {
            const pageEl =
              document.querySelector(`[data-diag-svg-wrapper="${ctx.pageNumber}"]`)
              || document.querySelector(`[data-pal-root="${ctx.pageNumber}"]`);
            if (pageEl) {
              // Walk up to the pdfjs page div so the bounds match
              // what the user visually sees as "the page".
              const pageDiv = pageEl.closest('.survey-pdfjs-page-div') || pageEl;
              const r = pageDiv.getBoundingClientRect();
              if (r.width > 0 && r.height > 0) pageRect = r;
            }
          }
          const bounds = getPageViewportBounds(
            pageRect,
            window.innerWidth,
            window.innerHeight,
            isMobileMenu ? 0 : DESKTOP_RIGHT_RAIL_WIDTH,
          );
          const position = clampFloatingMenuPosition({
            x: ctx.x,
            y: ctx.y,
            width: rect.width,
            height: rect.height,
            bounds,
          });

          el.style.left = `${position.left}px`;
          el.style.top = `${position.top}px`;
        }}
        style={isMobileMenu ? {
          // UX: demo touch context-menu chrome (mobile-expo-go/src/styles.ts:861-871).
          // Fixed panel, per-type width, radius 9, #181B20 fill / #3C424D border,
          // 6px padding, no shadow (demo uses borders + fills only).
          position: 'fixed',
          left: ctx.x,
          top: ctx.y,
          background: 'var(--surface-1)',
          border: '1px solid var(--border)',
          borderRadius: 9,
          zIndex: 10000,
          width: mobileWidth,
          padding: 6,
          fontSize: 13,
          color: 'var(--text-1)',
          letterSpacing: 0,
          fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
        } : {
          // Design.md menu spec: dark card, ink border, small radius,
          // deep soft shadow — matches the home page's portalled menus.
          position: 'fixed',
          left: ctx.x,
          top: ctx.y,
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          boxShadow: '0 12px 30px rgba(0,0,0,0.5)',
          zIndex: 10000,
          minWidth: 160,
          padding: 4,
          fontSize: 12.5,
          color: 'var(--text-2)',
          letterSpacing: 0,
          fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
        }}
      >
        {/* UX: mobile menus lead with a muted title row + divider, matching the
            demo FloatingContextMenu (styles.ts:872-889). Desktop stays title-less. */}
        {isMobileMenu && (
          <>
            <div style={{ color: 'var(--text-3)', fontSize: 11, fontWeight: 800, padding: '4px 6px' }}>{mobileTitle}</div>
            <div style={{ height: 1, background: 'var(--surface-3)' }} />
          </>
        )}
        {items.map((it) => (
          it.separator
            ? <div key={it.key} style={{ height: 1, background: isMobileMenu ? 'var(--surface-3)' : 'var(--surface-3)', margin: '4px 0' }} />
            : (
              <div
                key={it.key}
                onClick={it.disabled ? undefined : it.onClick}
                // UX: disabled items (e.g. Paste when the clipboard is
                // empty) render in muted gray with a default cursor and no
                // hover surveyMarker — the user can see the option exists but
                // that it's not currently actionable. Matches standard
                // desktop-app menu behavior. Danger items (Delete) use the
                // demo destructive color #F08A8A on mobile, design.md danger on desktop.
                style={isMobileMenu ? {
                  height: 34,
                  display: 'flex',
                  alignItems: 'center',
                  padding: '0 8px',
                  borderRadius: 6,
                  cursor: it.disabled ? 'default' : 'pointer',
                  userSelect: 'none',
                  fontSize: 13,
                  fontWeight: 800,
                  opacity: it.disabled ? 0.45 : 1,
                  color: it.disabled ? '#5a6473' : (it.key === 'delete' ? '#F08A8A' : '#f4f5f7'),
                } : {
                  padding: '7px 12px',
                  borderRadius: 5,
                  cursor: it.disabled ? 'default' : 'pointer',
                  userSelect: 'none',
                  color: it.disabled ? '#5a6473' : (it.key === 'delete' ? '#d95a56' : '#e8e2d4'),
                }}
                onMouseEnter={(e) => { if (!it.disabled) e.currentTarget.style.background = isMobileMenu ? 'var(--surface-2)' : 'var(--surface-3)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                {it.label}
              </div>
            )
        ))}
      </div>
    );

    // UX: on mobile, back the menu with the demo's near-invisible dismiss
    // layer (rgba(0,0,0,0.01) — NEVER dims the page; styles.ts:856-860). A tap
    // anywhere off the menu closes it. Desktop keeps its window-level
    // mousedown/Escape dismiss (no scrim) untouched.
    if (isMobileMenu) {
      return (
        <>
          <div
            onPointerDown={closeAnnotationContextMenu}
            style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.01)' }}
          />
          {panel}
        </>
      );
    }
    return panel;
  })(), document.body);
}
