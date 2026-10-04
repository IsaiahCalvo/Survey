// Annotation hydration page cover, laid over the first page while its marks
// hydrate (so stale or empty marks are never shown, or drawn on, before the
// stored copy settles).
//
// Owner 2026-10-04 ("it looked like we had two different loading screens"):
// the cover no longer paints anything. It used to grey the whole page out with
// three pulsing dots — a second, different loading screen after "Opening…".
// Now the page itself shows the moment it is drawn, the marks fade in when they
// are ready (PDFViewer's annotation surface), and this cover only keeps input
// off the page until then. Screen readers still hear that it is opening.
//
// A pure render helper that captures nothing from component scope and returns
// null when inactive.

const SR_ONLY = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

export function renderAnnotationHydrationPageCover(pageNumber, renderer, active) {
  if (!active) return null;
  return (
    <>
      <span role="status" aria-live="polite" style={SR_ONLY}>
        Opening document
      </span>
      <div
        data-annotation-hydration-cover="true"
        data-annotation-hydration-cover-active="true"
        data-annotation-hydration-cover-page={pageNumber}
        data-annotation-hydration-cover-renderer={renderer}
        aria-busy="true"
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 1000,
          background: 'transparent',
          pointerEvents: 'auto',
          cursor: 'progress',
        }}
      />
    </>
  );
}
