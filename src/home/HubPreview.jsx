/* DEV-ONLY preview harness for the Survey Hub redesign.
   Mounted by main.jsx when the URL has `?hubPreview=1`, so the new home can be
   built and reviewed in isolation without auth, Supabase, or the real App tree.
   Never imported in production paths.

   Mock data mirrors the real document / project / template shapes and includes
   SAMPLE teammates (members directory, project rosters, file owners) so the
   preview reads one-to-one with the design mockup. The bulk-action handlers
   run on local state so duplicate / move / copy / delete are demonstrable. */
import { useEffect, useRef, useState } from 'react';
import SurveyHub from './SurveyHub';
import CreateProjectModal from './CreateProjectModal';
import ToastHost from '../components/ToastHost';
import { AuthContext } from '../contexts/AuthContext';
import { MSGraphContext } from '../contexts/MSGraphContext';

/* Mock context values so the Settings page (AccountSettings) can render in the
   preview without a real backend. Same pattern as src/DevTestRoute.jsx. */
const asyncNoop = async () => {};

/* `?signedIn=1` gives the mock auth a signed-in user so the Settings page
   (which reads the user from AuthContext, not the hub's prop) actually opens. */
const previewSignedIn = typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).get('signedIn') === '1';
const PREVIEW_AUTH_USER = {
  id: 'u1',
  email: 'isaiah@example.com',
  user_metadata: { first_name: 'Isaiah', last_name: 'Calvo' },
  app_metadata: { provider: 'email' },
  identities: [],
};

const mockAuthValue = {
  user: previewSignedIn ? PREVIEW_AUTH_USER : null,
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

const iso = (daysAgo, h = 10, m = 0) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

/* Sample teammate directory. */
const MOCK_MEMBERS = [
  { id: 'IC', name: 'Isaiah Calvo', role: 'Project Engineer', color: '#d8a84e', online: true },
  { id: 'AS', name: 'Anna Sato', role: 'Architect', color: '#c293e6', online: true },
  { id: 'RD', name: 'Ravi Doshi', role: 'MEP Lead', color: '#a6e07a', online: false },
  { id: 'JM', name: 'Jordan Mei', role: 'Security Eng', color: '#7ab7e6', online: true },
  { id: 'KM', name: 'Kira Moss', role: 'Spec Writer', color: '#e69a7a', online: false },
];

const MOCK_PROJECTS = [
  { id: 'p1', name: 'Tower 5 — Security', user_id: 'u1', created_at: iso(40), members: ['IC', 'JM', 'RD'] },
  { id: 'p2', name: 'Lab Reno — MEP', user_id: 'u1', created_at: iso(30), members: ['IC', 'AS', 'RD', 'KM'] },
  { id: 'p3', name: 'MEP Phase 2', user_id: 'u1', created_at: iso(20), members: ['RD', 'IC'] },
];

const INITIAL_DOCUMENTS = [
  { id: 'd1', name: 'SE-011 Security Shop Drawings.pdf', file_size: 25_050_000, project_id: 'p1', owner: 'IC', pages: 48, created_at: iso(9), updated_at: iso(2, 9, 14), shared: false },
  { id: 'd2', name: 'Package 2 — Rev 4 — IC.pdf', file_size: 7_930_000, project_id: null, owner: 'IC', pages: 22, created_at: iso(8), updated_at: iso(1, 16, 48), shared: true },
  { id: 'd3', name: 'RFI-014 Lobby Camera Coverage.pdf', file_size: 1_820_000, project_id: 'p1', owner: 'JM', pages: 9, created_at: iso(1), updated_at: iso(0, 11, 2), shared: false },
  { id: 'd4', name: 'Door Hardware Schedule — A.601.pdf', file_size: 3_400_000, project_id: 'p2', owner: 'AS', pages: 14, created_at: iso(15), updated_at: iso(15, 17, 25), shared: false },
  { id: 'd5', name: 'MEP Coordination — Level 3.pdf', file_size: 12_400_000, project_id: 'p3', owner: 'RD', pages: 31, created_at: iso(5), updated_at: iso(1, 10, 6), shared: true },
  { id: 'd6', name: 'test.pdf', file_size: 2_400, project_id: null, owner: 'IC', pages: 1, created_at: iso(12), updated_at: iso(5, 13, 51), shared: false },
];

const makeLongDocumentFixture = () => Array.from({ length: 3 }).flatMap((_, batch) => (
  INITIAL_DOCUMENTS.map((doc, index) => ({
    ...doc,
    id: `${doc.id}-long-${batch}`,
    name: batch === 0 ? doc.name : copyName(doc.name).replace('-copy', ` demo ${batch + 1}`),
    updated_at: iso((batch * INITIAL_DOCUMENTS.length) + index, 9 + (index % 7), 10 + (index * 3) % 40),
  }))
));

const MOCK_TEMPLATES = [
  {
    id: 't1', name: 'Security Walk-Through', created_at: iso(28),
    entities: [
      { id: 'e1', name: 'GC', color: 'rgba(216,168,78,0.5)' },
      { id: 'e2', name: 'Subcontractor', color: 'rgba(122,183,230,0.5)' },
      { id: 'e3', name: '100% Complete', color: 'rgba(166,224,122,0.5)' },
    ],
    modules: [
      {
        id: 'm1', name: 'Installation Phase',
        categories: [
          { id: 'c1', name: 'Cameras', checklist: [
            { id: 'i1', text: 'Is the camera cable pulled?' },
            { id: 'i2', text: 'Is the camera installed?' },
          ] },
          { id: 'c2', name: 'Doors', checklist: [
            { id: 'i3', text: 'Is the door roughed in?' },
            { id: 'i4', text: 'Are the door devices installed?' },
          ] },
        ],
      },
      { id: 'm2', name: 'Commissioning Phase', categories: [
        { id: 'c3', name: 'Cameras', checklist: [{ id: 'i5', text: 'Camera tested and online?' }] },
      ] },
    ],
  },
  {
    id: 't2', name: 'MEP As-Built Markup', created_at: iso(22),
    entities: [
      { id: 'e4', name: 'MEP', color: 'rgba(122,183,230,0.5)' },
      { id: 'e5', name: 'Architect', color: 'rgba(194,147,230,0.5)' },
    ],
    modules: [
      { id: 'm3', name: 'Equipment', categories: [
        { id: 'c4', name: 'AHU Equipment', checklist: [{ id: 'i6', text: 'Tags updated?' }] },
      ] },
    ],
  },
];

/* Append "-copy" before the file extension. */
const copyName = (name = '') => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0, dot)}-copy${name.slice(dot)}` : `${name}-copy`;
};
let copyCounter = 0;
const newId = () => `d-copy-${Date.now()}-${copyCounter++}`;

export const MOBILE_WORKFLOW_STORAGE_KEYS = Object.freeze({
  documents: 'mobileWorkflowDocuments',
  projectPreferences: 'mobileWorkflowProjectPreferences',
  projects: 'mobileWorkflowProjects',
  templates: 'mobileWorkflowTemplates',
});

const readWorkflowFixture = (key, fallback) => {
  try {
    const stored = JSON.parse(localStorage.getItem(key) || 'null');
    if (Array.isArray(stored)) return stored;
  } catch { /* a corrupt test fixture resets to the stable seed */ }
  return fallback;
};

const readWorkflowObject = (key, fallback = {}) => {
  try {
    const stored = JSON.parse(localStorage.getItem(key) || 'null');
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) return stored;
  } catch { /* a corrupt test fixture resets to the stable seed */ }
  return fallback;
};

const persistWorkflowFixture = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage is optional outside E2E */ }
};

export default function HubPreview() {
  /* `?empty=1` renders the hub with zero documents/projects/templates so the
     three empty states can be reviewed with real code (dev-only, like the rest
     of this harness). */
  const params = new URLSearchParams(window.location.search);
  const emptyFixture = params.get('empty') === '1';
  const longDocsFixture = params.get('longDocs') === '1';
  const loadingFixture = params.get('hubLoading');
  const errorFixture = params.get('hubError');
  const workflowE2E = params.get('workflowE2E') === '1';
  const previewHasNoData = emptyFixture
    || ['documents', 'projects', 'templates'].includes(loadingFixture)
    || ['documents', 'projects', 'templates'].includes(errorFixture);
  const [documents, setDocuments] = useState(() => {
    const fallback = previewHasNoData ? [] : (longDocsFixture ? makeLongDocumentFixture() : INITIAL_DOCUMENTS);
    return workflowE2E ? readWorkflowFixture(MOBILE_WORKFLOW_STORAGE_KEYS.documents, fallback) : fallback;
  });
  const [projects, setProjects] = useState(() => {
    const fallback = previewHasNoData ? [] : MOCK_PROJECTS;
    return workflowE2E ? readWorkflowFixture(MOBILE_WORKFLOW_STORAGE_KEYS.projects, fallback) : fallback;
  });
  const [templates, setTemplates] = useState(() => {
    const fallback = previewHasNoData ? [] : MOCK_TEMPLATES;
    return workflowE2E ? readWorkflowFixture(MOBILE_WORKFLOW_STORAGE_KEYS.templates, fallback) : fallback;
  });
  const [projectPreferences, setProjectPreferences] = useState(() => (
    workflowE2E
      ? readWorkflowObject(MOBILE_WORKFLOW_STORAGE_KEYS.projectPreferences)
      : {}
  ));
  const [loadErrors, setLoadErrors] = useState(() => ({
    documents: errorFixture === 'documents' ? new Error('Documents could not be loaded.') : null,
    projects: errorFixture === 'projects' ? new Error('Projects could not be loaded.') : null,
    templates: errorFixture === 'templates' ? new Error('Templates could not be loaded.') : null,
  }));
  const workflowUploadInputRef = useRef(null);
  const workflowUploadTargetRef = useRef(null);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [projectDraftName, setProjectDraftName] = useState('');
  const [projectDraftFiles, setProjectDraftFiles] = useState([]);
  const initialTab = params.get('tab');
  const initialMobileDetailOpen = params.get('mobileState') === 'detail';

  useEffect(() => {
    if (!workflowE2E) return;
    persistWorkflowFixture(MOBILE_WORKFLOW_STORAGE_KEYS.documents, documents);
    persistWorkflowFixture(MOBILE_WORKFLOW_STORAGE_KEYS.projectPreferences, projectPreferences);
    persistWorkflowFixture(MOBILE_WORKFLOW_STORAGE_KEYS.projects, projects);
    persistWorkflowFixture(MOBILE_WORKFLOW_STORAGE_KEYS.templates, templates);
    window.__mobileWorkflowState = { documents, projectPreferences, projects, templates };
  }, [documents, projectPreferences, projects, templates, workflowE2E]);

  const handleOpenDocument = (document, returnTab = 'documents') => {
    const viewerParams = new URLSearchParams({
      testPdf: workflowE2E ? 'clickable-link-test.pdf' : 'Package 2 - Rev 4 -- IC.pdf',
      previewName: document?.name || 'Document.pdf',
      returnTab,
    });
    if (workflowE2E) {
      viewerParams.set('workflowE2E', '1');
      viewerParams.set('surveyTemplateWorkflowE2E', '1');
      viewerParams.set('mobileNav', 'tabs');
      viewerParams.set('nativeShell', 'expo');
    }
    window.location.assign(`/?${viewerParams.toString()}`);
  };

  const handleDuplicate = (docs) => {
    const copies = docs.map((d) => ({ ...d, id: newId(), name: copyName(d.name), updated_at: new Date().toISOString() }));
    setDocuments((prev) => [...copies, ...prev]);
  };

  const handleDuplicateProjects = (items) => {
    const now = new Date().toISOString();
    const projectCopies = [];
    const documentCopies = [];
    (items || []).forEach((source, index) => {
      const projectId = `workflow-project-copy-${Date.now()}-${index}`;
      projectCopies.push({
        ...source,
        id: projectId,
        name: `${source.name} (copy)`,
        created_at: now,
        updated_at: now,
      });
      documents.filter((document) => document.project_id === source.id).forEach((document, documentIndex) => {
        documentCopies.push({
          ...document,
          id: `workflow-document-copy-${Date.now()}-${index}-${documentIndex}`,
          name: copyName(document.name),
          project_id: projectId,
          created_at: now,
          updated_at: now,
        });
      });
    });
    if (projectCopies.length) setProjects((prev) => [...projectCopies, ...prev]);
    if (documentCopies.length) setDocuments((prev) => [...documentCopies, ...prev]);
  };

  const handleProjectPreferencesChange = (patch) => {
    setProjectPreferences((previous) => (
      typeof patch === 'function' ? patch(previous) : { ...previous, ...(patch || {}) }
    ));
  };

  const retryLoad = (kind) => {
    if (kind === 'documents') setDocuments(longDocsFixture ? makeLongDocumentFixture() : INITIAL_DOCUMENTS);
    if (kind === 'projects') setProjects(MOCK_PROJECTS);
    if (kind === 'templates') setTemplates(MOCK_TEMPLATES);
    setLoadErrors((previous) => ({ ...previous, [kind]: null }));
  };

  const handleDelete = (docs) => {
    const ids = new Set(docs.map((d) => d.id));
    setDocuments((prev) => prev.filter((d) => !ids.has(d.id)));
  };

  const handleMoveCopy = (docs, projectId, mode) => {
    const ids = new Set(docs.map((d) => d.id));
    if (mode === 'move') {
      setDocuments((prev) => prev.map((d) => (ids.has(d.id) ? { ...d, project_id: projectId } : d)));
    } else {
      const copies = docs.map((d) => ({ ...d, id: newId(), project_id: projectId, updated_at: new Date().toISOString() }));
      setDocuments((prev) => [...copies, ...prev]);
    }
  };

  const handleCreateProject = () => {
    if (!workflowE2E) {
      console.log('[hub preview] new project');
      return null;
    }
    setProjectDraftName('');
    setProjectDraftFiles([]);
    setProjectModalOpen(true);
    return null;
  };

  const workflowRowsForFiles = (files, projectId) => {
    const now = new Date().toISOString();
    return files.map((file, index) => ({
      id: `workflow-document-${Date.now()}-${index}`,
      name: file.name,
      file_size: file.size,
      mime_type: file.type || 'application/pdf',
      project_id: projectId,
      user_id: 'u1',
      owner: 'IC',
      created_at: now,
      updated_at: now,
    }));
  };

  const confirmCreateProject = () => {
    const name = projectDraftName.trim();
    if (!name) return;
    const now = new Date().toISOString();
    const project = {
      id: `workflow-project-${Date.now()}`,
      name,
      user_id: 'u1',
      members: ['IC'],
      created_at: now,
      updated_at: now,
    };
    setProjects((prev) => [project, ...prev]);
    const acceptedFiles = projectDraftFiles.filter((file) => (
      file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    ));
    if (acceptedFiles.length) {
      setDocuments((prev) => [...workflowRowsForFiles(acceptedFiles, project.id), ...prev]);
    }
    setProjectModalOpen(false);
    setProjectDraftName('');
    setProjectDraftFiles([]);
  };

  const handleRenameProject = (project, name) => {
    if (!project?.id || !name) return false;
    setProjects((prev) => prev.map((item) => (
      item.id === project.id ? { ...item, name, updated_at: new Date().toISOString() } : item
    )));
    return true;
  };

  const handleDeleteProjects = (items) => {
    const ids = new Set((items || []).map((item) => item?.id).filter(Boolean));
    if (ids.size === 0) return false;
    setProjects((prev) => prev.filter((project) => !ids.has(project.id)));
    setDocuments((prev) => prev.filter((document) => !ids.has(document.project_id)));
    return true;
  };

  const handleRenameDocument = (document, name) => {
    if (!document?.id || !name) return false;
    setDocuments((prev) => prev.map((item) => (
      item.id === document.id ? { ...item, name, updated_at: new Date().toISOString() } : item
    )));
    return true;
  };

  const handleUpload = (projectId = null) => {
    if (!workflowE2E) {
      console.log('[hub preview] upload');
      return;
    }
    workflowUploadTargetRef.current = projectId || null;
    if (workflowUploadInputRef.current) {
      workflowUploadInputRef.current.value = '';
      workflowUploadInputRef.current.click();
    }
  };

  const handleWorkflowFiles = (fileList) => {
    const files = Array.from(fileList || []).filter((file) => (
      file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    ));
    if (files.length === 0) return;
    const projectId = workflowUploadTargetRef.current;
    const rows = workflowRowsForFiles(files, projectId);
    setDocuments((prev) => [...rows, ...prev]);
  };

  const handleCreateTemplate = () => {
    if (!workflowE2E) {
      console.log('[hub preview] new template');
      return null;
    }
    const template = {
      id: `workflow-template-${Date.now()}`,
      name: `Untitled Template ${templates.length + 1}`,
      created_at: new Date().toISOString(),
      entities: [],
      modules: [],
    };
    setTemplates((prev) => [template, ...prev]);
    return template;
  };

  return (
    <AuthContext.Provider value={mockAuthValue}>
      <MSGraphContext.Provider value={mockMSGraphValue}>
        <div style={{ width: '100vw', height: '100vh' }}>
          <SurveyHub
            documents={documents}
            projects={projects}
            templates={templates}
            documentsInitialLoading={loadingFixture === 'documents'}
            documentsLoadError={loadErrors.documents}
            onRetryDocuments={() => retryLoad('documents')}
            projectsInitialLoading={loadingFixture === 'projects'}
            projectsLoadError={loadErrors.projects}
            onRetryProjects={() => retryLoad('projects')}
            templatesInitialLoading={loadingFixture === 'templates'}
            templatesLoadError={loadErrors.templates}
            onRetryTemplates={() => retryLoad('templates')}
            members={MOCK_MEMBERS}
            user={{ name: 'Isaiah Calvo', email: 'isaiahcalvo123@gmail.com' }}
            isPro
            initialTab={initialTab}
            initialMobileDetailOpen={initialMobileDetailOpen}
            onOpenDocument={handleOpenDocument}
            onUpload={handleUpload}
            onCreateProject={handleCreateProject}
            onRenameProject={handleRenameProject}
            onDeleteProjects={handleDeleteProjects}
            onDuplicateProjects={handleDuplicateProjects}
            onCreateTemplate={handleCreateTemplate}
            onSaveTemplates={setTemplates}
            onDuplicateDocuments={handleDuplicate}
            onDeleteDocuments={handleDelete}
            onRenameDocument={handleRenameDocument}
            onMoveCopyDocuments={handleMoveCopy}
            projectPreferences={projectPreferences}
            onProjectPreferencesChange={handleProjectPreferencesChange}
            onSettings={() => console.log('[hub preview] open settings page')}
            onSignOut={() => console.log('[hub preview] sign out')}
          />
          <CreateProjectModal
            open={projectModalOpen}
            name={projectDraftName}
            files={projectDraftFiles}
            onNameChange={setProjectDraftName}
            onFilesChange={(files) => setProjectDraftFiles((prev) => [...prev, ...files])}
            onRemoveFile={(index) => setProjectDraftFiles((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}
            onCancel={() => setProjectModalOpen(false)}
            onConfirm={confirmCreateProject}
          />
          {workflowE2E ? (
            <input
              ref={workflowUploadInputRef}
              data-testid="mobile-workflow-upload-input"
              type="file"
              multiple
              accept="application/pdf"
              style={{ display: 'none' }}
              onChange={(event) => {
                handleWorkflowFiles(event.target.files);
                event.target.value = '';
              }}
            />
          ) : null}
          {/* Toast bus host — in the real app AppShell mounts this; mount it
              here too so hub actions (and design review) can show toasts. */}
          <ToastHost />
        </div>
      </MSGraphContext.Provider>
    </AuthContext.Provider>
  );
}
