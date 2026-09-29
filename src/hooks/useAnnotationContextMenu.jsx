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

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { appDebug } from '../viewerShared.js';
import { deepClone } from '../utils/deepClone.js';
import { watchLightPopover } from '../components/dismissRules.js';
import {
  clampFloatingMenuPosition,
  DESKTOP_RIGHT_RAIL_WIDTH,
  getPageViewportBounds,
} from '../utils/floatingUiGeometry.js';
// RULED 2026-09-28 owner: open editing + lock. Cut / Delete take ANY mark
// (own or someone else's) with no confirmation; a user-locked mark greys them
// out and the menu offers Lock / Unlock (its author or the document owner).
// Same single source of truth as click hit-test / marquee / planner.
import { canModify, canToggleLock, isUserLocked } from '../lib/collab/permissionScope.js';
import { reorderSelectionInStack } from '../utils/annotationFamilyRules.js';
import { resolveMenuTargets, stampMenuTargetIds } from '../utils/selectionRemap.js';

// w61: `getPageObjects(pageNumber)` (optional) returns the page's mark list,
// so the menu can note which marks it was opened on (by id) and still act on
// exactly those if another screen changes the list while it is open.
export function useAnnotationContextMenu({ getPageObjects = null } = {}) {
  const getPageObjectsRef = useRef(getPageObjects);
  getPageObjectsRef.current = getPageObjects;
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
    window.__onAnnotationContextMenu = ({ pageNumber, annotationIndex, calloutId, kind, groupIndices, groupMarkerIds, surveyMarkerId, event }) => {
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
      const pageObjects = (() => {
        try { return getPageObjectsRef.current?.(pageNumber) || null; } catch { return null; }
      })();
      setAnnotationContextMenu(stampMenuTargetIds({
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
        // w53: Survey Markers — the one right-clicked ('surveyMarker' kind)
        // or those in the right-clicked selection ('group' kind).
        surveyMarkerId: surveyMarkerId || null,
        groupMarkerIds: Array.isArray(groupMarkerIds) ? groupMarkerIds.slice() : [],
      }, pageObjects));
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
  //
  // 2026-09-23: now one of the shared dismiss rules' light popovers
  // (src/components/dismissRules.js): an outside press still closes it and
  // still does its job (R1 — select the mark pressed, press the button); a
  // press on the bare page only closes it (R2); Escape closes it and nothing
  // under it (R5). Still capture phase, so descendants cannot stop it.
  useEffect(() => {
    if (!annotationContextMenu) return undefined;
    let stop = null;
    // Delay attaching so the opening right-click's own press doesn't
    // instantly re-close the menu.
    const t = window.setTimeout(() => {
      stop = watchLightPopover({
        contains: (target) => Boolean(target.closest('[data-annotation-context-menu]')),
        close: () => setAnnotationContextMenu(null),
      });
    }, 0);
    return () => {
      window.clearTimeout(t);
      stop?.();
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
    // w61: the page lists of the render drawing the menu (optional).
    annotationsByPageNow = null,
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
    // RULED 2026-09-28 owner: open editing + lock: bulk-delete planner bridge (PDFViewer's
    // requestBulkDeleteRef). Deletes go straight through (no confirmation) and
    // get one History row; user-locked marks are left out. Optional: mounts
    // without it fall back to the direct splice.
    requestBulkDelete = null,
    // Ownership inputs for the delete/cut partition below. Optional — when
    // either is missing (boot window) the legacy permissive behavior applies.
    viewerId = null,
    documentOwnerId = null,
    // w52: callouts selected together with shapes move with the group's
    // z-order items.
    selectedCalloutIds = null,
    // w53: Survey Markers in the family — restack a mixed selection in the
    // page's one stack (one save, one undo step) and delete markers.
    handleReorderFamily = null,
    deleteSurveyMarkers = null,
    // w53: one clipboard for any selection (marks + callouts + Survey
    // Markers) and Duplicate — utils/familyClipboard.js via PDFViewer.
    copyFamilySelection = null,
    duplicateFamilySelection = null,
    familyClipboard = null,
    pasteFamilyAt = null,
    // Owner ruling 2026-09-28 — Lock / Unlock on every object menu:
    // toggleLockSelection(pageNumber, { indices, calloutIds, markerIds }, lock)
    // and a Survey Marker record lookup by id.
    toggleLockSelection = null,
    resolveSurveyMarker = null,
    // w56: PDFViewer's handleBeginBatchDelete — arms a mixed marks+callouts
    // delete so the group menu's Delete is one save / one Undo.
    beginBatchDelete = null,
  } = actions;

  // May this mark be cut / deleted? RULED 2026-09-28 owner: open editing +
  // lock — any mark that is not user-locked (the boot window stays
  // permissive for unlocked marks, matching canSelectAnnotationByIndex /
  // deleteSelected in useSVGInteraction).
  const canModifyObj = (obj) => {
    if (!obj) return false;
    if (isUserLocked(obj)) return false;
    if (!viewerId || !documentOwnerId) return true;
    return canModify({ annotation: obj, viewerId, documentOwnerId });
  };
  // Lock / Unlock item for a set of members [{ obj, marker? }]. Every
  // member locked -> "Unlock"; otherwise "Lock" (locks the rest). Greyed out
  // when the viewer may toggle none of them (author / document owner only).
  const lockItemFor = (members, selection) => {
    const list = (members || []).filter((m) => m && m.obj);
    if (list.length === 0 || typeof toggleLockSelection !== 'function') return null;
    const allLocked = list.every((m) => isUserLocked(m.obj));
    const mayToggle = (m) => canToggleLock(m.marker
      ? { surveyMarker: m.obj, viewerId, documentOwnerId }
      : { annotation: m.obj, viewerId, documentOwnerId });
    const target = allLocked ? list : list.filter((m) => !isUserLocked(m.obj));
    const enabled = Boolean(viewerId) && target.some(mayToggle);
    return allLocked
      ? { label: 'Unlock', key: 'unlock', lock: false, enabled, selection }
      : { label: 'Lock', key: 'lock', lock: true, enabled, selection };
  };

  return createPortal((() => {
    // w61: the targets noted (by id) when the menu opened, found again in
    // the page list as it is now — never a neighbour that slid into place.
    const ctx = resolveMenuTargets(
      annotationContextMenu,
      (annotationsByPageNow || annotationsByPageRef?.current)?.[annotationContextMenu.pageNumber]?.objects || null,
    );
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
      if (familyClipboard && typeof pasteFamilyAt === 'function') {
        pasteFamilyAt(ctx.pageNumber, ctx.x, ctx.y);
      } else if (clipboardAnnotation) {
        doPasteAnnotation();
      } else if (clipboardCallout) {
        handlePasteCallout(ctx.pageNumber, { clientX: ctx.x, clientY: ctx.y });
      }
    };
    const hasAnyClipboard = Boolean(clipboardAnnotation || clipboardCallout || familyClipboard);
    // w53: Duplicate — a copy 16 page units down-right, one Undo step, the
    // clipboard untouched (same item on every menu).
    const duplicateItem = (selection) => item('Duplicate', 'duplicate', () => {
      if (typeof duplicateFamilySelection === 'function') duplicateFamilySelection(ctx.pageNumber, selection);
    }, typeof duplicateFamilySelection === 'function');
    // Owner ruling 2026-09-28: Lock / Unlock, right under Delete.
    const lockMenuItems = (members, selection) => {
      const spec = lockItemFor(members, selection);
      if (!spec) return [];
      return [item(spec.label, spec.key, () => {
        toggleLockSelection(ctx.pageNumber, spec.selection, spec.lock);
      }, spec.enabled)];
    };

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
      // delete).
      //
      // UX: w52 (2026-09-28, owner: "annotations are annotations") — the four
      // z-order items (Bring to front / Bring forward / Send backward / Send
      // to back) are on the callout menu too, exactly like the shape menu.
      // A callout is a mark in its page's one stacking order
      // (annotationsByPage[page].objects, persisted per mark as `z` —
      // src/services/annotationStackOrder.js), drawn in that order by the SVG
      // layer, the canvas painter, thumbnails, export and print. So any mark
      // can go above or below a callout, and a callout above or below any
      // mark. The items resolve the callout's slot in page.objects and call
      // the SAME handleReorderAnnotation the shape menu uses (one undo step,
      // same Figma-style overlap-aware forward/backward).
      //
      // Resolve the right-clicked callout's projected group object (data.type
      // === 'callout', id at data.id) so Cut / Delete / Lock read its user lock
      // (RULED 2026-09-28 owner: open editing + lock: any editor cuts or deletes it unless it is locked).
      const findCalloutObj = () => {
        const page = annotationsByPageRef.current?.[ctx.pageNumber];
        if (!page?.objects || !ctx.calloutId) return null;
        return page.objects.find(
          (o) => o?.data?.type === 'callout' && o?.data?.id === ctx.calloutId
        ) || null;
      };
      // w52: the callout's slot in its page's stacking order.
      const reorderCallout = (direction) => {
        const page = annotationsByPageRef.current?.[ctx.pageNumber];
        if (!page?.objects || !ctx.calloutId) return;
        const index = page.objects.findIndex(
          (o) => o?.data?.type === 'callout' && o?.data?.id === ctx.calloutId
        );
        if (index < 0) return;
        handleReorderAnnotation(ctx.pageNumber, index, direction);
      };
      const calloutObj = findCalloutObj();
      const calloutEditable = !calloutObj || canModifyObj(calloutObj);
      items = [
        item('Cut', 'cut', () => {
          if (!ctx.calloutId) return;
          const obj = findCalloutObj();
          // Lock gate (boot window permissive inside canModifyObj - matches
          // the shape Cut item). A callout that can't be resolved from the
          // page projection is a no-op rather than an ungated cut.
          if (!obj || !canModifyObj(obj)) return;
          handleCutCallout(ctx.calloutId);
        }, calloutEditable),
        item('Copy', 'copy', () => ctx.calloutId && handleCopyCallout(ctx.calloutId)),
        // UX: paste lands at the right-click point (same cursor-anchored rule
        // as Cmd+V and the shape menu's doPasteAnnotation). ctx.x/y are the
        // right-click's client coords. doPasteAny covers both clipboards.
        item('Paste', 'paste', doPasteAny, hasAnyClipboard),
        duplicateItem({ calloutIds: [ctx.calloutId] }),
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
        }, calloutEditable),
        ...lockMenuItems(calloutObj ? [{ obj: calloutObj }] : [], { calloutIds: [ctx.calloutId] }),
        sep(),
        // w52: same z-order block as the shape menu, same handler.
        item('Bring to front', 'bringToFront', () => reorderCallout('front')),
        item('Bring forward', 'bringForward', () => reorderCallout('forward')),
        item('Send backward', 'sendBackward', () => reorderCallout('backward')),
        item('Send to back', 'sendToBack', () => reorderCallout('back')),
      ];
    } else if (ctx.kind === 'counter') {
      // w52 (2026-09-28): right-clicking the page while the Counter tool is
      // armed. The old lone "Continue pin" item did nothing (no handler ever
      // existed). A pin (or any mark) under the pointer now resolves to the
      // normal annotation menu in annotationHitTest; bare page = the page
      // menu, same as every other tool.
      items = [
        item('Paste', 'paste', doPasteAny, hasAnyClipboard),
      ];
    } else if (ctx.kind === 'annotation') {
      const menuObj = annotationsByPageRef.current?.[ctx.pageNumber]?.objects?.[ctx.annotationIndex] || null;
      const menuObjEditable = !menuObj || canModifyObj(menuObj);
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
          // RULED 2026-09-28 owner: open editing + lock: Cut takes anyone's mark with no confirmation;
          // a user-locked mark stays (canModifyObj).
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
        }, menuObjEditable),
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
        duplicateItem({ indices: [ctx.annotationIndex] }),
        // UX: right-click Delete mirrors the keyboard Delete/Backspace path.
        // RULED 2026-09-28 owner: open editing + lock: Delete takes anyone's mark with no confirmation
        // (via the planner when present, for the History row); a user-locked mark
        // stays.
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
          // Open editing: any mark that is not user-locked.
          if (!canModifyObj(obj)) return;
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
          // Direct fallback (planner absent or id-less mark).
          runDelete();
        }, menuObjEditable),
        ...lockMenuItems(menuObj ? [{ obj: menuObj }] : [], { indices: [ctx.annotationIndex] }),
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
    } else if (ctx.kind === 'surveyMarker' && ctx.surveyMarkerId) {
      // UX: w53 (2026-09-28, owner: "annotations are annotations") — the
      // Survey Marker menu is the shape menu: Paste, Delete and the four
      // z-order items (the marker takes its place in the page's one stack).
      // Delete uses the marker's own delete (ownership gate, trash, History
      // row, linked-Excel row removal).
      const reorderMarker = (direction) => {
        if (typeof handleReorderFamily !== 'function') return;
        handleReorderFamily(ctx.pageNumber, { markerIds: [ctx.surveyMarkerId], direction });
      };
      const markerRecord = typeof resolveSurveyMarker === 'function' ? resolveSurveyMarker(ctx.surveyMarkerId) : null;
      const markerEditable = !markerRecord || !isUserLocked(markerRecord);
      items = [
        // Owner ruling 2026-09-28: Cut picks up the survey item's PLACEMENT
        // only - the item, its Excel row and its answers stay (the survey
        // panel shows it "Not on page"); Paste puts the SAME item back.
        item('Cut', 'cut', () => copyFamilySelection?.(ctx.pageNumber, { markerIds: [ctx.surveyMarkerId] }, 'cut'),
          markerEditable && typeof copyFamilySelection === 'function'),
        item('Copy', 'copy', () => copyFamilySelection?.(ctx.pageNumber, { markerIds: [ctx.surveyMarkerId] }, 'copy')),
        item('Paste', 'paste', doPasteAny, hasAnyClipboard),
        duplicateItem({ markerIds: [ctx.surveyMarkerId] }),
        item('Delete', 'delete', () => {
          if (typeof deleteSurveyMarkers === 'function') deleteSurveyMarkers([ctx.surveyMarkerId]);
        }, markerEditable),
        ...lockMenuItems(markerRecord ? [{ obj: markerRecord, marker: true }] : [], { markerIds: [ctx.surveyMarkerId] }),
        sep(),
        item('Bring to front', 'bringToFront', () => reorderMarker('front')),
        item('Bring forward', 'bringForward', () => reorderMarker('forward')),
        item('Send backward', 'sendBackward', () => reorderMarker('backward')),
        item('Send to back', 'sendToBack', () => reorderMarker('back')),
      ];
    } else if (ctx.kind === 'group' && Array.isArray(ctx.groupIndices)
      // w56: selected callouts count as members too (a mark + a callout,
      // or two callouts, is a multi-selection with the group menu).
      && (ctx.groupIndices.length + (ctx.groupMarkerIds?.length || 0)
        + (selectedCalloutIds && typeof selectedCalloutIds.size === 'number' ? selectedCalloutIds.size : 0)) >= 2) {
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
        // w53: family planner (same permutation; Survey Markers too).
        if (typeof handleReorderFamily === 'function') {
          handleReorderFamily(ctx.pageNumber, {
            indices: sortedAsc,
            calloutIds: Array.from(selectedCalloutIds || []),
            markerIds: ctx.groupMarkerIds || [],
            direction,
          });
          return;
        }
        const page = annotationsByPageRef.current?.[ctx.pageNumber];
        if (!page?.objects?.length) return;
        // w52: the selection moves as ONE block through the shared stack
        // helper (same permutation as the keyboard Cmd+]/[ path), and any
        // callouts selected with the shapes move with them.
        const calloutSlots = [];
        if (selectedCalloutIds && typeof selectedCalloutIds.has === 'function' && selectedCalloutIds.size > 0) {
          page.objects.forEach((object, index) => {
            if (object?.data?.type === 'callout' && selectedCalloutIds.has(object?.data?.id)) calloutSlots.push(index);
          });
        }
        const result = reorderSelectionInStack(page.objects, [...sortedAsc, ...calloutSlots], direction);
        if (!result.changed) return;
        const next = deepClone(page);
        next.objects = result.objects.map((object) => deepClone(object));
        handleSaveAnnotations(ctx.pageNumber, next, {
          source: 'object:modified',
          action: 'reorder-group',
          checkpointPolicy: 'normal',
        });
        setPendingSvgSelection({
          pageNumber: ctx.pageNumber,
          // Shapes only: callout selection is keyed by id and survives the move.
          annotationIndices: result.selectedIndices.filter(
            (index) => result.objects[index]?.data?.type !== 'callout'
          ),
          tick: Date.now(),
        });
      };

      // w53: the whole selection — marks, callouts, Survey Markers.
      const familySelection = {
        indices: sortedAsc,
        calloutIds: Array.from(selectedCalloutIds || []),
        markerIds: ctx.groupMarkerIds || [],
      };
      // Owner ruling 2026-09-28: the group's members for Lock / Unlock, and
      // whether any of them can still be cut / deleted (locked ones stay).
      const groupPage = annotationsByPageRef.current?.[ctx.pageNumber];
      const groupCalloutIdSet = new Set(familySelection.calloutIds.map(String));
      const groupMembers = [
        ...sortedAsc.map((idx) => ({ obj: groupPage?.objects?.[idx] })),
        ...(groupPage?.objects || [])
          .filter((o) => o?.data?.type === 'callout' && groupCalloutIdSet.has(String(o?.data?.id)))
          .map((obj) => ({ obj })),
        ...familySelection.markerIds.map((id) => ({
          obj: typeof resolveSurveyMarker === 'function' ? resolveSurveyMarker(id) : null,
          marker: true,
        })),
      ].filter((m) => m.obj);
      const groupHasEditable = groupMembers.length === 0 || groupMembers.some((m) => !isUserLocked(m.obj));
      items = [
        item('Cut', 'cut', () => {
          if (typeof copyFamilySelection === 'function') {
            copyFamilySelection(ctx.pageNumber, familySelection, 'cut');
            return;
          }
          const page = annotationsByPageRef.current?.[ctx.pageNumber];
          if (!page?.objects) return;
          // RULED 2026-09-28 owner: open editing + lock: Cut takes every member that is not user-locked;
          // the clipboard matches the splice exactly, so Paste never duplicates a
          // member that stayed on the page.
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
        }, groupHasEditable),
        item('Copy', 'copy', () => {
          if (typeof copyFamilySelection === 'function') {
            copyFamilySelection(ctx.pageNumber, familySelection, 'copy');
            return;
          }
          const copy = copyAll();
          if (!copy) return;
          setClipboardAnnotation({ ...copy, mode: 'copy' });
          clearCalloutClipboard();
        }),
        item('Paste', 'paste', doPasteAny, hasAnyClipboard),
        duplicateItem(familySelection),
        // RULED 2026-09-28 owner: open editing + lock: multi-select Delete removes every member
        // that is not user-locked, with no confirmation (via the planner for the
        // History row).
        // (planner present + stable id); anything else stays on the page.
        item('Delete', 'delete', () => {
          // w53: the selection's Survey Markers are deleted with the marks
          // in the same save (one undo step, nothing deleted if the
          // cross-author confirm is cancelled); markers alone go through
          // their own delete.
          const markerIds = ctx.groupMarkerIds || [];
          const page = annotationsByPageRef.current?.[ctx.pageNumber];
          const deletable = page?.objects ? sortedDesc
            .map((idx) => ({ idx, obj: page.objects[idx] }))
            .filter(({ obj }) => canModifyObj(obj)) : [];
          // w56: the selection's callouts go too — the same gated delete as
          // pressing Delete with the mixed selection (SVGAnnotationLayer's
          // keyboard path). Cut / Copy / Duplicate / Lock already took them;
          // Delete used to leave them on the page. Only this page's callouts
          // (the same scope Cut / Copy / Duplicate use), and only ones that
          // still exist.
          const pageCalloutIds = new Set((page?.objects || [])
            .filter((o) => o?.data?.type === 'callout' && o?.data?.id != null)
            .map((o) => String(o.data.id)));
          const selectedCalloutIdList = familySelection.calloutIds
            .filter((id) => pageCalloutIds.has(String(id)));
          const deleteSelectedCallouts = () => {
            if (selectedCalloutIdList.length > 0 && typeof window.__onDeleteSelectedCallouts === 'function') {
              window.__onDeleteSelectedCallouts(selectedCalloutIdList);
            }
          };
          if (deletable.length === 0) {
            if (markerIds.length > 0 && typeof deleteSurveyMarkers === 'function') deleteSurveyMarkers(markerIds);
            deleteSelectedCallouts();
            return;
          }
          const runDelete = () => {
            const next = deepClone(page);
            for (const { idx } of deletable) {
              if (idx >= 0 && idx < next.objects.length) next.objects.splice(idx, 1);
            }
            handleSaveAnnotations(ctx.pageNumber, next, {
              source: 'object:modified',
              action: 'delete',
              checkpointPolicy: 'normal',
              ...(markerIds.length > 0 ? { surveyMarkerFamily: { deletes: markerIds } } : {}),
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
            // w56: arm the mixed marks+callouts batch first (as the keyboard
            // Delete does) so the planner folds this page's callouts into the
            // marks' save — one Undo brings both back; the callout delete
            // below then skips the ones already taken.
            if (selectedCalloutIdList.length > 0 && typeof beginBatchDelete === 'function') {
              beginBatchDelete(2, selectedCalloutIdList);
            }
            requestBulkDelete({
              candidateIds,
              snapshotObjects: deletable.map(({ obj }) => deepClone(obj)),
              pageNumber: ctx.pageNumber,
              runDelete,
            });
            deleteSelectedCallouts();
            return;
          }
          // Direct fallback: no planner (or an all-id-less set).
          runDelete();
          deleteSelectedCallouts();
        }, groupHasEditable),
        ...lockMenuItems(groupMembers, familySelection),
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
    const mobileWidth = (ctx.kind === 'annotation' || ctx.kind === 'group' || ctx.kind === 'callout' || ctx.kind === 'surveyMarker') ? 176 : 154;
    const mobileTitle = (ctx.kind === 'annotation' || ctx.kind === 'group') ? 'Annotation'
      : ctx.kind === 'surveyMarker' ? 'Survey Marker'
      : ctx.kind === 'callout' ? 'Callout'
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
                  color: it.disabled ? 'var(--text-disabled)' : (it.key === 'delete' ? 'var(--danger-text)' : 'var(--text-1)'),
                } : {
                  padding: '7px 12px',
                  borderRadius: 5,
                  cursor: it.disabled ? 'default' : 'pointer',
                  userSelect: 'none',
                  color: it.disabled ? 'var(--text-disabled)' : (it.key === 'delete' ? 'var(--danger-text)' : 'var(--text-1)'),
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
