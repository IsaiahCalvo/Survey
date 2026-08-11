// src/components/collab/QuarantineMarkerOverlay.jsx
//
// Phase 30 — Per-annotation quarantine marker overlay.
//
// Sibling component rendered alongside <SVGAnnotationLayer> (zero touches to
// SVGAnnotationLayer.jsx — modeled on Phase 29's <CollaboratorOutlineOverlay>
// pattern). Reads from per-annotation queue state and renders inline markers
// next to quarantined annotations.
//
// 30-UI-SPEC.md Surface 2:
//   - 4px-diameter solid red dot (#d95a56) at the annotation's top-right
//     corner, offset 8px outside the bounding box.
//   - Inline label "didn't save, please try redrawing" at 11px / weight 400 /
//     color var(--text-muted).
//   - role="status" + aria-live="polite" so screen readers announce when a
//     marker appears.
//   - pointer-events: none on the marker root — does NOT steal pointer events
//     from the underlying annotation; the user can still click / select /
//     right-click the annotation normally.
//
// Copy lock from CONTEXT.md `<specifics>`: "didn't save, please try redrawing"
// — exact lowercase string. Do NOT capitalize, do NOT shorten.
//
// Lane safety: this overlay is NEW and lives entirely outside SVGAnnotationLayer.
// Plan 30-06 owns the per-page mount + bbox feed; Plan 30-05 ships the component
// shape so 30-06 can drop it in without touching Always-Protected files.

import './QuarantineMarkerOverlay.css';

// UX: locked verbatim per 30-UI-SPEC.md Surface 2 and CONTEXT.md `<specifics>`.
// Lowercase 'd' is intentional — softens marker so it reads as a status note,
// not an alert. "redrawing" matches the user's mental model of how they got
// the annotation there. Do NOT shorten to "didn't save" alone — the
// "please try redrawing" half is the actionable instruction.
const MARKER_LABEL = "didn't save, please try redrawing";

/**
 * @param {object} props
 * @param {Array<{id: string, pageNumber: number, bbox: {x: number, y: number, w: number, h: number}}>} props.quarantinedAnnotations
 *   List of quarantined annotations and their bounding boxes; positions the marker.
 *   Plan 30-06 owns the bbox feed (joins useDualWriteQueue's quarantinedAnnoIds
 *   with annotation geometry from useAnnotationsCRDT).
 * @param {number} props.pageNumber - the page this overlay is rendering for;
 *   the component filters quarantinedAnnotations to those matching pageNumber so
 *   it can be mounted per-page.
 */
export function QuarantineMarkerOverlay({ quarantinedAnnotations = [], pageNumber }) {
  const onThisPage = quarantinedAnnotations.filter((a) => a.pageNumber === pageNumber);
  // Defensive: render nothing when there are no markers to draw on this page.
  // Avoids emitting an empty container on every render of every page.
  if (onThisPage.length === 0) return null;

  return (
    <div
      className="quarantine-marker-overlay"
      // role="status" + aria-live="polite" per 30-UI-SPEC.md Surface 2 a11y.
      // 'polite' (not 'assertive') because failure is non-blocking; user is
      // mid-task. Announcement should not interrupt mid-edit.
      role="status"
      aria-live="polite"
      data-phase="30"
      data-page={pageNumber ?? undefined}
    >
      {onThisPage.map((anno) => {
        // Marker positioned at top-right of the annotation's bounding box,
        // offset 8px outside (sm token per 30-UI-SPEC.md spacing scale) so
        // the marker sits clear of the annotation's own stroke.
        const left = (anno.bbox?.x ?? 0) + (anno.bbox?.w ?? 0) + 8;
        const top = (anno.bbox?.y ?? 0) - 4;
        return (
          <div
            key={anno.id}
            className="quarantine-marker"
            style={{ left: `${left}px`, top: `${top}px` }}
          >
            {/* aria-hidden on the dot because the label below carries the
                semantic content; otherwise screen readers double-announce. */}
            <span className="quarantine-marker__dot" aria-hidden="true" />
            <span
              className="quarantine-marker__label"
              // HTML title attribute provides the hover tooltip fallback for
              // labels clipped by viewport edges (30-UI-SPEC.md hover tooltip).
              title={MARKER_LABEL}
            >
              {MARKER_LABEL}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default QuarantineMarkerOverlay;
