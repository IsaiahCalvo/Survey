// DevTestRoute.jsx -- Dev-only component that loads a test PDF without authentication.
// Dynamically imported by main.jsx inside an `if (import.meta.env.DEV)` guard,
// so this file is never included in production bundles.
import { useEffect, useState } from 'react';
import { AuthContext } from './contexts/AuthContext';
import { MSGraphContext } from './contexts/MSGraphContext';
import ErrorBoundary from './components/ErrorBoundary';
import KeyboardShortcutsOverlay from './components/KeyboardShortcutsOverlay';
import SyncStatusChip from './components/SyncStatusChip';
import App from './AppShell';

// Editor tools on this route are real. Live account / auth mutations
// fail-closed via previewBlocked so Settings cannot claim a reset email,
// save, upgrade, or sign-out actually happened.
const asyncNoop = async () => {};
const previewBlocked = (action) => async () => {
  throw new Error(`Test PDF cannot ${action}.`);
};
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
  signUp: previewBlocked('create an account'),
  signIn: previewBlocked('sign in'),
  signInWithGoogle: previewBlocked('start Google sign-in'),
  signInWithSSO: previewBlocked('start SSO'),
  signOut: previewBlocked('sign out'),
  resetPassword: previewBlocked('send password reset emails'),
  updatePassword: previewBlocked('update passwords'),
  updateProfile: previewBlocked('save profile changes'),
  refreshSubscriptionTier: previewBlocked('refresh subscription status'),
  resendConfirmation: previewBlocked('resend confirmation emails'),
  linkGoogleIdentity: previewBlocked('start Google OAuth'),
  unlinkProvider: previewBlocked('unlink providers'),
  deleteAccount: previewBlocked('delete accounts'),
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
  login: previewBlocked('start Microsoft login'),
  logout: previewBlocked('disconnect Microsoft'),
  updateLastUsed: asyncNoop,
  connectionRestored: true,
  needsReconnect: false,
  handleOAuthCallback: asyncNoop,
  ensureFreshToken: async () => false,
};

const makeKal436Modules = () => [{
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
}];

// KAL-436 stays entity-less so existing place-marker E2E still skip the
// desktop Entity dialog. The second local template seeds entities for the
// rail picker leftover (not a cloud persist seam). Separate module trees
// so a category mutation on one template cannot alias the other.
const surveyTransitionE2ETemplates = [{
  id: 'kal436-template',
  name: 'KAL-436 Preservation Template',
  modules: makeKal436Modules(),
}, {
  id: 'kal436-entities-template',
  name: 'Survey Entities Template',
  entities: [
    { id: 'kal436-entity-gc', name: 'GC', color: 'rgba(216,168,78,0.5)' },
    { id: 'kal436-entity-sub', name: 'Subcontractor', color: 'rgba(122,183,230,0.5)' },
    { id: 'kal436-entity-complete', name: '100% Complete', color: 'rgba(166,224,122,0.5)' },
  ],
  modules: makeKal436Modules(),
}, {
  // Local seed only (not a cloud persist seam). One empty module so the
  // empty-state "Create category for empty module" start-adding path can
  // run without deleting the last KAL-436 category (that leftover stands).
  id: 'kal436-empty-module-template',
  name: 'Empty Module Template',
  modules: [{
    id: 'kal436-empty-module',
    name: 'Empty Survey Data',
    categories: [],
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

// DEV-only live host for SyncStatusChip. ?testPdf= has no file.id, so the
// sidebar chip stays correctly hidden (leftover X-01). This overlay lets
// pending+N vs Offline be proven without enabling cloud sync or inventing a
// document id.
function DevSyncChipPreview() {
  const [preview, setPreview] = useState(null);
  useEffect(() => {
    window.__test_setSyncChipPreview = (next) => {
      setPreview(next && typeof next === 'object' ? next : null);
    };
    return () => {
      try { delete window.__test_setSyncChipPreview; } catch { /* swallow */ }
    };
  }, []);
  if (!preview) return null;
  return (
    <div data-sync-chip-preview style={{ position: 'fixed', top: 8, right: 8, zIndex: 4000 }}>
      <SyncStatusChip
        status={preview.status || { stage: 'idle' }}
        queueSize={preview.queueSize ?? 0}
        enabled
      />
    </div>
  );
}

export function DevTestRoute({ pdfName, displayName = null, returnTab = null }) {
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState(null);
  const surveyTransitionE2E = new URLSearchParams(window.location.search)
    .get('surveyTransitionE2E') === '1';
  const surveyTemplateWorkflowE2E = new URLSearchParams(window.location.search)
    .get('surveyTemplateWorkflowE2E') === '1';
  const documentDeepLinkE2E = new URLSearchParams(window.location.search)
    .get('documentDeepLinkE2E') === '1';

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
        const url = `/debug-fixtures/${encodeURIComponent(pdfName)}`;
        const resp = await fetch(url);
        if (!resp.ok) {
          throw new Error(`Failed to fetch test PDF: ${resp.status} ${resp.statusText}`);
        }
        const blob = await resp.blob();
        const file = new File([blob], displayName || pdfName, { type: 'application/pdf' });
        // DEV / ?testPdf= only. History keys off this local id so A-07 can
        // run against in-memory/localStorage events. Do NOT set file.id —
        // cloud hydration/sync/presence treat that as a real Supabase row.
        file.__localHistoryDocumentId = `dev-testpdf:${pdfName}`;

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
  }, [pdfName, displayName, documentDeepLinkE2E]);

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
          <App devPreviewReturnTab={returnTab} />
          <DevSyncChipPreview />
          <KeyboardShortcutsOverlay />
        </MSGraphContext.Provider>
      </AuthContext.Provider>
    </ErrorBoundary>
  );
}
