// DevTestRoute.jsx -- Dev-only component that loads a test PDF without authentication.
// Dynamically imported by main.jsx inside an `if (import.meta.env.DEV)` guard,
// so this file is never included in production bundles.
import { useEffect, useState } from 'react';
import { AuthContext } from './contexts/AuthContext';
import { MSGraphContext } from './contexts/MSGraphContext';
import ErrorBoundary from './components/ErrorBoundary';
import KeyboardShortcutsOverlay from './components/KeyboardShortcutsOverlay';
import App from './AppShell';

const noop = () => {};
const asyncNoop = async () => {};

const mockAuthValue = {
  user: null,
  session: null,
  loading: false,
  signUp: asyncNoop,
  signIn: asyncNoop,
  signInWithGoogle: asyncNoop,
  signInWithSSO: asyncNoop,
  signOut: asyncNoop,
  resetPassword: asyncNoop,
  updatePassword: asyncNoop,
  updateProfile: asyncNoop,
  refreshSubscriptionTier: asyncNoop,
  isAuthenticated: false,
  isSupabaseAvailable: false,
  plan: 'developer',
  tier: 'developer',
  features: {
    cloudSync: true,
    advancedSurvey: true,
    excelExport: true,
    sso: true,
  },
};

const mockMSGraphValue = {
  msalInstance: null,
  account: null,
  graphClient: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,
  login: asyncNoop,
  logout: asyncNoop,
  updateLastUsed: asyncNoop,
  connectionRestored: true,
  needsReconnect: false,
  handleOAuthCallback: asyncNoop,
  ensureFreshToken: async () => true,
};

export function DevTestRoute({ pdfName }) {
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function loadPdf() {
      try {
        const url = `/debug-fixtures/${encodeURIComponent(pdfName)}`;
        const resp = await fetch(url);
        if (!resp.ok) {
          throw new Error(`Failed to fetch test PDF: ${resp.status} ${resp.statusText}`);
        }
        const blob = await resp.blob();
        const file = new File([blob], pdfName, { type: 'application/pdf' });

        if (cancelled) return;

        // Set the file on window so App's useEffect can auto-open it
        window.__devTestPdf = file;
        setStatus('ready');
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          setStatus('error');
        }
      }
    }

    loadPdf();
    return () => { cancelled = true; };
  }, [pdfName]);

  if (status === 'loading') {
    return (
      <div style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#F5F5F5',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '16px', color: '#666' }}>
            Loading test PDF: {pdfName}...
          </div>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#F5F5F5',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '16px', color: '#cc0000', marginBottom: '8px' }}>
            Failed to load test PDF
          </div>
          <div style={{ fontSize: '14px', color: '#666' }}>{error}</div>
        </div>
      </div>
    );
  }

  // status === 'ready'
  return (
    <ErrorBoundary>
      <AuthContext.Provider value={mockAuthValue}>
        <MSGraphContext.Provider value={mockMSGraphValue}>
          <App />
          <KeyboardShortcutsOverlay />
        </MSGraphContext.Provider>
      </AuthContext.Provider>
    </ErrorBoundary>
  );
}
