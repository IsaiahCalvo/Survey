// DevTestRoute.jsx -- Dev-only component that loads a test PDF without authentication.
// Dynamically imported by main.jsx inside an `if (import.meta.env.DEV)` guard,
// so this file is never included in production bundles.
import { useEffect, useState } from 'react';
import { AuthContext } from './contexts/AuthContext';
import { MSGraphContext } from './contexts/MSGraphContext';
import ErrorBoundary from './components/ErrorBoundary';
import KeyboardShortcutsOverlay from './components/KeyboardShortcutsOverlay';
import App from './AppShell';
import PageReplacementExpiredHarness from './dev/PageReplacementExpiredHarness.jsx';

const noop = () => {};
const asyncNoop = async () => {};
const mockUser = {
  id: 'dev-test-user',
  email: 'dev-test-user@example.invalid',
  user_metadata: {
    first_name: 'Dev',
    last_name: 'Test User',
    full_name: 'Dev Test User',
  },
};

const mockAuthValue = {
  user: mockUser,
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
  // The route supplies local document identity without impersonating a real
  // Supabase session; cloud-aware consumers must remain offline.
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

const surveyTransitionE2ETemplates = [{
  id: 'kal436-template',
  name: 'KAL-436 Preservation Template',
  modules: [{
    id: 'kal436-module',
    name: 'Existing Survey Data',
    categories: [{
      id: 'kal436-category',
      name: 'Walls',
      color: '#d8a84e',
    }],
  }, {
    id: 'kal436-other-module',
    name: 'Other Survey Data',
    categories: [{
      id: 'kal436-other-category',
      name: 'Doors',
      color: '#5ba1f0',
    }],
  }],
}];

const SURVEY_TEMPLATE_WORKFLOW_STORAGE_KEY = 'mobileWorkflowTemplates';

const readSurveyTemplateWorkflowTemplates = () => {
  try {
    const value = JSON.parse(localStorage.getItem(SURVEY_TEMPLATE_WORKFLOW_STORAGE_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
};

export function DevTestRoute({ pdfName, displayName = null, returnTab = null }) {
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState(null);
  const surveyTransitionE2E = new URLSearchParams(window.location.search)
    .get('surveyTransitionE2E') === '1';
  const surveyTemplateWorkflowE2E = new URLSearchParams(window.location.search)
    .get('surveyTemplateWorkflowE2E') === '1';
  const documentDeepLinkE2E = new URLSearchParams(window.location.search)
    .get('documentDeepLinkE2E') === '1';
  const pageReplacementExpiredE2E = new URLSearchParams(window.location.search)
    .get('pageReplacementExpiredE2E') === '1';

  if (surveyTransitionE2E) {
    window.__surveyTransitionE2ETemplates = surveyTransitionE2ETemplates;
  } else if (surveyTemplateWorkflowE2E) {
    // The mobile workflow harness creates this tree through TemplatesEditor,
    // then opens the real viewer. Carry that exact saved model across the
    // dev-only route boundary without involving Supabase or test accounts.
    window.__surveyTransitionE2ETemplates = readSurveyTemplateWorkflowTemplates();
  }

  useEffect(() => {
    let cancelled = false;

    async function loadPdf() {
      try {
        if (pageReplacementExpiredE2E) { setStatus('ready'); return; }
        const url = `/debug-fixtures/${encodeURIComponent(pdfName)}`;
        const resp = await fetch(url);
        if (!resp.ok) {
          throw new Error(`Failed to fetch test PDF: ${resp.status} ${resp.statusText}`);
        }
        const blob = await resp.blob();
        const file = new File([blob], displayName || pdfName, { type: 'application/pdf' });

        if (cancelled) return;

        if (documentDeepLinkE2E) {
          window.__documentDeepLinkE2EDocuments = [{
            id: 'deep-link-test-document',
            name: file.name,
            size: file.size,
            filePath: '/debug/deep-link-test.pdf',
            __localFile: file,
          }];
        } else {
          // Set the file on window so App's useEffect can auto-open it
          window.__devTestPdf = file;
        }
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
  }, [pdfName, displayName, documentDeepLinkE2E, pageReplacementExpiredE2E]);

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
  if (pageReplacementExpiredE2E) return <PageReplacementExpiredHarness />;
  return (
    <ErrorBoundary>
      <AuthContext.Provider value={mockAuthValue}>
        <MSGraphContext.Provider value={mockMSGraphValue}>
          <App devPreviewReturnTab={returnTab} />
          <KeyboardShortcutsOverlay />
        </MSGraphContext.Provider>
      </AuthContext.Provider>
    </ErrorBoundary>
  );
}
