// src/components/collab/CollaboratorOutlineOverlay.jsx
// Phase 29 — Sibling SVG overlay drawing per-user-color outlines around annotations
// that remote collaborators currently have open in their edit canvas.
//
// Source: .planning/phases/29-fabric-yjs-binding-per-user-undo/29-UI-SPEC.md §2
// Visual contract (locked):
//   - 2px solid stroke (NOT dashed — dashed would read as "selected")
//   - 4px outset offset around the annotation bounding box
//   - opacity 0.7
//   - border-radius 4px
//   - pointer-events: none (clicks pass through)
//   - 160ms ease-out fade in/out animation on appear/disappear
//   - Render layer: above SVG annotation, below local selection ring (z 5)
//
// Why a sibling overlay (NOT modifying SVGAnnotationLayer):
//   SVGAnnotationLayer.jsx is Always-Protected per CLAUDE.md. The outline is
//   purely additive chrome that overlays on top — implemented as a sibling
//   positioned absolute over the same per-page coordinate space. The protected
//   SVG layer never learns about awareness state.
//
// Why one outline color slot per remote user:
//   29-UI-SPEC.md + 29-CONTEXT.md "Awareness signal" — stable per-user color
//   assigned by the server when the user joins the document. Phase 33 reuses
//   the same 6-slot palette for the cursor pill / presence list, so the user
//   has a continuous mental model when more awareness UI ships.
//
// Component contract: pure presentational. Caller owns the data feed —
// `editors` is an array of { annoId, bbox, userId, colorSlot } tuples. Per-page
// integration (joining bbox data from useAnnotationsCRDT with editor identity
// from useRemoteEditors) is the caller's responsibility; this component just
// renders rects. Plan 29-06 mounts this at YDocProvider scope with empty
// editors initially; per-page bbox feed is a follow-up (Phase 32 hardening).

import { useMemo } from 'react';
import { userColor } from '../../utils/userColors.js';
import './CollaboratorOutlineOverlay.css';

/**
 * @param {object} props
 * @param {number} [props.pageNumber] - Which PDF page this overlay is rendering for.
 *   Currently unused inside the component (caller already filtered editors by page);
 *   kept on the API for symmetry with PageAnnotationLayer / SVGAnnotationLayer
 *   render contracts and for future per-page debugging.
 * @param {{ width: number, height: number }} [props.pageSize] - Page dimensions in
 *   viewer units. When null/undefined, the overlay renders nothing.
 * @param {Array<{ annoId: string, bbox: { left: number, top: number, width: number, height: number }, userId: string, colorSlot: number, name?: string }>} [props.editors]
 *   - One entry per remote-edit-active annotation on this page.
 *   - colorSlot is 1..6 mapping to --user-color-N CSS var; slot 7+ wraps to slot 1.
 */
export function CollaboratorOutlineOverlay({ pageNumber, pageSize, editors = [] }) {
  // Memoize rect math so React doesn't re-compute on parent re-render unless
  // editors actually changed. UX: this matters because YDocProvider may re-render
  // when storageState / role / transportState change — none of those should
  // ripple into the outline overlay.
  const rects = useMemo(() => {
    return editors.map((e) => {
      // 4px outset offset per UI-SPEC §2.
      // UX: outset (not inset) so the outline does not visually overlap the
      // annotation's stroke; the user reads the outline as decoration around
      // the shape, not as part of the shape's own border.
      const offset = 4;
      // Slot 7+ wraps to slot 1 — 6-slot palette collision is acceptable for v2.4
      // per CONTEXT.md "Awareness signal" decision.
      const slot = ((e.colorSlot - 1) % 6) + 1;
      return {
        key: `${e.annoId}-${e.userId}`,
        x: e.bbox.left - offset,
        y: e.bbox.top - offset,
        width: e.bbox.width + offset * 2,
        height: e.bbox.height + offset * 2,
        // Owner 2026-10-07: colour = person. With a user id the outline is that
        // person's own colour (utils/userColors.js, the darker `line` twin of
        // their face pastel, so it shows on white paper); the old slot
        // variable is only the fallback for an awareness entry with no id.
        colorVar: e.userId ? userColor(e.userId).line : `var(--user-color-${slot}, #4A90E2)`,
      };
    });
  }, [editors]);

  // Defensive: render nothing when there is no page geometry yet, or no editors
  // to draw outlines for. Avoids emitting an empty <svg> element that would
  // bloat the DOM tree on every render of every page.
  if (!pageSize || rects.length === 0) return null;

  return (
    <svg
      className="collaborator-outline-overlay"
      width={pageSize.width}
      height={pageSize.height}
      viewBox={`0 0 ${pageSize.width} ${pageSize.height}`}
      // aria-hidden because the outline is decoration, not user-actionable info.
      // Screen readers should not announce it — there is nothing the user can
      // do with this affordance, and the underlying annotation is already in
      // the accessibility tree via SVGAnnotationLayer.
      aria-hidden="true"
      data-phase="29"
      data-page={pageNumber ?? undefined}
    >
      {rects.map((r) => (
        <rect
          key={r.key}
          className="collaborator-outline-overlay__rect"
          x={r.x}
          y={r.y}
          width={r.width}
          height={r.height}
          // Inline stroke override picks up the per-user CSS variable. The
          // CSS file owns the default fallback (--user-color-1) for graceful
          // degradation when the variable is missing.
          style={{ stroke: r.colorVar }}
        />
      ))}
    </svg>
  );
}

export default CollaboratorOutlineOverlay;
