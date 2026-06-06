// Dashboard — the application home screen (project tree, document grid,
// template management, SurveyHub). Extracted from src/viewerShared.js so it can be
// developed independently of the PDF viewer monolith. Communicates with the
// app shell purely through props + a forwarded ref (openTemplateModal, etc.).
//
// pdfjs worker is configured once at App.jsx module load; pdfjsLib is a shared
// singleton in the Vite module graph, so no re-init is needed here.

import { loadPdfjs } from './utils/pdfWorkerConfig';
import { classifyIncomingFile } from './utils/incomingFileResolver';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
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
import { reorderCategoriesByActiveOver, reorderItemsByActiveOver } from './home/templateReorderUtils';
import { getPDFId } from './viewerShared';
import { migrateLocalAnnotationsToCloud, resetMigrationFlag } from './services/cloudSyncMigration';

// Root-cause fix (2026-06-05): a freshly uploaded PDF opens optimistically with
// NO cloud id, so its embedded annotations import + render + mirror to
// localStorage, but the in-viewer cloud-sync hook stays inactive (documentId is
// null) because the new document id is never stamped back onto the open File.
// Result: the embedded marks live only in localStorage for the whole upload
// session and never reach the cloud — so they vanish on any device that wasn't
// the uploader (the "embedded marks vanish on re-upload/reload" bug). Here we
// push the localStorage snapshot straight to the cloud via the existing one-time
// migration the moment the document row exists, making persistence
// device-independent. We poll briefly for the viewer's import to land in
// localStorage first (the import runs in parallel with the upload). If it never
// appears we DON'T run the migration, leaving the reopen-time migration as the
// existing backstop (so we never set the migrated flag with nothing pushed).
async function persistImportedMarksToCloudForUpload({ file, documentId, userId }) {
  if (!file || !documentId || !userId) return;
  const pdfId = getPDFId(file);
  if (!pdfId) return;
  const key = `annotationsByPage_${pdfId}`;
  const hasMarks = () => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object'
        && Object.values(parsed).some(
          (p) => Array.isArray(p?.objects) && p.objects.length > 0
        );
    } catch { return false; }
  };
  // Wait up to ~6s for the viewer's embedded import to mirror into localStorage.
  const deadline = Date.now() + 6000;
  while (!hasMarks() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!hasMarks()) return; // nothing imported (or race lost) — reopen backstop covers it
  try {
    const result = await migrateLocalAnnotationsToCloud({ documentId, userId, pdfId });
    // The migration is a one-time-per-doc operation that sets a "migrated" flag.
    // We only used it here to push the EMBEDDED marks at upload time. Reset the
    // flag so the reopen-time migration still runs and catches any marks the user
    // draws later in this same session (the in-viewer cloud-sync hook stays
    // inactive while the open File has no id). The migration is idempotent — it
    // dedups against existing cloud rows — so re-running it only pushes new marks.
    if (result && !result.error) {
      resetMigrationFlag(userId, documentId);
    }
    console.log('[UploadPersist] embedded-mark cloud push ' + JSON.stringify({
      documentId,
      pdfId,
      pushed: result?.pushed ?? 0,
      migrated: result?.migrated ?? false,
      error: result?.error?.message || null,
    }));
  } catch (err) {
    console.warn('[UploadPersist] embedded-mark cloud push failed', err);
  }
}

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

const generateUniqueId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const createCopyName = (name, usedNames) => {
  const trimmedName = (name || 'Untitled').trim();
  const baseName = trimmedName.replace(/\s+\(Copy(?:\s+\d+)?\)$/i, '');
  let attempt = `${baseName} (Copy)`;
  let counter = 2;
  while (usedNames.has(attempt.toLowerCase())) {
    attempt = `${baseName} (Copy ${counter})`;
    counter += 1;
  }
  usedNames.add(attempt.toLowerCase());
  return attempt;
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
  if (typeof window !== 'undefined' && import.meta.env?.DEV) {
    window.__kal23_setDashboardError = setDashboardError;
  }
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [isMoveModalOpen, setIsMoveModalOpen] = useState(false);
  const [isMoveCopyDropdownOpen, setIsMoveCopyDropdownOpen] = useState(false);
  const moveCopyDropdownRef = useRef(null);
  const [templateName, setTemplateName] = useState('');
  const [templateVisibility, setTemplateVisibility] = useState('personal'); // 'personal' | 'shared'
  const [modules, setModules] = useState([]); // { id, name, categories: [ { id, name, checklist: [ { id, text } ] } ] }
  const [selectedModuleId, setSelectedModuleId] = useState(null); // Module selected from dropdown
  const [selectedTemplateCategoryId, setSelectedTemplateCategoryId] = useState(null); // Category selected in template modal
  const [addingModule, setAddingModule] = useState(false); // Show input when adding module
  const [newModuleName, setNewModuleName] = useState(''); // Temporary module name input
  const [addingCategory, setAddingCategory] = useState(false); // Show input when adding category
  const [newCategoryName, setNewCategoryName] = useState(''); // Temporary category name input
  const [editingModules, setEditingModules] = useState(false); // Edit mode for modules
  const [editingCategories, setEditingCategories] = useState(false); // Edit mode for categories
  const [editingModuleName, setEditingModuleName] = useState({}); // { moduleId: name } for editing module names
  const [editingCategoryName, setEditingCategoryName] = useState(() => ({})); // { categoryId: name } for editing category names
  const [selectedModuleIds, setSelectedModuleIds] = useState([]); // Selected modules for move/copy
  const [selectedCategoryIds, setSelectedCategoryIds] = useState(() => []); // Selected categories for move/copy
  const [selectedChecklistItemIds, setSelectedChecklistItemIds] = useState(() => []); // Selected checklist items for move/copy
  const initialTemplateStateRef = useRef(null);
  const [isMoveCopyModalOpen, setIsMoveCopyModalOpen] = useState(false);
  const [moveCopyType, setMoveCopyType] = useState(null); // 'module' | 'category' | 'checklistItem'
  const [moveCopyMode, setMoveCopyMode] = useState('copy'); // 'move' | 'copy'
  // Entities: { id, name, color }
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

  const { uploadDocument: uploadToStorage, uploadDataFile, deleteDocumentFile: deleteFromStorage, downloadDocument: downloadFromStorage, getDocumentUrl } = useStorage();

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

  const [selectedColorPickerId, setSelectedColorPickerId] = useState(null); // Track which color picker is selected
  const [colorPickerMode, setColorPickerMode] = useState('grid'); // 'grid' or 'advanced'
  const [tempColor, setTempColor] = useState(null); // Temporary color while picking
  const [opacityInputValue, setOpacityInputValue] = useState(null); // Temporary opacity input value (null = show current, '' = empty during typing, string = value)
  const [opacityInputFocused, setOpacityInputFocused] = useState(false); // Track if opacity input is focused
  const entitySensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6
      }
    })
  );

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

  const [activeEntityId, setActiveEntityId] = useState(null);
  const handleEntityDragStart = useCallback(({ active }) => {
    setActiveEntityId(active.id);
  }, []);
  const handleEntityDragEnd = useCallback(({ active, over }) => {
    setActiveEntityId(null);
    if (!over || active.id === over.id) {
      return;
    }
    setEntities((prevEntities) => reorderItemsByActiveOver(prevEntities, active.id, over.id));
  }, []);
  const handleEntityDragCancel = useCallback(() => {
    setActiveEntityId(null);
  }, []);
  const isAnyEntityDragging = Boolean(activeEntityId);
  useEffect(() => {
    if (isAnyEntityDragging) {
      document.body.classList.add('entity-dragging');
    } else {
      document.body.classList.remove('entity-dragging');
    }
    return () => {
      document.body.classList.remove('entity-dragging');
    };
  }, [isAnyEntityDragging]);
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
    const supabaseMatch = (supabaseTemplates || []).find(t =>
      t.id === templateId || (t.config && t.config.id === templateId)
    );
    return supabaseMatch?.id || null;
  }, [templates, supabaseTemplates]);

  const sanitizeTemplateConfig = (template) => {
    if (!template || typeof template !== 'object') return template;
    const { supabaseId, ...rest } = template;
    return rest;
  };

  const updateTemplates = useCallback((updater) => {
    const currentTemplates = templates;
    const nextValue = typeof updater === 'function' ? updater(currentTemplates) : updater;
    const next = Array.isArray(nextValue) ? nextValue : [];
    // Use setTimeout to avoid setState during render
    setTimeout(() => onTemplatesChange?.(next), 0);
  }, [onTemplatesChange, templates]);

  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState(null);
  const [editingTemplateId, setEditingTemplateId] = useState(null); // Track which template is being edited

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

  // Bulk selection state
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]); // array of item ids currently selected

  // View mode dropdown state
  const [isViewDropdownOpen, setIsViewDropdownOpen] = useState(false);
  const viewDropdownRef = useRef(null);
  const selectionModeActionsRef = useRef(null);

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

  // Close Move/Copy dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (moveCopyDropdownRef.current && !moveCopyDropdownRef.current.contains(event.target)) {
        setIsMoveCopyDropdownOpen(false);
      }
    };

    if (isMoveCopyDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isMoveCopyDropdownOpen]);

  // Color picker closing is handled by the overlay onClick, no need for separate handler

  // Reset selected category when selected space changes
  useEffect(() => {
    setSelectedTemplateCategoryId(null);
  }, [selectedModuleId]);

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
          title: 'Open PDF Document',
          filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
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
              const arrayBuffer = await file.arrayBuffer();
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
        const bytes = new Uint8Array(await file.arrayBuffer());
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
              const arrayBuffer = await file.arrayBuffer();
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
            const arrayBuffer = await file.arrayBuffer();
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

  // Helpers for selection/bulk actions
  const getCurrentContextKey = () => {
    if (activeSection === 'projects') {
      return selectedProjectId ? 'projectFiles' : 'projects';
    }
    if (activeSection === 'templates') {
      return selectedTemplateId ? 'templateFiles' : 'templates';
    }
    return 'documents';
  };

  const getCurrentItems = () => {
    const ctx = getCurrentContextKey();
    if (ctx === 'documents') return sortedDocuments;
    if (ctx === 'projects') return sortedProjects;
    if (ctx === 'projectFiles') {
      // Use supabaseDocuments when a project is selected
      if (selectedProjectId && supabaseDocuments) {
        return supabaseDocuments.map(doc => ({
          id: doc.id,
          name: doc.name,
          size: doc.file_size || 0,
          uploadedAt: doc.created_at || doc.updated_at,
          type: 'application/pdf',
          filePath: doc.file_path,
          projectId: doc.project_id
        }));
      }
      return [];
    }
    if (ctx === 'templates') return sortedTemplates;
    if (ctx === 'templateFiles') return (templates.find(t => t.id === selectedTemplateId)?.pdfs || []);
    return [];
  };

  const isItemSelected = (id) => selectedIds.includes(id);

  const toggleSelectItem = (id, e) => {
    if (e && e.stopPropagation) e.stopPropagation();
    setSelectedIds(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      console.log('[DocumentDelete] selection:toggle', JSON.stringify({
        id,
        wasSelected: prev.includes(id),
        selectedIds: next,
      }));
      return next;
    });
  };

  const handleEnterSelectionMode = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    console.log('[DocumentDelete] selection:enter', JSON.stringify({
      activeSection,
      visibleItems: getCurrentItems().length,
    }));
    setIsSelectionMode(true);
    setSelectedIds([]);
  };

  const selectAllCurrent = () => {
    const items = getCurrentItems();
    setSelectedIds(items.map(i => i.id));
  };

  const clearSelection = () => setSelectedIds([]);

  const exitSelectionMode = useCallback(() => { setIsSelectionMode(false); setSelectedIds([]); }, []);

  // Document-level click handler to exit selection mode when clicking outside items
  useEffect(() => {
    if (!isSelectionMode || (activeSection !== 'documents' && activeSection !== 'projects' && activeSection !== 'templates')) {
      return;
    }

    const handleDocumentClick = (e) => {
      const target = e.target;

      // Check if clicking within the selection mode actions container
      const isInSelectionModeActions = selectionModeActionsRef.current && selectionModeActionsRef.current.contains(target);

      // Check if clicking on an item container (grid item div or table row)
      const isItemContainer = target.closest('tr[style*="cursor: pointer"]') ||
        (target.closest('div[style*="cursor: pointer"]') &&
          target.closest('div[style*="cursor: pointer"]')?.style?.cursor === 'pointer' &&
          !target.closest('div[style*="cursor: pointer"]')?.closest('button'));

      // Only prevent exit if clicking within selection mode actions OR on an item container
      const shouldPreventExit = isInSelectionModeActions || isItemContainer;

      if (!shouldPreventExit) {
        exitSelectionMode();
      }
    };

    // Use capture phase to catch clicks before they're handled by other elements
    document.addEventListener('click', handleDocumentClick, true);

    return () => {
      document.removeEventListener('click', handleDocumentClick, true);
    };
  }, [isSelectionMode, activeSection, exitSelectionMode]);

  // Handle clicking outside items to exit selection mode (container-level handler as backup)
  const handleContainerClick = (e) => {
    // Only exit if we're in selection mode and in one of the relevant sections
    if (isSelectionMode && (activeSection === 'documents' || activeSection === 'projects' || activeSection === 'templates')) {
      const target = e.target;

      // Check if clicking within the selection mode actions container (Select All, Move/Copy, Share, Delete, Cancel buttons)
      const isInSelectionModeActions = selectionModeActionsRef.current && selectionModeActionsRef.current.contains(target);

      // Check if clicking on an item container (grid item div or table row)
      // Items have onClick handlers that stop propagation, but we check here as a safety measure
      const isItemContainer = target.closest('tr[style*="cursor: pointer"]') ||
        (target.closest('div[style*="cursor: pointer"]') &&
          target.closest('div[style*="cursor: pointer"]')?.style?.cursor === 'pointer' &&
          !target.closest('div[style*="cursor: pointer"]')?.closest('button'));

      // Only prevent exit if clicking within selection mode actions OR on an item container
      // All other clicks (including other buttons like settings, upload, create project, etc.) should exit
      const shouldPreventExit = isInSelectionModeActions || isItemContainer;

      if (!shouldPreventExit) {
        exitSelectionMode();
      }
    }
  };

  const handleSectionNavClick = (section, { resetProject = false, resetTemplate = false } = {}) => {
    // Feature gate Templates section for Pro/Enterprise users
    if (section === 'templates' && !features?.advancedSurvey) {
      alert('Survey Templates are a Pro feature. Please upgrade to access Templates.');
      return;
    }

    if (section !== activeSection && isSelectionMode) {
      exitSelectionMode();
    }

    if (resetProject) {
      setSelectedProjectId(null);
    }

    if (resetTemplate) {
      setSelectedTemplateId(null);
    }

    setActiveSection(section);
  };

  // Persist projects to Supabase
  const persistProjects = async (projectsToSave) => {
    if (!user) {
      return;
    }

    // This function is called with an array of projects
    // We need to sync each project to Supabase
    try {
      const currentProjectIds = new Set(projects.map(p => p.id));
      const newProjectIds = new Set(projectsToSave.map(p => p.id));

      // Delete projects that were removed
      for (const project of projects) {
        if (!newProjectIds.has(project.id)) {
          try {
            await deleteSupabaseProject(project.id);
          } catch (err) {
            console.error('Error deleting project:', err);
          }
        }
      }

      // Update or create projects
      for (const project of projectsToSave) {
        if (currentProjectIds.has(project.id)) {
          // Update existing project
          try {
            await updateSupabaseProject(project.id, {
              name: project.name,
              config: {
                pdfs: project.pdfs || [],
                createdAt: project.createdAt
              }
            });
          } catch (err) {
            console.error('Error updating project:', err);
          }
        } else {
          // Create new project
          try {
            await createSupabaseProject({
              name: project.name,
              config: {
                pdfs: project.pdfs || [],
                createdAt: project.createdAt
              }
            });
          } catch (err) {
            console.error('Error creating project:', err);
          }
        }
      }

      // Refetch to sync state
      await refetchProjects();
    } catch (err) {
      console.error('Error persisting projects:', err);
    }
  };

  // Persist templates to Supabase
  const persistTemplates = async (templatesToSave) => {
    if (!user) {
      return;
    }

    try {
      const currentTemplateIds = new Set(templates.map(t => t.id));
      const newTemplateIds = new Set(templatesToSave.map(t => t.id));

      // Delete templates that were removed
      for (const template of templates) {
        if (!newTemplateIds.has(template.id)) {
          const supabaseId = resolveSupabaseTemplateId(template);
          if (!supabaseId) continue;
          try {
            await deleteSupabaseTemplate(supabaseId);
          } catch (err) {
            console.error('Error deleting template:', err);
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
          }
        }
      }

      // Refetch to sync state
      await refetchTemplates();
    } catch (err) {
      console.error('Error persisting templates:', err);
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

  const handleBulkDelete = async () => {
    const ctx = getCurrentContextKey();
    if (selectedIds.length === 0) return;

    if (!user) {
      alert('Please sign in to delete items');
      return;
    }

    try {
      if (ctx === 'documents') {
        const idsToDelete = [...selectedIds];
        console.log('[DocumentDelete] bulk:start', JSON.stringify({
          ctx,
          selectedIds: idsToDelete,
          selectedCount: idsToDelete.length,
          visibleDocumentCount: sortedDocuments.length,
        }));
        // Hide immediately. The database operation below archives the row so
        // old cutover/Y.Doc annotation blobs are not synchronously hard-deleted.
        setDocuments(prev => prev.filter(d => !idsToDelete.includes(d.id)));
        setSelectedIds([]);
        setIsSelectionMode(false);
        // Delete documents from Supabase
        for (const docId of idsToDelete) {
          try {
            // Check if this is a temp document (local only, not yet in Supabase)
            if (typeof docId === 'string' && docId.startsWith('temp-')) {
              // Just remove from local state, no Supabase deletion needed
              continue;
            }
            const doc = supabaseDocuments.find(d => d.id === docId);
            const filePath = doc?.file_path || doc?.filePath;

            await deleteDocumentEverywhere({ docId, filePath, source: 'bulk-documents' });
          } catch (err) {
            console.error('[DocumentDelete] bulk:item-error', { docId, error: serializeError(err) });
            throw err;
          }
        }
        await refetchDocuments();
      } else if (ctx === 'projects') {
        // Delete projects from Supabase
        for (const projectId of selectedIds) {
          try {
            await deleteSupabaseProject(projectId);
          } catch (err) {
            console.error('Error deleting project:', err);
          }
        }
        await refetchProjects();
      } else if (ctx === 'projectFiles') {
        const proj = projects.find(p => p.id === selectedProjectId);
        if (proj) {
          const idsToDelete = [...selectedIds];
          setDocuments(prev => prev.filter(d => !idsToDelete.includes(d.id)));
          setSelectedIds([]);
          setIsSelectionMode(false);
          // Delete document records and files from Supabase
          for (const docId of idsToDelete) {
            try {
              // Check if this is a temp document (local only, not yet in Supabase)
              if (typeof docId === 'string' && docId.startsWith('temp-')) {
                // Just remove from local state, no Supabase deletion needed
                continue;
              }
              const doc = supabaseDocuments.find(d => d.id === docId);
              const filePath = doc?.file_path || doc?.filePath;

              await deleteDocumentEverywhere({ docId, filePath, source: 'bulk-project-files' });
            } catch (err) {
              console.error('[DocumentDelete] bulk:item-error', { docId, error: serializeError(err) });
              throw err;
            }
          }

          // Documents are automatically linked to projects via project_id foreign key
          // No need to update project config - documents will be refetched
          await refetchProjects();
          await refetchDocuments();
        }
      } else if (ctx === 'templates') {
        // Delete templates from Supabase
        for (const templateId of selectedIds) {
          const supabaseId = resolveSupabaseTemplateId(templateId);
          if (!supabaseId) continue;
          try {
            await deleteSupabaseTemplate(supabaseId);
          } catch (err) {
            console.error('Error deleting template:', err);
          }
        }
        await refetchTemplates();
      } else if (ctx === 'templateFiles') {
        const tmpl = templates.find(t => t.id === selectedTemplateId);
        if (tmpl) {
          // Update template config to remove PDFs
          const updatedPdfs = (Array.isArray(tmpl.pdfs) ? tmpl.pdfs : []).filter(f => !selectedIds.includes(f.id));
          const supabaseId = resolveSupabaseTemplateId(tmpl);
          if (supabaseId) {
            const updatedConfig = sanitizeTemplateConfig({ ...tmpl, pdfs: updatedPdfs });
            await updateSupabaseTemplate(supabaseId, {
              config: updatedConfig
            });
            await refetchTemplates();
          } else {
            console.warn('Unable to resolve Supabase template id for template files update.');
          }
        }
      }
      exitSelectionMode();
    } catch (err) {
      console.error('[DocumentDelete] bulk:error', serializeError(err));
      alert('Failed to delete items: ' + (err.message || 'Unknown error'));
    }
  };

  const handleBulkCopy = () => {
    const ctx = getCurrentContextKey();
    if (selectedIds.length === 0) return;
    if (ctx === 'documents') {
      const toCopy = sortedDocuments.filter(d => selectedIds.includes(d.id));
      const copies = toCopy.map(d => ({ ...d, id: `${Date.now()}-${Math.random()}`, name: `${d.name} (Copy)` }));
      setDocuments(prev => [...copies, ...prev]);
    } else if (ctx === 'projects') {
      const toCopy = projects.filter(p => selectedIds.includes(p.id));
      const usedProjectNames = new Set(
        projects
          .map(project => normalizeName(project?.name))
          .filter(Boolean)
      );
      const copies = toCopy.map(p => {
        const newProjectId = `${Date.now()}-${Math.random()}`;
        const newPdfs = (p.pdfs || []).map(f => ({ ...f, id: `${Date.now()}-${Math.random()}` }));
        const baseName = p?.name?.trim() || 'Untitled Project';
        const normalizedBaseName = normalizeName(baseName);
        let copyName = baseName;
        if (normalizedBaseName && usedProjectNames.has(normalizedBaseName)) {
          copyName = createCopyName(baseName, usedProjectNames);
        } else if (normalizedBaseName) {
          usedProjectNames.add(normalizedBaseName);
        }
        return { ...p, id: newProjectId, name: copyName, createdAt: new Date().toISOString(), pdfs: newPdfs };
      });
      const next = [...copies, ...projects];
      persistProjects(next);
    } else if (ctx === 'projectFiles') {
      const proj = projects.find(p => p.id === selectedProjectId);
      if (proj) {
        const toCopy = (proj.pdfs || []).filter(f => selectedIds.includes(f.id));
        const copies = toCopy.map(f => ({ ...f, id: `${Date.now()}-${Math.random()}`, name: `${f.name} (Copy)` }));
        const updated = { ...proj, pdfs: [...copies, ...(proj.pdfs || [])] };
        const next = projects.map(p => p.id === proj.id ? updated : p);
        persistProjects(next);
        // Also add to global documents list
        setDocuments(prev => [...copies, ...prev]);
      }
    } else if (ctx === 'templates') {
      const toCopy = templates.filter(t => selectedIds.includes(t.id));
      const usedTemplateNames = new Set(
        templates
          .map(template => normalizeName(template?.name))
          .filter(Boolean)
      );
      const copies = toCopy.map(t => {
        const newTemplateId = `${Date.now()}-${Math.random()}`;
        const newPdfs = (t.pdfs || []).map(f => ({ ...f, id: `${Date.now()}-${Math.random()}` }));
        const baseName = (t?.name?.trim()) || 'Template';
        const normalizedBaseName = normalizeName(baseName);
        let copyName = baseName;
        if (normalizedBaseName && usedTemplateNames.has(normalizedBaseName)) {
          copyName = createCopyName(baseName, usedTemplateNames);
        } else if (normalizedBaseName) {
          usedTemplateNames.add(normalizedBaseName);
        }
        return { ...t, id: newTemplateId, name: copyName, createdAt: new Date().toISOString(), pdfs: newPdfs };
      });
      const next = [...copies, ...templates];
      persistTemplates(next);
    } else if (ctx === 'templateFiles') {
      const tmpl = templates.find(t => t.id === selectedTemplateId);
      if (tmpl) {
        const toCopy = (tmpl.pdfs || []).filter(f => selectedIds.includes(f.id));
        const copies = toCopy.map(f => ({ ...f, id: `${Date.now()}-${Math.random()}`, name: `${f.name} (Copy)` }));
        const updated = { ...tmpl, pdfs: [...copies, ...(tmpl.pdfs || [])] };
        const next = templates.map(t => t.id === tmpl.id ? updated : t);
        persistTemplates(next);
      }
    }
    exitSelectionMode();
  };

  const handleBulkShare = () => {
    const ctx = getCurrentContextKey();
    if (selectedIds.length === 0) return;
    if (ctx === 'documents') {
      setDocuments(prev => prev.map(d => selectedIds.includes(d.id) ? { ...d, shared: true } : d));
    } else if (ctx === 'projects') {
      const next = projects.map(p => selectedIds.includes(p.id) ? { ...p, shared: true } : p);
      persistProjects(next);
    } else if (ctx === 'projectFiles') {
      const proj = projects.find(p => p.id === selectedProjectId);
      if (proj) {
        const updated = { ...proj, pdfs: (proj.pdfs || []).map(f => selectedIds.includes(f.id) ? { ...f, shared: true } : f) };
        const next = projects.map(p => p.id === proj.id ? updated : p);
        persistProjects(next);
      }
    } else if (ctx === 'templates') {
      const next = templates.map(t => selectedIds.includes(t.id) ? { ...t, shared: true } : t);
      persistTemplates(next);
    } else if (ctx === 'templateFiles') {
      const tmpl = templates.find(t => t.id === selectedTemplateId);
      if (tmpl) {
        const updated = { ...tmpl, pdfs: (tmpl.pdfs || []).map(f => selectedIds.includes(f.id) ? { ...f, shared: true } : f) };
        const next = templates.map(t => t.id === tmpl.id ? updated : t);
        persistTemplates(next);
      }
    }
    alert(`Shared ${selectedIds.length} item(s)`);
    exitSelectionMode();
  };

  const handleBulkMove = () => {
    if (selectedIds.length === 0) return;
    setIsMoveModalOpen(true);
  };

  const handleMoveToProject = async (projectId, isNewProject = false, moveToDocuments = false) => {
    if (selectedIds.length === 0) return;

    const ctx = getCurrentContextKey();

    // Get selected documents based on context
    let docsToMove = [];
    if (ctx === 'documents') {
      docsToMove = sortedDocuments.filter(d => selectedIds.includes(d.id));
    } else if (ctx === 'projectFiles') {
      // Get files from the current project
      const currentProject = projects.find(p => p.id === selectedProjectId);
      if (currentProject) {
        docsToMove = (currentProject.pdfs || []).filter(f => selectedIds.includes(f.id));
      }
    }

    if (docsToMove.length === 0) return;

    // Handle moving to Documents tab
    if (moveToDocuments) {
      // Remove from source location
      if (ctx === 'documents') {
        setDocuments(prev => prev.filter(d => !selectedIds.includes(d.id)));
      } else if (ctx === 'projectFiles') {
        const proj = projects.find(p => p.id === selectedProjectId);
        if (proj) {
          const updated = { ...proj, pdfs: (proj.pdfs || []).filter(f => !selectedIds.includes(f.id)) };
          const next = projects.map(p => p.id === proj.id ? updated : p);
          persistProjects(next);
        }
        // Also update documents list
        setDocuments(prev => prev.filter(d => !selectedIds.includes(d.id)));
      }

      // Add to documents list (with new IDs to avoid conflicts)
      const docsWithNewIds = docsToMove.map(d => ({
        ...d,
        id: `${Date.now()}-${Math.random()}`
      }));
      setDocuments(prev => [...docsWithNewIds, ...prev]);

      setIsMoveModalOpen(false);
      setProjectName('');
      exitSelectionMode();
      return;
    }

    if (isNewProject) {
      // Create new project with selected documents
      // Add documents to new project (with new IDs to avoid conflicts when moving from projectFiles)
      const docsWithNewIds = docsToMove.map(d => ({
        ...d,
        id: `${Date.now()}-${Math.random()}`
      }));

      if (!user) {
        setDashboardError('Please sign in to create projects.');
        return;
      }

      // Create new project in Supabase
      const createdProject = await createSupabaseProject({
        name: projectName.trim() || 'New Project',
        config: {
          pdfs: docsWithNewIds,
          createdAt: new Date().toISOString()
        }
      });

      // Update documents to associate with project
      for (const doc of docsToMove) {
        try {
          // Find the actual document in Supabase
          const actualDoc = supabaseDocuments.find(d =>
            (d.id === doc.id) || (d.name === doc.name && !d.project_id)
          );
          if (actualDoc) {
            await updateSupabaseDocument(actualDoc.id, {
              project_id: createdProject.id
            });
          }
        } catch (err) {
          console.error('Error updating document:', err);
        }
      }

      await refetchProjects();
      await refetchDocuments();

      // Remove from source location
      if (ctx === 'documents') {
        setDocuments(prev => prev.filter(d => !selectedIds.includes(d.id)));
      } else if (ctx === 'projectFiles') {
        const proj = projects.find(p => p.id === selectedProjectId);
        if (proj) {
          const updated = { ...proj, pdfs: (proj.pdfs || []).filter(f => !selectedIds.includes(f.id)) };
          const next = projects.map(p => p.id === proj.id ? updated : p);
          persistProjects(next);
        }
      }
    } else {
      // Move to existing project
      const targetProj = projects.find(p => p.id === projectId);
      if (targetProj) {
        // Add documents to target project (with new IDs to avoid conflicts)
        const docsWithNewIds = docsToMove.map(d => ({
          ...d,
          id: `${Date.now()}-${Math.random()}`
        }));

        // Update documents to move to target project
        if (!user) {
          alert('Please sign in to move documents');
          return;
        }

        for (const doc of docsToMove) {
          try {
            const actualDoc = supabaseDocuments.find(d =>
              (d.id === doc.id) || (d.name === doc.name)
            );
            if (actualDoc) {
              await updateSupabaseDocument(actualDoc.id, {
                project_id: projectId
              });
            }
          } catch (err) {
            console.error('Error updating document:', err);
          }
        }

        // Documents are automatically linked to projects via project_id foreign key
        // No need to update project config - documents will be refetched

        await refetchProjects();
        await refetchDocuments();
      }
    }

    setIsMoveModalOpen(false);
    setProjectName('');
    exitSelectionMode();
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

    // Delete stale DB row when present; treat already-missing rows as success.
    try {
      await deleteSupabaseDocument(docId);
    } catch (error) {
      if (!isSupabaseRowNotFoundError(error)) {
        console.error('[DocumentCleanup] Failed to delete stale document row:', error);
      }
    } finally {
      cleaningUpDocumentsRef.current.delete(docId);
    }
  }, [deleteSupabaseDocument]);

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
        alert('Unable to open document. Please check your connection and try again.');
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
      alert('Failed to delete document: ' + error.message);
      // Revert optimistic update if needed, but refetching should handle it
      await refetchDocuments();
    }
  };

  // Template builders: helpers
  const handleAddModuleClick = () => {
    setAddingModule(true);
  };

  const handleSaveModule = () => {
    const trimmedModuleName = newModuleName.trim();
    if (!trimmedModuleName) {
      alert('Please enter a module name.');
      return;
    }
    if (hasNameConflict(modules, trimmedModuleName, { getName: (module) => module?.name })) {
      alert('A module with this name already exists. Please choose a different name.');
      return;
    }
    const newModule = {
      id: `module-${Date.now()}-${Math.random()}`,
      name: trimmedModuleName,
      categories: []
    };
    setModules(prev => [...prev, newModule]);
    setSelectedModuleId(newModule.id);
    setAddingModule(false);
    setNewModuleName('');
    setSelectedTemplateCategoryId(null); // Reset category selection when module changes
  };

  const handleCancelAddModule = () => {
    setAddingModule(false);
    setNewModuleName('');
  };

  const handleModuleSelect = (moduleId) => {
    if (!editingModules) {
      setSelectedModuleId(moduleId);
      setSelectedTemplateCategoryId(null); // Reset category when module changes
    }
  };

  const deleteModule = (moduleId) => {
    const moduleToDelete = modules.find(m => m.id === moduleId);

    setModules(prev => prev.filter(m => m.id !== moduleId));
    setSelectedModuleIds(prev => prev.filter(id => id !== moduleId));

    if (selectedModuleId === moduleId) {
      setSelectedModuleId(null);
      setSelectedTemplateCategoryId(null);
    }

    if (moduleToDelete) {
      const categoryIds = (moduleToDelete.categories || []).map(cat => cat.id);
      if (categoryIds.length > 0) {
        setSelectedCategoryIds(prev => prev.filter(id => !categoryIds.includes(id)));
        setEditingCategoryName(prev => {
          const next = { ...prev };
          categoryIds.forEach(id => {
            if (next[id] !== undefined) {
              delete next[id];
            }
          });
          return next;
        });
        if (categoryIds.includes(selectedTemplateCategoryId)) {
          setSelectedTemplateCategoryId(null);
        }
      }
    }

    if (moveCopyDestinationModuleId === moduleId) {
      setMoveCopyDestinationModuleId(null);
      setMoveCopyNewCategoryName('');
    }

    // Clean up editing state
    setEditingModuleName(prev => {
      const next = { ...prev };
      delete next[moduleId];
      return next;
    });

    setSelectedTemplate(prev => {
      if (!prev) return prev;
      const removeModuleById = (collection) =>
        (collection || []).filter(m => m.id !== moduleId);
      return {
        ...prev,
        modules: removeModuleById(prev.modules),
        spaces: removeModuleById(prev.spaces)
      };
    });

    updateTemplates(prevTemplates => {
      const next = prevTemplates.map(t => ({
        ...t,
        modules: (t.modules || []).filter(m => m.id !== moduleId),
        spaces: (t.spaces || []).filter(s => s.id !== moduleId)
      }));
      try {
        localStorage.setItem('templates', JSON.stringify(next));
      } catch (e) {
        console.error('Error persisting templates:', e);
      }
      return next;
    });
  };

  // Batch deletion function for multiple modules
  const deleteModules = (moduleIds) => {
    if (!moduleIds || moduleIds.length === 0) return;

    const modulesToDelete = modules.filter(m => moduleIds.includes(m.id));
    const allCategoryIds = modulesToDelete.flatMap(m => (m.categories || []).map(cat => cat.id));

    // Remove modules in a single state update
    setModules(prev => prev.filter(m => !moduleIds.includes(m.id)));
    setSelectedModuleIds(prev => prev.filter(id => !moduleIds.includes(id)));

    // Clear selected module if it's being deleted
    if (moduleIds.includes(selectedModuleId)) {
      setSelectedModuleId(null);
      setSelectedTemplateCategoryId(null);
    }

    // Clean up category selections and editing state
    if (allCategoryIds.length > 0) {
      setSelectedCategoryIds(prev => prev.filter(id => !allCategoryIds.includes(id)));
      setEditingCategoryName(prev => {
        const next = { ...prev };
        allCategoryIds.forEach(id => {
          if (next[id] !== undefined) {
            delete next[id];
          }
        });
        return next;
      });
      if (selectedTemplateCategoryId && allCategoryIds.includes(selectedTemplateCategoryId)) {
        setSelectedTemplateCategoryId(null);
      }
    }

    // Clean up move/copy destination
    if (moveCopyDestinationModuleId && moduleIds.includes(moveCopyDestinationModuleId)) {
      setMoveCopyDestinationModuleId(null);
      setMoveCopyNewCategoryName('');
    }

    // Clean up editing state for modules
    setEditingModuleName(prev => {
      const next = { ...prev };
      moduleIds.forEach(id => {
        if (next[id] !== undefined) {
          delete next[id];
        }
      });
      return next;
    });

    // Update selectedTemplate
    setSelectedTemplate(prev => {
      if (!prev) return prev;
      const removeModulesById = (collection) =>
        (collection || []).filter(m => !moduleIds.includes(m.id));
      return {
        ...prev,
        modules: removeModulesById(prev.modules),
        spaces: removeModulesById(prev.spaces)
      };
    });

    // Update templates array and persist to localStorage
    updateTemplates(prevTemplates => {
      const next = prevTemplates.map(t => ({
        ...t,
        modules: (t.modules || []).filter(m => !moduleIds.includes(m.id)),
        spaces: (t.spaces || []).filter(s => !moduleIds.includes(s.id))
      }));
      try {
        localStorage.setItem('templates', JSON.stringify(next));
      } catch (e) {
        console.error('Error persisting templates:', e);
      }
      return next;
    });
  };

  const handleModuleNameChange = (moduleId, newName) => {
    setEditingModuleName(prev => ({ ...prev, [moduleId]: newName }));
  };

  const saveModuleEdit = (moduleId) => {
    const newName = editingModuleName[moduleId]?.trim();
    if (!newName) {
      alert('Module name cannot be empty.');
      return;
    }
    if (hasNameConflict(modules, newName, { getName: (module) => module?.name, ignoreId: moduleId })) {
      alert('A module with this name already exists. Please choose a different name.');
      return;
    }
    setModules(prev => prev.map(m => m.id === moduleId ? { ...m, name: newName } : m));
    setEditingModuleName(prev => {
      const next = { ...prev };
      delete next[moduleId];
      return next;
    });
  };

  const cancelModuleEdit = (moduleId) => {
    setEditingModuleName(prev => {
      const next = { ...prev };
      delete next[moduleId];
      return next;
    });
  };

  const handleEditModules = () => {
    setEditingModules(true);
    setSelectedModuleIds([]);
    // Initialize editing state with current module names
    const initialNames = {};
    modules.forEach(module => {
      initialNames[module.id] = module.name;
    });
    setEditingModuleName(initialNames);
  };

  const moduleSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8
      }
    })
  );

  const handleModuleDragEnd = useCallback(({ active, over }) => {
    if (!over || active.id === over.id) {
      return;
    }

    setModules((prevModules) => reorderItemsByActiveOver(prevModules, active.id, over.id));
  }, []);

  const handleModuleInputKeyDown = useCallback((moduleId, event) => {
    if (event.key === 'Enter') {
      saveModuleEdit(moduleId);
      event.currentTarget.blur();
    } else if (event.key === 'Escape') {
      cancelModuleEdit(moduleId);
      event.currentTarget.blur();
    }
  }, [saveModuleEdit, cancelModuleEdit]);

  const handleSaveEditModules = () => {
    if (!editingModules) {
      return;
    }

    const proposedNamesById = {};
    const seenNames = new Map();

    for (const module of modules) {
      if (!module) continue;
      const rawValue = Object.prototype.hasOwnProperty.call(editingModuleName, module.id)
        ? editingModuleName[module.id]
        : module.name;
      const trimmedName = (rawValue || '').trim();

      if (!trimmedName) {
        alert('Module name cannot be empty.');
        return;
      }

      const normalized = normalizeName(trimmedName);
      if (normalized) {
        const existingId = seenNames.get(normalized);
        if (existingId && existingId !== module.id) {
          const conflictingModule = modules.find((m) => m.id === existingId);
          const conflictingName = (Object.prototype.hasOwnProperty.call(editingModuleName, existingId)
            ? editingModuleName[existingId]
            : conflictingModule?.name) || trimmedName;
          alert(`Module names must be unique. "${trimmedName}" conflicts with "${conflictingName}".`);
          return;
        }
        seenNames.set(normalized, module.id);
      }

      proposedNamesById[module.id] = trimmedName;
    }

    setModules((prev) =>
      prev.map((module) => {
        const nextName = proposedNamesById[module.id];
        if (typeof nextName === 'undefined' || nextName === module.name) {
          return module;
        }
        return { ...module, name: nextName };
      })
    );

    setEditingModules(false);
    setEditingModuleName({});
    setSelectedModuleIds([]);
  };

  const toggleModuleSelection = (moduleId) => {
    setSelectedModuleIds(prev =>
      prev.includes(moduleId)
        ? prev.filter(id => id !== moduleId)
        : [...prev, moduleId]
    );
  };

  const handleMoveCopyModules = () => {
    if (selectedModuleIds.length === 0) {
      alert('Please select at least one module to move/copy.');
      return;
    }
    setMoveCopyType('module');
    setMoveCopyMode('copy');
    setIsMoveCopyModalOpen(true);
  };

  const handleDuplicateModules = () => {
    if (selectedModuleIds.length === 0) {
      alert('Please select at least one module to duplicate.');
      return;
    }

    const selectedSet = new Set(selectedModuleIds);
    const duplicateIds = [];
    const newEditingEntries = {};

    setModules(prevModules => {
      const usedNames = new Set(
        prevModules
          .map(m => (m.name || '').trim().toLowerCase())
          .filter(Boolean)
      );

      const nextModules = [];

      prevModules.forEach(module => {
        nextModules.push(module);

        if (selectedSet.has(module.id)) {
          const duplicatedCategories = (module.categories || []).map(category => {
            const duplicatedChecklist = (category.checklist || []).map(item => ({
              ...item,
              id: generateUniqueId('item')
            }));

            return {
              ...category,
              id: generateUniqueId('cat'),
              checklist: duplicatedChecklist
            };
          });

          const duplicateName = createCopyName(module.name || 'Untitled Module', usedNames);
          const duplicateModule = {
            ...module,
            id: generateUniqueId('module'),
            name: duplicateName,
            categories: duplicatedCategories
          };

          nextModules.push(duplicateModule);
          duplicateIds.push(duplicateModule.id);
          newEditingEntries[duplicateModule.id] = duplicateName;
        }
      });

      return nextModules;
    });

    if (duplicateIds.length > 0) {
      setSelectedModuleIds(duplicateIds);
      setEditingModuleName(prev => ({ ...prev, ...newEditingEntries }));
    }
  };

  const handleAddCategoryClick = () => {
    if (!selectedModuleId) return;
    setAddingCategory(true);
  };

  const handleSaveCategory = () => {
    const trimmedCategoryName = newCategoryName.trim();
    if (!trimmedCategoryName) {
      alert('Please enter a category name.');
      return;
    }
    if (!selectedModuleId) return;
    const selectedModule = modules.find(m => m.id === selectedModuleId);
    if (!selectedModule) return;
    if (hasNameConflict(selectedModule.categories, trimmedCategoryName, { getName: (category) => category?.name })) {
      alert('A category with this name already exists in this module. Please choose a different name.');
      return;
    }

    setModules(prev => prev.map(m => {
      if (m.id !== selectedModuleId) return m;
      const newCat = {
        id: `cat-${Date.now()}-${Math.random()}`,
        name: trimmedCategoryName,
        checklist: []
      };
      return { ...m, categories: [...m.categories, newCat] };
    }));

    setAddingCategory(false);
    setNewCategoryName('');
  };

  const handleCancelAddCategory = () => {
    setAddingCategory(false);
    setNewCategoryName('');
  };

  const handleCategorySelect = (categoryId) => {
    if (!editingCategories) {
      setSelectedTemplateCategoryId(categoryId);
    }
  };

  const handleCategoryNameChange = (categoryId, newName) => {
    setEditingCategoryName(prev => ({ ...prev, [categoryId]: newName }));
  };

  const saveCategoryEdit = (moduleId, categoryId) => {
    const newName = editingCategoryName[categoryId]?.trim();
    if (!newName) {
      alert('Category name cannot be empty.');
      return;
    }
    const parentModule = modules.find(m => m.id === moduleId);
    if (!parentModule) return;
    if (hasNameConflict(parentModule.categories, newName, { getName: (category) => category?.name, ignoreId: categoryId })) {
      alert('A category with this name already exists in this module. Please choose a different name.');
      return;
    }
    setModules(prev => prev.map(m => {
      if (m.id !== moduleId) return m;
      return {
        ...m,
        categories: m.categories.map(c => c.id === categoryId ? { ...c, name: newName } : c)
      };
    }));
    setEditingCategoryName(prev => {
      const next = { ...prev };
      delete next[categoryId];
      return next;
    });
  };

  const cancelCategoryEdit = (categoryId) => {
    setEditingCategoryName(prev => {
      const next = { ...prev };
      delete next[categoryId];
      return next;
    });
  };

  const handleEditCategories = () => {
    if (!selectedModuleId) return;
    setEditingCategories(true);
    setSelectedCategoryIds([]);
    // Initialize editing state with current category names for selected module
    const selectedModule = modules.find(m => m.id === selectedModuleId);
    if (selectedModule) {
      const initialNames = {};
      (selectedModule.categories || []).forEach(cat => {
        initialNames[cat.id] = cat.name;
      });
      setEditingCategoryName(initialNames);
    }
  };

  const selectedModuleForCategories = useMemo(
    () => modules.find((m) => m.id === selectedModuleId) || null,
    [modules, selectedModuleId]
  );

  const categorySensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8
      }
    })
  );

  const handleCategoryDragEnd = useCallback(({ active, over }) => {
    if (!over || active.id === over.id || !selectedModuleId) {
      return;
    }

    setModules((prevModules) => reorderCategoriesByActiveOver(prevModules, selectedModuleId, active.id, over.id));
  }, [selectedModuleId]);

  const handleCategoryInputKeyDown = useCallback((categoryId, event) => {
    if (event.key === 'Enter') {
      if (selectedModuleId) {
        saveCategoryEdit(selectedModuleId, categoryId);
      }
      event.currentTarget.blur();
    } else if (event.key === 'Escape') {
      cancelCategoryEdit(categoryId);
      event.currentTarget.blur();
    }
  }, [selectedModuleId, saveCategoryEdit, cancelCategoryEdit]);

  const handleSaveEditCategories = () => {
    if (!editingCategories) {
      return;
    }

    if (!selectedModuleId) {
      setEditingCategories(false);
      setEditingCategoryName({});
      setSelectedCategoryIds([]);
      return;
    }

    const selectedModule = modules.find((module) => module.id === selectedModuleId);
    if (!selectedModule) {
      setEditingCategories(false);
      setEditingCategoryName({});
      setSelectedCategoryIds([]);
      return;
    }

    const proposedNamesById = {};
    const seenNames = new Map();

    for (const category of selectedModule.categories || []) {
      if (!category) continue;
      const rawValue = Object.prototype.hasOwnProperty.call(editingCategoryName, category.id)
        ? editingCategoryName[category.id]
        : category.name;
      const trimmedName = (rawValue || '').trim();

      if (!trimmedName) {
        alert('Category name cannot be empty.');
        return;
      }

      const normalized = normalizeName(trimmedName);
      if (normalized) {
        const existingId = seenNames.get(normalized);
        if (existingId && existingId !== category.id) {
          const conflictingCategory = (selectedModule.categories || []).find((cat) => cat.id === existingId);
          const conflictingName = (Object.prototype.hasOwnProperty.call(editingCategoryName, existingId)
            ? editingCategoryName[existingId]
            : conflictingCategory?.name) || trimmedName;
          alert(`Category names within a module must be unique. "${trimmedName}" conflicts with "${conflictingName}".`);
          return;
        }
        seenNames.set(normalized, category.id);
      }

      proposedNamesById[category.id] = trimmedName;
    }

    setModules((prevModules) =>
      prevModules.map((module) => {
        if (module.id !== selectedModuleId) {
          return module;
        }

        const updatedCategories = (module.categories || []).map((category) => {
          const nextName = proposedNamesById[category.id];
          if (typeof nextName === 'undefined' || nextName === category.name) {
            return category;
          }
          return { ...category, name: nextName };
        });

        return { ...module, categories: updatedCategories };
      })
    );

    setEditingCategories(false);
    setEditingCategoryName({});
    setSelectedCategoryIds([]);
  };

  const toggleCategorySelection = (categoryId) => {
    setSelectedCategoryIds(prev =>
      prev.includes(categoryId)
        ? prev.filter(id => id !== categoryId)
        : [...prev, categoryId]
    );
  };

  const handleMoveCopyCategories = () => {
    if (selectedCategoryIds.length === 0) {
      alert('Please select at least one category to move/copy.');
      return;
    }
    setMoveCopyType('category');
    setMoveCopyMode('copy');
    setIsMoveCopyModalOpen(true);
  };

  const handleDuplicateCategories = () => {
    if (!selectedModuleId) {
      alert('Please select a module before duplicating categories.');
      return;
    }
    if (selectedCategoryIds.length === 0) {
      alert('Please select at least one category to duplicate.');
      return;
    }

    const selectedSet = new Set(selectedCategoryIds);
    const duplicateIds = [];
    const newEditingEntries = {};

    setModules(prevModules =>
      prevModules.map(module => {
        if (module.id !== selectedModuleId) {
          return module;
        }

        const usedNames = new Set(
          (module.categories || [])
            .map(cat => (cat.name || '').trim().toLowerCase())
            .filter(Boolean)
        );

        const updatedCategories = [];

        (module.categories || []).forEach(category => {
          updatedCategories.push(category);

          if (selectedSet.has(category.id)) {
            const duplicatedChecklist = (category.checklist || []).map(item => ({
              ...item,
              id: generateUniqueId('item')
            }));

            const duplicateName = createCopyName(category.name || 'Untitled Category', usedNames);
            const duplicatedCategory = {
              ...category,
              id: generateUniqueId('cat'),
              name: duplicateName,
              checklist: duplicatedChecklist
            };

            updatedCategories.push(duplicatedCategory);
            duplicateIds.push(duplicatedCategory.id);
            newEditingEntries[duplicatedCategory.id] = duplicateName;
          }
        });

        return {
          ...module,
          categories: updatedCategories
        };
      })
    );

    if (duplicateIds.length > 0) {
      setSelectedCategoryIds(duplicateIds);
      setEditingCategoryName(prev => ({ ...prev, ...newEditingEntries }));
    }
  };

  // Move/Copy handlers
  const [moveCopyDestinationTemplateId, setMoveCopyDestinationTemplateId] = useState(null);
  const [moveCopyDestinationModuleId, setMoveCopyDestinationModuleId] = useState(null);
  const [moveCopyDestinationCategoryId, setMoveCopyDestinationCategoryId] = useState(null);
  const [moveCopyNewTemplateName, setMoveCopyNewTemplateName] = useState('');
  const [moveCopyNewModuleName, setMoveCopyNewModuleName] = useState('');
  const [moveCopyNewCategoryName, setMoveCopyNewCategoryName] = useState('');

  const selectedModuleForMoveCopy = useMemo(() => {
    return modules.find(m => m.id === selectedModuleId) || null;
  }, [modules, selectedModuleId]);

  const selectedCategoriesForMoveCopy = useMemo(() => {
    if (!selectedModuleForMoveCopy) return [];
    return (selectedModuleForMoveCopy.categories || []).filter(c => selectedCategoryIds.includes(c.id));
  }, [selectedModuleForMoveCopy, selectedCategoryIds]);

  const destinationModuleForMoveCopy = useMemo(() => {
    return modules.find(m => m.id === moveCopyDestinationModuleId) || null;
  }, [modules, moveCopyDestinationModuleId]);

  const hasCategoryNameConflict = useMemo(() => {
    if (!destinationModuleForMoveCopy) return false;
    const existingNames = new Set(
      (destinationModuleForMoveCopy.categories || []).map(cat => (cat.name || '').trim().toLowerCase())
    );
    return selectedCategoriesForMoveCopy.some(cat =>
      existingNames.has((cat.name || '').trim().toLowerCase())
    );
  }, [destinationModuleForMoveCopy, selectedCategoriesForMoveCopy]);

  const shouldShowRenameInput =
    moveCopyType === 'category' &&
    moveCopyDestinationModuleId &&
    moveCopyDestinationModuleId !== 'new' &&
    (moveCopyMode === 'copy' || hasCategoryNameConflict);

  useEffect(() => {
    if (!shouldShowRenameInput && moveCopyNewCategoryName) {
      setMoveCopyNewCategoryName('');
    }
  }, [shouldShowRenameInput, moveCopyNewCategoryName]);

  const executeMoveCopy = () => {
    if (moveCopyType === 'module') {
      if (selectedModuleIds.length === 0) return;

      const modulesToMove = modules.filter(m => selectedModuleIds.includes(m.id));

      if (moveCopyDestinationTemplateId === 'new') {
        // Create new template
        const trimmedTemplateName = moveCopyNewTemplateName.trim();
        if (!trimmedTemplateName) {
          alert('Please enter a template name.');
          return;
        }

        // Deep clone modules to move/copy
        const clonedModules = modulesToMove.map(module => ({
          id: moveCopyMode === 'move' ? module.id : `module-${Date.now()}-${Math.random()}`,
          name: module.name,
          categories: (module.categories || []).map(cat => ({
            id: moveCopyMode === 'move' ? cat.id : `cat-${Date.now()}-${Math.random()}`,
            name: cat.name,
            checklist: (cat.checklist || []).map(item => ({
              id: moveCopyMode === 'move' ? item.id : `item-${Date.now()}-${Math.random()}`,
              text: item.text
            }))
          }))
        }));

        const newTemplate = {
          id: `${Date.now()}-${Math.random()}`,
          name: trimmedTemplateName,
          visibility: 'personal',
          modules: clonedModules,
          spaces: clonedModules,
          createdAt: new Date().toISOString(),
          entities: []
        };

        // Save new template
        const existingRaw = localStorage.getItem('templates');
        const existing = existingRaw ? JSON.parse(existingRaw) : [];
        if (hasNameConflict(existing, trimmedTemplateName, { getName: (template) => template?.name })) {
          alert('A template with this name already exists. Please choose a different name.');
          return;
        }
        existing.unshift(newTemplate);
        localStorage.setItem('templates', JSON.stringify(existing));
        updateTemplates(existing);

        if (moveCopyMode === 'move') {
          // Remove modules from current template
          setModules(prev => prev.filter(m => !selectedModuleIds.includes(m.id)));
          setSelectedModuleIds([]);
        }
      } else {
        // Move/copy to existing template
        const existingRaw = localStorage.getItem('templates');
        const existing = existingRaw ? JSON.parse(existingRaw) : [];
        const targetTemplate = existing.find(t => t.id === moveCopyDestinationTemplateId);

        if (targetTemplate) {
          const usedModuleNames = new Set(
            (targetTemplate.modules || [])
              .map(existingModule => normalizeName(existingModule?.name))
              .filter(Boolean)
          );
          const clonedModules = modulesToMove.map(module => {
            const baseName = module?.name?.trim() || 'Untitled Module';
            let finalName = baseName;
            const normalizedModuleName = normalizeName(finalName);
            if (normalizedModuleName && usedModuleNames.has(normalizedModuleName)) {
              finalName = createCopyName(baseName, usedModuleNames);
            } else if (normalizedModuleName) {
              usedModuleNames.add(normalizedModuleName);
            }
            return {
              ...module,
              id: moveCopyMode === 'move' ? module.id : `module-${Date.now()}-${Math.random()}`,
              name: finalName,
              categories: (module.categories || []).map(cat => ({
                id: moveCopyMode === 'move' ? cat.id : `cat-${Date.now()}-${Math.random()}`,
                name: cat.name,
                checklist: (cat.checklist || []).map(item => ({
                  id: moveCopyMode === 'move' ? item.id : `item-${Date.now()}-${Math.random()}`,
                  text: item.text
                }))
              }))
            };
          });

          const mergedModules = [...(targetTemplate.modules || []), ...clonedModules];
          targetTemplate.modules = mergedModules;
          targetTemplate.spaces = mergedModules;
          localStorage.setItem('templates', JSON.stringify(existing));
          updateTemplates(existing);

          if (moveCopyMode === 'move') {
            setModules(prev => prev.filter(m => !selectedModuleIds.includes(m.id)));
            setSelectedModuleIds([]);
          }
        }
      }
    } else if (moveCopyType === 'category') {
      if (selectedCategoryIds.length === 0 || !selectedModuleId) return;

      const selectedModule = modules.find(m => m.id === selectedModuleId);
      if (!selectedModule) return;

      const categoriesToMove = (selectedModule.categories || []).filter(c => selectedCategoryIds.includes(c.id));

      if (moveCopyDestinationModuleId === 'new') {
        // Create new module in current template
        const trimmedModuleName = moveCopyNewModuleName.trim();
        if (!trimmedModuleName) {
          alert('Please enter a module name.');
          return;
        }

        if (hasNameConflict(modules, trimmedModuleName, { getName: (module) => module?.name })) {
          alert('A module with this name already exists. Please choose a different name.');
          return;
        }

        const clonedCategories = categoriesToMove.map(cat => ({
          id: moveCopyMode === 'move' ? cat.id : `cat-${Date.now()}-${Math.random()}`,
          name: cat.name,
          checklist: (cat.checklist || []).map(item => ({
            id: moveCopyMode === 'move' ? item.id : `item-${Date.now()}-${Math.random()}`,
            text: item.text
          }))
        }));

        const newModule = {
          id: `module-${Date.now()}-${Math.random()}`,
          name: trimmedModuleName,
          categories: clonedCategories
        };

        setModules(prev => {
          const updated = [...prev, newModule];
          if (moveCopyMode === 'move') {
            return updated.map(m => {
              if (m.id === selectedModuleId) {
                return {
                  ...m,
                  categories: (m.categories || []).filter(c => !selectedCategoryIds.includes(c.id))
                };
              }
              return m;
            });
          }
          return updated;
        });

        if (moveCopyMode === 'move') {
          setSelectedCategoryIds([]);
        }
      } else {
        // Move/copy to existing module
        const destinationModule = modules.find(m => m.id === moveCopyDestinationModuleId);
        if (!destinationModule) {
          alert('Selected destination module could not be found. Please choose another destination.');
          return;
        }

        const isMoveWithinSameModule = moveCopyMode === 'move' && moveCopyDestinationModuleId === selectedModuleId;
        const trimmedRename = moveCopyNewCategoryName.trim();
        const renameMap = new Map();

        if (!isMoveWithinSameModule) {
          const existingCategoryNames = new Set(
            (destinationModule.categories || []).map(cat => (cat.name || '').trim().toLowerCase())
          );
          const conflictingCategories = categoriesToMove.filter(cat =>
            existingCategoryNames.has((cat.name || '').trim().toLowerCase())
          );

          if (conflictingCategories.length > 0) {
            if (categoriesToMove.length > 1 || conflictingCategories.length > 1) {
              alert('Multiple selected categories conflict with existing names. Please move or copy them one at a time and provide unique names.');
              return;
            }

            if (!trimmedRename) {
              alert('A category with the same name already exists in the destination. Please provide a new name before continuing.');
              return;
            }

            renameMap.set(conflictingCategories[0].id, trimmedRename);
          } else if (trimmedRename) {
            if (categoriesToMove.length > 1) {
              alert('Renaming during move/copy is only supported when a single category is selected.');
              return;
            }
            renameMap.set(categoriesToMove[0].id, trimmedRename);
          }
        }

        const clonedCategories = categoriesToMove.map(cat => ({
          id: moveCopyMode === 'move' ? cat.id : `cat-${Date.now()}-${Math.random()}`,
          name: renameMap.get(cat.id) || cat.name,
          checklist: (cat.checklist || []).map(item => ({
            id: moveCopyMode === 'move' ? item.id : `item-${Date.now()}-${Math.random()}`,
            text: item.text
          }))
        }));

        setModules(prev => prev.map(m => {
          if (m.id === moveCopyDestinationModuleId) {
            return {
              ...m,
              categories: [...(m.categories || []), ...clonedCategories]
            };
          }
          if (moveCopyMode === 'move' && m.id === selectedModuleId) {
            return {
              ...m,
              categories: (m.categories || []).filter(c => !selectedCategoryIds.includes(c.id))
            };
          }
          return m;
        }));

        if (moveCopyMode === 'move') {
          setSelectedCategoryIds([]);
        }
      }
    }

    // Close modal and reset
    setIsMoveCopyModalOpen(false);
    setMoveCopyDestinationTemplateId(null);
    setMoveCopyDestinationModuleId(null);
    setMoveCopyDestinationCategoryId(null);
    setMoveCopyNewTemplateName('');
    setMoveCopyNewModuleName('');
    setMoveCopyNewCategoryName('');
  };

  const addCategory = (spaceId) => {
    // Legacy function - keeping for compatibility but redirecting to new flow
    handleAddCategoryClick();
  };

  const renameCategory = (spaceId, categoryId, name) => {
    setModules(prev => prev.map(s => s.id === spaceId ? { ...s, categories: s.categories.map(c => c.id === categoryId ? { ...c, name } : c) } : s));
  };

  const deleteCategory = (spaceId, categoryId) => {
    const moduleIndex = modules.findIndex(m => m.id === spaceId);
    if (moduleIndex !== -1) {
      const moduleToUpdate = modules[moduleIndex];
      const updatedCategories = (moduleToUpdate.categories || []).filter(c => c.id !== categoryId);

      if (updatedCategories.length !== (moduleToUpdate.categories || []).length) {
        setModules(prev =>
          prev.map(m =>
            m.id === spaceId
              ? { ...m, categories: updatedCategories }
              : m
          )
        );
        setSelectedCategoryIds(prev => prev.filter(id => id !== categoryId));
        setEditingCategoryName(prev => {
          const next = { ...prev };
          if (next[categoryId] !== undefined) {
            delete next[categoryId];
          }
          return next;
        });
        if (moveCopyDestinationCategoryId === categoryId) {
          setMoveCopyDestinationCategoryId(null);
        }
        if (moveCopyNewCategoryName) {
          setMoveCopyNewCategoryName('');
        }
      }
    }

    if (selectedTemplateCategoryId === categoryId) {
      setSelectedTemplateCategoryId(null);
    }

    // Update selectedTemplate and templates in separate state updates
    setSelectedTemplate(prev => {
      if (!prev) return prev;
      const pruneCategory = (collection = []) =>
        collection.map(entry =>
          entry.id === spaceId
            ? {
              ...entry,
              categories: (entry.categories || []).filter(c => c.id !== categoryId)
            }
            : entry
        );
      return {
        ...prev,
        modules: pruneCategory(prev.modules || []),
        spaces: pruneCategory(prev.spaces || [])
      };
    });

    // Update templates array and persist to localStorage
    updateTemplates(prevTemplates => {
      const pruneCategory = (collection = []) =>
        collection.map(entry =>
          entry.id === spaceId
            ? {
              ...entry,
              categories: (entry.categories || []).filter(c => c.id !== categoryId)
            }
            : entry
        );
      const next = prevTemplates.map(t => ({
        ...t,
        modules: pruneCategory(t.modules || []),
        spaces: pruneCategory(t.spaces || [])
      }));
      // Persist to localStorage
      try {
        localStorage.setItem('templates', JSON.stringify(next));
      } catch (e) {
        console.error('Error persisting templates:', e);
      }
      return next;
    });
  };

  // Batch deletion function for multiple categories
  const deleteCategories = (spaceId, categoryIds) => {
    if (!categoryIds || categoryIds.length === 0) return;

    const moduleToUpdate = modules.find(m => m.id === spaceId);
    if (!moduleToUpdate) return;

    const updatedCategories = (moduleToUpdate.categories || []).filter(c => !categoryIds.includes(c.id));

    // Only update if categories were actually removed
    if (updatedCategories.length !== (moduleToUpdate.categories || []).length) {
      // Remove categories in a single state update
      setModules(prev =>
        prev.map(m =>
          m.id === spaceId
            ? { ...m, categories: updatedCategories }
            : m
        )
      );

      setSelectedCategoryIds(prev => prev.filter(id => !categoryIds.includes(id)));

      setEditingCategoryName(prev => {
        const next = { ...prev };
        categoryIds.forEach(id => {
          if (next[id] !== undefined) {
            delete next[id];
          }
        });
        return next;
      });

      if (moveCopyDestinationCategoryId && categoryIds.includes(moveCopyDestinationCategoryId)) {
        setMoveCopyDestinationCategoryId(null);
      }
      if (moveCopyNewCategoryName) {
        setMoveCopyNewCategoryName('');
      }
    }

    // Clear selected template category if it's being deleted
    if (selectedTemplateCategoryId && categoryIds.includes(selectedTemplateCategoryId)) {
      setSelectedTemplateCategoryId(null);
    }

    // Update selectedTemplate
    setSelectedTemplate(prev => {
      if (!prev) return prev;
      const pruneCategories = (collection = []) =>
        collection.map(entry =>
          entry.id === spaceId
            ? {
              ...entry,
              categories: (entry.categories || []).filter(c => !categoryIds.includes(c.id))
            }
            : entry
        );
      return {
        ...prev,
        modules: pruneCategories(prev.modules || []),
        spaces: pruneCategories(prev.spaces || [])
      };
    });

    // Update templates array and persist to localStorage
    updateTemplates(prevTemplates => {
      const pruneCategories = (collection = []) =>
        collection.map(entry =>
          entry.id === spaceId
            ? {
              ...entry,
              categories: (entry.categories || []).filter(c => !categoryIds.includes(c.id))
            }
            : entry
        );
      const next = prevTemplates.map(t => ({
        ...t,
        modules: pruneCategories(t.modules || []),
        spaces: pruneCategories(t.spaces || [])
      }));
      // Persist to localStorage
      try {
        localStorage.setItem('templates', JSON.stringify(next));
      } catch (e) {
        console.error('Error persisting templates:', e);
      }
      return next;
    });
  };

  const copyCategoriesBetweenSpaces = (fromSpaceId, toSpaceId) => {
    if (fromSpaceId === toSpaceId) return;
    const from = modules.find(s => s.id === fromSpaceId);
    if (!from) return;
    const clonedCats = (from.categories || []).map(c => ({ id: `cat-${Date.now()}-${Math.random()}`, name: c.name, checklist: (c.checklist || []).map(it => ({ id: `item-${Date.now()}-${Math.random()}`, text: it.text })) }));
    setModules(prev => prev.map(s => s.id === toSpaceId ? { ...s, categories: [...s.categories, ...clonedCats] } : s));
  };

  const addChecklistItem = (spaceId, categoryId) => {
    setModules(prev => prev.map(s => s.id === spaceId ? { ...s, categories: s.categories.map(c => c.id === categoryId ? { ...c, checklist: [...c.checklist, { id: `item-${Date.now()}-${Math.random()}`, text: '' }] } : c) } : s));
  };

  const updateChecklistItem = (spaceId, categoryId, itemId, text) => {
    const valueToPersist = typeof text === 'string' ? text : '';
    setModules(prev => prev.map(s => s.id === spaceId ? { ...s, categories: s.categories.map(c => c.id === categoryId ? { ...c, checklist: c.checklist.map(i => i.id === itemId ? { ...i, text: valueToPersist } : i) } : c) } : s));
  };

  const deleteChecklistItem = (spaceId, categoryId, itemId) => {
    setModules(prev => prev.map(s => s.id === spaceId ? { ...s, categories: s.categories.map(c => c.id === categoryId ? { ...c, checklist: c.checklist.filter(i => i.id !== itemId) } : c) } : s));
  };

  // Entity helpers
  const addEntity = () => {
    setEntities(prev => {
      const usedNames = new Set(
        prev.map(entity => normalizeName(entity?.name)).filter(Boolean)
      );
      let counter = prev.length + 1;
      let candidateName = `Entity ${counter}`;
      while (usedNames.has(normalizeName(candidateName))) {
        counter += 1;
        candidateName = `Entity ${counter}`;
      }
      const newEntity = {
        id: `entity-${Date.now()}-${Math.random()}`,
        name: candidateName,
        color: hexToRgba('#E3D1FB', 0.2) // Default color with 20% opacity (for entity definition display)
      };
      return [...prev, newEntity];
    });
  };

  const updateEntity = (entityId, updates) => {
    setEntities(prev =>
      prev.map(entity =>
        entity.id === entityId ? { ...entity, ...updates } : entity
      )
    );
  };

  const deleteEntity = (entityId) => {
    setEntities(prev => prev.filter(e => e.id !== entityId));
  };

  const handleEntityColorPickerOpen = (entityId, hex, opacity) => {
    setSelectedColorPickerId(entityId);
    setColorPickerMode('grid');
    setTempColor({ hex, opacity });
    setOpacityInputValue(null);
    setOpacityInputFocused(false);
  };

  const handleEntityDelete = (entityId) => {
    deleteEntity(entityId);
    if (selectedColorPickerId === entityId) {
      setSelectedColorPickerId(null);
    }
  };

  const handleEntityNameChange = (entityId, name) => {
    updateEntity(entityId, { name });
  };

  const getTemplateSnapshot = useCallback(() => ({
    templateName: templateName.trim(),
    templateVisibility,
    modules: modules.map((module) => ({
      ...module,
      categories: (module.categories || []).map((category) => ({
        ...category,
        checklist: (category.checklist || []).map((item) => ({ ...item }))
      }))
    })),
    entities: entities.map((entity) => ({ ...entity }))
  }), [templateName, templateVisibility, modules, entities]);

  useEffect(() => {
    if (isTemplateModalOpen) {
      if (!initialTemplateStateRef.current) {
        initialTemplateStateRef.current = JSON.stringify(getTemplateSnapshot());
      }
    } else {
      initialTemplateStateRef.current = null;
    }
  }, [isTemplateModalOpen, getTemplateSnapshot]);

  const hasUnsavedTemplateChanges = useMemo(() => {
    if (!isTemplateModalOpen || !initialTemplateStateRef.current) {
      return false;
    }
    const currentSnapshot = JSON.stringify(getTemplateSnapshot());
    return currentSnapshot !== initialTemplateStateRef.current;
  }, [isTemplateModalOpen, getTemplateSnapshot]);

  const openTemplateModal = () => {
    setTemplateName('');
    setTemplateVisibility('personal');
    setModules([]);
    setSelectedModuleId(null);
    setSelectedTemplateCategoryId(null);
    setEditingTemplateId(null);
    setSelectedColorPickerId(null);
    setAddingModule(false);
    setNewModuleName('');
    setAddingCategory(false);
    setNewCategoryName('');
    setEditingModules(false);
    setEditingCategories(false);
    setEditingModuleName({});
    setEditingCategoryName({});
    setSelectedModuleIds([]);
    setSelectedCategoryIds([]);
    setSelectedChecklistItemIds([]);
    setIsMoveCopyModalOpen(false);
    setMoveCopyDestinationTemplateId(null);
    setMoveCopyDestinationModuleId(null);
    setMoveCopyDestinationCategoryId(null);
    setMoveCopyNewTemplateName('');
    setMoveCopyNewModuleName('');
    setMoveCopyNewCategoryName('');
    // Initialize with default Entities (entity definitions use 20% opacity for display, surveyMarkers use 40%)
    setEntities([
      { id: `entity-${Date.now()}-1`, name: 'GC', color: hexToRgba('#E3D1FB', 0.2) },
      { id: `entity-${Date.now()}-2`, name: 'Subcontractor', color: hexToRgba('#FFF5C3', 0.2) },
      { id: `entity-${Date.now()}-3`, name: 'My Company', color: hexToRgba('#CBDCFF', 0.2) },
      { id: `entity-${Date.now()}-4`, name: '100% Complete', color: hexToRgba('#B2FFB2', 0.2) },
      { id: `entity-${Date.now()}-5`, name: 'Removed', color: hexToRgba('#BBBBBB', 0.2) }
    ]);
    setIsTemplateModalOpen(true);
  };
  useImperativeHandle(ref, () => ({
    openTemplateModal,
    openEditTemplateModal,
    closeTemplateModal: () => setIsTemplateModalOpen(false),
    exitSelectionMode
  }));

  const openEditTemplateModal = (templateId, options = {}) => {
    const { moduleId: focusModuleId, startAddingCategory = false } = options || {};
    const template = templates.find(t => t.id === templateId);
    if (!template) {
      alert('Template not found.');
      return;
    }

    // Pre-populate all fields with template data
    setTemplateName(template.name || '');
    setTemplateVisibility(template.visibility || 'personal');

    // Deep clone modules to avoid mutating the original
    const clonedModules = (template.modules || template.spaces || []).map(module => ({
      id: module.id,
      name: module.name,
      categories: (module.categories || []).map(cat => ({
        id: cat.id,
        name: cat.name,
        checklist: (cat.checklist || []).map(item => ({
          id: item.id,
          text: item.text
        }))
      }))
    }));

    setModules(clonedModules);
    const targetModuleId = focusModuleId && clonedModules.some(m => m.id === focusModuleId)
      ? focusModuleId
      : (clonedModules.length > 0 ? clonedModules[0].id : null);
    setSelectedModuleId(targetModuleId);
    setSelectedTemplateCategoryId(null);
    setAddingModule(false);
    setNewModuleName('');
    const shouldStartAddingCategory = Boolean(startAddingCategory && targetModuleId);
    setAddingCategory(shouldStartAddingCategory);
    setNewCategoryName('');
    setEditingModules(false);
    setEditingCategories(false);
    setEditingModuleName({});
    setEditingCategoryName({});
    setSelectedModuleIds([]);
    setSelectedCategoryIds([]);
    setSelectedChecklistItemIds([]);
    setIsMoveCopyModalOpen(false);
    setMoveCopyDestinationTemplateId(null);
    setMoveCopyDestinationModuleId(null);
    setMoveCopyDestinationCategoryId(null);
    setMoveCopyNewTemplateName('');
    setMoveCopyNewModuleName('');
    setMoveCopyNewCategoryName('');

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

    setEditingTemplateId(templateId);
    setIsTemplateModalOpen(true);
  };

  const cancelTemplateModal = () => {
    setIsTemplateModalOpen(false);
    setEditingTemplateId(null);
    setSelectedTemplateCategoryId(null);
    setSelectedColorPickerId(null);
    setAddingModule(false);
    setNewModuleName('');
    setAddingCategory(false);
    setNewCategoryName('');
    setEditingModules(false);
    setEditingCategories(false);
    setEditingModuleName({});
    setEditingCategoryName({});
    setSelectedModuleIds([]);
    setSelectedCategoryIds([]);
    setSelectedChecklistItemIds([]);
    setIsMoveCopyModalOpen(false);
    setMoveCopyDestinationTemplateId(null);
    setMoveCopyDestinationModuleId(null);
    setMoveCopyDestinationCategoryId(null);
    setMoveCopyNewTemplateName('');
    setMoveCopyNewModuleName('');
    setMoveCopyNewCategoryName('');
  };

  const handleTemplateOverlayClick = useCallback((event) => {
    if (event.target !== event.currentTarget) {
      return;
    }

    if (hasUnsavedTemplateChanges) {
      const shouldClose = window.confirm('You have unsaved changes. If you close now, all changes will be lost. Continue?');
      if (!shouldClose) {
        return;
      }
    }

    cancelTemplateModal();
  }, [hasUnsavedTemplateChanges, cancelTemplateModal]);

  const saveTemplate = async () => {
    const trimmedTemplateName = templateName.trim();
    if (!trimmedTemplateName) {
      alert('Please enter a template name.');
      return;
    }
    if (hasNameConflict(templates, trimmedTemplateName, { getName: (template) => template?.name, ignoreId: editingTemplateId })) {
      alert('A template with this name already exists. Please choose a different name.');
      return;
    }

    for (const module of modules) {
      const moduleName = (module?.name || 'Module').trim() || 'Module';
      for (const category of module?.categories || []) {
        const categoryName = (category?.name || 'Category').trim() || 'Category';
        const seenChecklistNames = new Set();
        for (const item of category?.checklist || []) {
          const trimmedItemName = (item?.text || '').trim();
          if (!trimmedItemName) {
            continue;
          }
          const normalizedItemName = normalizeName(trimmedItemName);
          if (seenChecklistNames.has(normalizedItemName)) {
            alert(`Checklist items within "${categoryName}" (${moduleName}) must have unique names. Please update duplicates before saving.`);
            return;
          }
          seenChecklistNames.add(normalizedItemName);
        }
      }
    }

    const cleanedModules = modules.map(m => ({
      id: m.id,
      name: m.name.trim() || 'Untitled Module',
      categories: (m.categories || []).map(c => ({
        id: c.id,
        name: c.name.trim() || 'Untitled Category',
        checklist: (c.checklist || []).map(i => ({ id: i.id, text: (i.text || '').trim() })).filter(i => i.text)
      }))
    }));

    const trimmedEntityNames = entities
      .map(e => (e?.name || '').trim())
      .filter(Boolean);

    const hasDuplicateEntityNames = trimmedEntityNames.some((name, index) => {
      const normalized = normalizeName(name);
      return trimmedEntityNames.findIndex(other => normalizeName(other) === normalized) !== index;
    });

    if (hasDuplicateEntityNames) {
      alert('Each Entity name must be unique. Please resolve duplicate names before saving.');
      return;
    }

    // Clean Entities
    const cleanedEntities = entities
      .filter(e => e.name.trim())
      .map(e => ({
        id: e.id,
        name: e.name.trim(),
        color: e.color
      }));

    const buildUpdatedTemplates = (sourceTemplates = []) => {
      const existingTemplates = Array.isArray(sourceTemplates) ? sourceTemplates : [];

      if (hasNameConflict(existingTemplates, trimmedTemplateName, { getName: (template) => template?.name, ignoreId: editingTemplateId })) {
        alert('A template with this name already exists. Please choose a different name.');
        return null;
      }

      const timestamp = new Date().toISOString();

      if (editingTemplateId) {
        let wasUpdated = false;
        const updatedTemplates = existingTemplates.map(template => {
          if (template.id !== editingTemplateId) return template;
          wasUpdated = true;
          return {
            ...template,
            id: editingTemplateId,
            name: trimmedTemplateName,
            visibility: templateVisibility,
            modules: cleanedModules,
            spaces: cleanedModules,
            entities: cleanedEntities,
            updatedAt: timestamp,
            createdAt: template.createdAt || timestamp
          };
        });

        if (!wasUpdated) {
          const fallbackTemplate = {
            id: editingTemplateId,
            name: trimmedTemplateName,
            visibility: templateVisibility,
            modules: cleanedModules,
            spaces: cleanedModules,
            entities: cleanedEntities,
            createdAt: timestamp,
            updatedAt: timestamp
          };
          return [fallbackTemplate, ...updatedTemplates];
        }

        return updatedTemplates;
      }

      const newTemplate = {
        id: `tpl-${Date.now()}`,
        name: trimmedTemplateName,
        visibility: templateVisibility,
        modules: cleanedModules,
        spaces: cleanedModules,
        entities: cleanedEntities,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      return [newTemplate, ...existingTemplates];
    };

    try {
      if (user) {
        const sourceTemplates = Array.isArray(templates) ? templates : [];
        const nextTemplates = buildUpdatedTemplates(sourceTemplates);
        if (!nextTemplates) {
          return;
        }
        updateTemplates(nextTemplates);
        await persistTemplates(nextTemplates);
      } else {
        const raw = localStorage.getItem('templates');
        const existing = raw ? JSON.parse(raw) : [];
        const nextTemplates = buildUpdatedTemplates(existing);
        if (!nextTemplates) {
          return;
        }
        localStorage.setItem('templates', JSON.stringify(nextTemplates));
        updateTemplates(nextTemplates);
      }

      setIsTemplateModalOpen(false);
      setEditingTemplateId(null);
    } catch (e) {
      console.error('Failed to save template', e);
      alert('Failed to save template.');
    }
  };

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

  // Persist edits made in the Survey Hub's Templates editor. Mirrors the
  // logged-in / guest split used by saveTemplate so hub edits land in
  // Supabase (config JSONB) for signed-in users, or localStorage otherwise.
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
      alert('Failed to save templates.');
    }
  };

  // Delete the given documents everywhere (archives row + storage file).
  const hubDeleteDocuments = async (docs) => {
    const list = Array.isArray(docs) ? docs.filter(Boolean) : [];
    if (list.length === 0) return;
    if (!user) { alert('Please sign in to delete documents'); return; }
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
      alert('Failed to delete documents: ' + (err.message || 'Unknown error'));
      await refetchDocuments();
    }
  };

  const hubDeleteProjects = async (items) => {
    const list = Array.isArray(items) ? items.filter(Boolean) : [];
    if (list.length === 0) return false;
    if (!user) { alert('Please sign in to delete projects'); return false; }
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
      alert('Failed to delete projects: ' + (err.message || 'Unknown error'));
      await refetchProjects();
      await refetchDocuments();
      return false;
    }
  };

  // Duplicate the given documents — optimistic local copies, same shape as
  // the legacy handleBulkCopy documents branch.
  const hubDuplicateDocuments = (docs) => {
    const list = Array.isArray(docs) ? docs.filter(Boolean) : [];
    if (list.length === 0) return;
    const copies = list.map(d => ({ ...d, id: `${Date.now()}-${Math.random()}`, name: `${d.name} (Copy)` }));
    setDocuments(prev => [...copies, ...prev]);
  };

  // Move or copy the given documents to an existing project. Move re-parents
  // the real Supabase rows (project_id) — same call the legacy
  // handleMoveToProject "move to existing project" branch makes. Copy has no
  // clean single-call Supabase primitive, so it stays an optimistic local
  // copy (consistent with the legacy handleBulkCopy documents branch).
  const hubMoveCopyDocuments = async (docs, projectId, mode = 'move') => {
    const list = Array.isArray(docs) ? docs.filter(Boolean) : [];
    if (list.length === 0 || !projectId) return;
    if (!user) { alert('Please sign in to move documents'); return; }
    const targetProj = projects.find(p => p.id === projectId);
    if (!targetProj) return;

    if (mode === 'copy') {
      // TODO: no server-side document-copy primitive exists; this is an
      // optimistic local-only copy, matching the legacy handleBulkCopy
      // behavior. Wire a real copy primitive if/when one is added.
      const copies = list.map(d => ({
        ...d,
        id: `${Date.now()}-${Math.random()}`,
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
      alert('Failed to move documents: ' + (err.message || 'Unknown error'));
      await refetchDocuments();
    }
  };

  const hubToggleDocumentLock = async (doc) => {
    if (!doc?.id) return;
    if (!user) { alert('Please sign in to lock documents'); return; }
    if (doc.user_id && doc.user_id !== user.id) {
      alert('Only the document owner can lock or unlock this document.');
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
      alert(`Failed to ${isLocked ? 'unlock' : 'lock'} document: ${err.message || 'Unknown error'}`);
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
