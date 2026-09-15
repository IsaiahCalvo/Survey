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
import { resolveIncomingUpload } from './utils/incomingFileResolver';
import DuplicateUploadModal from './components/DuplicateUploadModal';
import Icon from './Icons';
import DismissBarrier from './components/DismissBarrier';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import SurveyHub from './home/SurveyHub';
import CreateProjectModal from './home/CreateProjectModal';
import { useProjectUploadRecovery } from './home/useProjectUploadRecovery.js';
import ProjectUploadRecoveryPanel from './home/ProjectUploadRecoveryPanel.jsx';
import { useDocumentUploadRecovery } from './home/useDocumentUploadRecovery.js';
import DocumentUploadRecoveryPanel from './home/DocumentUploadRecoveryPanel.jsx';
import { createDocumentUploadCloud } from './services/documentUploadCloud.js';
import { resolveHubInitialLoading } from './home/hubInitialLoadingState.js';
import { retryCompensatingCleanup, runCompensatingBatch } from './home/compensatingBatch.js';
import { preparePdfUpload } from './home/pdfUploadWork.js';
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
import { runActorBoundDatabaseMutation } from './services/actorBoundDatabaseMutation.js';
import { showToast } from './utils/toast';
import { archiveItems } from './services/archiveService';
import { notifyLibraryChanged } from './hooks/libraryChangeBus';
import { useConfirmDialog, usePromptDialog } from './components/dialogPrompts';
import { readBlobAsArrayBuffer } from './utils/blobArrayBuffer.js';
import { importLocalDocument, importLocalDocumentCopy, listLocalDocuments, openLocalDocument } from './services/localDocumentStore.js';
import { listLocalDocumentDrafts, readLocalDocumentDraft, readExistingLocalDocumentDraft, verifyExistingLocalDocumentDraftReceipt, discardLocalDocumentDraft } from './services/localDocumentDraftStore.js';
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

const canonicalDocumentByteSize = (value) => {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) return null;
  return value;
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


const Dashboard = forwardRef(function Dashboard({ isActive = true, catalogEnabled = false, onDocumentSelect, onOpenCloudDocument,
  onAcquireCloudDocumentForAction, onDescribeCloudDocumentPreview, onAcquireCloudDocumentPreview,
  onReadCloudDocumentName, onBack, documents, setDocuments, templates: externalTemplates = [],
  onTemplatesChange, onShowAuthModal, entities, setEntities }, ref) {
  const fileInputRef = useRef();
  const projectFileInputRef = useRef();
  const localFileInputRef = useRef(null);
  const localRecoveryInputRef = useRef(null);
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
  const [localRecoveryNotice, setLocalRecoveryNotice] = useState('');
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
  const localListVisibleRef = useRef(false);
  const localListReadRef = useRef(null);
  const localListInvalidatedRef = useRef(true);
  if (localListVisibleRef.current !== recoveryVisible) {
    localListVisibleRef.current = recoveryVisible;
    localListGenerationRef.current++;
    localListInvalidatedRef.current = true;
  }
  const refreshLocalDocuments = useCallback(async () => {
    localListGenerationRef.current++;
    localListInvalidatedRef.current = true;
    if (!localMountedRef.current || !localListVisibleRef.current) return;
    if (localListReadRef.current) return localListReadRef.current;
    // Hidden events only invalidate. Visible bursts share one metadata scan;
    // events during that scan request one trailing read of the latest rows.
    const pending = Promise.resolve().then(async () => {
      while (localMountedRef.current && localListVisibleRef.current && localListInvalidatedRef.current) {
        localListInvalidatedRef.current = false;
        const generation = localListGenerationRef.current;
        const current = () => localMountedRef.current && localListVisibleRef.current
          && generation === localListGenerationRef.current;
        try {
          const rows = await listLocalDocuments();
          if (current()) { setLocalDocuments(rows); setLocalListError(''); }
        } catch (error) {
          if (current()) setLocalListError(`Could not read files on this device: ${error.message || 'Storage unavailable'}`);
        } finally {
          if (current()) setLocalDocumentsLoading(false);
        }
      }
    }).finally(() => {
      if (localListReadRef.current === pending) localListReadRef.current = null;
      if (localMountedRef.current && localListVisibleRef.current && localListInvalidatedRef.current) void refreshLocalDocuments();
    });
    localListReadRef.current = pending;
    return pending;
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
    if (recoveryVisible) void refreshLocalDocuments();
  }, [recoveryVisible, refreshLocalDocuments]);
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
    setLocalRecoveryNotice('');
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
    const name = `${recovered.file.name.replace(/\.pdf$/i, '').slice(0, 1008)} (recovered).pdf`;
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
  const exportLocalRecoveryCopy = ({ sessionId, sequence }) => runLocalRecoveryAction(async isCurrent => {
    const recovered = await readExistingLocalDocumentDraft(sessionId, { expectedSequence: sequence });
    if (!isCurrent()) return;
    const { createLocalRecoveryBundle } = await import('./services/localRecoveryBundle.js');
    const bundle = await createLocalRecoveryBundle(recovered);
    if (!isCurrent()) return;
    // A writer may have advanced while the immutable bundle was prepared.
    // Recheck the selected receipt without mutating or acknowledging its draft.
    await verifyExistingLocalDocumentDraftReceipt(recovered.metadata);
    if (!isCurrent()) return;
    const { saveLocalRecoveryBundle } = await import('./services/saveLocalRecoveryBundle.js');
    const result = await saveLocalRecoveryBundle(bundle, recovered.metadata.name, { isCurrent });
    if (!isCurrent() || result.canceled) return;
    setLocalRecoveryNotice(result.durabilityWarning
      ? 'The recovery file was written, but the system could not confirm the final disk flush. Keep this snapshot until you verify the exported file.'
      : result.saved ? 'Recovery file saved. The source snapshot was kept. Use Restore recovery file to verify it as a separate copy.'
      : 'Recovery download started. Confirm the file finished saving before relying on it. The source snapshot was kept.');
  });
  const restoreLocalRecoveryFile = event => {
    const selected = event.target.files?.[0]; event.target.value = '';
    if (!selected) return;
    void runLocalRecoveryAction(async isCurrent => {
      const { parseLocalRecoveryBundle } = await import('./services/localRecoveryBundle.js');
      const recovered = await parseLocalRecoveryBundle(selected);
      if (!isCurrent()) return;
      const name = `${recovered.file.name.replace(/\.pdf$/i, '').slice(0, 1009)} (restored).pdf`;
      const copy = new File([recovered.file], name, { type: 'application/pdf' });
      const manifest = await importLocalDocumentCopy(copy, recovered.state);
      if (!isCurrent()) return;
      localListGenerationRef.current++;
      setLocalDocuments(rows => [manifest, ...rows.filter(entry => entry.localId !== manifest.localId)]);
      setLocalDocumentsLoading(false);
      await openManagedLocalDocument(manifest.localId, isCurrent);
    });
  };
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

  const { uploadDocument: uploadToStorage, uploadDataFile, deleteDocumentFile: deleteFromStorage, downloadDocument: downloadFromStorage } = useStorage();

  // Subscription limits and usage tracking
  const {
    canCreateProject,
    canUploadDocument,
    canCreateTemplate,
    canCreateRegion,
    hasFeatureAccess,
    usage,
    limits,
    refetch: refetchUsage,
    tier: subscriptionTier
  } = useSubscriptionLimits();

  const [projectName, setProjectName] = useState('');
  const [projectFiles, setProjectFiles] = useState([]);
  const projectCreateScopeRef = useRef(null);
  if (projectCreateScopeRef.current?.actorId !== (user?.id || null)) {
    projectCreateScopeRef.current = { actorId: user?.id || null, active: true };
  }
  const projectCreateScope = projectCreateScopeRef.current;
  const projectCreateBusyRef = useRef(null);
  const projectModalScopeRef = useRef(null);
  useEffect(() => {
    projectCreateScope.active = true;
    projectCreateBusyRef.current = null;
    projectModalScopeRef.current = null;
    setIsProjectModalOpen(false);
    setProjectName('');
    setProjectFiles([]);
    setUploadInFlight(false);
    return () => { projectCreateScope.active = false; };
  }, [projectCreateScope]);
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
  } = useDocuments(selectedProjectId, { catalogEnabled });

  // Fetch all documents for file count display in project list
  const {
    documents: allDocuments,
    refetch: refetchAllDocuments
  } = useDocuments(null, { catalogEnabled });

  const isProjectCreateCurrent = () => projectCreateScope.active && projectCreateScopeRef.current === projectCreateScope;
  const projectUploadRecovery = useProjectUploadRecovery({
    actorId: user?.id || null, tier: subscriptionTier, client: supabase, active: isActive,
    onSaved: async () => {
      // Each await can outlive this account, including A -> B -> A changes.
      for (const refresh of [refetchProjects, refetchDocuments, refetchAllDocuments, refetchUsage]) {
        if (!isProjectCreateCurrent()) return;
        await refresh();
      }
    },
  });
  const discardProjectUpload = async (attempt) => {
    if (!isProjectCreateCurrent() || attempt.actorId !== projectCreateScope.actorId) return;
    const confirmed = await askConfirm({
      title: 'Discard these upload retry copies?',
      message: `Remove only the local retry copies for "${attempt.name}"? Cloud projects and files will not change. This may erase the only copy of PDFs that have not finished uploading.`,
      confirmLabel: 'Discard retry copies',
      danger: true,
    });
    if (!confirmed || !isProjectCreateCurrent()) return;
    try { await projectUploadRecovery.discard(attempt.id); }
    catch { /* The recovery panel reports the safe, scoped error. */ }
  };

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

  const singleUploadEntryRef = useRef(null);
  const [singleUploadWork, setSingleUploadWork] = useState(null);
  const singleUploadHandlerRef = useRef(null);
  const documentUploadRecovery = useDocumentUploadRecovery({
    actorId: user?.id || null, tier: subscriptionTier, client: supabase, active: isActive,
    chooseAlias: async (row, name) => {
      const answer = await askDuplicateUpload('alias', name, row.name);
      return answer === 'cancel' ? 'skip-alias' : answer;
    },
    onSaved: async () => {
      if (!documentUploadRecovery.isCurrent()) return;
      setDashboardError('');
      await Promise.all([refetchProjects, refetchDocuments, refetchAllDocuments, refetchUsage].map(refresh =>
        documentUploadRecovery.isCurrent() ? refresh() : undefined));
    },
  });
  useEffect(() => {
    // Retire an old account/view's prompt as well as its pending requests.
    duplicateModalRef.current?.resolve?.('cancel');
    duplicateModalRef.current = null;
    setDuplicateModal(null);
    return () => { duplicateModalRef.current?.resolve?.('cancel'); duplicateModalRef.current = null; };
  }, [documentUploadRecovery.isCurrent]);
  const discardDocumentUpload = async attempt => {
    const current = documentUploadRecovery.isCurrent;
    if (!current() || attempt.actorId !== user?.id) return;
    const confirmed = await askConfirm({ title: 'Discard this file upload retry copy?',
      message: `Remove only the local retry copy for "${attempt.name}"? Cloud files will not change. This may erase the only copy of a PDF that has not finished uploading.`,
      confirmLabel: 'Discard retry copy', danger: true });
    if (!confirmed || !current()) return;
    try {
      await documentUploadRecovery.discard(attempt.id);
      if (current()) setDashboardError('');
    } catch { /* Recovery panel keeps the scoped error. */ }
  };

  // Same name + different (or unknown) contents must PAUSE and ask before any
  // row is created (decision 6). Candidates come from a FRESH owner-scoped
  // query — the client-side lists can be stale, scoped to another project, or
  // include collaborator-owned rows this user must never archive.
  // Never throws. Returns:
  //   { proceed: true, archiveDocument? } — retain the exact consent snapshot;
  //     archive only after the new PDF and row are confirmed.
  //   { proceed: false }                — handled here (opened existing) or canceled
  const confirmSameNameDifferentContent = async ({ fileName, contentSha, projectId, openAfterUpload, cloud, isCurrent }) => {
    try {
      if (!isCurrent()) return { proceed: false };
      const candidates = await cloud.findDocumentsByName(projectId || null, fileName);
      if (!isCurrent()) return { proceed: false };

      const decision = resolveIncomingUpload(
        { name: fileName, sha: contentSha, projectId: projectId || null },
        candidates || []
      );
      if (decision.kind !== 'version-ask') return { proceed: true };
      const choice = await askDuplicateUpload('version', fileName, decision.doc.name, decision.knownDifferent);
      if (!isCurrent()) return { proceed: false };
      if (choice === 'open-existing') {
        if (openAfterUpload) await handleDocumentClick(decision.doc);
        return { proceed: false };
      }
      if (choice !== 'new-version') return { proceed: false }; // Escape/backdrop = cancel
      const selected = decision.doc;
      return { proceed: true, archiveDocument: Object.fromEntries([
        'id', 'user_id', 'project_id', 'name', 'file_path', 'file_size', 'content_sha256', 'updated_at', 'archived', 'user_archived_at',
      ].map(key => [key, selected[key] ?? null])) };
    } catch (err) {
      // Fail SAFE: cancel the upload rather than risk a silent duplicate or a
      // stuck file input further down the path.
      if (isCurrent()) {
        console.error('Duplicate check failed:', err);
        showToast('Couldn’t check for duplicates — upload canceled. Please try again.');
      }
      return { proceed: false };
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
    const formattedDocs = supabaseDocuments.map(doc => {
      const catalogName = typeof doc.name === 'string' ? doc.name : null;
      return ({
      ...doc,
      id: doc.id,
      name: catalogName ?? 'Untitled PDF',
      catalogName,
      nameTruncated: doc.name_truncated ?? null,
      size: doc.file_size ?? 0,
      uploadedAt: doc.created_at || doc.updated_at,
      type: 'application/pdf',
      filePath: doc.file_path,
      projectId: doc.project_id,
      cutoverCompletedAt: doc.cutover_completed_at || null
    }); });
    setDocuments(prev => {
      // Keep temporary documents that haven't been replaced by real ones yet
      const tempDocs = prev.filter(d =>
        d.id.startsWith('temp-') &&
        !formattedDocs.some(fd => fd.name === d.name
          && canonicalDocumentByteSize(fd.size) === canonicalDocumentByteSize(d.size))
      );
      return [...tempDocs, ...formattedDocs];
    });
  }, [supabaseDocuments]);

  useEffect(() => {
    try { localStorage.setItem('dashboardViewMode', viewMode); } catch { }
  }, [viewMode]);


  // The native menu keeps one listener but invokes the latest render's handler.
  useEffect(() => {
    if (!window.electronAPI?.onOpenPdfMenu) return undefined;
    const unsubscribe = window.electronAPI.onOpenPdfMenu(() => { void singleUploadHandlerRef.current?.(); });
    return () => { if (typeof unsubscribe === 'function') unsubscribe(); };
  }, []);

  const uploadProjectId = explicit => {
    if (typeof explicit === 'string' && !explicit.startsWith('local-')) return explicit;
    const selected = activeSection === 'projects' ? selectedProjectId : null;
    return typeof selected === 'string' && !selected.startsWith('local-') ? selected : null;
  };
  const beginSingleUpload = () => {
    const current = documentUploadRecovery.isCurrent;
    if (!current() || documentUploadRecovery.busy || singleUploadEntryRef.current?.current()) return null;
    const token = { current };
    singleUploadEntryRef.current = token; setSingleUploadWork(token);
    return token;
  };
  const finishSingleUpload = token => {
    if (singleUploadEntryRef.current === token) singleUploadEntryRef.current = null;
    if (token.current()) setSingleUploadWork(null);
  };
  const performSingleUpload = async ({ file, projectId, openAfterUpload, nativePath = null, token }) => {
    const current = token.current;
    try {
      const prepared = await preparePdfUpload(file, { readBlobAsArrayBuffer, computeContentSha256 });
      if (!current()) return;
      const cloud = await createDocumentUploadCloud({ client: supabase, actorId: user.id,
        tier: subscriptionTier, isCurrent: current });
      if (!current()) return;
      const duplicateGate = await confirmSameNameDifferentContent({ fileName: prepared.file.name,
        contentSha: prepared.contentSha, projectId, openAfterUpload, cloud, isCurrent: current });
      if (!current() || !duplicateGate.proceed) return;

      // This stages immutable bytes and intent before writes, then confirms the
      // object before publishing the row. Nothing opens an unbacked cloud ID.
      const result = await documentUploadRecovery.start({ file: prepared.file, prepared,
        projectId, archiveDocument: duplicateGate.archiveDocument || null });
      if (!current() || !openAfterUpload) return;
      const row = result.document;
      if (!row?.id) return;
      // The confirmed runner's current PDF avoids a second legacy download
      // while the default-off path is active. Checked discovery ignores it.
      try {
        await onOpenCloudDocument(row, {
          ...(result.file instanceof Blob ? { legacyFile: result.file } : {}),
          // A reused cloud PDF is not the picked native file anymore.
          ...(result.reused ? {} : { nativePath: nativePath || undefined }),
        });
      } catch (openError) {
        if (current()) {
          console.error('The confirmed upload could not be opened:', openError);
          showToast('The upload finished, but the document could not be opened. Try opening it again.', 'error');
        }
      }
      return;
    } catch (error) {
      if (current()) {
        console.error('File upload did not finish:', error);
        setDashboardError(error.attemptId && error.recoveryCreated !== false
          ? 'This upload needs attention. Its saved retry copy is listed in File upload recovery.'
          : 'Could not start this upload. Keep the original file and check device storage and your connection.');
      }
    }
  };

  const handleUploadClick = async (explicitProjectId, options = {}) => {
    if (!user) { setDashboardError('Please sign in to upload documents.'); onShowAuthModal(); return; }
    if (!documentUploadRecovery.isCurrent()) return;
    const projectId = uploadProjectId(explicitProjectId);
    const openAfterUpload = options.open !== false;
    if (!window.electronAPI?.openFile) {
      uploadTargetProjectRef.current = { projectId, open: openAfterUpload, current: documentUploadRecovery.isCurrent };
      fileInputRef.current?.click();
      return;
    }
    const token = beginSingleUpload();
    if (!token) return;
    try {
      const result = await window.electronAPI.openFile({ title: 'Open PDF document',
        filters: [{ name: 'PDF files', extensions: ['pdf'] }] });
      if (!token.current() || result.canceled) return;
      const file = new File([new Uint8Array(result.data)], result.fileName, { type: 'application/pdf' });
      await performSingleUpload({ file, projectId, openAfterUpload, nativePath: result.filePath, token });
    } catch (error) {
      if (token.current()) setDashboardError('Couldn’t open that file: ' + (error?.message || 'Unknown error'));
    } finally { finishSingleUpload(token); }
  };
  singleUploadHandlerRef.current = handleUploadClick;

  const handleFileUpload = async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    const pending = uploadTargetProjectRef.current;
    uploadTargetProjectRef.current = null;
    if (!file || file.type !== 'application/pdf') return;
    if (!user) { setDashboardError('Please sign in to upload documents.'); onShowAuthModal(); return; }
    if (pending?.current && !pending.current()) return;
    const token = beginSingleUpload();
    if (!token) return;
    try {
      await performSingleUpload({ file,
        projectId: pending ? pending.projectId : uploadProjectId(null),
        openAfterUpload: pending?.open !== false, token });
    } finally { finishSingleUpload(token); }
  };

  // Create Project flow
  const handleCreateProjectClick = () => {
    if (!isProjectCreateCurrent() || projectCreateBusyRef.current?.scope === projectCreateScope || projectUploadRecovery.busy) return;
    projectModalScopeRef.current = projectCreateScope;
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
    if (!isProjectCreateCurrent()) return;
    if (!user) throw Object.assign(new Error('User not authenticated'), { code: 'NOT_AUTHENTICATED' });
    const trimmedName = name.trim();
    const projectCheck = canCreateProject();
    if (!projectCheck.allowed) throw Object.assign(new Error(projectCheck.reason), { code: 'PROJECT_LIMIT_REACHED' });
    if (files.length) {
      const documentCheck = canUploadDocument(files.reduce((sum, file) => sum + file.size, 0));
      if (!documentCheck.allowed) throw Object.assign(new Error(documentCheck.reason), { code: 'UPLOAD_LIMIT_REACHED' });
    }
    // One fresh name check before the durable attempt is created.
    const latestProjects = await refetchProjects() || supabaseProjects || [];
    if (!isProjectCreateCurrent()) return;
    if (hasNameConflict(latestProjects, trimmedName, { getName: project => project?.name })) {
      throw Object.assign(new Error('A project with this name already exists. Please choose a different name.'),
        { code: 'DUPLICATE_PROJECT_NAME' });
    }
    return projectUploadRecovery.start(trimmedName, files);
  };

  const handleConfirmCreateProject = async () => {
    if (!isProjectCreateCurrent() || projectCreateBusyRef.current?.scope === projectCreateScope || projectUploadRecovery.busy) return;
    if (!projectName.trim()) {
      setDashboardError('Please enter a project name.');
      return;
    }
    // Set before the first await: Enter plus a click must not create two attempts.
    const token = { scope: projectCreateScope };
    projectCreateBusyRef.current = token;
    setUploadInFlight(true);
    try {
      await persistProject(projectName.trim(), projectFiles);
      if (!isProjectCreateCurrent()) return;
      setIsProjectModalOpen(false);
      setProjectName('');
      setProjectFiles([]);
      setDashboardError('');
    } catch (err) {
      if (!isProjectCreateCurrent()) return;
      if (err?.attemptId && err.recoveryCreated !== false) {
        // Continue the saved attempt, never resubmit it as a fresh project.
        setIsProjectModalOpen(false);
        setProjectName('');
        setProjectFiles([]);
        setDashboardError('This upload needs attention. Use Project upload recovery to retry the saved attempt. Cloud work may already be saved.');
      } else if (err?.code === 'NOT_AUTHENTICATED') {
        setDashboardError('Please sign in to create projects.');
        onShowAuthModal?.();
      } else if (['DUPLICATE_PROJECT_NAME', 'PROJECT_LIMIT_REACHED', 'UPLOAD_LIMIT_REACHED'].includes(err?.code)) {
        setDashboardError(err.message);
      } else {
        setDashboardError('Could not start this project. Check device storage and your connection, then try again.');
      }
    } finally {
      if (isProjectCreateCurrent() && projectCreateBusyRef.current === token) {
        projectCreateBusyRef.current = null;
        setUploadInFlight(false);
      }
    }
  };

  const handleCancelCreateProject = () => {
    if (!isProjectCreateCurrent() || projectCreateBusyRef.current?.scope === projectCreateScope) return;
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
      (doc.name || '').toLowerCase().includes(lq) ||
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
      if (doc?.id) {
        await onOpenCloudDocument(doc);
        return;
      }
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
     pre-KAL-44 local-template behavior for unsigned-in users; this does not
     claim to scan local PDFs or unsaved drafts. The TemplatesEditor
     awaits this promise inside its async delete handler. */
  const hubGetChecklistItemUsageCount = useCallback(async (itemId) => {
    if (!itemId || typeof itemId !== 'string') throw new TypeError('Checklist item id is required');
    if (!user) return 0;
    return await countSurveyMarkersReferencingChecklistItem(itemId);
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

  const hubPrepareDocumentRename = async (doc) => {
    if (!catalogEnabled) return doc;
    if (!doc?.id || !user) return null;
    const scope = documentOpenScope;
    try {
      if (typeof onReadCloudDocumentName !== 'function') throw new Error('Name reader unavailable.');
      const result = await onReadCloudDocumentName({ documentId: doc.id });
      if (documentOpenScopeRef.current !== scope || result?.actorUserId !== scope.actorUserId
        || result?.documentId !== doc.id || typeof result?.name !== 'string'
        || result.name.length === 0 || result.name.length > 65536) throw new Error('Invalid name result.');
      return { ...doc, name: result.name };
    } catch {
      if (documentOpenScopeRef.current === scope) {
        showToast('The full document name could not be read. Please try again.', 'error');
      }
      return null;
    }
  };

  const cloneDocumentToProject = async (doc, projectId = null, operation = null) => {
    const actualDoc = (allDocuments || []).find((candidate) => candidate.id === doc?.id) || doc;
    let blob;
    let sourceName;
    if (catalogEnabled) {
      if (typeof onAcquireCloudDocumentForAction !== 'function') {
        throw new Error('The current PDF could not be read for copying.');
      }
      const scope = documentOpenScope;
      const acquired = await onAcquireCloudDocumentForAction({ documentId: actualDoc?.id });
      if (documentOpenScopeRef.current !== scope || acquired?.actorUserId !== scope.actorUserId
        || acquired?.documentId !== actualDoc?.id || !(acquired?.blob instanceof Blob)
        || typeof acquired?.name !== 'string' || acquired.name.length === 0) {
        throw new Error('The current PDF could not be read for copying.');
      }
      blob = acquired.blob;
      sourceName = acquired.name;
    } else {
      const filePath = actualDoc?.file_path || actualDoc?.filePath;
      if (!filePath) throw new Error(`Document "${actualDoc?.name || 'Untitled'}" has no stored PDF.`);
      blob = await downloadFromStorage(filePath);
      sourceName = actualDoc.name || 'Untitled.pdf';
    }
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
    const scope = documentOpenScope;
    if (catalogEnabled) {
      let role;
      try {
        role = await runActorBoundDatabaseMutation({
          client: supabase,
          actorUserId: scope.actorUserId,
          isCurrent: () => documentOpenScopeRef.current === scope,
        }, async ({ request }) => {
          const response = await request(() => supabase.rpc('get_my_document_role', { doc_id: doc.id }), { write: false });
          if (response?.error || response?.data !== 'owner') return null;
          return response.data;
        });
      } catch {
        role = null;
      }
      if (documentOpenScopeRef.current !== scope) return;
      if (role !== 'owner') {
        showToast('Only the document owner can lock or unlock this document.', 'error');
        return;
      }
    } else if (doc.user_id && doc.user_id !== user.id) {
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
        result = catalogEnabled
          ? await runActorBoundDatabaseMutation({ client: supabase, actorUserId: scope.actorUserId,
              isCurrent: () => documentOpenScopeRef.current === scope }, ({ request }) => (
              request(() => supabase.rpc('kal49_unlock_document', { doc_id: doc.id }))
            ))
          : await unlockDocument(doc.id);
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
        result = catalogEnabled
          ? await runActorBoundDatabaseMutation({ client: supabase, actorUserId: scope.actorUserId,
              isCurrent: () => documentOpenScopeRef.current === scope }, ({ request }) => (
              request(() => supabase.rpc('kal49_lock_document', {
                doc_id: doc.id, label: raw.trim() ? raw.trim() : null,
              }))
            ))
          : await lockDocument(doc.id, raw.trim() ? raw.trim() : null);
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
      <input ref={localRecoveryInputRef} data-local-recovery-input type="file" accept=".survey-recovery"
        onChange={restoreLocalRecoveryFile} style={{ display: 'none' }} />
      <input
        ref={projectFileInputRef}
        type="file"
        accept="application/pdf"
        onChange={handleProjectFilesSelected}
        multiple
        style={{ display: 'none' }}
      />
      <SurveyHub
        projectUploadRecovery={<>
          <ProjectUploadRecoveryPanel recovery={projectUploadRecovery} onDiscard={discardProjectUpload} />
          <DocumentUploadRecoveryPanel recovery={documentUploadRecovery} onDiscard={discardDocumentUpload} />
        </>}
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
        onExportLocalRecoveryCopy={exportLocalRecoveryCopy}
        onImportLocalRecoveryBundle={() => { if (!localBusyRef.current) localRecoveryInputRef.current?.click(); }}
        localRecoveryNotice={localRecoveryNotice}
        localStorageStatusActive={recoveryVisible}
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
        onDescribeCloudDocumentPreview={catalogEnabled ? onDescribeCloudDocumentPreview : null}
        onAcquireCloudDocumentPreview={catalogEnabled ? onAcquireCloudDocumentPreview : null}
        onUpload={handleUploadClick}
        uploadBusy={!!singleUploadWork?.current() || documentUploadRecovery.busy || (uploadInFlight && projectCreateBusyRef.current?.scope === projectCreateScope) || projectUploadRecovery.busy}
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
        onPrepareDocumentRename={hubPrepareDocumentRename}
        onMoveCopyDocuments={hubMoveCopyDocuments}
        onProjectPreferencesChange={hubProjectPreferencesChange}
        onLockDocument={hubToggleDocumentLock}
        catalogActionsEnabled={catalogEnabled}
        onSettings={() => setShowAccountSettings(true)}
        onSignOut={signOut}
        onSignIn={onShowAuthModal}
      />
      <CreateProjectModal
        open={isProjectModalOpen && projectModalScopeRef.current === projectCreateScope}
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
