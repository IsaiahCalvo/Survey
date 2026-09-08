// Dashboard — the application home screen (project tree, document grid,
// template management, SurveyHub). Extracted from src/viewerShared.js so it can be
// developed independently of the PDF viewer monolith. Communicates with the
// app shell purely through props + a forwarded ref. (The template-modal ref
// methods are entities-only stubs since KAL-82 slice 2 — the modal UI itself
// was removed in the home redesign.)
//
// pdfjs worker is configured once at App.jsx module load; pdfjsLib is a shared
// singleton in the Vite module graph, so no re-init is needed here.

import { loadPdfjs } from './utils/pdfWorkerConfig';
import { resolveIncomingUpload, shouldOfferAlias, nextAvailableName } from './utils/incomingFileResolver';
import DuplicateUploadModal from './components/DuplicateUploadModal';
import Icon from './Icons';
import DismissBarrier from './components/DismissBarrier';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import SurveyHub from './home/SurveyHub';
import CreateProjectModal from './home/CreateProjectModal';
import { resolveHubInitialLoading } from './home/hubInitialLoadingState.js';
import { retryCompensatingCleanup, runCompensatingBatch } from './home/compensatingBatch.js';
import { readPdfPageCount, mapUploadsBounded } from './home/pdfUploadWork.js';
import { moveOrCopyDocumentsAtomically, parseDocumentBatchRecovery } from './home/documentBatchOperations.js';
import { mapAuthoritativeTemplateRows, persistTemplateSnapshot } from './home/templatePersistence.js';
import { useAuth } from './contexts/AuthContext';
import { useMSGraph } from './contexts/MSGraphContext';
import { useDocuments, useProjects, useStorage, useTemplates } from './hooks/useDatabase';
import { useSubscriptionLimits } from './hooks/useSubscriptionLimits';
import { getSupabaseSession, supabase } from './supabaseClient';
import { isStorageFileNotFoundError, isSupabaseRowNotFoundError } from './utils/storageErrors';
import { countSurveyMarkersReferencingChecklistItem } from './services/documentAnnotationService';
import { computeContentSha256 } from './services/contentHash';
import { purgeAnnotationDoc } from './services/annotationDocSync';
import { lockDocument, unlockDocument } from './services/documentLockService.js';
import { resolveDocumentMetadata } from './services/documentMetadataResolver.js';
import { perfUpload } from './utils/performanceLogger';
import { showToast } from './utils/toast';
import { archiveItems } from './services/archiveService';
import { notifyLibraryChanged } from './hooks/libraryChangeBus';
import { useConfirmDialog, usePromptDialog } from './components/dialogPrompts';
import { readBlobAsArrayBuffer } from './utils/blobArrayBuffer.js';
import { importLocalDocument, importLocalDocumentCopy, listLocalDocuments, openLocalDocument } from './services/localDocumentStore.js';
import { listLocalDocumentDrafts, readLocalDocumentDraft, discardLocalDocumentDraft } from './services/localDocumentDraftStore.js';
import { createLocalDocumentStateReader } from './services/localDocumentState.js';

// --- helpers (shared small utilities; FONT_FAMILY/hexToRgba/normalizeName/
//     hasNameConflict also live in App.jsx for the viewer) ---

// Consistent font stack for the entire application
const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, Ubuntu, "Noto Sans", Arial, sans-serif';

// Convert hex color to rgba with default opacity (default 0.2, but surveyMarkers use 1.0)
const hexToRgba = (hex, opacity = 0.2) => {
  // Remove # if present
  hex = hex.replace('#', '');

  // Parse RGB values
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
};

const serializeError = (error) => {
  if (!error) return null;
  return {
    name: error.name || null,
    message: error.message || String(error),
    code: error.code || null,
    status: error.status || error.statusCode || null,
    details: error.details || null,
    hint: error.hint || null,
  };
};

const normalizeName = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
};

const hasNameConflict = (
  items,
  candidateName,
  {
    getName = (item) => item?.name,
    getId = (item) => item?.id,
    ignoreId,
    predicate
  } = {}
) => {
  if (!Array.isArray(items)) return false;
  const normalizedCandidate = normalizeName(candidateName);
  if (!normalizedCandidate) return false;

  const shouldIgnore = typeof ignoreId !== 'undefined';

  return items.some((item) => {
    if (!item) return false;
    if (predicate && !predicate(item)) return false;
    if (shouldIgnore && getId(item) === ignoreId) return false;
    const existingName = normalizeName(getName(item));
    return existingName && existingName === normalizedCandidate;
  });
};


const Dashboard = forwardRef(function Dashboard({ isActive = true, onDocumentSelect, onActivateOpenDocument, onBack, documents, setDocuments, templates: externalTemplates = [], onTemplatesChange, onShowAuthModal, entities, setEntities }, ref) {
  const fileInputRef = useRef();
  const projectFileInputRef = useRef();
  const localFileInputRef = useRef(null);
  const [localDocuments, setLocalDocuments] = useState([]);
  const [localDocumentsLoading, setLocalDocumentsLoading] = useState(true);
  const [localDocumentsError, setLocalDocumentsError] = useState('');
  const [localListError, setLocalListError] = useState('');
  const [localDocumentBusy, setLocalDocumentBusy] = useState(false);
  const localBusyRef = useRef(false);
  const localListGenerationRef = useRef(0);
  const localMountedRef = useRef(false);
  const localOpenCallbackRef = useRef(onDocumentSelect);
  localOpenCallbackRef.current = onDocumentSelect;
  const [localRecoveryCopies, setLocalRecoveryCopies] = useState([]);
  const [localRecoveryLoading, setLocalRecoveryLoading] = useState(true);
  const [localRecoveryListError, setLocalRecoveryListError] = useState('');
  const [localRecoveryActionError, setLocalRecoveryActionError] = useState('');
  const localRecoveryGenerationRef = useRef(0);
  const [localDocumentsVisible, setLocalDocumentsVisible] = useState(false);
  const localRecoveryVisibilityRef = useRef(null);
  const localRecoveryReadRef = useRef(null);
  const localRecoveryInvalidatedRef = useRef(true);
  const recoveryVisible = isActive && localDocumentsVisible;
  if (localRecoveryVisibilityRef.current?.active !== recoveryVisible) {
    localRecoveryVisibilityRef.current = { active: recoveryVisible };
    localRecoveryGenerationRef.current++;
    localRecoveryInvalidatedRef.current = true;
  }
  const refreshLocalRecoveryCopies = useCallback(async () => {
    localRecoveryGenerationRef.current++;
    localRecoveryInvalidatedRef.current = true;
    if (!localMountedRef.current || !localRecoveryVisibilityRef.current?.active) return;
    if (localRecoveryReadRef.current) return localRecoveryReadRef.current;
    // Same-turn events share a read. Events arriving during that read invalidate
    // its result and request one trailing latest read, never a concurrent scan.
    const pending = Promise.resolve().then(async () => {
      while (localMountedRef.current && localRecoveryVisibilityRef.current?.active
        && localRecoveryInvalidatedRef.current) {
        localRecoveryInvalidatedRef.current = false;
        const generation = localRecoveryGenerationRef.current;
        const current = () => localMountedRef.current && localRecoveryVisibilityRef.current?.active
          && generation === localRecoveryGenerationRef.current;
        try {
          const rows = await listLocalDocumentDrafts();
          if (current()) { setLocalRecoveryCopies(rows); setLocalRecoveryListError(''); }
        } catch (error) {
          if (current()) setLocalRecoveryListError(`Could not read recovery copies: ${error.message || 'Storage unavailable'}`);
        } finally {
          if (current()) setLocalRecoveryLoading(false);
        }
      }
    }).finally(() => {
      if (localRecoveryReadRef.current === pending) localRecoveryReadRef.current = null;
      if (localMountedRef.current && localRecoveryVisibilityRef.current?.active
        && localRecoveryInvalidatedRef.current) void refreshLocalRecoveryCopies();
    });
    localRecoveryReadRef.current = pending;
    return pending;
  }, []);
  const refreshLocalDocuments = useCallback(async () => {
    const generation = ++localListGenerationRef.current;
    try {
      const rows = await listLocalDocuments();
      if (localMountedRef.current && generation === localListGenerationRef.current) {
        setLocalDocuments(rows);
        setLocalListError('');
      }
    } catch (error) {
      if (localMountedRef.current && generation === localListGenerationRef.current) {
        setLocalListError(`Could not read files on this device: ${error.message || 'Storage unavailable'}`);
      }
    } finally {
      if (localMountedRef.current && generation === localListGenerationRef.current) setLocalDocumentsLoading(false);
    }
  }, []);
  useEffect(() => {
    localMountedRef.current = true;
    void refreshLocalDocuments();
    window.addEventListener('focus', refreshLocalDocuments);
    window.addEventListener('local-document-store-changed', refreshLocalDocuments);
    return () => {
      localMountedRef.current = false;
      localListGenerationRef.current++;
      window.removeEventListener('focus', refreshLocalDocuments);
      window.removeEventListener('local-document-store-changed', refreshLocalDocuments);
    };
  }, [refreshLocalDocuments]);
  useEffect(() => {
    window.addEventListener('focus', refreshLocalRecoveryCopies);
    window.addEventListener('local-document-draft-changed', refreshLocalRecoveryCopies);
    return () => {
      localRecoveryGenerationRef.current++;
      window.removeEventListener('focus', refreshLocalRecoveryCopies);
      window.removeEventListener('local-document-draft-changed', refreshLocalRecoveryCopies);
    };
  }, [refreshLocalRecoveryCopies]);
  useEffect(() => {
    if (recoveryVisible) void refreshLocalRecoveryCopies();
  }, [recoveryVisible, refreshLocalRecoveryCopies]);

  const openManagedLocalDocument = async (localId, isCurrent = () => true) => {
    if (!isCurrent()) return;
    const file = await openLocalDocument(localId);
    if (!file || file.storageMode !== 'local' || file.localId !== localId || file.id != null) {
      throw new Error('The saved local PDF has an invalid identity');
    }
    if (!localMountedRef.current || !isCurrent()) return;
    // Validate before opening, without overwriting unversioned recovery keys.
    createLocalDocumentStateReader(file);
    // This is the managed copy, never the picker File or its original/native
    // path. Local identity is device-owned and never stamped with a cloud id.
    if (localMountedRef.current && isCurrent()) await localOpenCallbackRef.current?.(file, null);
  };
  const importAndOpenLocalDocument = async file => {
    const manifest = await importLocalDocument(file);
    if (!localMountedRef.current) return;
    // Invalidate older listings so a delayed startup read cannot hide a newly
    // committed import. Cloud refresh never owns this independent list.
    localListGenerationRef.current++;
    setLocalDocuments(rows => [manifest, ...rows.filter(row => row.localId !== manifest.localId)]);
    setLocalDocumentsLoading(false);
    await openManagedLocalDocument(manifest.localId);
  };
  const runLocalDocumentAction = async action => {
    if (localBusyRef.current) return;
    localBusyRef.current = true;
    setLocalDocumentBusy(true);
    setLocalDocumentsError('');
    try { await action(); }
    catch (error) {
      if (localMountedRef.current) setLocalDocumentsError(`Could not open the local PDF: ${error.message || 'Storage unavailable'}`);
    } finally {
      localBusyRef.current = false;
      if (localMountedRef.current) setLocalDocumentBusy(false);
    }
  };
  const handleOpenLocalClick = () => {
    if (localBusyRef.current) return;
    if (!window.electronAPI?.openFile) { localFileInputRef.current?.click(); return; }
    void runLocalDocumentAction(async () => {
      const result = await window.electronAPI.openFile({
        title: 'Open local PDF — save a copy on this device',
        filters: [{ name: 'PDF files', extensions: ['pdf'] }],
      });
      if (result.canceled || !localMountedRef.current) return;
      const file = new File([new Uint8Array(result.data)], result.fileName, { type: 'application/pdf' });
      await importAndOpenLocalDocument(file);
    });
  };
  const handleLocalFileSelected = event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void runLocalDocumentAction(() => importAndOpenLocalDocument(file));
  };
  const runLocalRecoveryAction = async action => {
    const scope = localRecoveryVisibilityRef.current;
    if (localBusyRef.current || !localMountedRef.current || !scope?.active) return;
    const isCurrent = () => localMountedRef.current && localRecoveryVisibilityRef.current === scope;
    localBusyRef.current = true;
    setLocalDocumentBusy(true);
    setLocalRecoveryActionError('');
    try { await action(isCurrent); }
    catch (error) {
      if (isCurrent()) {
        setLocalRecoveryActionError(`Could not complete the recovery action: ${error.message || 'Storage unavailable'}`);
        await refreshLocalRecoveryCopies();
      }
    } finally {
      localBusyRef.current = false;
      if (localMountedRef.current) setLocalDocumentBusy(false);
    }
  };
  const recoverLocalCopy = ({ sessionId, sequence }) => runLocalRecoveryAction(async isCurrent => {
    const recovered = await readLocalDocumentDraft(sessionId, { expectedSequence: sequence });
    if (!isCurrent()) return;
    if (recovered.metadata.sessionId !== sessionId || recovered.metadata.sequence !== sequence) {
      throw new Error('This snapshot changed. Refresh the list and choose it again.');
    }
    const name = `${recovered.file.name.replace(/\.pdf$/i, '')} (recovered).pdf`;
    const file = new File([recovered.file], name, { type: 'application/pdf' });
    const manifest = await importLocalDocumentCopy(file, recovered.state);
    if (!isCurrent()) return;
    localListGenerationRef.current++;
    setLocalDocuments(rows => [manifest, ...rows.filter(entry => entry.localId !== manifest.localId)]);
    setLocalDocumentsLoading(false);
    // Recovery never replaces or discards the source session snapshot.
    await openManagedLocalDocument(manifest.localId, isCurrent);
  });
  const discardLocalRecoveryCopy = ({ sessionId, sequence, name }) => runLocalRecoveryAction(async isCurrent => {
    const confirmed = await askConfirm({
      title: 'Discard this recovery snapshot?',
      message: `Discard the saved session snapshot for "${name}"? This removes only this snapshot. The original document and other copies stay unchanged.`,
      confirmLabel: 'Discard snapshot',
      danger: true,
    });
    if (!confirmed || !isCurrent()) return;
    await discardLocalDocumentDraft(sessionId, { expectedSequence: sequence });
    if (isCurrent()) await refreshLocalRecoveryCopies();
  });
  // Destination project for the next browser-input upload. The browser file
  // picker fires `handleFileUpload` separately, so the project id chosen in
  // the Projects tab is stashed here for that handler to read.
  const uploadTargetProjectRef = useRef(null);
  // KAL-23: dashboard-level error toast for upload/create/save flows. Replaces
  // the noisy browser alerts that used to interrupt the user when an upload or
  // project save failed asynchronously. Click the close × on the toast to
  // dismiss; toast auto-clears after the next successful action.
  const [dashboardError, setDashboardError] = useState('');
  const [uploadInFlight, setUploadInFlight] = useState(false);
  // KAL-73: count of background document uploads still writing to storage, so
  // the hub's Upload button can show 'Uploading…' while bytes are in flight.
  const [activeUploads, setActiveUploads] = useState(0);
  // KAL-23 verification hook: expose setter on window in development only so
  // automated UAT can force the toast without needing a real upload failure.
  // The user-visible upload/create paths still drive setDashboardError normally.
  useEffect(() => {
    if (typeof window !== 'undefined' && import.meta.env?.DEV) {
      window.__kal23_setDashboardError = setDashboardError;
    }
  }, []);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  // KAL-57: themed replacements for the native confirm()/prompt() dialogs that
  // used to gate document/project deletion and the document lock toggle. Both
  // are promise-based so each caller keeps its original `if (!answer) return;`
  // control flow — nothing runs until the user actually answers.
  const [askConfirm, confirmDialogElement] = useConfirmDialog();
  const [askPrompt, promptDialogElement] = usePromptDialog();
  // Auth state and user dropdown menu
  const { user, isAuthenticated, signOut, signInWithGoogle, features } = useAuth();
  const documentOpenScopeRef = useRef(null);
  if (documentOpenScopeRef.current?.actorUserId !== (user?.id || null)) {
    documentOpenScopeRef.current = { actorUserId: user?.id || null };
  }
  const documentOpenScope = documentOpenScopeRef.current;
  const { isAuthenticated: isMSAuthenticated, login: msLogin, logout: msLogout, account: msAccount, needsReconnect: msNeedsReconnect } = useMSGraph();
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [showAccountSettings, setShowAccountSettings] = useState(false);
  const userDropdownRef = useRef(null);
  const documentMoveCopyRecoveryRef = useRef(null);
  const duplicateDocumentsRecoveryRef = useRef(null);
  const duplicateProjectsRecoveryRef = useRef(null);
  const userDropdownInsideRefs = useMemo(() => [userDropdownRef], []);
  const documentMoveCopyRecoveryKey = `survey-document-move-copy-recovery:${user?.id || 'guest'}`;
  useEffect(() => {
    try {
      documentMoveCopyRecoveryRef.current = parseDocumentBatchRecovery(
        localStorage.getItem(documentMoveCopyRecoveryKey),
      );
    } catch {
      documentMoveCopyRecoveryRef.current = null;
    }
  }, [documentMoveCopyRecoveryKey]);
  const persistDocumentMoveCopyRecovery = useCallback((recovery) => {
    documentMoveCopyRecoveryRef.current = recovery;
    try {
      if (recovery) localStorage.setItem(documentMoveCopyRecoveryKey, JSON.stringify(recovery));
      else localStorage.removeItem(documentMoveCopyRecoveryKey);
    } catch { /* durable retry is best effort when storage is unavailable */ }
  }, [documentMoveCopyRecoveryKey]);
  const duplicateDocumentsRecoveryKey = `survey-duplicate-documents-recovery:${user?.id || 'guest'}`;
  const duplicateProjectsRecoveryKey = `survey-duplicate-projects-recovery:${user?.id || 'guest'}`;
  useEffect(() => {
    const readPending = (key) => {
      try {
        const parsed = JSON.parse(localStorage.getItem(key) || 'null');
        return Array.isArray(parsed?.pending) ? parsed : null;
      } catch { return null; }
    };
    duplicateDocumentsRecoveryRef.current = readPending(duplicateDocumentsRecoveryKey);
    duplicateProjectsRecoveryRef.current = readPending(duplicateProjectsRecoveryKey);
  }, [duplicateDocumentsRecoveryKey, duplicateProjectsRecoveryKey]);
  const persistPendingCleanup = useCallback((key, ref, recovery) => {
    ref.current = recovery;
    try {
      if (recovery?.pending?.length) localStorage.setItem(key, JSON.stringify(recovery));
      else localStorage.removeItem(key);
    } catch { /* cleanup retry remains live in memory */ }
  }, []);
  const projectPreferencesKey = `survey-project-preferences:${user?.id || 'guest'}`;
  const [projectPreferences, setProjectPreferences] = useState({});
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(projectPreferencesKey) || '{}');
      setProjectPreferences(stored && typeof stored === 'object' ? stored : {});
    } catch {
      setProjectPreferences({});
    }
  }, [projectPreferencesKey]);
  const hubProjectPreferencesChange = useCallback((nextPreferences) => {
    setProjectPreferences((current) => {
      const next = typeof nextPreferences === 'function'
        ? nextPreferences(current)
        : { ...current, ...(nextPreferences || {}) };
      try { localStorage.setItem(projectPreferencesKey, JSON.stringify(next)); } catch { /* preference persistence is best effort */ }
      return next;
    });
  }, [projectPreferencesKey]);

  // Supabase hooks for data persistence
  const {
    projects: supabaseProjects,
    initialLoading: projectsInitialLoading,
    error: projectsLoadError,
    createProject: createSupabaseProject,
    updateProject: updateSupabaseProject,
    deleteProject: deleteSupabaseProject,
    refetch: refetchProjects
  } = useProjects();

  const {
    templates: supabaseTemplates,
    initialLoading: templatesInitialLoading,
    error: templatesLoadError,
    createTemplate: createSupabaseTemplate,
    updateTemplate: updateSupabaseTemplate,
    deleteTemplate: deleteSupabaseTemplate,
    replaceTemplates: replaceSupabaseTemplates,
    refetch: refetchTemplates
  } = useTemplates();

  const { uploadDocument: uploadToStorage, replaceDocument: replaceStorageDocument, uploadDataFile, deleteDocumentFile: deleteFromStorage, downloadDocument: downloadFromStorage } = useStorage();

  // Subscription limits and usage tracking
  const {
    canCreateProject,
    canUploadDocument,
    canCreateTemplate,
    canCreateRegion,
    hasFeatureAccess,
    usage,
    limits,
    refetch: refetchUsage
  } = useSubscriptionLimits();

  const [projectName, setProjectName] = useState('');
  const [projectFiles, setProjectFiles] = useState([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: 'uploadedAt', direction: 'desc' });
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState('grid'); // 'grid' or 'table'
  const [activeSection, setActiveSection] = useState('documents'); // 'documents' | 'projects' | 'templates'
  // Use Supabase projects instead of local state
  const projects = supabaseProjects || [];
  // Normalize Supabase templates and merge with local-only templates for optimistic UI
  const templates = useMemo(() => {
    // Templates created before the "Ball in Court" -> "Entity" rename store the
    // entity roster under the legacy key `ballInCourtEntities`. Convert it to
    // `entities` (and drop the stale key) so the rest of the app only ever sees
    // the current name; the next template save then persists the corrected shape.
    const normalizeTemplateEntities = (tpl) => {
      if (!tpl || typeof tpl !== 'object' || tpl.ballInCourtEntities === undefined) {
        return tpl;
      }
      const { ballInCourtEntities, ...rest } = tpl;
      return { ...rest, entities: rest.entities ?? ballInCourtEntities ?? [] };
    };
    // First, normalize Supabase templates
    const supabaseNormalized = (supabaseTemplates || []).map((templateRow) => {
      const config = templateRow?.config && typeof templateRow.config === 'object'
        ? templateRow.config
        : {};
      const templateId = config.id || templateRow.id;
      return {
        ...config,
        id: templateId,
        supabaseId: templateRow.id,
        name: config.name || templateRow.name || 'Untitled Template',
        createdAt: config.createdAt || templateRow.created_at || templateRow.updated_at || new Date().toISOString(),
        updatedAt: config.updatedAt || templateRow.updated_at || config.createdAt || templateRow.created_at || new Date().toISOString()
      };
    });

    // Get IDs of templates that exist in Supabase
    const supabaseIds = new Set(supabaseNormalized.map(t => t.id));

    // Find local-only templates (exist in externalTemplates but not yet in Supabase)
    // These are templates that were just created and haven't been synced yet
    const localOnlyTemplates = (externalTemplates || []).filter(t =>
      t && t.id && !supabaseIds.has(t.id) && !t.supabaseId
    );

    // Merge: local-only templates first (for immediate visibility), then Supabase templates
    return [...localOnlyTemplates, ...supabaseNormalized].map(normalizeTemplateEntities);
  }, [supabaseTemplates, externalTemplates]);

  // Track previous supabaseTemplates to detect actual Supabase changes
  const prevSupabaseTemplatesRef = useRef(supabaseTemplates);

  const resolveSupabaseTemplateId = useCallback((templateOrId) => {
    if (!templateOrId) return null;
    if (typeof templateOrId === 'object' && templateOrId.supabaseId) {
      return templateOrId.supabaseId;
    }
    const templateId = typeof templateOrId === 'string' ? templateOrId : templateOrId.id;
    if (!templateId) return null;
    const match = templates.find(t => t.id === templateId);
    if (match?.supabaseId) return match.supabaseId;
    // BL-23: search the freshest rows (ref), not just this render's state — a
    // queued save must resolve rows its predecessor created moments ago.
    const supabaseMatch = (supabaseRowsRef.current || supabaseTemplates || []).find(t =>
      t.id === templateId || (t.config && t.config.id === templateId)
    );
    return supabaseMatch?.id || null;
  }, [templates, supabaseTemplates]);

  const sanitizeTemplateConfig = (template) => {
    if (!template || typeof template !== 'object') return template;
    const { supabaseId, ...rest } = template;
    return rest;
  };

  // Read templates from a ref so this callback stays stable across template
  // changes (it was being rebuilt on every edit, churning everything that
  // depends on it). The ref is written during render so it is always current.
  const templatesRef = useRef(templates);
  templatesRef.current = templates;
  // BL-23: the newest known Supabase template rows. Render-synced like
  // templatesRef, but ALSO advanced synchronously from each persist's refetch
  // result — a save queued behind another save starts before React re-renders
  // with the refetched state, and diffing against the pre-save rows would
  // re-create rows the earlier save just persisted (duplicates).
  const supabaseRowsRef = useRef(supabaseTemplates);
  supabaseRowsRef.current = supabaseTemplates;
  const updateTemplates = useCallback((updater) => {
    const currentTemplates = templatesRef.current;
    const nextValue = typeof updater === 'function' ? updater(currentTemplates) : updater;
    const next = Array.isArray(nextValue) ? nextValue : [];
    // Use setTimeout to avoid setState during render
    setTimeout(() => onTemplatesChange?.(next), 0);
  }, [onTemplatesChange]);

  const [selectedProjectId, setSelectedProjectId] = useState(null);

  // Documents hook - must be called after selectedProjectId is declared
  const {
    documents: supabaseDocuments,
    initialLoading: documentsInitialLoading,
    error: documentsLoadError,
    createDocument: createSupabaseDocument,
    updateDocument: updateSupabaseDocument,
    deleteDocument: deleteSupabaseDocument,
    refetch: refetchDocuments
  } = useDocuments(selectedProjectId);

  // Fetch all documents for file count display in project list
  const {
    documents: allDocuments,
    refetch: refetchAllDocuments
  } = useDocuments(null);

  // Duplicate-upload ASK flows (decision 6). One modal, promise-shaped so the
  // upload paths can simply `await` the user's answer mid-flow. If a second
  // ask ever lands while one is open (two concurrent upload flows), the first
  // resolves as a cancel instead of hanging its awaiting upload forever.
  const [duplicateModal, setDuplicateModal] = useState(null);
  const duplicateModalRef = useRef(null);
  const askDuplicateUpload = (mode, incomingName, existingName, knownDifferent = true) =>
    new Promise((resolve) => {
      duplicateModalRef.current?.resolve?.(duplicateModalRef.current.mode === 'alias' ? 'skip-alias' : 'cancel');
      const next = { mode, incomingName, existingName, knownDifferent, resolve };
      duplicateModalRef.current = next;
      setDuplicateModal(next);
    });
  const settleDuplicateModal = (choice) => {
    duplicateModalRef.current?.resolve?.(choice);
    duplicateModalRef.current = null;
    setDuplicateModal(null);
  };

  // Same name + different (or unknown) contents must PAUSE and ask before any
  // row is created (decision 6). Candidates come from a FRESH owner-scoped
  // query — the client-side lists can be stale, scoped to another project, or
  // include collaborator-owned rows this user must never archive.
  // Never throws. Returns:
  //   { proceed: true, archiveDocId? }  — continue; archive that id AFTER the
  //                                       new row is created (never before,
  //                                       so a failed create can't hide the
  //                                       old document)
  //   { proceed: false }                — handled here (opened existing) or canceled
  const confirmSameNameDifferentContent = async ({ fileName, contentSha, projectId, openAfterUpload }) => {
    try {
      let query = supabase
        .from('documents')
        .select('id, name, file_path, content_sha256, archived, project_id, user_id, created_at')
        .eq('user_id', user.id)
        .eq('name', fileName)
        .eq('archived', false)
        .limit(50);
      query = projectId ? query.eq('project_id', projectId) : query.is('project_id', null);
      const { data: candidates, error } = await query;
      if (error) throw error;

      const decision = resolveIncomingUpload(
        { name: fileName, sha: contentSha, projectId: projectId || null },
        candidates || []
      );
      if (decision.kind !== 'version-ask') return { proceed: true };
      const choice = await askDuplicateUpload('version', fileName, decision.doc.name, decision.knownDifferent);
      if (choice === 'open-existing') {
        if (openAfterUpload) await handleDocumentClick(decision.doc);
        return { proceed: false };
      }
      if (choice !== 'new-version') return { proceed: false }; // Escape/backdrop = cancel
      return { proceed: true, archiveDocId: decision.doc.id };
    } catch (err) {
      // Fail SAFE: cancel the upload rather than risk a silent duplicate or a
      // stuck file input further down the path.
      console.error('Duplicate check failed:', err);
      showToast('Couldn’t check for duplicates — upload canceled. Please try again.');
      return { proceed: false };
    }
  };

  // After the new row exists: archive the old same-name copy the user chose to
  // replace. Non-fatal on failure (both copies stay visible — recoverable).
  const archiveReplacedDocument = async (archiveDocId) => {
    if (!archiveDocId) return;
    try {
      await deleteSupabaseDocument(archiveDocId);
    } catch (err) {
      console.error('Could not archive the previous version:', err);
      showToast('The new version was added, but the old copy could not be archived.');
    }
  };

  // Same contents came back deduped under a DIFFERENT name -> offer to keep the
  // new name as an alias (decision 6 / KAL-290). Non-destructive either way.
  const maybeOfferAlias = async (resolvedDoc, incomingName, contentSha) => {
    if (!shouldOfferAlias(resolvedDoc, { name: incomingName, sha: contentSha })) return;
    const choice = await askDuplicateUpload('alias', incomingName, resolvedDoc.name);
    if (choice !== 'add-alias') return;
    try {
      await updateSupabaseDocument(resolvedDoc.id, {
        name_aliases: [...(resolvedDoc.name_aliases || []), incomingName],
      });
      showToast(`Also keeping the name “${incomingName}”`, 'success');
    } catch (err) {
      console.error('Could not save the extra name:', err);
      showToast('Couldn’t save the extra name for this document.');
    }
  };

  const navIconWrapperStyle = {
    width: '20px',
    height: '20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0
  };

  const navLabelStyle = {
    fontSize: '14px',
    fontWeight: '500',
    lineHeight: '20px'
  };


  // View mode dropdown state
  const [isViewDropdownOpen, setIsViewDropdownOpen] = useState(false);
  const viewDropdownRef = useRef(null);
  const viewDropdownInsideRefs = useMemo(() => [viewDropdownRef], []);

  // Load view mode from localStorage (only UI preference, not data)
  useEffect(() => {
    try {
      const storedView = localStorage.getItem('dashboardViewMode');
      if (storedView === 'grid' || storedView === 'table') setViewMode(storedView);
    } catch { }
  }, []);

  // Sync Supabase templates with parent component (only when Supabase data changes)
  useEffect(() => {
    if (!Array.isArray(templates)) return;
    // Only sync to parent when supabaseTemplates actually changed
    // This prevents circular updates when externalTemplates change
    if (prevSupabaseTemplatesRef.current !== supabaseTemplates) {
      prevSupabaseTemplatesRef.current = supabaseTemplates;
      setTimeout(() => {
        onTemplatesChange?.(templates);
      }, 0);
    }
  }, [templates, supabaseTemplates, onTemplatesChange]);

  // Sync Supabase documents with parent component state
  useEffect(() => {
    if (!Array.isArray(supabaseDocuments)) return;
    // Convert Supabase documents to the format expected by the UI.
    // Spread the real Supabase row FIRST so the true shape survives —
    // project_id, file_size, created_at, updated_at, user_id, shared,
    // page_count. The Survey Hub keys off project_id to group a project's
    // files; the old mapping dropped it (kept only camelCase projectId),
    // so files never showed inside their project. The camelCase keys below
    // are legacy aliases the pre-redesign UI still reads.
    const formattedDocs = supabaseDocuments.map(doc => ({
      ...doc,
      id: doc.id,
      name: doc.name,
      size: doc.file_size || 0,
      uploadedAt: doc.created_at || doc.updated_at,
      type: 'application/pdf',
      filePath: doc.file_path,
      projectId: doc.project_id,
      cutoverCompletedAt: doc.cutover_completed_at || null
    }));
    setDocuments(prev => {
      // Keep temporary documents that haven't been replaced by real ones yet
      const tempDocs = prev.filter(d =>
        d.id.startsWith('temp-') &&
        !formattedDocs.some(fd => fd.name === d.name && fd.size === d.size)
      );
      return [...tempDocs, ...formattedDocs];
    });
  }, [supabaseDocuments]);

  useEffect(() => {
    try { localStorage.setItem('dashboardViewMode', viewMode); } catch { }
  }, [viewMode]);


  // UX 2026-04-22: File menu → "Open PDF…" fires the same flow as clicking
  // the Upload PDF card. Wires Cmd/Ctrl+O and the Open PDF… menu item.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.electronAPI?.onOpenPdfMenu) {
      return undefined;
    }
    const unsubscribe = window.electronAPI.onOpenPdfMenu(() => {
      handleUploadClick();
    });
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle file upload via Electron dialog (preserves file path).
  // `explicitProjectId` — when the Projects tab's "Add files" / "Upload files"
  // triggers this, it passes the destination project id so the uploaded file
  // is saved INTO that project (and persists). Other callers pass nothing.
  // `options.open` — defaults true (open the PDF after upload, like the
  // Documents-tab Upload). The Projects tab passes false: a file added to a
  // project should just be saved into it, not opened.
  const handleUploadClick = async (explicitProjectId, options = {}) => {
    const openAfterUpload = options.open !== false;
    // In Electron, use dialog to get file path
    if (window.electronAPI && window.electronAPI.openFile) {
      try {
        perfUpload.start('electron-dialog');
        const result = await window.electronAPI.openFile({
          title: 'Open PDF document',
          filters: [{ name: 'PDF files', extensions: ['pdf'] }]
        });
        perfUpload.mark('electron-dialog', 'Dialog closed');

        if (result.canceled) {
          perfUpload.end('electron-dialog');
          return;
        }

        if (!user) {
          setDashboardError('Please sign in to upload documents.');
          onShowAuthModal();
          return;
        }

        // Create File object
        perfUpload.mark('electron-dialog', 'Creating File object');
        const fileData = new Uint8Array(result.data);
        const file = new File([fileData], result.fileName, { type: 'application/pdf' });
        // 2026-04-30 fix: stamp the uploader's identity onto the in-memory File
        // so the per-user delete authority gate can resolve documentOwnerId
        // before the Supabase row's id round-trips back. Without this, a quick
        // delete after upload silently failed.
        if (user?.id) file.user_id = user.id;
        // Store the file path separately (File.path is read-only)
        const filePath = result.filePath;
        perfUpload.mark('electron-dialog', 'File object created');
        perfUpload.end('electron-dialog');

        // Start upload timing for this specific file
        perfUpload.start(file.name);

        // Determine Project ID. An explicit id from the Projects tab wins;
        // a `local-` id is a not-yet-saved project, so it falls back to null.
        let projectId = (typeof explicitProjectId === 'string' && !explicitProjectId.startsWith('local-'))
          ? explicitProjectId
          : null;
        if (!projectId && selectedProjectId && activeSection === 'projects') {
          projectId = selectedProjectId;
        }

        // Content fingerprint of the bytes → resolve the document's identity
        // BEFORE opening it. This is the keystone of the rebuild: the viewer
        // always opens with a real document id (so the save shortcut and durable
        // annotation store work on a brand-new upload), and identical bytes dedup
        // to one document instead of spawning a duplicate/blank copy.
        let contentSha;
        try {
          contentSha = await computeContentSha256(fileData);
        } catch (hashErr) {
          console.error('Content hashing failed:', hashErr);
          setDashboardError('Couldn’t read that file for upload. Please try again.');
          perfUpload.end(file.name);
          return;
        }

        // Decision 6 gate: same name + different contents -> ask first.
        const duplicateGate = await confirmSameNameDifferentContent({
          fileName: file.name,
          contentSha,
          projectId,
          openAfterUpload,
        });
        if (!duplicateGate.proceed) {
          perfUpload.end(file.name);
          return;
        }

        let resolvedDoc;
        try {
          resolvedDoc = await createSupabaseDocument({
            name: file.name,
            file_path: `${user.id}/${contentSha}.pdf`,
            file_size: file.size,
            page_count: 1, // placeholder; corrected in the background after parse
            project_id: projectId || null,
            content_sha256: contentSha,
          });
        } catch (createErr) {
          console.error('Could not create/resolve document before open:', createErr);
          setDashboardError('Couldn’t prepare the document in the cloud: ' + (createErr.message || 'Unknown error'));
          perfUpload.end(file.name);
          return;
        }

        // Decision 6: identical bytes deduped to a doc with a different name ->
        // offer to keep the new name as an alias, then open the EXISTING
        // document by its own identity. Opening the picked File here would
        // spawn a second tab of the same document under the new name (the
        // tab-matcher keys on the name), double-mounting the viewer.
        if (resolvedDoc.content_sha256 === contentSha && resolvedDoc.name !== file.name) {
          // A deduped row does not GUARANTEE a durable object (a prior failed
          // upload can leave a row whose object is missing). We hold identical
          // bytes — store them AT THE ROW'S OWN file_path (which is what the
          // open below reads; it may still be a legacy pre-rekey path) so the
          // open can't hit file-not-found and cascade into deleting the very
          // row we're reusing. Idempotent upsert: same bytes, same key.
          try {
            const { error: healErr } = await supabase.storage
              .from('documents')
              .upload(resolvedDoc.file_path, file, { upsert: true, contentType: 'application/pdf' });
            if (healErr) throw healErr;
          } catch (upErr) {
            console.error('Could not store the file bytes:', upErr);
            setDashboardError('Couldn’t save the document to the cloud: ' + (upErr.message || 'Unknown error'));
            perfUpload.end(file.name);
            return; // nothing archived, nothing opened — safe retry
          }
          await archiveReplacedDocument(duplicateGate.archiveDocId);
          await maybeOfferAlias(resolvedDoc, file.name, contentSha);
          if (openAfterUpload) await handleDocumentClick(resolvedDoc);
          refetchAllDocuments();
          perfUpload.end(file.name);
          return;
        }

        // Stamp the resolved identity onto the in-memory File so the viewer opens
        // with it (no null-id window).
        file.id = resolvedDoc.id;
        file.projectId = resolvedDoc.project_id ?? projectId ?? null;
        file.supabaseFilePath = resolvedDoc.file_path ?? null;
        file.uploadStartTime = performance.now();
        if (openAfterUpload) onDocumentSelect(file, filePath);

        // OPTIMISTIC LIST UPDATE — carry both key spellings so the file shows
        // immediately in the project-grouped views (which read project_id).
        const tempDoc = {
          id: resolvedDoc.id,
          name: file.name,
          size: file.size,
          uploadedAt: new Date().toISOString(),
          created_at: resolvedDoc.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString(),
          type: 'application/pdf',
          filePath: filePath,
          projectId: projectId,
          project_id: projectId,
          file: file
        };
        setDocuments(prev => [tempDoc, ...prev.filter(d => d.id !== tempDoc.id)]);

        // Background: store the bytes (content-addressed, idempotent — a re-upload
        // of the same file overwrites the same object) and correct the page count
        // once parsed. The marks' durability is the annotation store's job now.
        (async () => {
          setActiveUploads((count) => count + 1);
          try {
            perfUpload.mark(file.name, 'Starting cloud upload');
            // A resolved row may still use a legacy path. Retry its exact
            // object, not a new hash path that this document would never read.
            const uploadPromise = replaceStorageDocument(file, resolvedDoc.file_path);
            const pageCountPromise = readPdfPageCount(file, { readBlobAsArrayBuffer, loadPdfjs });

            // A page-count parse failure must not reject the join — the archive
            // below depends only on the UPLOAD being durable.
            const [, pageCount] = await Promise.all([uploadPromise, pageCountPromise.catch(() => null)]);
            perfUpload.mark(file.name, 'Cloud upload + page count complete');

            // "Upload as new version": archive the replaced copy only now that
            // the new bytes are DURABLE in storage — a failed upload must never
            // leave the old document hidden and the new row pointing at nothing.
            await archiveReplacedDocument(duplicateGate.archiveDocId);

            if (pageCount && pageCount !== resolvedDoc.page_count) {
              try { await updateSupabaseDocument(resolvedDoc.id, { page_count: pageCount }); } catch { /* non-fatal */ }
            }
            refetchAllDocuments();
            perfUpload.end(file.name);
          } catch (err) {
            perfUpload.end(file.name);
            console.error('Error uploading file in background:', err);
            setDashboardError('Couldn’t save the document to the cloud: ' + (err.message || 'Unknown error') + '. Your file is still on disk — try uploading again or check your connection.');
          } finally {
            setActiveUploads((count) => count - 1);
          }
        })();

      } catch (error) {
        console.error('Error opening file:', error);
        setDashboardError('Couldn’t open that file: ' + (error?.message || 'Unknown error'));
      }
    } else {
      // Fallback to browser file input. Stash the destination project id and
      // the open-after flag so the separate `handleFileUpload` change-handler
      // saves the file into the right project and honors the silent-add flag.
      uploadTargetProjectRef.current = {
        projectId: (typeof explicitProjectId === 'string' && !explicitProjectId.startsWith('local-'))
          ? explicitProjectId
          : null,
        open: openAfterUpload,
      };
      fileInputRef.current?.click();
    }
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (file && file.type === 'application/pdf') {

      if (!user) {
        setDashboardError('Please sign in to upload documents.');
        onShowAuthModal();
        event.target.value = '';
        return;
      }

      // 2026-04-30 fix: stamp the uploader's identity onto the in-memory File
      // so the per-user delete authority gate can resolve documentOwnerId
      // before the Supabase row's id round-trips back. Without this, a quick
      // delete right after browser-input upload silently failed.
      file.user_id = user.id;

      // Determine Project ID + open-after flag. A request stashed by the
      // Projects-tab upload wins; consume-and-clear it so a later plain upload
      // doesn't reuse it.
      const pendingUpload = uploadTargetProjectRef.current || {};
      uploadTargetProjectRef.current = null;
      let projectId = pendingUpload.projectId || null;
      const openAfterUpload = pendingUpload.open !== false;
      if (!projectId && selectedProjectId && activeSection === 'projects') {
        projectId = selectedProjectId;
      }

      // Content fingerprint → resolve the document's identity BEFORE opening, so
      // the viewer opens with a real id (durable store + save shortcut work on a
      // fresh upload) and identical bytes dedup to one document.
      let contentSha;
      try {
        const bytes = new Uint8Array(await readBlobAsArrayBuffer(file));
        contentSha = await computeContentSha256(bytes);
      } catch (hashErr) {
        console.error('Content hashing failed:', hashErr);
        setDashboardError('Couldn’t read that file for upload. Please try again.');
        event.target.value = '';
        return;
      }

      // Decision 6 gate: same name + different contents -> ask first.
      const duplicateGate = await confirmSameNameDifferentContent({
        fileName: file.name,
        contentSha,
        projectId,
        openAfterUpload,
      });
      if (!duplicateGate.proceed) {
        event.target.value = '';
        return;
      }

      let resolvedDoc;
      try {
        resolvedDoc = await createSupabaseDocument({
          name: file.name,
          file_path: `${user.id}/${contentSha}.pdf`,
          file_size: file.size,
          page_count: 1,
          project_id: projectId || null,
          content_sha256: contentSha,
        });
      } catch (createErr) {
        console.error('Could not create/resolve document before open:', createErr);
        setDashboardError('Couldn’t prepare the document in the cloud: ' + (createErr.message || 'Unknown error'));
        event.target.value = '';
        return;
      }

      // Decision 6: identical bytes deduped to a doc with a different name ->
      // offer to keep the new name as an alias, then open the EXISTING document
      // by its own identity (a second same-document tab under the new name
      // double-mounts the viewer — see the Electron path note).
      if (resolvedDoc.content_sha256 === contentSha && resolvedDoc.name !== file.name) {
        // A deduped row does not GUARANTEE a durable object (a prior failed
        // upload can leave a row whose object is missing). We hold identical
        // bytes — store them AT THE ROW'S OWN file_path (which is what the
        // open below reads; it may still be a legacy pre-rekey path) so the
        // open can't hit file-not-found and cascade into deleting the very
        // row we're reusing. Idempotent upsert: same bytes, same key.
        try {
          const { error: healErr } = await supabase.storage
            .from('documents')
            .upload(resolvedDoc.file_path, file, { upsert: true, contentType: 'application/pdf' });
          if (healErr) throw healErr;
        } catch (upErr) {
          console.error('Could not store the file bytes:', upErr);
          setDashboardError('Couldn’t save the document to the cloud: ' + (upErr.message || 'Unknown error'));
          event.target.value = '';
          return; // nothing archived, nothing opened — safe retry
        }
        await archiveReplacedDocument(duplicateGate.archiveDocId);
        await maybeOfferAlias(resolvedDoc, file.name, contentSha);
        if (openAfterUpload) await handleDocumentClick(resolvedDoc);
        refetchAllDocuments();
        event.target.value = '';
        return;
      }

      file.id = resolvedDoc.id;
      file.projectId = resolvedDoc.project_id ?? projectId ?? null;
      file.supabaseFilePath = resolvedDoc.file_path ?? null;
      file.uploadStartTime = performance.now();
      if (openAfterUpload) onDocumentSelect(file);

      // OPTIMISTIC LIST UPDATE — carry both key spellings so the file shows
      // immediately in the project-grouped views (which read project_id).
      const tempDoc = {
        id: resolvedDoc.id,
        name: file.name,
        size: file.size,
        uploadedAt: new Date().toISOString(),
        created_at: resolvedDoc.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
        type: 'application/pdf',
        filePath: null,
        projectId: projectId,
        project_id: projectId,
        file: file
      };
      setDocuments(prev => [tempDoc, ...prev.filter(d => d.id !== tempDoc.id)]);

      // Background: store the bytes (content-addressed, idempotent) and correct
      // the page count once parsed.
      (async () => {
        setActiveUploads((count) => count + 1);
        try {
          // The resolved row owns the storage path, including legacy retries.
          const uploadPromise = replaceStorageDocument(file, resolvedDoc.file_path);
          const pageCountPromise = readPdfPageCount(file, { readBlobAsArrayBuffer, loadPdfjs })
            .catch((err) => {
              console.error('Error getting page count:', err);
              return null;
            });

          await uploadPromise;

          // "Upload as new version": archive the replaced copy only now that
          // the new bytes are DURABLE in storage — a failed upload must never
          // leave the old document hidden and the new row pointing at nothing.
          await archiveReplacedDocument(duplicateGate.archiveDocId);

          pageCountPromise.then(async (pageCount) => {
            if (pageCount !== null && pageCount !== resolvedDoc.page_count) {
              try { await updateSupabaseDocument(resolvedDoc.id, { page_count: pageCount }); } catch (err) { console.error('Error updating page count:', err); }
            }
          }).catch(() => {});

          refetchAllDocuments();
        } catch (err) {
          console.error('Error uploading file in background:', err);
          setDashboardError('Couldn’t save the document to the cloud: ' + (err.message || 'Unknown error') + '. Your file is still on disk — try uploading again or check your connection.');
        } finally {
          setActiveUploads((count) => count - 1);
        }
      })();

    }
    // Reset input
    event.target.value = '';
  };

  // Create Project flow
  const handleCreateProjectClick = () => {
    setProjectName('');
    setProjectFiles([]);
    setIsDragOver(false);
    setIsProjectModalOpen(true);
  };

  const handleProjectFilesSelected = (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    const onlyPDFs = files.filter(f => f.type === 'application/pdf');
    setProjectFiles(prev => [...prev, ...onlyPDFs]);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer?.files || []);
    const onlyPDFs = files.filter(f => f.type === 'application/pdf');
    setProjectFiles(prev => [...prev, ...onlyPDFs]);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const persistProject = async (name, files) => {
    if (!user) {
      const error = new Error('User not authenticated');
      error.code = 'NOT_AUTHENTICATED';
      throw error;
    }

    const trimmedName = name.trim();

    // Check subscription limits BEFORE attempting to create project
    const projectCheck = canCreateProject();
    if (!projectCheck.allowed) {
      const error = new Error(projectCheck.reason);
      error.code = 'PROJECT_LIMIT_REACHED';
      throw error;
    }

    // Check file upload limits for each file
    const totalFileSize = files.reduce((sum, file) => sum + file.size, 0);
    const documentCheck = canUploadDocument(totalFileSize);
    if (!documentCheck.allowed) {
      const error = new Error(documentCheck.reason);
      error.code = 'UPLOAD_LIMIT_REACHED';
      throw error;
    }

    // Refetch projects to ensure we have the latest data
    const latestProjects = await refetchProjects() || supabaseProjects || [];

    if (hasNameConflict(latestProjects, trimmedName, { getName: (project) => project?.name })) {
      const duplicateError = new Error('A project with this name already exists. Please choose a different name.');
      duplicateError.code = 'DUPLICATE_PROJECT_NAME';
      throw duplicateError;
    }

    let newProject = null;
    try {
      // Create project in Supabase first
      newProject = await createSupabaseProject({
        name: trimmedName
      });
    } catch (err) {
      console.error('Error creating project in database:', err);
      const error = new Error(`Failed to create project: ${err.message || 'Unknown error'}`);
      error.code = 'PROJECT_CREATE_FAILED';
      error.originalError = err;
      throw error;
    }

    // Upload files to Supabase Storage and create document records
    const uploadErrors = [];
    let successCount = 0;

    // Bound file jobs so large batches do not start every upload/parser at once.
    // Decision 6, bulk flavor: the project is brand-new so there's nothing to
    // collide WITH, but two picked files can share a NAME between themselves —
    // number the later ones like a desktop OS instead of silently creating
    // twin same-name rows. (Identical BYTES in the batch still dedup server-side.)
    const usedNames = new Set();
    const batchEntries = files.map((file) => {
      const name = nextAvailableName(file.name, usedNames);
      usedNames.add(name);
      return { file, name };
    });
    const settledFiles = await mapUploadsBounded(batchEntries, async ({ file, name }) => {
      let pageCountPromise;
      try {
        // Content-address these uploads too (decision 6): hash first so the
        // stored object lands at {user}/{sha}.pdf, never a new time-named file.
        const contentSha = await computeContentSha256(new Uint8Array(await file.arrayBuffer()));

        // Start upload and page count in parallel
        const uploadPromise = uploadToStorage(file, newProject.id, undefined, contentSha);
        pageCountPromise = readPdfPageCount(file, { readBlobAsArrayBuffer, loadPdfjs })
          .catch((err) => {
            console.error(`Error getting page count for ${file.name}:`, err);
            return null;
          });

        // Wait for upload to complete first
        const filePath = await uploadPromise;

        // Create document record immediately after upload
        // Use null for page_count initially, will update in background
        const doc = await createSupabaseDocument({
          name,
          file_path: filePath,
          file_size: file.size,
          page_count: null,
          project_id: newProject.id,
          content_sha256: contentSha,
        });

        // Two picked files with identical bytes dedup to ONE row — keep the
        // second file's name as an alias automatically (decision 6; bulk flow
        // has no room for the ask-modal, and adding a name is non-destructive).
        if (doc && doc.content_sha256 === contentSha && doc.name !== name
            && 'name_aliases' in doc && !(doc.name_aliases || []).includes(name)) {
          try {
            await updateSupabaseDocument(doc.id, { name_aliases: [...(doc.name_aliases || []), name] });
          } catch (aliasErr) { console.warn(`Could not record alias "${name}":`, aliasErr?.message); }
        }

        // Keep this slot until the parser releases its worker and buffers.
        const pageCount = await pageCountPromise;
        if (pageCount !== null) {
          try {
            await updateSupabaseDocument(doc.id, { page_count: pageCount });
          } catch (err) {
            console.error(`Error updating page count for ${file.name}:`, err);
          }
        }

        return { success: true, file: file.name };
      } catch (err) {
        console.error(`Error uploading file ${file.name}:`, err);
        return {
          success: false,
          file: file.name,
          error: err.message || err.toString()
        };
      } finally {
        await pageCountPromise;
      }
    });

    const results = settledFiles.map((result, index) => result.status === 'fulfilled'
      ? result.value
      : { success: false, file: batchEntries[index].file.name, error: result.reason?.message || String(result.reason) });

    // Count successes and collect errors
    results.forEach(result => {
      if (result.success) {
        successCount++;
      } else {
        uploadErrors.push({ fileName: result.file, error: result.error });
      }
    });

    // If no files were successfully uploaded, throw an error
    if (files.length > 0 && successCount === 0) {
      const errorMessages = uploadErrors.map(e => `${e.fileName}: ${e.error}`).join('; ');
      const error = new Error(`Failed to upload any files. Errors: ${errorMessages}`);
      error.code = 'NO_FILES_UPLOADED';
      error.uploadErrors = uploadErrors;

      // Try to clean up the project if no files were uploaded
      try {
        await deleteSupabaseProject(newProject.id);
      } catch (cleanupErr) {
        console.error('Error cleaning up project:', cleanupErr);
      }

      throw error;
    }

    // Refresh global document list to update counts
    refetchAllDocuments();

    // Warn if some files failed but others succeeded
    if (uploadErrors.length > 0) {
      console.warn('Some files failed to upload:', uploadErrors);
    }

    try {
      // Refetch projects and documents
      await refetchProjects();
      await refetchDocuments();
      // Refetch usage to update subscription limits
      await refetchUsage();
    } catch (err) {
      console.error('Error refetching data:', err);
      // Don't throw here - the project was created successfully, just refresh failed
    }
  };

  const handleConfirmCreateProject = async () => {
    if (!projectName.trim()) {
      setDashboardError('Please enter a project name.');
      return;
    }
    const trimmedProjectName = projectName.trim();

    // Refetch projects to ensure we have the latest data before checking for conflicts
    let latestProjects = supabaseProjects || [];
    try {
      const refetched = await refetchProjects();
      latestProjects = refetched || latestProjects;
    } catch (err) {
      console.error('Error refetching projects:', err);
    }

    if (hasNameConflict(latestProjects, trimmedProjectName, { getName: (project) => project?.name })) {
      setDashboardError('A project with this name already exists. Please choose a different name.');
      return;
    }
    setUploadInFlight(true);
    try {
      await persistProject(trimmedProjectName, projectFiles);
      setIsProjectModalOpen(false);
      setProjectName('');
      setProjectFiles([]);
      setDashboardError('');
    } catch (err) {
      console.error('Error creating project:', err);

      if (err?.code === 'DUPLICATE_PROJECT_NAME') {
        setDashboardError(err.message);
        return;
      }

      if (err?.code === 'NOT_AUTHENTICATED') {
        setDashboardError('Please sign in to create projects.');
        onShowAuthModal();
        return;
      }

      if (err?.code === 'PROJECT_LIMIT_REACHED') {
        setDashboardError(err.message);
        return;
      }

      if (err?.code === 'UPLOAD_LIMIT_REACHED') {
        setDashboardError(err.message);
        return;
      }

      if (err?.code === 'NO_FILES_UPLOADED') {
        const errorDetails = err.uploadErrors?.map(e => `\n• ${e.fileName}: ${e.error}`).join('') || '';
        setDashboardError(`Couldn’t upload your files:${errorDetails}\n\nCheck file sizes and try again.`);
        return;
      }

      if (err?.code === 'PROJECT_CREATE_FAILED' || err?.code === 'PROJECT_UPDATE_FAILED') {
        const errorMsg = err.originalError?.message || err.message || 'Unknown error';
        setDashboardError(`Couldn’t save the project: ${errorMsg}. Check your connection and try again.`);
        return;
      }

      // Generic error message with more details if available
      const errorMsg = err.message || err.toString() || 'Unknown error';
      setDashboardError(`Couldn’t create the project: ${errorMsg}. Try again or check the console for details.`);
    } finally {
      setUploadInFlight(false);
    }
  };

  const handleCancelCreateProject = () => {
    setIsProjectModalOpen(false);
  };

  // Legacy hub selection mode was removed (KAL-82 slice 1 — see
  // .planning/optimization/SELECT-MODE-AUDIT.md). AppShell still calls
  // dashboardRef.current.exitSelectionMode(); keep a no-op until that caller
  // is cleaned up separately.
  const exitSelectionMode = useCallback(() => {}, []);


  // Persist templates to Supabase
  const persistTemplates = async (templatesToSave) => {
    if (!user) {
      return;
    }

    try {
      const withResolvedRows = templatesToSave.map((template) => ({
        ...template,
        supabaseId: template.supabaseId || resolveSupabaseTemplateId(template) || undefined,
      }));
      const freshRows = await persistTemplateSnapshot({
        ownerId: user.id,
        templates: withResolvedRows,
        persist: replaceSupabaseTemplates,
      });
      supabaseRowsRef.current = freshRows;
      return freshRows;
    } catch (err) {
      console.error('Error persisting templates:', err);
      throw err;
    }
  };

  const deleteDocumentEverywhere = async ({
    docId,
    filePath = null,
    source = 'unknown',
    requireStorageCleanup = false,
  }) => {
    if (!docId) throw new Error('Missing document id');
    if (!supabase) throw new Error('Supabase is not available');

    console.log('[DocumentDelete] start', JSON.stringify({ docId, filePath, source }));

    // Rebuild: delete means DELETE. Hard-delete the documents row so the ON
    // DELETE CASCADE clears its annotation log, snapshot, and legacy rows — the
    // marks are actually removed, not orphaned. Then drop the stored bytes and
    // purge the local durable copy so a same-content re-upload (which dedups to
    // the same id) can't resurrect the old marks.
    const { data: existing } = await supabase
      .from('documents')
      .select('id,name,file_path,user_id')
      .eq('id', docId)
      .maybeSingle();
    const storagePath = existing?.file_path || filePath || null;

    const { error: deleteError } = await supabase
      .from('documents')
      .delete()
      .eq('id', docId);

    if (deleteError && !isSupabaseRowNotFoundError(deleteError)) {
      console.error('[DocumentDelete] delete:error', JSON.stringify({
        docId, source, error: serializeError(deleteError),
      }));
      throw deleteError;
    }

    // Remove the stored PDF bytes (best effort — never blocks the delete).
    // Content-addressed storage means the SAME object can back several rows
    // (same bytes in two projects share one {user}/{sha}.pdf) — only remove it
    // when no other row still points at it.
    let storageCleanupError = null;
    if (storagePath) {
      try {
        const { data: sharer, error: sharerErr } = await supabase
          .from('documents')
          .select('id')
          .eq('file_path', storagePath)
          .neq('id', docId)
          .limit(1)
          .maybeSingle();
        if (sharerErr) {
          // Can't PROVE the object is unshared -> keep it. An orphaned object
          // is GC territory later; a deleted shared object is another
          // document's bytes gone.
          console.warn('[DocumentDelete] sharer check failed — keeping storage object', sharerErr.message);
          storageCleanupError = sharerErr;
        } else if (sharer) {
          console.log('[DocumentDelete] storage kept — object shared with', sharer.id);
        } else {
          await deleteFromStorage(storagePath);
        }
      } catch (storageErr) {
        storageCleanupError = storageErr;
        console.warn('[DocumentDelete] storage remove failed', storageErr?.message);
      }
    }

    // Purge the local durable copy (IndexedDB + in-memory doc).
    try { await purgeAnnotationDoc(docId); }
    catch (purgeErr) { console.warn('[DocumentDelete] local purge failed', purgeErr?.message); }

    // Verify the row is gone.
    const { data: remaining, error: verifyError } = await supabase
      .from('documents')
      .select('id')
      .eq('id', docId)
      .maybeSingle();

    if (verifyError && !isSupabaseRowNotFoundError(verifyError)) {
      console.error('[DocumentDelete] verify:error', JSON.stringify({
        docId, source, error: serializeError(verifyError),
      }));
      throw verifyError;
    }

    if (remaining) {
      const blocked = new Error('Document delete did not remove the database row');
      console.error('[DocumentDelete] verify:still-present', JSON.stringify({ docId, source, remaining }));
      throw blocked;
    }

    if (storageCleanupError && requireStorageCleanup) throw storageCleanupError;

    console.log('[DocumentDelete] verify:removed', JSON.stringify({ docId, source }));
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now - date);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 1) {
      const hours = Math.floor(diffTime / (1000 * 60 * 60));
      if (hours < 1) {
        const minutes = Math.floor(diffTime / (1000 * 60));
        return minutes < 1 ? 'Just now' : `${minutes} min ago`;
      }
      return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    } else if (diffDays < 7) {
      return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    }
    return date.toLocaleDateString();
  };

  const handleSort = (key) => {
    setSortConfig(prevConfig => ({
      key,
      direction: prevConfig.key === key && prevConfig.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const filteredDocuments = useMemo(() => {
    if (!searchQuery) return documents;
    const lq = searchQuery.toLowerCase();
    return documents.filter(doc =>
      doc.name.toLowerCase().includes(lq) ||
      (doc.name_aliases || []).some((a) => String(a).toLowerCase().includes(lq))
    );
  }, [documents, searchQuery]);

  const sortedDocuments = useMemo(() => {
    return [...filteredDocuments].sort((a, b) => {
      if (!sortConfig.key) return 0;

      let aVal = a[sortConfig.key];
      let bVal = b[sortConfig.key];

      if (sortConfig.key === 'uploadedAt') {
        aVal = new Date(aVal);
        bVal = new Date(bVal);
      }


      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredDocuments, sortConfig]);

  const sortedProjects = useMemo(() => {
    let filtered = projects;
    if (searchQuery) {
      const lq = searchQuery.toLowerCase();
      filtered = projects.filter(p => p.name.toLowerCase().includes(lq));
    }
    // Default sort by created_at desc (Supabase uses snake_case)
    return [...filtered]
      .map(p => ({ p, ms: Date.parse(p.created_at || p.createdAt || '') || 0 }))
      .sort((a, b) => b.ms - a.ms)
      .map(x => x.p);
  }, [projects, searchQuery]);

  const sortedTemplates = useMemo(() => {
    let filtered = templates;
    if (searchQuery) {
      const lq = searchQuery.toLowerCase();
      filtered = templates.filter(t => (t.name || '').toLowerCase().includes(lq));
    }
    return [...filtered]
      .map(t => ({ t, ms: Date.parse(t.createdAt || '') || 0 }))
      .sort((a, b) => b.ms - a.ms)
      .map(x => x.t);
  }, [templates, searchQuery]);

  // Derived state for selection mode availability
  const hasItems = activeSection === 'documents'
    ? sortedDocuments.length > 0
    : activeSection === 'projects'
      ? projects.length > 0
      : templates.length > 0;

  const handleDocumentClick = async (doc) => {
    const isCurrentOpen = () => documentOpenScopeRef.current === documentOpenScope;
    if (!isCurrentOpen()) return;
    try {
      // [OpenTiming] BUG#2 — first open milestone: user clicked a document.
      try { console.log('[OpenTiming] doc-click @ ' + Math.round(performance.now()) + 'ms', doc?.name || doc?.file?.name || doc?.id || ''); } catch (_e) { /* swallow */ }
      if (doc?.id && onActivateOpenDocument?.(doc) === true) return;
      // 1. Check if we have a local file object (e.g. from optimistic upload)
      if (doc.file) {
        // Attach Supabase metadata to the file for sync
        if (doc.id && !doc.file.id) {
          doc.file.id = doc.id;
          doc.file.projectId = doc.projectId || doc.project_id;
          // Phase 35 Plan 03 — attach document owner so PDFViewer's per-user
          // delete authority gate can resolve documentOwnerId without a
          // documents-table lookup (the documents array is Dashboard-scoped).
          doc.file.user_id = doc.user_id || doc.userId || null;
        }
        onDocumentSelect(doc.file);
        return;
      }

      // 2. Check if doc has filePath (formatted) or file_path (raw Supabase)
      const filePath = doc.filePath || doc.file_path;

      if (filePath) {
        // New and failed-load tabs still need a fresh file from storage.
        const blob = await downloadFromStorage(filePath);
        if (!isCurrentOpen()) return;
        const file = new File([blob], doc.name, { type: 'application/pdf' });

        // CRITICAL: Attach Supabase document metadata for real-time sync
        // Without this, pdfFile.id is undefined and sync won't work
        file.id = doc.id;  // Supabase document ID
        file.projectId = doc.projectId || doc.project_id;  // Project ID
        file.supabaseFilePath = filePath;  // Storage path
        // Phase 35 Plan 03 — owner identity for the per-user delete authority
        // gate (resolved in PDFViewer's documentOwnerId useMemo).
        file.user_id = doc.user_id || doc.userId || null;

        onDocumentSelect(file);
      } else if (doc.dataUrl) {
        // Legacy: Convert dataUrl back to blob, then to File
        const response = await fetch(doc.dataUrl);
        if (!isCurrentOpen()) return;
        const blob = await response.blob();
        if (!isCurrentOpen()) return;
        const file = new File([blob], doc.name, { type: 'application/pdf' });

        // Attach Supabase metadata
        file.id = doc.id;
        file.projectId = doc.projectId || doc.project_id;
        // Phase 35 Plan 03 — owner identity for delete authority gate.
        file.user_id = doc.user_id || doc.userId || null;

        onDocumentSelect(file);
      } else {
        console.error('Document structure:', doc);
        throw new Error('Document has no filePath, file_path, or dataUrl');
      }
    } catch (error) {
      if (!isCurrentOpen()) return;
      console.error('Error opening document:', error);

      // Check if file no longer exists in storage
      if (isStorageFileNotFoundError(error)) {
        // A failed read is not permission to erase the document or its marks.
        // The upload may still be pending, or the object may need recovery.
        showToast('The PDF file is unavailable. Your document and annotations were kept. Try again, or re-upload the original PDF to the same project.', 'error');
      } else {
        // Network or other temporary error - show message
        showToast('Unable to open document. Please check your connection and try again.', 'error');
      }
    }
  };

  useEffect(() => {
    if (!import.meta.env.DEV || typeof window === 'undefined') return undefined;
    window.__fix20OpenDocumentById = async (documentId) => {
      if (!documentId) throw new Error('Fix20 open requires documentId');
      const { data, error } = await supabase
        .from('documents')
        .select('id,name,file_path,file_size,page_count,user_id,project_id')
        .eq('id', documentId)
        .single();
      if (error) throw error;
      await handleDocumentClick(data);
      return data;
    };
    // Phase 35 eraser E2E compatibility aliases. DEV-only and backed by the
    // same production open/metadata paths as the app.
    window.__eraserE2EOpenDocumentById = window.__fix20OpenDocumentById;
    window.__eraserE2EPrimeDocumentMetadataCache = (documentId) => (
      resolveDocumentMetadata(documentId)
    );
    // KAL-49 harness — dev-only probe used by scripts/kal49-document-lock-e2e.mjs
    // to drive a Supabase annotation INSERT against the *current authenticated
    // session* so the verifier can prove the RLS deny path. Same shape as the
    // service singleton uses; this is the only point in the app where we have
    // both the imported `supabase` client and the current auth context.
    window.__kal49Harness = {
      async insertAnnotationProbe(documentId) {
        if (!documentId) throw new Error('kal49 probe requires documentId');
        const session = await getSupabaseSession('kal49Harness');
        const userId = session?.user?.id || null;
        if (!userId) return { error: { message: 'no session' } };
        const { data, error } = await supabase
          .from('document_annotations')
          .insert({
            document_id: documentId,
            user_id: userId,
            annotation_id: `kal49-probe-${Date.now()}`,
            page_number: 1,
            annotation_type: 'ink',
            annotation_data: { type: 'ink', test: 'kal49' },
            // bounds is NOT NULL on document_annotations — fill with a degenerate
            // single-point bound so the schema check passes; RLS is what we're
            // probing, not geometry.
            bounds: { x: 0, y: 0, width: 1, height: 1 },
          })
          .select();
        return {
          data: data ?? null,
          error: error ? { code: error.code, message: error.message, status: error.status } : null,
        };
      },
    };
    return () => {
      if (window.__fix20OpenDocumentById) {
        delete window.__fix20OpenDocumentById;
      }
      delete window.__eraserE2EOpenDocumentById;
      delete window.__eraserE2EPrimeDocumentMetadataCache;
      if (window.__kal49Harness) {
        delete window.__kal49Harness;
      }
    };
  }, [handleDocumentClick]);

  /* KAL-82 slice 2 — the legacy template-modal UI is gone (home-redesign
     409b0325 stopped rendering it; 3cb37412 deleted its JSX), but these two
     openers are still invoked by live buttons: TemplatesEditor's "New
     Template" (via SurveyHub onCreateTemplate) and the survey-panel /
     spaces-rail create-template/category actions (via AppShell's
     handleCreateTemplateRequest -> dashboard ref). The orphaned modal state
     machine was deleted in this slice; the stubs below intentionally
     PRESERVE the one observable side effect the old openers had — seeding /
     loading the AppShell-owned entities state, which PDFViewer serializes
     into the persisted document data JSON on save. Rewiring or removing
     those buttons (and whether to keep this entities reset at all) is
     queued on KAL-82 as a product decision. */
  const openTemplateModal = () => {
    // Initialize with default Entities (entity definitions use 20% opacity for display, surveyMarkers use 40%)
    setEntities([
      { id: `entity-${Date.now()}-1`, name: 'GC', color: hexToRgba('#E3D1FB', 0.2) },
      { id: `entity-${Date.now()}-2`, name: 'Subcontractor', color: hexToRgba('#FFF5C3', 0.2) },
      { id: `entity-${Date.now()}-3`, name: 'My Company', color: hexToRgba('#CBDCFF', 0.2) },
      { id: `entity-${Date.now()}-4`, name: '100% Complete', color: hexToRgba('#B2FFB2', 0.2) },
      { id: `entity-${Date.now()}-5`, name: 'Removed', color: hexToRgba('#BBBBBB', 0.2) }
    ]);
  };

  const openEditTemplateModal = (templateId) => {
    const template = templates.find(t => t.id === templateId);
    if (!template) {
      showToast('Template not found.', 'error');
      return;
    }

    // Load Entities from template, or use defaults
    const defaultEntities = [
      { id: `entity-${Date.now()}-1`, name: 'GC', color: hexToRgba('#E3D1FB', 0.2) },
      { id: `entity-${Date.now()}-2`, name: 'Subcontractor', color: hexToRgba('#FFF5C3', 0.2) },
      { id: `entity-${Date.now()}-3`, name: 'My Company', color: hexToRgba('#CBDCFF', 0.2) },
      { id: `entity-${Date.now()}-4`, name: '100% Complete', color: hexToRgba('#B2FFB2', 0.2) },
      { id: `entity-${Date.now()}-5`, name: 'Removed', color: hexToRgba('#BBBBBB', 0.2) }
    ];
    const loadedEntities = template.entities || defaultEntities;
    // Ensure all loaded entities have rgba format with 20% opacity
    const normalizedEntities = loadedEntities.map(entity => {
      if (!entity.color) {
        return entity;
      }

      // If color is hex, convert to rgba with default 20% opacity (legacy data)
      if (entity.color.startsWith('#')) {
        return { ...entity, color: hexToRgba(entity.color, 0.2) };
      }

      // If color is rgba, preserve whatever opacity was previously saved
      const rgbaMatch = entity.color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:,\s*([\d.]+))?\s*\)/i);
      if (rgbaMatch) {
        const opacity = rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 1;
        const clampedOpacity = Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 1;
        return {
          ...entity,
          color: `rgba(${rgbaMatch[1]}, ${rgbaMatch[2]}, ${rgbaMatch[3]}, ${clampedOpacity})`
        };
      }

      return entity;
    });
    setEntities(normalizedEntities);
  };

  useImperativeHandle(ref, () => ({
    openTemplateModal,
    openEditTemplateModal,
    closeTemplateModal: () => {}, // KAL-82 slice 2: no modal left to close
    exitSelectionMode
  }));

  /* --- Survey Hub (home redesign) wiring -------------------------------
     SurveyHub is the home UI. (The pre-redesign grid/table JSX that used to
     live here as `legacyHomeUI` was removed once SurveyHub was confirmed.)
     These adapter handlers operate directly on the document objects SurveyHub
     passes in, reusing the same Supabase primitives the legacy bulk handlers
     use (no refactor). */

  // Open a document in the PDF viewer — reuse the existing open path.
  const hubOpenDocument = (doc) => { if (doc) handleDocumentClick(doc); };

  /* KAL-44 — count survey markers that reference a checklist item id across
     every document, so the templates editor can decide to archive vs hard-
     delete. Hub has no in-memory marker map (no document is open), so this
     hits Supabase. Guests get 0 (no cloud data) which preserves the
     pre-KAL-44 hard-delete path for unsigned-in users. The TemplatesEditor
     awaits this promise inside its async delete handler. */
  const hubGetChecklistItemUsageCount = useCallback(async (itemId) => {
    if (!itemId || typeof itemId !== 'string') return 0;
    if (!user) return 0;
    try {
      return await countSurveyMarkersReferencingChecklistItem(itemId);
    } catch (err) {
      console.warn('[ChecklistArchive] hub count failed:', err);
      return 0;
    }
  }, [user]);

  // Persist edits made in the Survey Hub's Templates editor. Logged-in / guest
  // split: hub edits land in Supabase (config JSONB) for signed-in users, or
  // localStorage otherwise.
  // UX (KAL-432): templates archive exactly like documents and projects. They
  // were the odd one out only because the editor's delete filtered the list and
  // let the bundle save infer the removal — that inferred delete was permanent.
  // Archiving goes straight at the row instead, so the editor never has to
  // round-trip a deletion through its save path.
  // Returns false when nothing was attempted (empty / signed out / cancelled),
  // otherwise the array of template ids that actually reached Archive. The
  // editor drops exactly those rows and keeps the rest.
  // UX: a template the hub cannot match to a stored row must NEVER disappear
  // quietly. It used to be filtered out of the batch, so the row vanished from
  // the editor while the stored template stayed live and un-archived — and the
  // next bundle save then read that as a removal and destroyed it for good.
  // Anything unresolved now stays on screen and says so out loud.
  const hubArchiveTemplates = async (templateIds) => {
    // Accepts bare ids or { id, name } entries — the editor passes names so an
    // unsaved template (which the hub's own list has never seen) can still be
    // named in the error message.
    const selection = Array.from(templateIds || [])
      .map((entry) => (typeof entry === 'string' ? { id: entry, name: null } : entry))
      .filter((entry) => entry && entry.id);
    const ids = selection.map((entry) => entry.id);
    if (ids.length === 0) return false;
    if (!user) { showToast('Please sign in to archive templates', 'warn'); return false; }
    const confirmed = await askConfirm({
      title: ids.length === 1 ? 'Move this template to Archive?' : `Move these ${ids.length} templates to Archive?`,
      message: ids.length === 1
        ? 'You can restore it from Archive for the next 30 days.'
        : 'You can restore them from Archive for the next 30 days.',
      confirmLabel: ids.length === 1 ? 'Move to Archive' : `Move ${ids.length} to Archive`,
    });
    if (!confirmed) return false;
    // The RPC takes the templates ROW id; the editor works in config ids. The
    // display name comes from the same lookup so Archive names the template
    // instead of showing a generic label.
    const known = templatesRef.current || [];
    const rows = selection.map((entry) => {
      const match = known.find((t) => t && t.id === entry.id);
      return {
        id: entry.id,
        supabaseId: resolveSupabaseTemplateId(match || entry.id),
        name: match?.name || entry.name || 'Untitled template',
      };
    });
    const unresolved = rows.filter((row) => !row.supabaseId);
    const resolved = rows.filter((row) => row.supabaseId);
    if (unresolved.length) {
      console.error('[TemplateArchive] survey-hub:unresolved', JSON.stringify(unresolved.map(r => r.id)));
      showToast(
        unresolved.length === 1
          ? `${unresolved[0].name} isn’t saved to the cloud yet, so it can’t be archived. Save your templates and try again.`
          : `${unresolved.length} templates aren’t saved to the cloud yet, so they can’t be archived. Save your templates and try again.`,
        'error'
      );
    }
    if (resolved.length === 0) return [];
    let succeededIds = [];
    try {
      const { succeeded, failed } = await archiveItems(
        resolved.map((row) => ({ type: 'template', id: row.supabaseId, name: row.name }))
      );
      const archivedRowIds = new Set(succeeded.map((item) => item.id));
      succeededIds = resolved.filter((row) => archivedRowIds.has(row.supabaseId)).map((row) => row.id);
      if (failed.length) {
        console.error('[TemplateArchive] survey-hub:partial', JSON.stringify(failed.map(f => f.error)));
        showToast(failed[0].error, 'error');
      }
      // Drop the archived rows from the persisted-rows baseline immediately.
      // A save queued right behind this archive would otherwise diff against a
      // baseline that still lists the archived template, read it as a removal,
      // and hard-delete it. Pruning (rather than trusting the refetch) is safe
      // even when the read fails — loadTemplates swallows its error and returns
      // an empty list, which must never become the baseline.
      supabaseRowsRef.current = (supabaseRowsRef.current || []).filter(
        (row) => !archivedRowIds.has(row?.id)
      );
      await refetchTemplates();
      notifyLibraryChanged();
    } catch (err) {
      console.error('[TemplateArchive] survey-hub:error', serializeError(err));
      showToast('Failed to archive templates: ' + (err.message || 'Unknown error'), 'error');
      await refetchTemplates();
      return false;
    }
    return succeededIds;
  };

  const hubSaveTemplates = async (nextTemplates) => {
    if (!Array.isArray(nextTemplates)) return;
    try {
      if (user) {
        const freshRows = await persistTemplates(nextTemplates);
        updateTemplates(mapAuthoritativeTemplateRows(freshRows));
      } else {
        localStorage.setItem('templates', JSON.stringify(nextTemplates));
        updateTemplates(nextTemplates);
      }
    } catch (e) {
      console.error('Failed to save templates', e);
      showToast('Failed to save templates.', 'error');
      // BL-23: rethrow so the templates editor keeps its dirty state (and the
      // user's unsaved edits) when persistence fails.
      throw e;
    }
  };

  const hubReloadTemplates = async () => {
    const freshRows = await refetchTemplates();
    supabaseRowsRef.current = freshRows;
    const authoritative = mapAuthoritativeTemplateRows(freshRows);
    updateTemplates(authoritative);
    return authoritative;
  };

  // Delete the given documents everywhere: hard-deletes each row (cascading its
  // annotation log, snapshot, and child rows), removes the stored PDF, and purges
  // the local durable copy.
  // UX: this is the ONE and ONLY delete confirmation for documents — the hub's
  // toolbar bulk delete and the row "..." menu delete both land here, so the
  // user is asked exactly once. Never add a second confirm at a call site.
  // Returns false when nothing was deleted (cancelled / signed out / empty) so
  // callers can keep the user's selection intact after a cancel.
  // UX (KAL-432): Delete no longer destroys anything. It moves the documents
  // into the user's Archive, where they stay recoverable for 30 days before the
  // purge job removes them for good. The copy says so explicitly — promising
  // "cannot be undone" when the item is in fact recoverable would train users to
  // fear a safe action. Permanent deletion now lives only on the Archive screen.
  const hubDeleteDocuments = async (docs) => {
    const list = Array.isArray(docs) ? docs.filter(Boolean) : [];
    if (list.length === 0) return false;
    if (!user) { showToast('Please sign in to archive documents', 'warn'); return false; }
    const confirmed = await askConfirm({
      title: list.length === 1 ? 'Move this document to Archive?' : `Move these ${list.length} documents to Archive?`,
      message: list.length === 1
        ? 'You can restore it from Archive for the next 30 days.'
        : 'You can restore them from Archive for the next 30 days.',
      confirmLabel: list.length === 1 ? 'Move to Archive' : `Move ${list.length} to Archive`,
    });
    if (!confirmed) return false;
    // Unsaved local-only rows have no server row to archive; drop them as before.
    const archivable = list.filter(d => !(typeof d.id === 'string' && d.id.startsWith('temp-')));
    const ids = list.map(d => d.id);
    setDocuments(prev => prev.filter(d => !ids.includes(d.id)));
    try {
      const { failed } = await archiveItems(
        archivable.map(doc => ({ type: 'document', id: doc.id, name: doc.name || doc.title || 'Document' }))
      );
      // UX: no success toast. The row leaving the list IS the confirmation, and
      // a banner that lingers for seconds over a routine action is noise. Only
      // a failure is worth interrupting for.
      if (failed.length) {
        console.error('[DocumentArchive] survey-hub:partial', JSON.stringify(failed.map(f => f.error)));
        showToast(failed[0].error, 'error');
      }
      await refetchDocuments();
      notifyLibraryChanged();
    } catch (err) {
      console.error('[DocumentArchive] survey-hub:error', serializeError(err));
      showToast('Failed to archive documents: ' + (err.message || 'Unknown error'), 'error');
      await refetchDocuments();
    }
    return true;
  };

  const hubDeleteProjects = async (items) => {
    const list = Array.isArray(items) ? items.filter(Boolean) : [];
    if (list.length === 0) return false;
    if (!user) { showToast('Please sign in to delete projects', 'warn'); return false; }
    // UX (KAL-432): same as documents — a project and its documents move into
    // Archive as ONE group and restore together, so the copy promises recovery
    // rather than warning about permanence.
    const confirmed = await askConfirm({
      title: list.length === 1
        ? 'Move this project and its documents to Archive?'
        : `Move these ${list.length} projects and their documents to Archive?`,
      message: 'You can restore the whole project from Archive for the next 30 days.',
      confirmLabel: list.length === 1 ? 'Move to Archive' : `Move ${list.length} to Archive`,
    });
    // Cancelling must still resolve the caller's boolean contract as "not
    // deleted" — the hub uses this return value to decide whether to clear its
    // selection.
    if (!confirmed) return false;

    const ids = list.map((project) => project.id).filter(Boolean);
    setDocuments((prev) => prev.filter((doc) => !ids.includes(doc.project_id || doc.projectId)));
    try {
      const { failed } = await archiveItems(
        list.filter((project) => project.id).map((project) => ({
          type: 'project', id: project.id, name: project.name || 'Project',
        }))
      );
      // UX: no success toast — see hubDeleteDocuments. Only failures speak up.
      if (failed.length) {
        console.error('[ProjectArchive] survey-hub:partial', JSON.stringify(failed.map(f => f.error)));
        showToast(failed[0].error, 'error');
      }
      await refetchProjects();
      await refetchDocuments();
      await refetchAllDocuments();
      notifyLibraryChanged();
      return true;
    } catch (err) {
      console.error('[ProjectArchive] survey-hub:error', serializeError(err));
      showToast('Failed to archive projects: ' + (err.message || 'Unknown error'), 'error');
      await refetchProjects();
      await refetchDocuments();
      return false;
    }
  };

  const hubRenameProject = async (project, nextName) => {
    const name = String(nextName || '').trim();
    if (!project?.id || !name) return false;
    if (!user) { showToast('Please sign in to rename projects', 'warn'); return false; }
    try {
      await updateSupabaseProject(project.id, { name, updated_at: new Date().toISOString() });
      await refetchProjects();
      return true;
    } catch (err) {
      console.error('[ProjectRename] survey-hub:error', serializeError(err));
      showToast('Failed to rename project: ' + (err.message || 'Unknown error'), 'error');
      await refetchProjects();
      return false;
    }
  };

  const hubRenameDocument = async (doc, nextName) => {
    const name = String(nextName || '').trim();
    if (!doc?.id || !name) return false;
    if (!user) { showToast('Please sign in to rename documents', 'warn'); return false; }
    try {
      setDocuments((prev) => prev.map((item) => (
        item.id === doc.id ? { ...item, name, updated_at: new Date().toISOString() } : item
      )));
      await updateSupabaseDocument(doc.id, { name, updated_at: new Date().toISOString() });
      await refetchDocuments();
      await refetchAllDocuments();
      return true;
    } catch (err) {
      console.error('[DocumentRename] survey-hub:error', serializeError(err));
      showToast('Failed to rename document: ' + (err.message || 'Unknown error'), 'error');
      await refetchDocuments();
      return false;
    }
  };

  const cloneDocumentToProject = async (doc, projectId = null, operation = null) => {
    const actualDoc = (allDocuments || []).find((candidate) => candidate.id === doc?.id) || doc;
    const filePath = actualDoc?.file_path || actualDoc?.filePath;
    if (!filePath) throw new Error(`Document "${actualDoc?.name || 'Untitled'}" has no stored PDF.`);
    const blob = await downloadFromStorage(filePath);
    const sourceName = actualDoc.name || 'Untitled.pdf';
    const dot = sourceName.toLowerCase().lastIndexOf('.pdf');
    const copyName = dot >= 0
      ? `${sourceName.slice(0, dot)} (Copy)${sourceName.slice(dot)}`
      : `${sourceName} (Copy)`;
    const copyFile = new File([blob], copyName, { type: blob.type || 'application/pdf' });
    // A batch copy supplies a stable UUID. The same key makes both the storage
    // upload and documents insert idempotent after a committed-but-lost reply.
    const stableCopyId = operation?.operationId || crypto.randomUUID();
    const uploadedPath = await uploadToStorage(
      copyFile,
      projectId,
      undefined,
      stableCopyId,
    );
    try {
      return await createSupabaseDocument({
        id: stableCopyId,
        name: copyName,
        file_path: uploadedPath,
        file_size: blob.size,
        page_count: actualDoc.page_count ?? null,
        project_id: projectId,
        archived: false,
      });
    } catch (error) {
      // The row may have committed even though the response was lost. The
      // batch compensator reconciles this stable candidate by id; never remove
      // its bytes here based on the response alone.
      error.recoveryValue = { id: stableCopyId, file_path: uploadedPath };
      throw error;
    }
  };

  const rollbackClonedDocument = async (created) => {
    if (!created?.id) return;
    await deleteDocumentEverywhere({
      docId: created.id,
      filePath: created.file_path || created.filePath || null,
      source: 'survey-hub-duplicate-rollback',
      requireStorageCleanup: true,
    });
  };

  const rollbackClonedDocuments = async (createdDocuments) => {
    const cleanupErrors = [];
    for (const created of [...createdDocuments].reverse()) {
      try { await rollbackClonedDocument(created); }
      catch (error) { cleanupErrors.push(error); }
    }
    return cleanupErrors;
  };

  const hubDuplicateDocuments = async (docs, targetProjectId = undefined) => {
    const list = Array.isArray(docs) ? docs.filter(Boolean) : [];
    if (list.length === 0) return false;
    if (!user) { showToast('Please sign in to duplicate documents', 'warn'); return false; }
    try {
      if (duplicateDocumentsRecoveryRef.current?.pending?.length) {
        await retryCompensatingCleanup(
          duplicateDocumentsRecoveryRef.current,
          rollbackClonedDocument,
        );
        persistPendingCleanup(
          duplicateDocumentsRecoveryKey,
          duplicateDocumentsRecoveryRef,
          null,
        );
      }
      await runCompensatingBatch(
        list,
        (doc) => cloneDocumentToProject(
          doc,
          targetProjectId === undefined ? (doc.project_id ?? null) : targetProjectId,
        ),
        rollbackClonedDocument,
      );
      await refetchDocuments();
      await refetchAllDocuments();
      return true;
    } catch (err) {
      if (err.compensation?.pending?.length) {
        persistPendingCleanup(
          duplicateDocumentsRecoveryKey,
          duplicateDocumentsRecoveryRef,
          err.compensation,
        );
      }
      console.error('[DocumentDuplicate] survey-hub:error', serializeError(err));
      if (err.cleanupErrors?.length > 0) {
        console.error('[DocumentDuplicate] rollback:error', err.cleanupErrors.map(serializeError));
      }
      showToast('Failed to duplicate documents: ' + (err.message || 'Unknown error'), 'error');
      await refetchDocuments();
      await refetchAllDocuments();
      return false;
    }
  };

  const hubDuplicateProjects = async (sourceProjects) => {
    const list = Array.isArray(sourceProjects) ? sourceProjects.filter(Boolean) : [];
    if (list.length === 0) return false;
    if (!user) { showToast('Please sign in to duplicate projects', 'warn'); return false; }
    const duplicateProjectBundle = async (source) => {
        const stableProjectId = crypto.randomUUID();
        let created;
        try {
          created = await createSupabaseProject({
            id: stableProjectId,
            name: `${source.name || 'Untitled Project'} (copy)`,
          });
        } catch (error) {
          error.recoveryValue = { project: { id: stableProjectId }, documents: [] };
          throw error;
        }
        const createdDocuments = [];
        const sourceDocuments = (allDocuments || []).filter((doc) => doc.project_id === source.id);
        try {
          for (const doc of sourceDocuments) {
            createdDocuments.push(await cloneDocumentToProject(doc, created.id));
          }
          return { project: created, documents: createdDocuments };
        } catch (error) {
          if (error.recoveryValue) createdDocuments.push(error.recoveryValue);
          const cleanupErrors = await rollbackClonedDocuments(createdDocuments);
          try { await deleteSupabaseProject(created.id); }
          catch (cleanupError) { cleanupErrors.push(cleanupError); }
          if (cleanupErrors.length > 0) {
            error.cleanupErrors = cleanupErrors;
            error.recoveryValue = { project: created, documents: createdDocuments };
          } else {
            delete error.recoveryValue;
          }
          throw error;
        }
    };
    const rollbackDuplicatedProjectBundle = async ({ project, documents: copiedDocuments }) => {
      const cleanupErrors = await rollbackClonedDocuments(copiedDocuments);
      try { await deleteSupabaseProject(project.id); }
      catch (error) { cleanupErrors.push(error); }
      if (cleanupErrors.length > 0) throw cleanupErrors[0];
    };
    try {
      if (duplicateProjectsRecoveryRef.current?.pending?.length) {
        await retryCompensatingCleanup(
          duplicateProjectsRecoveryRef.current,
          rollbackDuplicatedProjectBundle,
        );
        persistPendingCleanup(
          duplicateProjectsRecoveryKey,
          duplicateProjectsRecoveryRef,
          null,
        );
      }
      await runCompensatingBatch(
        list,
        duplicateProjectBundle,
        rollbackDuplicatedProjectBundle,
      );
      await refetchProjects();
      await refetchDocuments();
      await refetchAllDocuments();
      return true;
    } catch (err) {
      if (err.compensation?.pending?.length) {
        persistPendingCleanup(
          duplicateProjectsRecoveryKey,
          duplicateProjectsRecoveryRef,
          err.compensation,
        );
      }
      console.error('[ProjectDuplicate] survey-hub:error', serializeError(err));
      if (err.cleanupErrors?.length > 0) {
        console.error('[ProjectDuplicate] rollback:error', err.cleanupErrors.map(serializeError));
      }
      showToast('Failed to duplicate projects: ' + (err.message || 'Unknown error'), 'error');
      await refetchProjects();
      await refetchDocuments();
      await refetchAllDocuments();
      return false;
    }
  };

  // Move re-parents the existing row; copy downloads the stored PDF and
  // creates a distinct storage object + document row in the destination.
  const hubMoveCopyDocuments = async (docs, projectId, mode = 'move') => {
    const list = Array.isArray(docs) ? docs.filter(Boolean) : [];
    if (list.length === 0 || !projectId) return;
    if (!user) { showToast('Please sign in to move documents', 'warn'); return; }
    const targetProj = projects.find(p => p.id === projectId);
    if (!targetProj) return;

    const actualDocuments = list.map((doc) => {
      const actual = (supabaseDocuments || []).find((candidate) => candidate.id === doc.id)
        || (allDocuments || []).find((candidate) => candidate.id === doc.id)
        || doc;
      if (!actual?.id) throw new Error(`Document "${doc?.name || 'Untitled'}" is no longer available.`);
      return actual;
    });
    const rollbackMove = async ({ document, previousProjectId }) => {
      await updateSupabaseDocument(document.id, { project_id: previousProjectId });
    };
    const readDocument = async (documentId) => {
      const { data, error } = await supabase
        .from('documents')
        .select('*')
        .eq('id', documentId)
        .maybeSingle();
      if (error && !isSupabaseRowNotFoundError(error)) throw error;
      return data || null;
    };
    try {
      const previousRecovery = documentMoveCopyRecoveryRef.current;
      if (previousRecovery) {
        const previousPhase = previousRecovery.phase;
        await moveOrCopyDocumentsAtomically({
          documents: [],
          projectId,
          mode,
          copyDocument: cloneDocumentToProject,
          rollbackCopy: rollbackClonedDocument,
          moveDocument: (document, destinationId) => (
            updateSupabaseDocument(document.id, { project_id: destinationId })
          ),
          rollbackMove,
          readDocument,
          recovery: previousRecovery,
          onRecoveryChange: persistDocumentMoveCopyRecovery,
        });
        if (previousPhase === 'execute') {
          await refetchProjects();
          await refetchDocuments();
          await refetchAllDocuments();
          return true;
        }
      }
      await moveOrCopyDocumentsAtomically({
        documents: actualDocuments,
        projectId,
        mode,
        copyDocument: cloneDocumentToProject,
        rollbackCopy: rollbackClonedDocument,
        moveDocument: (document, destinationId) => (
          updateSupabaseDocument(document.id, { project_id: destinationId })
        ),
        rollbackMove,
        readDocument,
        onRecoveryChange: persistDocumentMoveCopyRecovery,
      });
      await refetchProjects();
      await refetchDocuments();
      await refetchAllDocuments();
      return true;
    } catch (err) {
      console.error('[DocumentMoveCopy] survey-hub:error', serializeError(err));
      showToast(`Failed to ${mode} documents: ${err.message || 'Unknown error'}`, 'error');
      await refetchDocuments();
      await refetchAllDocuments();
      throw err;
    }
  };

  const hubToggleDocumentLock = async (doc) => {
    if (!doc?.id) return;
    if (!user) { showToast('Please sign in to lock documents', 'warn'); return; }
    if (doc.user_id && doc.user_id !== user.id) {
      showToast('Only the document owner can lock or unlock this document.', 'error');
      return;
    }

    const isLocked = doc.locked_at != null;
    try {
      let result;
      if (isLocked) {
        const ok = await askConfirm({
          title: 'Unlock for editing?',
          message: 'This re-enables changes from everyone with edit access.',
          confirmLabel: 'Unlock',
          // Unlocking is not destructive — brand gold primary, not red.
          danger: false,
        });
        if (!ok) return;
        result = await unlockDocument(doc.id);
      } else {
        const raw = await askPrompt({
          title: 'Lock this document?',
          message: 'It becomes read-only for everyone.',
          label: 'Optional label',
          placeholder: 'e.g. Final v1',
          confirmLabel: 'Lock document',
        });
        // null === dismissed. An empty string means "lock it, no label" — the
        // same distinction native prompt() made, and lockDocument() relies on
        // it below.
        if (raw == null) return;
        result = await lockDocument(doc.id, raw.trim() ? raw.trim() : null);
      }

      if (result.error) throw result.error;
      if (result.data) {
        setDocuments((prev) => prev.map((d) => (
          d.id === doc.id
            ? {
                ...d,
                locked_at: result.data.locked_at ?? null,
                locked_by: result.data.locked_by ?? null,
                locked_label: result.data.locked_label ?? null,
              }
            : d
        )));
      }
      await refetchDocuments();
    } catch (err) {
      console.error('[DocumentLock] survey-hub:error', serializeError(err));
      showToast(`Failed to ${isLocked ? 'unlock' : 'lock'} document: ${err.message || 'Unknown error'}`, 'error');
      await refetchDocuments();
    }
  };

  /* Home redesign: render the new Survey Hub instead of the legacy grid/table.
     Every prop maps to data/handlers that already exist in Dashboard/App.

     The hidden <input ref={fileInputRef} type="file" /> used by the browser
     fallback in handleUploadClick previously only lived inside the legacy home
     UI (no longer rendered), so the SurveyHub Documents-tab Upload button was
     a no-op. Mount the file inputs here so handleUploadClick fires correctly
     in v2.0 browser mode. handleFileUpload already resets event.target.value
     so the same file can be re-picked. */
  const hubInitialLoading = resolveHubInitialLoading({
    documentsInitialLoading,
    projectsInitialLoading,
    templatesInitialLoading,
  });

  return (
    <>
      <DismissBarrier
        active={showUserDropdown}
        insideRefs={userDropdownInsideRefs}
        onDismiss={() => setShowUserDropdown(false)}
      />
      <DismissBarrier
        active={isViewDropdownOpen}
        insideRefs={viewDropdownInsideRefs}
        onDismiss={() => setIsViewDropdownOpen(false)}
      />
      <input
        ref={localFileInputRef}
        data-local-pdf-input
        type="file"
        accept="application/pdf,.pdf"
        onChange={handleLocalFileSelected}
        style={{ display: 'none' }}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        onChange={handleFileUpload}
        style={{ display: 'none' }}
      />
      <input
        ref={projectFileInputRef}
        type="file"
        accept="application/pdf"
        onChange={handleProjectFilesSelected}
        multiple
        style={{ display: 'none' }}
      />
      <SurveyHub
        localDocuments={localDocuments}
        localDocumentsLoading={localDocumentsLoading}
        localDocumentsError={localDocumentsError || localListError}
        localDocumentBusy={localDocumentBusy}
        onImportLocalDocument={handleOpenLocalClick}
        onOpenLocalDocument={row => { void runLocalDocumentAction(() => openManagedLocalDocument(row.localId)); }}
        onRetryLocalDocuments={refreshLocalDocuments}
        localRecoveryCopies={localRecoveryCopies}
        localRecoveryLoading={localRecoveryLoading}
        localRecoveryError={localRecoveryActionError || localRecoveryListError}
        onRecoverLocalCopy={recoverLocalCopy}
        onDiscardLocalRecoveryCopy={discardLocalRecoveryCopy}
        onRetryLocalRecoveryCopies={refreshLocalRecoveryCopies}
        onLocalDocumentsVisibilityChange={setLocalDocumentsVisible}
        documents={documents}
        projects={projects}
        templates={templates}
        documentsInitialLoading={hubInitialLoading.documents}
        projectsInitialLoading={hubInitialLoading.projects}
        templatesInitialLoading={hubInitialLoading.templates}
        projectPreferences={projectPreferences}
        documentsLoadError={documentsLoadError}
        projectsLoadError={projectsLoadError}
        templatesLoadError={templatesLoadError}
        onRetryDocuments={refetchDocuments}
        onRetryProjects={refetchProjects}
        onRetryTemplates={refetchTemplates}
        members={[]}
        user={user ? { id: user.id, name: user.user_metadata?.full_name || user.name || user.email, email: user.email } : null}
        isPro={!!features?.advancedSurvey}
        onOpenDocument={hubOpenDocument}
        onUpload={handleUploadClick}
        uploadBusy={activeUploads > 0 || uploadInFlight}
        onCreateProject={handleCreateProjectClick}
        onRenameProject={hubRenameProject}
        onCreateTemplate={openTemplateModal}
        onDeleteProjects={hubDeleteProjects}
        onDuplicateProjects={hubDuplicateProjects}
        onSaveTemplates={hubSaveTemplates}
        onArchiveTemplates={hubArchiveTemplates}
        onReloadTemplates={hubReloadTemplates}
        getChecklistItemUsageCount={hubGetChecklistItemUsageCount}
        onDuplicateDocuments={hubDuplicateDocuments}
        onDeleteDocuments={hubDeleteDocuments}
        onRenameDocument={hubRenameDocument}
        onMoveCopyDocuments={hubMoveCopyDocuments}
        onProjectPreferencesChange={hubProjectPreferencesChange}
        onLockDocument={hubToggleDocumentLock}
        onSettings={() => setShowAccountSettings(true)}
        onSignOut={signOut}
        onSignIn={onShowAuthModal}
      />
      <CreateProjectModal
        open={isProjectModalOpen}
        name={projectName}
        files={projectFiles}
        busy={uploadInFlight}
        onNameChange={setProjectName}
        onFilesChange={(files) => setProjectFiles((prev) => [...prev, ...files.filter((file) => (
          file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
        ))])}
        onRemoveFile={(index) => setProjectFiles((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}
        onCancel={handleCancelCreateProject}
        onConfirm={handleConfirmCreateProject}
      />
      <DuplicateUploadModal
        isOpen={!!duplicateModal}
        mode={duplicateModal?.mode}
        incomingName={duplicateModal?.incomingName}
        existingName={duplicateModal?.existingName}
        contentsKnownDifferent={duplicateModal?.knownDifferent !== false}
        onResolve={settleDuplicateModal}
        onClose={() => settleDuplicateModal(duplicateModal?.mode === 'alias' ? 'skip-alias' : 'cancel')}
      />
      {dashboardError && (
        <div
          role="alert"
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            maxWidth: 520,
            background: '#1f1f1f',
            color: '#fff',
            border: '1px solid rgba(249, 115, 115, 0.65)',
            borderRadius: 8,
            padding: '12px 14px 12px 16px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
            boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
            zIndex: 2000,
            fontFamily: FONT_FAMILY,
            fontSize: 13,
            lineHeight: 1.45,
            whiteSpace: 'pre-line',
          }}
        >
          <span style={{ flex: 1 }}>{dashboardError}</span>
          <button
            type="button"
            onClick={() => setDashboardError('')}
            aria-label="Dismiss error"
            style={{
              flex: 'none',
              background: 'transparent',
              color: '#bbb',
              border: 'none',
              cursor: 'pointer',
              fontSize: 16,
              lineHeight: 1,
              padding: 0,
              width: 22,
              height: 22,
            }}
          ><Icon name="close" size={14} /></button>
        </div>
      )}

      {/* KAL-57: themed confirm / prompt dialogs (replacing native
          confirm()/prompt()). Rendered last so their fixed-position scrim sits
          above the hub chrome. Both are inert until a handler awaits them. */}
      {confirmDialogElement}
      {promptDialogElement}
    </>
  );
});

export default Dashboard;
