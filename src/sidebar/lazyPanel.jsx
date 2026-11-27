import React, { lazy } from 'react';

function LazyPanelFallback({ label = 'This panel' }) {
  return (
    <div
      role="status"
      data-sidebar-lazy-fallback="true"
      style={{
        padding: '20px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        color: 'var(--text-2, #b8b8be)',
        fontSize: '13px',
        lineHeight: 1.45,
      }}
    >
      <div>{label} updated while this page was open. Reload to use it.</div>
      <div>
        <button
          type="button"
          className="hub-btn hub-btn--primary"
          onClick={() => {
            try {
              window.location.reload();
            } catch {
              /* ignore */
            }
          }}
        >
          Reload page
        </button>
      </div>
    </div>
  );
}

/**
 * Resolves a dynamic import safely for React.lazy.
 * When Vite's `vite:preloadError` listener calls `event.preventDefault()` on a
 * stale post-deploy chunk, the dynamic import can resolve to `undefined` before
 * the reload takes effect, causing `Cannot read properties of undefined (reading 'default')`
 * (#1819). Guarding the resolved module prevents a whole-viewer Oops crash.
 */
export async function resolveLazyDefaultModule(loader, label = 'This panel') {
  try {
    const mod = await loader();
    if (mod && typeof mod.default !== 'undefined' && mod.default !== null) {
      return mod;
    }
  } catch {
    // Handled by inline reload fallback below so the viewer stays usable.
  }
  const Fallback = () => <LazyPanelFallback label={label} />;
  Fallback.displayName = 'LazyPanelFallback';
  return { default: Fallback };
}

export function safeLazyPanel(loader, label = 'This panel') {
  return lazy(() => resolveLazyDefaultModule(loader, label));
}

export class SidebarPanelErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.warn('[PDFSidebar] panel error contained:', error);
  }

  render() {
    if (this.state.hasError) {
      return <LazyPanelFallback label={this.props.label || 'This panel'} />;
    }
    return this.props.children;
  }
}
