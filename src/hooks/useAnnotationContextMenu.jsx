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
  } = actions;

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
      items = [
        item('Cut', 'cut', () => ctx.calloutId && handleCutCallout(ctx.calloutId)),
        item('Copy', 'copy', () => ctx.calloutId && handleCopyCallout(ctx.calloutId)),
        item('Paste', 'paste', () => handlePasteCallout(ctx.pageNumber)),
        item('Delete', 'delete'),
      ];
    } else if (ctx.kind === 'counter') {
      items = [
        item('Continue Pin', 'continuePin'),
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
          setClipboardAnnotation({
            object: deepClone(obj),
            sourcePageNumber: ctx.pageNumber,
            mode: 'cut',
          });
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
        }),
        // UX: Paste drops a clone of the clipboardAnnotation onto the
        // right-clicked page. See doPasteAnnotation() above for the full
        // behavior + live diagnostic dump. Grayed out when the clipboard
        // is empty — matches Acrobat, Drawboard PDF, Bluebeam, Figma.
        item('Paste', 'paste', doPasteAnnotation, Boolean(clipboardAnnotation)),
        // UX: right-click Delete mirrors the keyboard Delete/Backspace path —
        // splice the targeted shape out of that page's objects and commit
        // via handleSaveAnnotations. Same save path as useSVGInteraction's
        // deleteSelected, so undo + cloud sync behave identically to pressing
        // Delete with a selection. No-op if the page/index isn't resolvable.
        // After the save, broadcast a "clear selection on this page" command
        // via pendingSvgSelection (annotationIndex: null) so the selection
        // doesn't stick to the shape that slides into the deleted index
        // slot after the splice — the user expects everything dismissed.
        item('Delete', 'delete', () => {
          const page = annotationsByPageRef.current?.[ctx.pageNumber];
          if (!page?.objects || ctx.annotationIndex == null) return;
          if (ctx.annotationIndex < 0 || ctx.annotationIndex >= page.objects.length) return;
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
        item('Bring to Front', 'bringToFront', () => {
          handleReorderAnnotation(ctx.pageNumber, ctx.annotationIndex, 'front');
        }),
        item('Bring Forward', 'bringForward', () => {
          if (ctx.annotationIndex == null) return;
          handleReorderAnnotation(ctx.pageNumber, ctx.annotationIndex, 'forward');
        }),
        item('Send Backward', 'sendBackward', () => {
          if (ctx.annotationIndex == null) return;
          handleReorderAnnotation(ctx.pageNumber, ctx.annotationIndex, 'backward');
        }),
        item('Send to Back', 'sendToBack', () => {
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

      const copyAll = () => {
        const page = annotationsByPageRef.current?.[ctx.pageNumber];
        if (!page?.objects) return null;
        const collected = [];
        let minLeft = Infinity, minTop = Infinity;
        for (const idx of sortedAsc) {
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

      items = [
        item('Cut', 'cut', () => {
          const copy = copyAll();
          if (!copy) return;
          setClipboardAnnotation({ ...copy, mode: 'cut' });
          const page = annotationsByPageRef.current?.[ctx.pageNumber];
          if (!page?.objects) return;
          const next = deepClone(page);
          for (const idx of sortedDesc) {
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
        }),
        item('Paste', 'paste', doPasteAnnotation, Boolean(clipboardAnnotation)),
        item('Delete', 'delete', () => {
          const page = annotationsByPageRef.current?.[ctx.pageNumber];
          if (!page?.objects) return;
          const next = deepClone(page);
          for (const idx of sortedDesc) {
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
        }),
        sep(),
        item('Bring to Front', 'bringToFront', () => {
          // Top-most selected ends on top; keep relative order by
          // processing from topmost (largest index) downward.
          for (const idx of sortedDesc) {
            handleReorderAnnotation(ctx.pageNumber, idx, 'front');
          }
        }),
        item('Bring Forward', 'bringForward', () => {
          for (const idx of sortedDesc) {
            handleReorderAnnotation(ctx.pageNumber, idx, 'forward');
          }
        }),
        item('Send Backward', 'sendBackward', () => {
          for (const idx of sortedAsc) {
            handleReorderAnnotation(ctx.pageNumber, idx, 'backward');
          }
        }),
        item('Send to Back', 'sendToBack', () => {
          for (const idx of sortedAsc) {
            handleReorderAnnotation(ctx.pageNumber, idx, 'back');
          }
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
        item('Paste', 'paste', doPasteAnnotation, Boolean(clipboardAnnotation)),
      ];
    }

    return (
      <div
        data-annotation-context-menu="true"
        ref={(el) => {
          // UX: keep the menu inside the PDF page the user right-clicked
          // on (not just the viewport). When the cursor is near the right
          // or bottom edge of a page, flip the menu's anchor so its
          // right/bottom corner aligns with the cursor — this keeps the
          // pointer still resting on the clicked item/shape. Falls back
          // to a viewport clamp if the page element can't be found (e.g.
          // right-click landed in an empty zone). 8px margin so the menu
          // never kisses the page border.
          if (!el) return;
          const rect = el.getBoundingClientRect();
          const margin = 8;

          // Resolve the bounding box we want to keep the menu inside of.
          // First preference: the PDF page wrapper for ctx.pageNumber.
          // Fallback: the Pdfjs page div at the same index. Fallback
          // of fallback: the viewport.
          let bounds = null;
          if (ctx.pageNumber != null) {
            const pageEl =
              document.querySelector(`[data-diag-svg-wrapper="${ctx.pageNumber}"]`)
              || document.querySelector(`[data-pal-root="${ctx.pageNumber}"]`);
            if (pageEl) {
              // Walk up to the pdfjs page div so the bounds match
              // what the user visually sees as "the page".
              const pageDiv = pageEl.closest('.survey-pdfjs-page-div') || pageEl;
              const r = pageDiv.getBoundingClientRect();
              if (r.width > 0 && r.height > 0) bounds = r;
            }
          }
          if (!bounds) {
            bounds = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight, width: window.innerWidth, height: window.innerHeight };
          }

          // Horizontal: flip left if opening rightward would overflow.
          let nextLeft = ctx.x;
          if (ctx.x + rect.width + margin > bounds.right) {
            nextLeft = ctx.x - rect.width; // flip: menu opens leftward
          }
          // Then clamp so we never go past the left edge.
          if (nextLeft < bounds.left + margin) {
            nextLeft = Math.max(margin, bounds.left + margin);
          }
          // If the menu is wider than the bounds, keep it pinned to the
          // left edge with the margin (rather than going negative).
          if (rect.width + margin * 2 > bounds.width) {
            nextLeft = Math.max(margin, bounds.left + margin);
          }

          // Vertical: same logic for top/bottom.
          let nextTop = ctx.y;
          if (ctx.y + rect.height + margin > bounds.bottom) {
            nextTop = ctx.y - rect.height;
          }
          if (nextTop < bounds.top + margin) {
            nextTop = Math.max(margin, bounds.top + margin);
          }
          if (rect.height + margin * 2 > bounds.height) {
            nextTop = Math.max(margin, bounds.top + margin);
          }

          el.style.left = `${nextLeft}px`;
          el.style.top = `${nextTop}px`;
        }}
        style={{
          position: 'fixed',
          left: ctx.x,
          top: ctx.y,
          background: '#fff',
          border: '1px solid #ccc',
          borderRadius: 4,
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          zIndex: 10000,
          minWidth: 160,
          padding: '4px 0',
          fontSize: 13,
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {items.map((it) => (
          it.separator
            ? <div key={it.key} style={{ height: 1, background: '#eee', margin: '4px 0' }} />
            : (
              <div
                key={it.key}
                onClick={it.disabled ? undefined : it.onClick}
                // UX: disabled items (e.g. Paste when the clipboard is
                // empty) render in muted gray with a default cursor and no
                // hover surveyMarker — the user can see the option exists but
                // that it's not currently actionable. Matches standard
                // desktop-app menu behavior.
                style={{
                  padding: '6px 14px',
                  cursor: it.disabled ? 'default' : 'pointer',
                  userSelect: 'none',
                  color: it.disabled ? '#999' : 'inherit',
                }}
                onMouseEnter={(e) => { if (!it.disabled) e.currentTarget.style.background = '#eef'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                {it.label}
              </div>
            )
        ))}
      </div>
    );
  })(), document.body);
}
