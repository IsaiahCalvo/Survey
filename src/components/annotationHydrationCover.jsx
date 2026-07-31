// Annotation hydration page cover painted over a page while its annotations
// hydrate (so stale/empty content is not shown before Supabase settles).
//
// A pure render helper that captures nothing from component scope and returns
// null when inactive. Its cover blocks page input until hydration is complete.

export function renderAnnotationHydrationPageCover(pageNumber, renderer, active) {
  if (!active) return null;
  return (
    <>
      <span
        role="status"
        aria-live="polite"
        className="annotation-hydration-sr-only"
      >
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
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#e7edf1',
          pointerEvents: 'auto',
          boxShadow: 'inset 0 0 0 1px rgba(17, 24, 39, 0.08)',
        }}
      >
      <style>{`
        @keyframes annotationHydrationPagePulse {
          0%, 100% { opacity: 0.08; }
          50% { opacity: 0.34; }
        }

        @keyframes annotationHydrationDotPulse {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 0.96; }
        }

        .annotation-hydration-sr-only {
          position: absolute;
          width: 1px;
          height: 1px;
          padding: 0;
          margin: -1px;
          overflow: hidden;
          clip: rect(0, 0, 0, 0);
          white-space: nowrap;
          border: 0;
        }

        .annotation-hydration-paper {
          position: relative;
          width: 100%;
          height: 100%;
          box-sizing: border-box;
          overflow: hidden;
          background: #e7edf1;
        }

        .annotation-hydration-paper::after {
          content: '';
          position: absolute;
          inset: 0;
          background: #cbd4dc;
          opacity: 0.08;
          animation: annotationHydrationPagePulse 2s ease-in-out 850ms infinite;
          pointer-events: none;
        }

        .annotation-hydration-dots {
          position: absolute;
          inset: 0;
          z-index: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
        }

        .annotation-hydration-dot {
          display: block;
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: #63717d;
          opacity: 0.3;
          animation: annotationHydrationDotPulse 2s ease-in-out 850ms infinite;
        }

        @media (prefers-reduced-motion: reduce) {
          .annotation-hydration-paper::after,
          .annotation-hydration-dot {
            animation: none;
          }

          .annotation-hydration-paper::after {
            opacity: 0.16;
          }

          .annotation-hydration-dot {
            opacity: 0.64;
          }
        }
      `}</style>
        <div
          data-annotation-hydration-skeleton="true"
          className="annotation-hydration-paper"
          aria-hidden="true"
        >
          <div className="annotation-hydration-dots">
            <span data-annotation-hydration-dot="true" className="annotation-hydration-dot" />
            <span data-annotation-hydration-dot="true" className="annotation-hydration-dot" />
            <span data-annotation-hydration-dot="true" className="annotation-hydration-dot" />
          </div>
        </div>
      </div>
    </>
  );
}
