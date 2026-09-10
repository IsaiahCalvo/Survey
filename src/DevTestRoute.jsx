// DevTestRoute.jsx -- Dev-only component that loads a test PDF without authentication.
// Dynamically imported by main.jsx inside an `if (import.meta.env.DEV)` guard,
// so this file is never included in production bundles.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AuthContext } from './contexts/AuthContext';
import { MSGraphContext } from './contexts/MSGraphContext';
import ErrorBoundary from './components/ErrorBoundary';
import KeyboardShortcutsOverlay from './components/KeyboardShortcutsOverlay';
import App from './AppShell';
import PageReplacementExpiredHarness from './dev/PageReplacementExpiredHarness.jsx';
import DocumentEntityCatalogHarness from './dev/DocumentEntityCatalogHarness.jsx';
import { createLocalDocumentStore } from './services/localDocumentStore.js';
import { createLocalDocumentStateReader } from './services/localDocumentState.js';
import { randomUUID } from './utils/randomUUIDPolyfill.js';

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
const documentEntityCatalogE2ETemplates = [{
  id: 'entity-catalog-template', name: 'Document Entity Fixture', updatedAt: '2026-09-09T12:00:00.000Z',
  modules: [{ id: 'entity-module', name: 'Survey', categories: [{ id: 'entity-category',
    name: 'Walls', color: '#d8a84e', checklist: [] }] }],
  entities: [{ id: 'general-contractor', name: 'General Contractor', color: '#d8a84e', opacity: 0.7,
    borderColor: '#8b6422', borderOpacity: 0.8, matchFill: false },
  { id: 'subcontractor', name: 'Subcontractor', color: '#5ba1f0', opacity: 0.5,
    borderColor: null, borderOpacity: null, matchFill: true }],
}, {
  id: 'entity-catalog-changed-template', name: 'Changed Template (must not replace document list)',
  updatedAt: '2026-09-09T13:00:00.000Z',
  modules: [{ id: 'entity-module', name: 'Survey', categories: [{ id: 'entity-category',
    name: 'Walls', color: '#d8a84e', checklist: [] }] }],
  entities: [{ id: 'general-contractor', name: 'Renamed in template only', color: '#d85a5a', opacity: 0.4,
    borderColor: '#7b2020', borderOpacity: 0.9, matchFill: false },
  { id: 'template-only', name: 'Template-only choice', color: '#63c982', opacity: 0.6,
    borderColor: null, borderOpacity: null, matchFill: false }],
}, {
  id: 'wide-checklist-template', name: 'Wide checklist fixture', updatedAt: '2026-09-09T14:00:00.000Z',
  modules: [{ id: 'wide-checklist-module', name: 'Wide Export', categories: [{ id: 'wide-checklist-category',
    name: 'Wide Items', color: '#d8a84e', checklist: Array.from({ length: 27 }, (_, index) => ({
      id: `wide-check-${String(index + 1).padStart(2, '0')}`,
      text: `Wide check ${String(index + 1).padStart(2, '0')}`,
    })) }] }],
  entities: [{ id: 'general-contractor', name: 'General Contractor', color: '#d8a84e', opacity: 0.7,
    borderColor: '#8b6422', borderOpacity: 0.8, matchFill: false },
  { id: 'subcontractor', name: 'Subcontractor', color: '#5ba1f0', opacity: 0.5,
    borderColor: null, borderOpacity: null, matchFill: true }],
}, {
  id: 'document-survey-definition-template', name: 'Document Survey Definition Fixture',
  updatedAt: '2026-09-09T15:00:00.000Z',
  modules: [{ id: 'definition-module', name: 'Definition Module', categories: [{ id: 'definition-category',
    name: 'Definition Category', color: '#d8a84e', checklist: [
      { id: 'definition-check-one', text: 'Definition check one' },
      { id: 'definition-check-two', text: 'Definition check two' },
    ] }] }],
  entities: [{ id: 'definition-general-contractor', name: 'Definition General Contractor', color: '#d8a84e', opacity: 0.7,
    borderColor: '#8b6422', borderOpacity: 0.8, matchFill: false },
  { id: 'definition-subcontractor', name: 'Definition Subcontractor', color: '#5ba1f0', opacity: 0.5,
    borderColor: null, borderOpacity: null, matchFill: true }],
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

const deleteFixtureDatabase = dbName => new Promise((resolve, reject) => {
  let request;
  try { request = globalThis.indexedDB.deleteDatabase(dbName); }
  catch (error) { reject(error); return; }
  request.onsuccess = () => resolve();
  request.onerror = () => reject(request.error || new Error('Fixture data could not be removed.'));
  request.onblocked = () => reject(new Error('Fixture data is still open in another tab.'));
});

export function DevTestRoute({ pdfName, displayName = null, returnTab = null }) {
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState(null);
  const [catalogViewerMount, setCatalogViewerMount] = useState(0);
  const [catalogViewerCleanup, setCatalogViewerCleanup] = useState(null);
  const [catalogViewerStoredStatus, setCatalogViewerStoredStatus] = useState(null);
  const [surveyDefinitionPrivateTemplatesCleared, setSurveyDefinitionPrivateTemplatesCleared] = useState(false);
  const surveyTransitionE2E = new URLSearchParams(window.location.search)
    .get('surveyTransitionE2E') === '1';
  const surveyTemplateWorkflowE2E = new URLSearchParams(window.location.search)
    .get('surveyTemplateWorkflowE2E') === '1';
  const documentDeepLinkE2E = new URLSearchParams(window.location.search)
    .get('documentDeepLinkE2E') === '1';
  const pageReplacementExpiredE2E = new URLSearchParams(window.location.search)
    .get('pageReplacementExpiredE2E') === '1';
  const documentEntityCatalogE2E = new URLSearchParams(window.location.search)
    .get('documentEntityCatalogE2E') === '1';
  const documentEntityCatalogViewerE2E = new URLSearchParams(window.location.search)
    .get('documentEntityCatalogViewerE2E') === '1';
  const documentSurveyDefinitionViewerE2E = new URLSearchParams(window.location.search)
    .get('documentSurveyDefinitionViewerE2E') === '1';
  const documentOwnedViewerE2E = documentEntityCatalogViewerE2E || documentSurveyDefinitionViewerE2E;
  const catalogViewerDbNameRef = useRef(`survey-entity-catalog-viewer-${randomUUID()}`);
  const catalogViewerStoreRef = useRef(null);
  const catalogViewerLocalIdRef = useRef(null);
  const saveCatalogViewerLocalState = useCallback((...args) => {
    if (!catalogViewerStoreRef.current) throw new Error('The catalog viewer fixture is not ready.');
    return catalogViewerStoreRef.current.saveLocalDocumentState(...args);
  }, []);
  const replaceCatalogViewerLocalFile = useCallback((...args) => {
    if (!catalogViewerStoreRef.current) throw new Error('The catalog viewer fixture is not ready.');
    return catalogViewerStoreRef.current.replaceLocalDocument(...args);
  }, []);
  const inspectCatalogViewerStoredFile = useCallback(async (openedFile = null) => {
    try {
      const file = openedFile || await catalogViewerStoreRef.current.openLocalDocument(
        catalogViewerLocalIdRef.current,
      );
      const reader = createLocalDocumentStateReader(file);
      const readStatus = prefix => {
        const value = reader.getItem(`${prefix}_${file.localId}`);
        return value == null ? 'absent' : JSON.parse(value).status;
      };
      const next = { revision: file.localRevision,
        entityCatalog: readStatus('entityCatalog'),
        surveyDefinition: readStatus('surveyDefinition') };
      setCatalogViewerStoredStatus(next);
      return next;
    } catch {
      setCatalogViewerStoredStatus({ error: 'Stored fixture state could not be read.' });
      return null;
    }
  }, []);
  const removeCatalogViewerFixture = useCallback(async () => {
    const store = catalogViewerStoreRef.current;
    catalogViewerStoreRef.current = null;
    setCatalogViewerCleanup({ removed: null,
      message: 'Removing this fixture data…' });
    store?.close();
    try {
      await deleteFixtureDatabase(catalogViewerDbNameRef.current);
      setCatalogViewerCleanup({ removed: true,
        message: 'This fixture database was removed.' });
    } catch {
      setCatalogViewerCleanup({ removed: false,
        message: 'This fixture stopped, but its database could not be removed. Close other fixture tabs and reload.' });
    }
  }, []);

  if (documentOwnedViewerE2E) {
    window.__surveyTransitionE2ETemplates = documentSurveyDefinitionViewerE2E
      && surveyDefinitionPrivateTemplatesCleared
      ? []
      : documentEntityCatalogE2ETemplates;
  } else if (surveyTransitionE2E) {
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
        if (pageReplacementExpiredE2E || documentEntityCatalogE2E) { setStatus('ready'); return; }
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
        } else if (documentOwnedViewerE2E) {
          const store = createLocalDocumentStore({ indexedDB: globalThis.indexedDB,
            dbName: catalogViewerDbNameRef.current, timeoutMs: 2_000 });
          catalogViewerStoreRef.current = store;
          const manifest = await store.importLocalDocument(file);
          catalogViewerLocalIdRef.current = manifest.localId;
          window.__devTestPdf = await store.openLocalDocument(manifest.localId);
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
    return () => {
      cancelled = true;
      if (documentOwnedViewerE2E) {
        catalogViewerStoreRef.current?.close();
        try { globalThis.indexedDB.deleteDatabase(catalogViewerDbNameRef.current); } catch { /* exact fixture DB */ }
      }
    };
  }, [pdfName, displayName, documentDeepLinkE2E, documentEntityCatalogE2E,
    documentOwnedViewerE2E, pageReplacementExpiredE2E]);

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
  if (documentEntityCatalogE2E) return <DocumentEntityCatalogHarness />;
  if (documentOwnedViewerE2E && catalogViewerCleanup) return <main style={{ minHeight: '100vh',
    padding: '32px', color: '#20242b', background: '#f5f5f5',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
    <h1>{documentSurveyDefinitionViewerE2E
      ? 'Document survey definition viewer fixture' : 'Document entity list viewer fixture'}</h1>
    <p data-document-entity-catalog-viewer-fixture-removed={catalogViewerCleanup.removed == null
      ? 'pending' : String(catalogViewerCleanup.removed)}>{catalogViewerCleanup.message}</p>
  </main>;
  return (
    <ErrorBoundary>
      <AuthContext.Provider value={mockAuthValue}>
        <MSGraphContext.Provider value={mockMSGraphValue}>
          <App key={documentOwnedViewerE2E ? `document-owned-viewer-${catalogViewerMount}` : 'app'}
            devPreviewReturnTab={returnTab}
            documentEntityCatalogEnabled={documentOwnedViewerE2E}
            documentSurveyDefinitionEnabled={documentSurveyDefinitionViewerE2E}
            localDocumentStateWriter={documentOwnedViewerE2E
              ? saveCatalogViewerLocalState : null}
            localDocumentFileReplacer={documentOwnedViewerE2E
              ? replaceCatalogViewerLocalFile : null} />
          {documentEntityCatalogViewerE2E && <button type="button"
            data-document-entity-catalog-reopen
            style={{ position: 'fixed', right: 70, top: 12, zIndex: 9000 }}
            onClick={() => { void (async () => {
              window.__devTestPdf = await catalogViewerStoreRef.current.openLocalDocument(
                catalogViewerLocalIdRef.current,
              );
              setCatalogViewerMount(value => value + 1);
            })(); }}>Reopen stored fixture</button>}
          {documentSurveyDefinitionViewerE2E && <button type="button"
            data-document-survey-definition-reopen-without-private-templates
            style={{ position: 'fixed', right: 70, top: 52, zIndex: 9000 }}
            onClick={() => { void (async () => {
              setSurveyDefinitionPrivateTemplatesCleared(true);
              const openedFile = await catalogViewerStoreRef.current.openLocalDocument(
                catalogViewerLocalIdRef.current,
              );
              await inspectCatalogViewerStoredFile(openedFile);
              window.__devTestPdf = openedFile;
              setCatalogViewerMount(value => value + 1);
            })(); }}>Reopen without private templates</button>}
          {documentSurveyDefinitionViewerE2E && <button type="button"
            data-document-survey-definition-inspect-stored-fixture
            style={{ position: 'fixed', right: 70, top: 92, zIndex: 9000 }}
            onClick={() => { void inspectCatalogViewerStoredFile(); }}>Inspect stored fixture</button>}
          {documentSurveyDefinitionViewerE2E && catalogViewerStoredStatus && <output
            data-document-survey-definition-stored-status
            style={{ position: 'fixed', right: 70, top: 132, zIndex: 9000, padding: 8,
              background: '#202631', color: '#f4f6f8', border: '1px solid #465164' }}>
            {catalogViewerStoredStatus.error || `Stored revision: ${catalogViewerStoredStatus.revision}; `
              + `entity catalog: ${catalogViewerStoredStatus.entityCatalog}; `
              + `survey definition: ${catalogViewerStoredStatus.surveyDefinition}`}
          </output>}
          {documentOwnedViewerE2E && <button type="button"
            data-document-entity-catalog-viewer-remove-fixture
            style={{ position: 'fixed', right: 238, top: 12, zIndex: 9000 }}
            onClick={() => { void removeCatalogViewerFixture(); }}>Remove fixture data</button>}
          <KeyboardShortcutsOverlay />
        </MSGraphContext.Provider>
      </AuthContext.Provider>
    </ErrorBoundary>
  );
}
