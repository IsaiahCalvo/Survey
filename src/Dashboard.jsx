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
import { classifyIncomingFile } from './utils/incomingFileResolver';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import SurveyHub from './home/SurveyHub';
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
import { perfUpload } from './utils/performanceLogger';
import { showToast } from './utils/toast';
import { readBlobAsArrayBuffer } from './utils/blobArrayBuffer.js';

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


const Dashboard = forwardRef(function Dashboard({ onDocumentSelect, onBack, documents, setDocuments, templates: externalTemplates = [], onTemplatesChange, onShowAuthModal, entities, setEntities }, ref) {
  const fileInputRef = useRef();
  const projectFileInputRef = useRef();
  // Destination project for the next browser-input upload. The browser file
  // picker fires `handleFileUpload` separately, so the project id chosen in
  // the Projects tab is stashed here for that handler to read.
  const uploadTargetProjectRef = useRef(null);
  // Track documents being cleaned up to prevent duplicate cleanup attempts
  const cleaningUpDocumentsRef = useRef(new Set());
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
  // Auth state and user dropdown menu
  const { user, isAuthenticated, signOut, signInWithGoogle, features } = useAuth();
  const { isAuthenticated: isMSAuthenticated, login: msLogin, logout: msLogout, account: msAccount, needsReconnect: msNeedsReconnect } = useMSGraph();
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [showAccountSettings, setShowAccountSettings] = useState(false);
  const userDropdownRef = useRef(null);

  // Supabase hooks for data persistence
  const {
    projects: supabaseProjects,
    loading: projectsLoading,
    createProject: createSupabaseProject,
    updateProject: updateSupabaseProject,
    deleteProject: deleteSupabaseProject,
    refetch: refetchProjects
  } = useProjects();

  const {
    templates: supabaseTemplates,
    loading: templatesLoading,
    createTemplate: createSupabaseTemplate,
    updateTemplate: updateSupabaseTemplate,
    deleteTemplate: deleteSupabaseTemplate,
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
    refetch: refetchUsage
  } = useSubscriptionLimits();

  // Close user dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (userDropdownRef.current && !userDropdownRef.current.contains(event.target)) {
        setShowUserDropdown(false);
      }
    };

    if (showUserDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showUserDropdown]);

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
    loading: documentsLoading,
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

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (viewDropdownRef.current && !viewDropdownRef.current.contains(event.target)) {
        setIsViewDropdownOpen(false);
      }
    };

    if (isViewDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isViewDropdownOpen]);


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

        // Recognize a file we already have (same name + exact byte size) and
        // reopen THAT copy instead of uploading a blank duplicate. This is the
        // root-cause fix for the blank-pages bug, where every open created a new
        // empty cloud document.
        const incomingDecision = classifyIncomingFile(file, supabaseDocuments);
        if (incomingDecision.kind === 'reuse') {
          const existing = incomingDecision.doc;
          file.id = existing.id;
          file.projectId = existing.project_id ?? existing.projectId ?? null;
          file.supabaseFilePath = existing.file_path ?? existing.filePath ?? null;
          file.user_id = existing.user_id ?? existing.userId ?? file.user_id ?? null;
          if (openAfterUpload) onDocumentSelect(file, filePath);
          return;
        }

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
          try {
            perfUpload.mark(file.name, 'Starting cloud upload');
            const uploadPromise = uploadToStorage(file, projectId || 'general', undefined, contentSha);
            const pageCountPromise = (async () => {
              const arrayBuffer = await readBlobAsArrayBuffer(file);
              perfUpload.mark(file.name, 'ArrayBuffer ready for page count');
              const pdfjsLib = await loadPdfjs();
              let pdfDoc;
              try {
                pdfDoc = await pdfjsLib.getDocument({ isEvalSupported: false,
                  data: arrayBuffer.slice(0),
                  verbosity: pdfjsLib.VerbosityLevel.ERRORS
                }).promise;
              } catch (firstError) {
                console.warn('Standard PDF load failed during upload, trying recovery mode:', firstError.message);
                pdfDoc = await pdfjsLib.getDocument({ isEvalSupported: false,
                  data: arrayBuffer.slice(0),
                  verbosity: pdfjsLib.VerbosityLevel.ERRORS,
                  stopAtErrors: false,
                  disableAutoFetch: true,
                  disableStream: true
                }).promise;
              }
              return pdfDoc.numPages;
            })();

            const [, pageCount] = await Promise.all([uploadPromise, pageCountPromise]);
            perfUpload.mark(file.name, 'Cloud upload + page count complete');

            if (pageCount && pageCount !== resolvedDoc.page_count) {
              try { await updateSupabaseDocument(resolvedDoc.id, { page_count: pageCount }); } catch { /* non-fatal */ }
            }
            refetchAllDocuments();
            perfUpload.end(file.name);
          } catch (err) {
            perfUpload.end(file.name);
            console.error('Error uploading file in background:', err);
            setDashboardError('Couldn’t save the document to the cloud: ' + (err.message || 'Unknown error') + '. Your file is still on disk — try uploading again or check your connection.');
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

      // Recognize a file we already have (same name + exact byte size) and
      // reopen THAT copy instead of uploading a blank duplicate (root-cause fix
      // for the blank-pages bug — every open used to create a new empty doc).
      const incomingDecision = classifyIncomingFile(file, supabaseDocuments);
      if (incomingDecision.kind === 'reuse') {
        const existing = incomingDecision.doc;
        file.id = existing.id;
        file.projectId = existing.project_id ?? existing.projectId ?? null;
        file.supabaseFilePath = existing.file_path ?? existing.filePath ?? null;
        file.user_id = existing.user_id ?? existing.userId ?? file.user_id ?? null;
        if (openAfterUpload) onDocumentSelect(file);
        event.target.value = '';
        return;
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
        try {
          const uploadPromise = uploadToStorage(file, projectId || 'general', undefined, contentSha);
          const pageCountPromise = (async () => {
            try {
              const arrayBuffer = await readBlobAsArrayBuffer(file);
              const pdfjsLib = await loadPdfjs();
              let pdfDoc;
              try {
                pdfDoc = await pdfjsLib.getDocument({ isEvalSupported: false,
                  data: arrayBuffer.slice(0),
                  verbosity: pdfjsLib.VerbosityLevel.ERRORS
                }).promise;
              } catch (firstError) {
                console.warn('Standard PDF load failed, trying recovery mode:', firstError.message);
                pdfDoc = await pdfjsLib.getDocument({ isEvalSupported: false,
                  data: arrayBuffer.slice(0),
                  verbosity: pdfjsLib.VerbosityLevel.ERRORS,
                  stopAtErrors: false,
                  disableAutoFetch: true,
                  disableStream: true
                }).promise;
              }
              return pdfDoc.numPages;
            } catch (err) {
              console.error('Error getting page count:', err);
              return null;
            }
          })();

          await uploadPromise;
          pageCountPromise.then(async (pageCount) => {
            if (pageCount !== null && pageCount !== resolvedDoc.page_count) {
              try { await updateSupabaseDocument(resolvedDoc.id, { page_count: pageCount }); } catch (err) { console.error('Error updating page count:', err); }
            }
          }).catch(() => {});

          refetchAllDocuments();
        } catch (err) {
          console.error('Error uploading file in background:', err);
          setDashboardError('Couldn’t save the document to the cloud: ' + (err.message || 'Unknown error') + '. Your file is still on disk — try uploading again or check your connection.');
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

    // Process files in parallel for better performance
    const filePromises = files.map(async (file) => {
      try {
        // Start upload and page count in parallel
        const uploadPromise = uploadToStorage(file, newProject.id);
        const pageCountPromise = (async () => {
          try {
            const arrayBuffer = await readBlobAsArrayBuffer(file);
            const pdfjsLib = await loadPdfjs();
            let pdfDoc;
            try {
              // Clone buffer since PDF.js may detach it when transferring to worker
              pdfDoc = await pdfjsLib.getDocument({ isEvalSupported: false,
                data: arrayBuffer.slice(0),
                verbosity: pdfjsLib.VerbosityLevel.ERRORS
              }).promise;
            } catch (firstError) {
              console.warn(`Standard PDF load failed for ${file.name}, trying recovery mode:`, firstError.message);
              // Try recovery mode with fresh buffer clone
              pdfDoc = await pdfjsLib.getDocument({ isEvalSupported: false,
                data: arrayBuffer.slice(0),
                verbosity: pdfjsLib.VerbosityLevel.ERRORS,
                stopAtErrors: false,
                disableAutoFetch: true,
                disableStream: true
              }).promise;
            }
            return pdfDoc.numPages;
          } catch (err) {
            console.error(`Error getting page count for ${file.name}:`, err);
            return null;
          }
        })();

        // Wait for upload to complete first
        const filePath = await uploadPromise;

        // Create document record immediately after upload
        // Use null for page_count initially, will update in background
        const doc = await createSupabaseDocument({
          name: file.name,
          file_path: filePath,
          file_size: file.size,
          page_count: null,
          project_id: newProject.id
        });

        // Update page count in background (non-blocking)
        pageCountPromise.then(async (pageCount) => {
          if (pageCount !== null) {
            try {
              await updateSupabaseDocument(doc.id, { page_count: pageCount });
            } catch (err) {
              console.error(`Error updating page count for ${file.name}:`, err);
            }
          }
        }).catch(err => {
          console.error(`Error getting page count for ${file.name}:`, err);
        });

        return { success: true, file: file.name };
      } catch (err) {
        console.error(`Error uploading file ${file.name}:`, err);
        return {
          success: false,
          file: file.name,
          error: err.message || err.toString()
        };
      }
    });

    // Wait for all files to process
    const results = await Promise.all(filePromises);

    // Count successes and collect errors
    results.forEach(result => {
      if (result.success) {
        successCount++;
      } else {
        uploadErrors.push({ fileName: result.file, error: result.error });
      }
    });

    // If no files were successfully uploaded, throw an error
    if (successCount === 0) {
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
    if (projectFiles.length === 0) {
      setDashboardError('Add at least one PDF to the project before creating it.');
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

    // BL-23: count per-row failures and throw after the refetch so callers can
    // tell a save actually failed (the editor keeps its dirty state and the
    // user's edits survive). Whatever DID persist still syncs via the refetch.
    let rowFailures = 0;
    try {
      // BL-23: diff against the freshest PERSISTED rows (supabaseRowsRef is
      // render-synced AND advanced synchronously by the previous save's
      // refetch below), not this closure's render-time `templates` — a save
      // queued behind another save would otherwise diff against a stale
      // baseline and re-create rows the earlier save already persisted
      // (duplicates) or miss deletes. Mapping mirrors the templates useMemo:
      // template id lives in config.id (the row id is the Supabase id).
      const baselineTemplates = (supabaseRowsRef.current || []).map((row) => ({
        id: (row?.config && typeof row.config === 'object' && row.config.id) || row.id,
        supabaseId: row.id,
      }));
      const currentTemplateIds = new Set(baselineTemplates.map(t => t.id));
      const newTemplateIds = new Set(templatesToSave.map(t => t.id));

      // Delete templates that were removed
      for (const template of baselineTemplates) {
        if (!newTemplateIds.has(template.id)) {
          const supabaseId = resolveSupabaseTemplateId(template);
          if (!supabaseId) continue;
          try {
            await deleteSupabaseTemplate(supabaseId);
          } catch (err) {
            console.error('Error deleting template:', err);
            rowFailures += 1;
          }
        }
      }

      // Update or create templates
      for (const template of templatesToSave) {
        const configPayload = sanitizeTemplateConfig(template);
        if (currentTemplateIds.has(template.id)) {
          // Update existing template
          const supabaseId = resolveSupabaseTemplateId(template);
          if (!supabaseId) {
            console.warn('Unable to resolve Supabase template id for update, creating new template instead.');
            try {
              await createSupabaseTemplate({
                name: template.name,
                config: configPayload
              });
            } catch (err) {
              console.error('Error creating template:', err);
              rowFailures += 1;
            }
            continue;
          }
          try {
            await updateSupabaseTemplate(supabaseId, {
              name: template.name,
              config: configPayload // Store entire template structure in config JSONB
            });
          } catch (err) {
            console.error('Error updating template:', err);
            rowFailures += 1;
          }
        } else {
          // Create new template
          try {
            await createSupabaseTemplate({
              name: template.name,
              config: configPayload // Store entire template structure in config JSONB
            });
          } catch (err) {
            console.error('Error creating template:', err);
            rowFailures += 1;
          }
        }
      }

      // Refetch to sync state — and advance the baseline ref synchronously so
      // a save queued right behind this one diffs against what we just
      // persisted, without waiting for React to re-render. Guard: a refetch
      // failure returns [] (loadTemplates swallows its error); never poison
      // the baseline with an empty set while rows were just saved.
      const freshRows = await refetchTemplates();
      if (Array.isArray(freshRows) && (freshRows.length > 0 || templatesToSave.length === 0)) {
        supabaseRowsRef.current = freshRows;
      }
    } catch (err) {
      // BL-23: rethrow — swallowing refetch/unexpected errors here left callers
      // believing failed saves succeeded (the editor then dropped its edits).
      console.error('Error persisting templates:', err);
      throw err;
    }
    if (rowFailures > 0) {
      throw new Error(`${rowFailures} template${rowFailures === 1 ? '' : 's'} failed to save`);
    }
  };

  const deleteDocumentEverywhere = async ({ docId, filePath = null, source = 'unknown' }) => {
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
    if (storagePath) {
      try { await deleteFromStorage(storagePath); }
      catch (storageErr) { console.warn('[DocumentDelete] storage remove failed', storageErr?.message); }
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
      doc.name.toLowerCase().includes(lq)
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

  // Handler for when a file is not found in storage.
  const handleFileNotFound = useCallback(async (docId) => {
    if (!docId) return;

    // Prevent duplicate cleanup attempts
    if (cleaningUpDocumentsRef.current.has(docId)) return;
    cleaningUpDocumentsRef.current.add(docId);

    // Remove from UI immediately
    setDocuments(prev => prev.filter(d => d.id !== docId));

    // Hard-delete the stale row so its annotation log, snapshot, and cascade
    // children go with it — a missing PDF means the document is unusable, and a
    // soft-archive would orphan all that data forever. Treat already-missing
    // rows as success.
    try {
      await deleteDocumentEverywhere({ docId, source: 'file-not-found-cleanup' });
    } catch (error) {
      if (!isSupabaseRowNotFoundError(error)) {
        console.error('[DocumentCleanup] Failed to delete stale document row:', error);
      }
    } finally {
      cleaningUpDocumentsRef.current.delete(docId);
    }
  }, [deleteDocumentEverywhere]);

  const handleDocumentClick = async (doc) => {
    try {
      // [OpenTiming] BUG#2 — first open milestone: user clicked a document.
      try { console.log('[OpenTiming] doc-click @ ' + Math.round(performance.now()) + 'ms', doc?.name || doc?.file?.name || doc?.id || ''); } catch (_e) { /* swallow */ }
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
        // Download from Supabase storage
        // Note: onDocumentSelect will handle tab switching if file is already open
        // We need to reconstruct the File object to match what onDocumentSelect expects

        // First check if this document is already open in a tab to avoid re-downloading
        // We can't easily check tabs here without the file object, but onDocumentSelect does it.
        // So we'll proceed with download. Optimization: Check tabs by name/size if possible?
        // For now, let's download. The browser cache might help.

        const blob = await downloadFromStorage(filePath);
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
        const blob = await response.blob();
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
      console.error('Error opening document:', error);

      // Check if file no longer exists in storage
      if (isStorageFileNotFoundError(error)) {
        // Silently clean up the stale document - no error shown to user
        await handleFileNotFound(doc.id);
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
      if (window.__kal49Harness) {
        delete window.__kal49Harness;
      }
    };
  }, [handleDocumentClick]);

  const handleDeleteDocument = async (docId, event) => {
    event.stopPropagation();

    console.log('[DocumentDelete] single:click', JSON.stringify({ docId }));

    if (!confirm('Are you sure you want to delete this document? This action cannot be undone.')) {
      console.log('[DocumentDelete] single:cancelled', JSON.stringify({ docId }));
      return;
    }

    try {
      console.log('[DocumentDelete] single:confirmed', JSON.stringify({ docId }));
      // Optimistic update
      setDocuments(prev => prev.filter(doc => doc.id !== docId));

      // Find the document to get the file path
      const doc = documents.find(d => d.id === docId);
      const filePath = doc?.file_path || doc?.filePath;

      await deleteDocumentEverywhere({ docId, filePath, source: 'single-document-button' });
      await refetchDocuments();
    } catch (error) {
      console.error('[DocumentDelete] single:error', serializeError(error));
      showToast('Failed to delete document: ' + error.message, 'error');
      // Revert optimistic update if needed, but refetching should handle it
      await refetchDocuments();
    }
  };

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
  const hubSaveTemplates = async (nextTemplates) => {
    if (!Array.isArray(nextTemplates)) return;
    try {
      if (user) {
        updateTemplates(nextTemplates);
        await persistTemplates(nextTemplates);
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

  // Delete the given documents everywhere: hard-deletes each row (cascading its
  // annotation log, snapshot, and child rows), removes the stored PDF, and purges
  // the local durable copy.
  const hubDeleteDocuments = async (docs) => {
    const list = Array.isArray(docs) ? docs.filter(Boolean) : [];
    if (list.length === 0) return;
    if (!user) { showToast('Please sign in to delete documents', 'warn'); return; }
    if (!confirm(`Delete ${list.length === 1 ? 'this document' : `these ${list.length} documents`}? This action cannot be undone.`)) return;
    const ids = list.map(d => d.id);
    setDocuments(prev => prev.filter(d => !ids.includes(d.id)));
    try {
      for (const doc of list) {
        if (typeof doc.id === 'string' && doc.id.startsWith('temp-')) continue;
        const match = (supabaseDocuments || []).find(d => d.id === doc.id);
        const filePath = match?.file_path || match?.filePath || doc.file_path || doc.filePath;
        await deleteDocumentEverywhere({ docId: doc.id, filePath, source: 'survey-hub-bulk' });
      }
      await refetchDocuments();
    } catch (err) {
      console.error('[DocumentDelete] survey-hub:error', serializeError(err));
      showToast('Failed to delete documents: ' + (err.message || 'Unknown error'), 'error');
      await refetchDocuments();
    }
  };

  const hubDeleteProjects = async (items) => {
    const list = Array.isArray(items) ? items.filter(Boolean) : [];
    if (list.length === 0) return false;
    if (!user) { showToast('Please sign in to delete projects', 'warn'); return false; }
    if (!confirm(`Delete ${list.length === 1 ? 'this project and its documents' : `these ${list.length} projects and their documents`}? This action cannot be undone.`)) return false;

    const ids = list.map((project) => project.id).filter(Boolean);
    setDocuments((prev) => prev.filter((doc) => !ids.includes(doc.project_id || doc.projectId)));
    try {
      for (const projectId of ids) {
        await deleteSupabaseProject(projectId);
      }
      await refetchProjects();
      await refetchDocuments();
      await refetchAllDocuments();
      return true;
    } catch (err) {
      console.error('[ProjectDelete] survey-hub:error', serializeError(err));
      showToast('Failed to delete projects: ' + (err.message || 'Unknown error'), 'error');
      await refetchProjects();
      await refetchDocuments();
      return false;
    }
  };

  // Duplicate the given documents — optimistic local copies, same shape as
  // the removed legacy bulk-copy documents flow.
  const hubDuplicateDocuments = (docs) => {
    const list = Array.isArray(docs) ? docs.filter(Boolean) : [];
    if (list.length === 0) return;
    const copies = list.map(d => ({ ...d, id: crypto.randomUUID(), name: `${d.name} (Copy)` }));
    setDocuments(prev => [...copies, ...prev]);
  };

  // Move or copy the given documents to an existing project. Move re-parents
  // the real Supabase rows (project_id), matching the removed legacy
  // move-to-existing-project behavior. Copy has no
  // clean single-call Supabase primitive, so it stays an optimistic local
  // copy (consistent with the removed legacy bulk-copy flow).
  const hubMoveCopyDocuments = async (docs, projectId, mode = 'move') => {
    const list = Array.isArray(docs) ? docs.filter(Boolean) : [];
    if (list.length === 0 || !projectId) return;
    if (!user) { showToast('Please sign in to move documents', 'warn'); return; }
    const targetProj = projects.find(p => p.id === projectId);
    if (!targetProj) return;

    if (mode === 'copy') {
      // TODO: no server-side document-copy primitive exists; this is an
      // optimistic local-only copy, matching the removed legacy bulk-copy
      // behavior. Wire a real copy primitive if/when one is added.
      const copies = list.map(d => ({
        ...d,
        id: crypto.randomUUID(),
        name: `${d.name} (Copy)`,
        projectId,
        project_id: projectId,
      }));
      setDocuments(prev => [...copies, ...prev]);
      return;
    }

    try {
      const ids = list.map(d => d.id);
      setDocuments(prev => prev.filter(d => !ids.includes(d.id)));
      for (const doc of list) {
        const actualDoc = (supabaseDocuments || []).find(d => d.id === doc.id || d.name === doc.name);
        if (actualDoc) {
          await updateSupabaseDocument(actualDoc.id, { project_id: projectId });
        }
      }
      await refetchProjects();
      await refetchDocuments();
    } catch (err) {
      console.error('[DocumentMoveCopy] survey-hub:error', serializeError(err));
      showToast('Failed to move documents: ' + (err.message || 'Unknown error'), 'error');
      await refetchDocuments();
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
        const ok = confirm('Unlock for editing? This re-enables changes from everyone with edit access.');
        if (!ok) return;
        result = await unlockDocument(doc.id);
      } else {
        const raw = prompt(
          'Lock this document? It becomes read-only for everyone.\n\nOptional label (e.g. "Final v1"):',
          '',
        );
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
  return (
    <>
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
        documents={documents}
        projects={projects}
        templates={templates}
        members={[]}
        user={user ? { id: user.id, name: user.user_metadata?.full_name || user.name || user.email, email: user.email } : null}
        isPro={!!features?.advancedSurvey}
        onOpenDocument={hubOpenDocument}
        onUpload={handleUploadClick}
        onCreateProject={handleCreateProjectClick}
        onCreateTemplate={openTemplateModal}
        onDeleteProjects={hubDeleteProjects}
        onSaveTemplates={hubSaveTemplates}
        getChecklistItemUsageCount={hubGetChecklistItemUsageCount}
        onDuplicateDocuments={hubDuplicateDocuments}
        onDeleteDocuments={hubDeleteDocuments}
        onMoveCopyDocuments={hubMoveCopyDocuments}
        onLockDocument={hubToggleDocumentLock}
        onSettings={() => setShowAccountSettings(true)}
        onSignOut={signOut}
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
          >×</button>
        </div>
      )}
    </>
  );
});

export default Dashboard;
