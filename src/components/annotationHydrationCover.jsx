// Annotation hydration page cover — the "Loading annotations…" overlay painted
// over a page while its annotations hydrate (so stale/empty content is not shown
// before Supabase settles).
//
// Lifted verbatim out of PDFViewer: a pure render helper that captures nothing
// from component scope (it builds JSX purely from its three arguments), so it
// was useCallback(fn, []) and is now a plain exported function with identical
// behavior. Returns null when inactive.

export function renderAnnotationHydrationPageCover(pageNumber, renderer, active) {
  if (!active) return null;
  return (
    <div
      data-annotation-hydration-cover="true"
      data-annotation-hydration-cover-active="true"
      data-annotation-hydration-cover-page={pageNumber}
      data-annotation-hydration-cover-renderer={renderer}
      role="status"
      aria-live="polite"
      aria-label="Loading annotations"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f3f4f6',
        color: '#4b5563',
        pointerEvents: 'auto',
        boxShadow: 'inset 0 0 0 1px rgba(17, 24, 39, 0.08)',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '10px',
          fontSize: '13px',
          fontWeight: 500,
        }}
      >
        <div
          style={{
            width: '26px',
            height: '26px',
            borderRadius: '50%',
            border: '3px solid rgba(75, 85, 99, 0.22)',
            borderTopColor: '#4b5563',
            animation: 'annotationHydrationSpin 0.8s linear infinite',
          }}
        />
        <span>Loading annotations...</span>
      </div>
    </div>
  );
}
