/**
 * useDatabase.js — Supabase-backed CRUD hooks for the app's core entities.
 *
 * Exports useUserSettings, useProjects, useDocuments (owned + collaborator rows,
 * provenance stamping), useTemplates, useSpaces, useStorage (file up/download),
 * useConnectedServices, and useDocumentToolPreferences (localStorage + Supabase),
 * plus getOtherSurveysUsingTemplate and DEFAULT_TOOL_PREFERENCES / tool capability
 * tables. Each hook returns data + loading/error + create/update/delete + refetch.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, isSupabaseAvailable, isSchemaError, isConnectedServicesAvailable, setConnectedServicesAvailable } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { buildDocumentProvenance } from '../utils/documentProvenance.js';
import { coalesceRead } from './requestCoalescer.js';
import { createLibraryReadReconciler } from './libraryMutationState.js';
import { createLibraryMutationRunner } from './libraryMutationRunner.js';
import { resolveDocumentMetadata, invalidateDocumentMetadata } from '../services/documentMetadataResolver.js';
import { isScopedRequestCurrent } from './scopedRequestGuard.js';
import { subscribeLibraryChange } from './libraryChangeBus.js';
import { storageDownloads } from '../services/storageDownloads.js';
import { cleanupDocumentStorage } from '../services/documentStorageCleanup.js';
import { readLibraryRows, readLibraryIdChunks, sortLibraryRows } from './libraryPagination.js';
import { randomUUID } from '../utils/randomUUIDPolyfill.js';
import { queueToolPreferenceWrite } from './toolPreferenceWriteQueue.js';

const isSupabaseNotFoundError = (error) => {
  if (!error) return false;

  const code = String(error.code || '').toUpperCase();
  if (code === 'PGRST116') return true;

  if (error.status === 404 || error.statusCode === 404) return true;

  const message = String(error.message || '').toLowerCase();
  if (message.includes('no rows') || message.includes('not found')) return true;

  return false;
};

// ============================================
// PROJECTS HOOKS
// ============================================

export const useProjects = () => {
  const { user } = useAuth();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const projectScopeKey = user?.id || 'anonymous';
  const [loadedProjectReadScope, setLoadedProjectReadScope] = useState(null);
  const projectScopeKeyRef = useRef(projectScopeKey);
  const projectRequestRef = useRef(0);
  const projectMountedRef = useRef(true);
  const projectReadScopeRef = useRef(null);
  const projectReadRef = useRef(null);
  if (projectReadScopeRef.current?.key !== projectScopeKey) {
    projectReadScopeRef.current = { key: projectScopeKey, actorId: user?.id };
  }
  const projectReadScope = projectReadScopeRef.current;
  const [projectStateScope, setProjectStateScope] = useState(projectReadScope);
  const projectStateScopeRef = useRef(projectStateScope);
  projectStateScopeRef.current = projectStateScope;
  const initialLoading = !!(user && isSupabaseAvailable()) && loadedProjectReadScope !== projectReadScope;
  projectScopeKeyRef.current = projectScopeKey;
  const [error, setError] = useState(null);

  useEffect(() => {
    projectMountedRef.current = true;
    return () => {
      projectMountedRef.current = false;
      projectRequestRef.current += 1;
      projectReadRef.current?.controller.abort();
    };
  }, []);

  useEffect(() => {
    if (!user || !isSupabaseAvailable()) {
      projectRequestRef.current += 1;
      setProjects([]);
      setError(null);
      setLoading(false);
      setLoadedProjectReadScope(projectReadScope);
      setProjectStateScope(projectReadScope);
    } else {
      void fetchProjects({ initialScopeKey: projectScopeKey }).catch(() => undefined);
    }
    return () => {
      if (projectReadRef.current?.scope === projectReadScope) projectReadRef.current.controller.abort();
    };
  }, [projectReadScope]);

  // KAL-280 — restoring a project from Archive puts it back in this list. The
  // Archive screen is a sibling of the hub, not a parent, so it announces the
  // change rather than pushing rows down: subscribers simply refetch.
  useEffect(() => {
    if (!user || !isSupabaseAvailable()) return undefined;
    return subscribeLibraryChange(() => {
      fetchProjects({ initialScopeKey: projectScopeKey }).catch(() => {});
    });
  }, [projectReadScope]);

  const fetchProjects = async ({ initialScopeKey = null } = {}) => {
    const isCurrentScope = () => projectMountedRef.current && projectReadScopeRef.current === projectReadScope;
    if (!isCurrentScope() || !projectReadScope.actorId || !isSupabaseAvailable()) return [];
    const requestScopeKey = initialScopeKey || projectScopeKey;
    if (requestScopeKey !== projectScopeKey) return [];
    const requestId = ++projectRequestRef.current;
    projectReadRef.current?.controller.abort();
    const controller = new AbortController();
    const reconciler = createLibraryReadReconciler();
    projectReadRef.current = { scope: projectReadScope, controller, reconciler };
    const { signal } = controller;
    const isCurrentRequest = () => isCurrentScope() && !signal.aborted && isScopedRequestCurrent({
      requestId,
      latestRequestId: projectRequestRef.current,
      requestScopeKey,
      currentScopeKey: projectScopeKeyRef.current,
    });
    try {
      if (projectStateScopeRef.current !== projectReadScope) {
        projectStateScopeRef.current = projectReadScope;
        setProjectStateScope(projectReadScope);
        setProjects([]);
      }
      setLoading(true);
      setError(null);
      // KAL-285 — explicit column list instead of select('*'). The live
      // `projects` table has exactly these 8 columns (verified against prod
      // schema); Dashboard.jsx and this hook consume id/name/user_id directly
      // and sort/display off created_at/updated_at, so every real column is
      // kept rather than guessing which ones are unused.
      const projectColumns = 'id, user_id, name, description, color, archived, created_at, updated_at';
      const [ownedResult, collaboratorResult] = await Promise.all([
        readLibraryRows(() => supabase
          .from('projects')
          .select(projectColumns)
          .eq('user_id', projectReadScope.actorId)
          // KAL-280 — user-archived projects live in Archive, not the library.
          // Separate column from `archived` (the Free-tier downgrade flag).
          .is('user_archived_at', null), { signal }),
        readLibraryRows(() => supabase
          .from('project_collaborators')
          .select('project_id')
          .eq('user_id', projectReadScope.actorId)
          .eq('status', 'active'), { cursorColumn: 'project_id', signal }),
      ]);

      if (ownedResult.error) throw ownedResult.error;
      const ownedProjects = ownedResult.data || [];
      let collaboratorProjects = [];
      if (collaboratorResult.error) {
        // A failed membership probe is not an empty shared library. Keep the
        // last complete list and expose the error through the loader below.
        throw collaboratorResult.error;
      } else {
        const ownedIds = new Set(ownedProjects.map((project) => project.id));
        const missingIds = [...new Set((collaboratorResult.data || [])
          .map((row) => row.project_id)
          .filter(Boolean))]
          .filter((id) => !ownedIds.has(id));
        if (missingIds.length > 0) {
          const sharedResult = await readLibraryIdChunks(missingIds, (ids) => supabase
            .from('projects')
            .select(projectColumns)
            .in('id', ids)
            .is('user_archived_at', null), { signal });
          if (sharedResult.error) throw sharedResult.error;
          collaboratorProjects = sharedResult.data || [];
        }
      }

      const projectsData = [...new Map(
        [...ownedProjects, ...collaboratorProjects].map((project) => [project.id, project]),
      ).values()].sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0));
      if (!isCurrentRequest()) return [];
      const reconciled = reconciler.apply(projectsData);
      setProjects(reconciled);
      return reconciled;
    } catch (err) {
      if (!isCurrentRequest()) return [];
      setError(err.message);
      throw err; // Re-throw so callers can handle errors
    } finally {
      if (isCurrentRequest()) {
        setLoading(false);
        setLoadedProjectReadScope(projectReadScope);
      }
      if (projectReadRef.current?.controller === controller) projectReadRef.current = null;
      controller.abort();
    }
  };

  const mutateProject = createLibraryMutationRunner({
    client: supabase, scope: projectReadScope, scopeRef: projectReadScopeRef,
    mountedRef: projectMountedRef, readRef: projectReadRef,
    stateScopeRef: projectStateScopeRef, setStateScope: setProjectStateScope,
    setRows: setProjects, setError, available: isSupabaseAvailable,
  });

  const createProject = (input) => mutateProject(input, async (values, { request }) => {
    const { data, error } = await request(() => supabase.from('projects')
      .insert({ user_id: projectReadScope.actorId, ...values }).select().single());
    if (error) throw error;
    return data;
  }, row => ({ kind: 'upsert', row }));

  const updateProject = (id, updates) => mutateProject({ id, updates }, async (values, { request }) => {
    const { data, error } = await request(() => supabase.from('projects')
      .update(values.updates).eq('id', values.id).select().single());
    if (error) throw error;
    if (data?.id !== values.id) throw new Error('Invalid update response.');
    return data;
  }, row => ({ kind: 'update', row }));

  const deleteProject = (id) => mutateProject({ id }, async (values, { request }) => {
    const { error } = await request(() => supabase.from('projects').delete().eq('id', values.id));
    if (error) throw error;
  }, () => ({ kind: 'delete', id }));

  const hasCurrentProjectState = projectStateScope === projectReadScope;
  return {
    projects: hasCurrentProjectState ? projects : [],
    loading: hasCurrentProjectState ? loading : !!(user && isSupabaseAvailable()),
    initialLoading,
    error: hasCurrentProjectState ? error : null,
    createProject,
    updateProject,
    deleteProject,
    refetch: fetchProjects,
  };
};

// ============================================
// DOCUMENTS HOOKS
// ============================================

// Mutation-only consumers can opt out of library reads and invalidation events.
// Existing callers retain the full query behavior by default.
export const useDocuments = (projectId = null, { enabled = true } = {}) => {
  const { user, tier } = useAuth();
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(enabled);
  const documentScopeKey = `${user?.id || 'anonymous'}:${projectId ?? 'all'}:${enabled ? 'enabled' : 'disabled'}`;
  const [loadedDocumentReadScope, setLoadedDocumentReadScope] = useState(null);
  const documentScopeKeyRef = useRef(documentScopeKey);
  const documentRequestRef = useRef(0);
  const documentMountedRef = useRef(true);
  const documentReadScopeRef = useRef(null);
  const documentReadRef = useRef(null);
  const documentHasReadRef = useRef(false);
  if (documentReadScopeRef.current?.key !== documentScopeKey) {
    documentReadScopeRef.current = { key: documentScopeKey, actorId: user?.id, projectId,
      initialMount: !documentHasReadRef.current };
  }
  const documentReadScope = documentReadScopeRef.current;
  const [documentStateScope, setDocumentStateScope] = useState(documentReadScope);
  const documentStateScopeRef = useRef(documentStateScope);
  documentStateScopeRef.current = documentStateScope;
  const initialLoading = !!(enabled && user && isSupabaseAvailable()) && loadedDocumentReadScope !== documentReadScope;
  documentScopeKeyRef.current = documentScopeKey;
  const [error, setError] = useState(null);

  useEffect(() => {
    documentMountedRef.current = true;
    return () => {
      documentMountedRef.current = false;
      documentRequestRef.current += 1;
      documentReadRef.current?.controller.abort();
    };
  }, []);

  useEffect(() => {
    if (!enabled || !user || !isSupabaseAvailable()) {
      documentRequestRef.current += 1;
      setDocuments([]);
      setError(null);
      setLoading(false);
      setLoadedDocumentReadScope(documentReadScope);
      setDocumentStateScope(documentReadScope);
    } else {
      // Initial consumers share one sweep; reactivation starts fresh rather
      // than joining a retired scope's snapshot. Mutation-only viewers do not
      // read. The loader stores failures; this boot caller consumes rejection.
      void loadDocuments({ coalesce: documentReadScope.initialMount, initialScopeKey: documentScopeKey }).catch(() => undefined);
    }
    return () => {
      if (documentReadRef.current?.scope === documentReadScope) documentReadRef.current.controller.abort();
    };
  }, [documentReadScope]);

  // KAL-280 — same as projects: a document restored from Archive reappears
  // here without waiting for a remount. Not coalesced, because the archive
  // mutation has already landed and this read must see it.
  useEffect(() => {
    if (!enabled || !user || !isSupabaseAvailable()) return undefined;
    return subscribeLibraryChange(() => {
      void loadDocuments({ initialScopeKey: documentScopeKey }).catch(() => undefined);
    });
  }, [documentReadScope]);

  // Pure query worker: runs the owned + collaborator-probe + conditional id=in
  // sequence as ONE unit and RETURNS the merged array (no setState here), so it
  // can be shared verbatim across instances by the coalescer.
  const runDocumentsQuery = async (signal) => {
    const ownedQuery = () => {
      let query = supabase
        .from('documents')
        .select('*')
        .eq('user_id', documentReadScope.actorId)
        .eq('archived', false)
        // KAL-280 — user-archived documents live in Archive, not the library.
        // This is a SEPARATE column from `archived` above: that one is the
        // Free-tier downgrade flag, this one is the 30-day recoverable Archive.
        .is('user_archived_at', null);

      if (documentReadScope.projectId) query = query.eq('project_id', documentReadScope.projectId);
      return query;
    };

    // The owned-documents read and the collaborator probe are independent —
    // run them concurrently instead of as a 2-step waterfall. Supabase resolves
    // (never rejects) with {data,error}, so the throw-on-owned-error semantics
    // below are preserved (the dependent missingIds query stays sequential).
    const [ownedRes, collaboratorRows] = await Promise.all([
      readLibraryRows(ownedQuery, { signal }),
      readLibraryRows(() => supabase
        .from('document_collaborators')
        .select('document_id')
        .eq('user_id', documentReadScope.actorId)
        .eq('status', 'active'), { cursorColumn: 'document_id', signal }),
    ]);
    const { data, error } = ownedRes;
    if (error) throw error;

    let collaboratorDocuments = [];

    if (!collaboratorRows.error) {
      const collaboratorIds = [...new Set((collaboratorRows.data || [])
        .map((row) => row.document_id)
        .filter(Boolean))];
      const ownIds = new Set((data || []).map((doc) => doc.id));
      const missingIds = collaboratorIds.filter((id) => !ownIds.has(id));
      if (missingIds.length > 0) {
        const collaboratorResult = await readLibraryIdChunks(missingIds, (ids) => {
          let collaboratorQuery = supabase
            .from('documents')
            .select('*')
            .in('id', ids)
            .eq('archived', false)
            // KAL-280 — an archived document disappears for collaborators too.
            // The database enforces this as well (user_can_access_document
            // resolves only for the permanent owner while archived); filtering
            // here keeps the shared document out of the list in the first place.
            .is('user_archived_at', null);
          if (documentReadScope.projectId) collaboratorQuery = collaboratorQuery.eq('project_id', documentReadScope.projectId);
          return collaboratorQuery;
        }, { signal });
        if (collaboratorResult.error) throw collaboratorResult.error;
        collaboratorDocuments = collaboratorResult.data || [];
      }
    } else {
      // Do not replace the last complete library with an owned-only result
      // when any page of the shared-membership read fails.
      throw collaboratorRows.error;
    }

    const byId = new Map();
    for (const doc of [
      ...sortLibraryRows(data || [], 'updated_at'),
      ...sortLibraryRows(collaboratorDocuments, 'updated_at'),
    ]) {
      byId.set(doc.id, doc);
    }
    return [...byId.values()];
  };

  // Loader owns this instance's loading/error/state. `coalesce:true` shares the
  // in-flight read across instances (boot burst); the exposed `refetch` calls
  // with `coalesce:false` so a deliberate post-mutation refetch ALWAYS hits the
  // network and is never served a coalesced promise that predates the mutation.
  const loadDocuments = async ({ coalesce = false, initialScopeKey = null } = {}) => {
    const isCurrentScope = () => documentMountedRef.current && documentReadScopeRef.current === documentReadScope;
    if (!isCurrentScope() || !enabled || !documentReadScope.actorId || !isSupabaseAvailable()) return [];
    const requestScopeKey = initialScopeKey || documentScopeKey;
    if (requestScopeKey !== documentScopeKey) return [];
    documentHasReadRef.current = true;
    const requestId = ++documentRequestRef.current;
    documentReadRef.current?.controller.abort();
    const controller = new AbortController();
    const reconciler = createLibraryReadReconciler();
    documentReadRef.current = { scope: documentReadScope, controller, reconciler };
    const isCurrentRequest = () => isCurrentScope() && !controller.signal.aborted && isScopedRequestCurrent({
      requestId,
      latestRequestId: documentRequestRef.current,
      requestScopeKey,
      currentScopeKey: documentScopeKeyRef.current,
    });
    try {
      if (documentStateScopeRef.current !== documentReadScope) {
        documentStateScopeRef.current = documentReadScope;
        setDocumentStateScope(documentReadScope);
        setDocuments([]);
      }
      setLoading(true);
      setError(null);
      const key = `documents:${documentReadScope.actorId}:${documentReadScope.projectId ?? 'null'}`;
      const merged = coalesce
        ? await coalesceRead(key, runDocumentsQuery, { signal: controller.signal })
        : await runDocumentsQuery(controller.signal);
      if (!isCurrentRequest()) return [];
      const reconciled = reconciler.apply(merged);
      setDocuments(reconciled);
      return reconciled;
    } catch (err) {
      if (!isCurrentRequest()) return [];
      setError(err.message);
      throw err;
    } finally {
      if (isCurrentRequest()) {
        setLoading(false);
        setLoadedDocumentReadScope(documentReadScope);
      }
      if (documentReadRef.current?.controller === controller) documentReadRef.current = null;
      controller.abort();
    }
  };

  const mutateDocument = createLibraryMutationRunner({
    client: supabase, scope: documentReadScope, scopeRef: documentReadScopeRef,
    mountedRef: documentMountedRef, readRef: documentReadRef,
    stateScopeRef: documentStateScopeRef, setStateScope: setDocumentStateScope,
    setRows: setDocuments, setError, available: isSupabaseAvailable,
  });

  const createDocument = (documentData) => mutateDocument(documentData, async (values, { request }) => {
    // Keep caller provenance precedence and the same-project content dedup rule.
    const provenance = buildDocumentProvenance({ subscriptionTier: tier });
    const sha = values.content_sha256;
    const lookup = () => {
      let query = supabase.from('documents').select('*')
        .eq('user_id', documentReadScope.actorId).eq('content_sha256', sha).limit(1);
      query = values.project_id == null ? query.is('project_id', null) : query.eq('project_id', values.project_id);
      return query.maybeSingle();
    };
    if (sha) {
      const { data: existing, error } = await request(lookup, { write: false });
      if (error && !isSupabaseNotFoundError(error)) throw error;
      if (existing) {
        if (!existing.archived) return existing;
        const { data, error: reviveError } = await request(() => supabase.from('documents')
          .update({ archived: false, updated_at: new Date().toISOString() })
          .eq('id', existing.id).select().single());
        if (reviveError) throw reviveError;
        return data;
      }
    }
    const { data, error } = await request(() => supabase.from('documents')
      .insert({ user_id: documentReadScope.actorId, ...provenance, ...values }).select().single());
    // A confirmed unique violation is a dedup race, not an ambiguous transport
    // failure. Read the winner; never retry an unconfirmed insert.
    if (error?.code === '23505' && sha) {
      const { data: winner, error: retryError } = await request(lookup, { write: false });
      if (!retryError && winner) return winner;
    }
    if (error) throw error;
    return data;
  }, row => ({ kind: 'upsert', row }));

  const updateDocument = (id, updates) => mutateDocument({ id, updates }, async (values, { request }) => {
    const { data, error } = await request(() => supabase.from('documents')
      .update(values.updates).eq('id', values.id).select().single());
    if (error) throw error;
    if (data?.id !== values.id) throw new Error('Invalid update response.');
    return data;
  }, row => ({ kind: 'update', row }));

  const deleteDocument = (id) => mutateDocument({ id }, async (values, { request }) => {
    const { error } = await request(() => supabase.from('documents')
      .update({ archived: true, updated_at: new Date().toISOString() }).eq('id', values.id));
    if (error && !isSupabaseNotFoundError(error)) throw error;
  }, () => ({ kind: 'delete', id }));

  const updateLastOpened = (id) => mutateDocument({ id }, async (values, { request }) => {
    const { error } = await request(() => supabase.from('documents')
      .update({ last_opened_at: new Date().toISOString() }).eq('id', values.id));
    if (error) throw error;
  });

  const hasCurrentDocumentState = documentStateScope === documentReadScope;
  return {
    documents: hasCurrentDocumentState ? documents : [],
    loading: hasCurrentDocumentState ? loading : !!(enabled && user && isSupabaseAvailable()),
    initialLoading,
    error: hasCurrentDocumentState ? error : null,
    createDocument,
    updateDocument,
    deleteDocument,
    updateLastOpened,
    refetch: () => loadDocuments({ coalesce: false }),
  };
};

// ============================================
// TEMPLATES HOOKS
// ============================================

// Mutation/refetch-only consumers can opt out of automatic library reads.
// Explicit refetch always reads fresh, even when autoLoad is false.
export const useTemplates = ({ autoLoad = true } = {}) => {
  const { user } = useAuth();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(autoLoad);
  const templateScopeKey = user?.id || 'anonymous';
  const [loadedTemplateReadScope, setLoadedTemplateReadScope] = useState(null);
  const templateScopeKeyRef = useRef(templateScopeKey);
  const templateRequestRef = useRef(0);
  const templateMountedRef = useRef(true);
  const templateReadScopeRef = useRef(null);
  const templateReadRef = useRef(null);
  const templateHasReadRef = useRef(false);
  if (templateReadScopeRef.current?.key !== templateScopeKey
    || templateReadScopeRef.current?.autoLoad !== autoLoad) {
    templateReadScopeRef.current = {
      key: templateScopeKey, actorId: user?.id, autoLoad, initialMount: !templateHasReadRef.current,
    };
  }
  const templateReadScope = templateReadScopeRef.current;
  const [templateStateScope, setTemplateStateScope] = useState(templateReadScope);
  const templateStateScopeRef = useRef(templateStateScope);
  templateStateScopeRef.current = templateStateScope;
  const initialLoading = !!(autoLoad && user && isSupabaseAvailable()) && loadedTemplateReadScope !== templateReadScope;
  templateScopeKeyRef.current = templateScopeKey;
  const [error, setError] = useState(null);

  useEffect(() => {
    templateMountedRef.current = true;
    return () => {
      templateMountedRef.current = false;
      templateRequestRef.current += 1;
      templateReadRef.current?.controller.abort();
    };
  }, []);

  useEffect(() => {
    if (!autoLoad || !user || !isSupabaseAvailable()) {
      templateRequestRef.current += 1;
      setTemplateStateScope(templateReadScope);
      setTemplates([]);
      setError(null);
      setLoading(false);
      setLoadedTemplateReadScope(templateReadScope);
    } else {
      // Default consumers share their initial read. Reactivation starts fresh.
      // Keep the rejecting refetch contract; only boot consumes the rejection.
      void loadTemplates({ coalesce: templateReadScope.initialMount, initialScopeKey: templateScopeKey }).catch(() => undefined);
    }
    return () => {
      if (templateReadRef.current?.scope === templateReadScope) templateReadRef.current.controller.abort();
    };
  }, [templateReadScope]);

  // KAL-280 — a template restored from (or permanently deleted in) Archive has
  // to leave/rejoin this list without a reload, same as documents and projects.
  useEffect(() => {
    if (!autoLoad || !user || !isSupabaseAvailable()) return undefined;
    return subscribeLibraryChange(() => {
      void loadTemplates({ initialScopeKey: templateScopeKey }).catch(() => undefined);
    });
  }, [templateReadScope]);

  const runTemplatesQuery = async (signal) => {
    const { data, error } = await readLibraryRows(() => supabase
      .from('templates')
      .select('*')
      .eq('user_id', templateReadScope.actorId)
      // KAL-280 — user-archived templates live in Archive, not the library.
      .is('user_archived_at', null), { signal });
    if (error) throw error;
    return sortLibraryRows(data || [], 'created_at');
  };

  const loadTemplates = async ({ coalesce = false, initialScopeKey = null } = {}) => {
    const isCurrentScope = () => templateMountedRef.current && templateReadScopeRef.current === templateReadScope;
    if (!isCurrentScope() || !templateReadScope.actorId || !isSupabaseAvailable()) return [];
    const requestScopeKey = initialScopeKey || templateScopeKey;
    if (requestScopeKey !== templateScopeKey) return [];
    templateHasReadRef.current = true;
    const requestId = ++templateRequestRef.current;
    templateReadRef.current?.controller.abort();
    const controller = new AbortController();
    const reconciler = createLibraryReadReconciler();
    templateReadRef.current = { scope: templateReadScope, controller, reconciler };
    const isCurrentRequest = () => isCurrentScope() && !controller.signal.aborted && isScopedRequestCurrent({
      requestId,
      latestRequestId: templateRequestRef.current,
      requestScopeKey,
      currentScopeKey: templateScopeKeyRef.current,
    });
    try {
      if (templateStateScopeRef.current !== templateReadScope) {
        templateStateScopeRef.current = templateReadScope;
        setTemplateStateScope(templateReadScope);
        setTemplates([]);
      }
      setLoading(true);
      setError(null);
      const key = `templates:${templateReadScope.actorId}`;
      const rows = coalesce
        ? await coalesceRead(key, runTemplatesQuery, { signal: controller.signal })
        : await runTemplatesQuery(controller.signal);
      if (!isCurrentRequest()) return [];
      const reconciled = reconciler.apply(rows);
      setTemplates(reconciled);
      return reconciled;
    } catch (err) {
      if (!isCurrentRequest()) return [];
      setError(err.message);
      throw err;
    } finally {
      if (isCurrentRequest()) {
        setLoading(false);
        setLoadedTemplateReadScope(templateReadScope);
      }
      if (templateReadRef.current?.controller === controller) templateReadRef.current = null;
      controller.abort();
    }
  };

  const mutateTemplate = createLibraryMutationRunner({
    client: supabase, scope: templateReadScope, scopeRef: templateReadScopeRef,
    mountedRef: templateMountedRef, readRef: templateReadRef,
    stateScopeRef: templateStateScopeRef, setStateScope: setTemplateStateScope,
    setRows: setTemplates, setError, available: isSupabaseAvailable,
  });

  const createTemplate = (input) => mutateTemplate(input, async (values, { request }) => {
    const { data, error } = await request(() => supabase.from('templates')
      .insert({ user_id: templateReadScope.actorId, ...values }).select().single());
    if (error) throw error;
    return data;
  }, row => ({ kind: 'upsert', row }));

  const updateTemplate = (id, updates) => mutateTemplate({ id, updates }, async (values, { request }) => {
    const { data, error } = await request(() => supabase.from('templates')
      .update(values.updates).eq('id', values.id).select().single());
    if (error) throw error;
    if (data?.id !== values.id) throw new Error('Invalid update response.');
    return data;
  }, row => ({ kind: 'update', row }));

  const deleteTemplate = (id) => mutateTemplate({ id }, async (values, { request }) => {
    const { error } = await request(() => supabase.from('templates').delete().eq('id', values.id));
    if (error) throw error;
  }, () => ({ kind: 'delete', id }));

  const replaceTemplates = async (templateRows) => {
    if (!Array.isArray(templateRows)) throw new TypeError('Template snapshot must be an array.');
    return mutateTemplate(templateRows, async (capturedRows, { request }) => {
      const { data, error } = await request(() => supabase.rpc('replace_my_templates', {
        p_templates: capturedRows,
      }));
      if (error) throw error;
      if (!Array.isArray(data)) throw new TypeError('Invalid template response.');
      return data;
    }, rows => ({ kind: 'replace', rows }));
  };

  // Hide retired state in the render that changes actor/mode, before effects
  // start the new read or clear the prior state. Explicit disabled reads still
  // publish their own loading/error/rows normally within the same scope.
  const hasCurrentTemplateState = templateStateScope === templateReadScope;
  return {
    templates: hasCurrentTemplateState ? templates : [],
    loading: hasCurrentTemplateState ? loading : !!(autoLoad && user && isSupabaseAvailable()),
    initialLoading,
    error: hasCurrentTemplateState ? error : null,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    replaceTemplates,
    refetch: () => loadTemplates({ coalesce: false }),
  };
};

// ============================================
// TEMPLATE UTILITY FUNCTIONS
// ============================================

/**
 * Get all documents (surveys) using a specific template, excluding the current survey
 * Used to check if a template can be modified or if it's shared with other surveys
 * @param {string} templateId - The template ID to check
 * @param {string} currentSurveyId - The current survey/document ID to exclude
 * @returns {Promise<Array<{id: string, name: string}>>} - Array of other surveys using this template
 */
export async function getOtherSurveysUsingTemplate(templateId, currentSurveyId) {
  if (!isSupabaseAvailable()) {
    return [];
  }

  if (!templateId) {
    return [];
  }

  // Validate that templateId is a valid UUID format (Supabase requires UUID)
  // Skip local template IDs like "tpl-xxx" which aren't synced to Supabase
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(templateId)) {
    // Not a UUID - this is a local-only template, no other surveys can be using it
    return [];
  }

  try {
    // KAL-285: bounded — callers only need "is anyone else using this
    // template?" plus a few names for the confirm dialog; an unbounded
    // select could pull thousands of rows on a widely-used template.
    let query = supabase
      .from('documents')
      .select('id, name')
      .eq('template_id', templateId)
      .limit(100);

    // Exclude current survey if provided
    if (currentSurveyId) {
      query = query.neq('id', currentSurveyId);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error checking template usage:', error);
      throw error;
    }

    return data || [];
  } catch (err) {
    console.error('Error in getOtherSurveysUsingTemplate:', err);
    return [];
  }
}

// ============================================
// STORAGE HOOKS
// ============================================

export const useStorage = () => {
  const { user } = useAuth();

  const uploadDocument = useCallback(async (file, projectId, onProgress, contentSha = null) => {
    if (!user || !isSupabaseAvailable()) {
      throw new Error('User not authenticated or Supabase not available');
    }

    // Content-addressed path when we know the file's fingerprint: re-uploading
    // identical bytes overwrites the same object (idempotent, no duplicate).
    // Falls back to the legacy timestamp path when no hash is provided.
    let filePath;
    let upsert = false;
    if (contentSha) {
      filePath = `${user.id}/${contentSha}.pdf`;
      upsert = true;
    } else {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}.${fileExt}`;
      filePath = `${user.id}/${projectId}/${fileName}`;
    }

    const { data, error } = await supabase.storage
      .from('documents')
      .upload(filePath, file, {
        upsert,
        onUploadProgress: onProgress,
      });

    if (error) throw error;
    storageDownloads(supabase).invalidate(filePath);
    return filePath;
  }, [user]);

  const uploadDataFile = useCallback(async (data, filePath, onProgress) => {
    if (!user || !isSupabaseAvailable()) {
      throw new Error('User not authenticated or Supabase not available');
    }

    const { data: result, error } = await supabase.storage
      .from('documents')
      .upload(filePath, data, {
        upsert: true,
        contentType: 'application/json',
        onUploadProgress: onProgress,
      });

    if (error) throw error;
    storageDownloads(supabase).invalidate(filePath);
    return filePath;
  }, [user]);

  const replaceDocument = useCallback(async (file, filePath, onProgress) => {
    if (!user || !isSupabaseAvailable()) {
      throw new Error('User not authenticated or Supabase not available');
    }
    if (!filePath) throw new Error('Document storage path is required');
    const { error } = await supabase.storage
      .from('documents')
      .upload(filePath, file, {
        upsert: true,
        contentType: 'application/pdf',
        onUploadProgress: onProgress,
      });
    if (error) throw error;
    storageDownloads(supabase).invalidate(filePath);
    return filePath;
  }, [user]);

  const downloadDocument = useCallback(async (filePath) => {
    if (!isSupabaseAvailable()) {
      throw new Error('Supabase not available');
    }

    return storageDownloads(supabase).read(user?.id, filePath, async () => {
      const { data, error } = await supabase.storage
        .from('documents')
        .download(filePath);
      if (error) throw error;
      return data;
    });
  }, [user?.id]);

  const deleteDocumentFile = useCallback(async (filePath) => {
    if (!isSupabaseAvailable()) {
      throw new Error('Supabase not available');
    }

    const cleanup = await cleanupDocumentStorage(supabase, [filePath]);
    if (cleanup.pendingPaths.length > 0) {
      const error = new Error(cleanup.errors.join(' ') || 'Document storage cleanup is pending.');
      error.code = 'storage-cleanup-pending';
      throw error;
    }
    storageDownloads(supabase).invalidate(filePath);
  }, []);

  return {
    uploadDocument,
    replaceDocument,
    uploadDataFile,
    downloadDocument,
    deleteDocumentFile,
  };
};

// ============================================
// CONNECTED SERVICES HOOKS
// ============================================

/**
 * Hook for managing connected external services (Microsoft, Google, etc.)
 * Persists connection status to Supabase so services stay connected across sessions
 */
export const useConnectedServices = () => {
  const { user } = useAuth();
  const [services, setServices] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const serviceScopeKey = user?.id ?? null;
  const serviceScopeRef = useRef(serviceScopeKey);
  const serviceRequestRef = useRef(0);
  serviceScopeRef.current = serviceScopeKey;

  useEffect(() => {
    serviceRequestRef.current += 1;
    setServices({});
    setError(null);
    if (!user || !isSupabaseAvailable()) {
      setLoading(false);
      return;
    }

    fetchServices();
    return () => { serviceRequestRef.current += 1; };
  }, [serviceScopeKey]);

  const fetchServices = async () => {
    if (!user || !isSupabaseAvailable()) return;
    const requestId = ++serviceRequestRef.current;
    const isCurrentRequest = () => isScopedRequestCurrent({
      requestId,
      latestRequestId: serviceRequestRef.current,
      requestScopeKey: serviceScopeKey,
      currentScopeKey: serviceScopeRef.current,
    });

    // Skip if we already know the table isn't available
    if (isConnectedServicesAvailable() === false) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('connected_services')
        .select('*')
        .eq('user_id', user.id);
      if (!isCurrentRequest()) return;

      // Silently handle 406 errors (schema cache not ready)
      if (error) {
        console.error('[useConnectedServices] Error fetching:', error);
        if (isSchemaError(error)) {
          // Mark table as unavailable to prevent repeated requests
          setConnectedServicesAvailable(false);
          setLoading(false);
          return;
        }
        throw error;
      }

      // Table is available
      setConnectedServicesAvailable(true);


      // Convert array to object keyed by service_name for easier access
      const servicesMap = {};
      (data || []).forEach(service => {
        servicesMap[service.service_name] = service;
      });
      setServices(servicesMap);
    } catch (err) {
      if (!isCurrentRequest()) return;
      console.error('[useConnectedServices] Error fetching connected services:', err);
      setError(err.message);
    } finally {
      if (isCurrentRequest()) setLoading(false);
    }
  };

  const connectService = async (serviceName, accountData) => {
    if (!user || !isSupabaseAvailable()) return null;

    try {
      const serviceData = {
        user_id: user.id,
        service_name: serviceName,
        is_connected: true,
        account_id: accountData.accountId || null,
        account_email: accountData.email || null,
        account_name: accountData.name || null,
        metadata: accountData.metadata || {},
        connected_at: new Date().toISOString(),
        last_used_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from('connected_services')
        .upsert(serviceData, { onConflict: 'user_id,service_name' })
        .select()
        .single();

      if (error) throw error;

      if (serviceScopeRef.current !== serviceScopeKey) return data;
      setServices(prev => ({
        ...prev,
        [serviceName]: data
      }));

      return data;
    } catch (err) {
      console.error('Error connecting service:', err);
      if (serviceScopeRef.current === serviceScopeKey) setError(err.message);
      throw err;
    }
  };

  const disconnectService = async (serviceName) => {
    if (!user || !isSupabaseAvailable()) return;

    try {
      const { error } = await supabase
        .from('connected_services')
        .delete()
        .eq('user_id', user.id)
        .eq('service_name', serviceName);

      if (error) throw error;

      if (serviceScopeRef.current !== serviceScopeKey) return;
      setServices(prev => {
        const updated = { ...prev };
        delete updated[serviceName];
        return updated;
      });
    } catch (err) {
      console.error('Error disconnecting service:', err);
      if (serviceScopeRef.current === serviceScopeKey) setError(err.message);
      throw err;
    }
  };

  const updateServiceLastUsed = async (serviceName) => {
    if (!user || !isSupabaseAvailable()) return;

    try {
      await supabase
        .from('connected_services')
        .update({ last_used_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .eq('service_name', serviceName);
    } catch (err) {
      console.error('Error updating service last used:', err);
    }
  };

  const isServiceConnected = (serviceName) => {
    return services[serviceName]?.is_connected === true;
  };

  const getServiceInfo = (serviceName) => {
    return services[serviceName] || null;
  };

  return {
    services,
    loading,
    error,
    connectService,
    disconnectService,
    updateServiceLastUsed,
    isServiceConnected,
    getServiceInfo,
    refetch: fetchServices,
  };
};

// ============================================
// DOCUMENT TOOL PREFERENCES HOOKS
// ============================================

// Default preferences for each tool type
const DEFAULT_TOOL_PREFERENCES = {
  pen: { strokeColor: '#ff0000', strokeWidth: 3, strokeOpacity: 100 },
  highlighter: { strokeColor: '#ffff00', strokeWidth: 20, strokeOpacity: 50 },
  'text-highlight': { strokeColor: '#ffff00', strokeOpacity: 50 },
  eraser: { strokeWidth: 10 },
  rect: { strokeColor: '#ff0000', strokeWidth: 2, fillColor: '#ffffff', fillOpacity: 0, strokeOpacity: 100 },
  ellipse: { strokeColor: '#ff0000', strokeWidth: 2, fillColor: '#ffffff', fillOpacity: 0, strokeOpacity: 100 },
  line: { strokeColor: '#ff0000', strokeWidth: 2, strokeOpacity: 100 },
  arrow: { strokeColor: '#ff0000', strokeWidth: 2, strokeOpacity: 100 },
  callout: { strokeColor: '#ff0000', strokeWidth: 2, fillColor: '#ffffff', fillOpacity: 90, strokeOpacity: 100 },
  // Counter (Shottr-style numbered badge) — strokeColor is the circle fill;
  // strokeWidth is repurposed as the badge radius (px in page-space) so it shares
  // the bottom toolbar Size input wiring with all other shape tools.
  counter: { strokeColor: '#ef4444', strokeWidth: 14, strokeOpacity: 100 },
  text: { strokeColor: '#000000', strokeOpacity: 100 },
  note: { strokeColor: '#ffff00', fillColor: '#ffff00', strokeOpacity: 100, fillOpacity: 100 },
  underline: { strokeColor: '#ff0000', strokeOpacity: 100 },
  strikeout: { strokeColor: '#ff0000', strokeOpacity: 100 },
  squiggly: { strokeColor: '#ff0000', strokeOpacity: 100 },
  surveyMarker: { strokeColor: '#ffff00', strokeOpacity: 50 },
};

/**
 * Hook for managing per-document, per-tool preferences
 * Stores preferences in localStorage keyed by document ID
 * Optionally syncs to Supabase if user is authenticated and document exists in DB
 */
export const useDocumentToolPreferences = (documentId, supabaseDocId = null) => {
  const { user } = useAuth();
  const preferenceScope = JSON.stringify([user?.id ?? null, documentId, supabaseDocId]);
  const preferenceScopeRef = useRef(preferenceScope);
  const preferenceRequestRef = useRef(0);
  const preferenceSaveRef = useRef({ timer: null, generation: 0, activeScope: null, drafts: new Map() });
  const pendingDraftKey = `toolPrefsPending_${preferenceScope}`;
  const readPendingDraft = () => {
    const memory = preferenceSaveRef.current.drafts.get(preferenceScope);
    if (memory && !memory.durable) return memory;
    const raw = localStorage.getItem(pendingDraftKey);
    if (!raw) return null;
    const record = JSON.parse(raw);
    if (record.version !== 1 || typeof record.revision !== 'string' || !record.preferences
      || typeof record.preferences !== 'object' || Array.isArray(record.preferences)) {
      throw new Error('The pending tool settings could not be read. They were kept for recovery.');
    }
    return { raw, preferences: record.preferences, durable: true };
  };
  preferenceScopeRef.current = preferenceScope;
  const [toolPreferences, setToolPreferences] = useState(() => {
    // Initialize from localStorage if available
    if (documentId) {
      try {
        const draft = readPendingDraft();
        if (draft) return draft.preferences;
        const saved = localStorage.getItem(`toolPrefs_${documentId}`);
        if (saved) {
          return JSON.parse(saved);
        }
      } catch (e) {
        console.error('Error loading tool preferences from localStorage:', e);
      }
    }
    return { ...DEFAULT_TOOL_PREFERENCES };
  });
  const [loading, setLoading] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const schedulePendingDraft = (draft) => {
    const pending = preferenceSaveRef.current;
    if (!draft.durable || !supabaseDocId || !user || !isSupabaseAvailable()) return;
    const saveGeneration = ++pending.generation;
    const isCurrentSave = () => pending.activeScope === preferenceScope
      && preferenceScopeRef.current === preferenceScope && pending.generation === saveGeneration;
    clearTimeout(pending.timer);
    pending.timer = setTimeout(() => {
      if (!isCurrentSave()) return;
      pending.timer = null;
      return queueToolPreferenceWrite(supabase, user.id, supabaseDocId, async () => {
        if (!isCurrentSave()) return;
        try {
          const { data, error: sessionError } = await supabase.auth.getSession();
          if (!isCurrentSave()) return;
          if (sessionError) throw sessionError;
          const session = data?.session;
          if (session?.user?.id !== user.id || !session?.access_token) return;
          // Another mounted view may have saved a newer pending revision while
          // this job waited for a write slot or session refresh.
          if (localStorage.getItem(pendingDraftKey) !== draft.raw) return;
          const { data: saved, error } = await supabase
            .from('documents')
            .update({ tool_preferences: draft.preferences })
            .eq('id', supabaseDocId)
            .select('id')
            .setHeader('Authorization', `Bearer ${session.access_token}`)
            .maybeSingle();
          if (error) throw error;
          if (saved?.id !== supabaseDocId) throw new Error('Tool settings were not accepted. The pending draft was kept.');
          invalidateDocumentMetadata(supabaseDocId);
          if (pending.activeScope === preferenceScope && preferenceScopeRef.current === preferenceScope) {
            preferenceRequestRef.current += 1;
          }
          // An old receipt must not clear a newer local edit, even after close.
          if (localStorage.getItem(pendingDraftKey) === draft.raw) localStorage.removeItem(pendingDraftKey);
          if (pending.drafts.get(preferenceScope)?.raw === draft.raw) pending.drafts.delete(preferenceScope);
          if (isCurrentSave()) setSaveError(null);
        } catch (err) {
          if (isCurrentSave()) setSaveError(err.message || 'Tool settings could not sync. The pending draft was kept.');
        }
      });
    }, 500);
  };

  useEffect(() => {
    const pending = preferenceSaveRef.current;
    pending.activeScope = preferenceScope;
    return () => {
      pending.activeScope = null;
      pending.generation += 1;
      clearTimeout(pending.timer);
      pending.timer = null;
    };
  }, [preferenceScope]);

  // Load preferences when documentId changes
  useEffect(() => {
    preferenceRequestRef.current += 1;
    setLoading(false);
    setSaveError(null);
    if (!documentId) {
      setToolPreferences({ ...DEFAULT_TOOL_PREFERENCES });
      return;
    }

    // Load from localStorage first
    try {
      const draft = readPendingDraft();
      if (draft) {
        setToolPreferences(draft.preferences);
        if (draft.durable) schedulePendingDraft(draft);
        else setSaveError('Tool settings are not saved on this device. Keep this document open and try again.');
        return () => { preferenceRequestRef.current += 1; };
      }
      const saved = localStorage.getItem(`toolPrefs_${documentId}`);
      if (saved) {
        setToolPreferences(JSON.parse(saved));
      } else {
        setToolPreferences({ ...DEFAULT_TOOL_PREFERENCES });
      }
    } catch (e) {
      console.error('Error loading tool preferences:', e);
      setSaveError(e.message || 'Tool settings could not be read.');
      return () => { preferenceRequestRef.current += 1; };
    }

    // If we have a Supabase document ID and user, fetch from DB
    if (supabaseDocId && user && isSupabaseAvailable()) {
      fetchFromSupabase();
    }
    return () => { preferenceRequestRef.current += 1; };
  }, [preferenceScope]);

  const fetchFromSupabase = async () => {
    if (!supabaseDocId || !user || !isSupabaseAvailable()) return;
    const requestId = ++preferenceRequestRef.current;
    const isCurrentRequest = () => isScopedRequestCurrent({
      requestId,
      latestRequestId: preferenceRequestRef.current,
      requestScopeKey: preferenceScope,
      currentScopeKey: preferenceScopeRef.current,
    });

    try {
      setLoading(true);
      const draft = readPendingDraft();
      if (draft) {
        setToolPreferences(draft.preferences);
        schedulePendingDraft(draft);
        return;
      }
      const meta = await resolveDocumentMetadata(supabaseDocId);
      if (!isCurrentRequest()) return;
      if (readPendingDraft()) return;

      if (meta.toolPreferences) {
        // Merge with defaults to ensure all tools have preferences
        const merged = { ...DEFAULT_TOOL_PREFERENCES, ...meta.toolPreferences };
        setToolPreferences(merged);
        // Also save to localStorage for offline access
        if (documentId) {
          localStorage.setItem(`toolPrefs_${documentId}`, JSON.stringify(merged));
        }
      }
    } catch (err) {
      console.error('Error fetching tool preferences:', err);
    } finally {
      if (isCurrentRequest()) setLoading(false);
    }
  };

  // Update preferences for a specific tool
  const updateToolPreference = useCallback((toolId, updates) => {
    const pending = preferenceSaveRef.current;
    if (pending.activeScope !== preferenceScope || preferenceScopeRef.current !== preferenceScope) return;
    pending.generation += 1;
    clearTimeout(pending.timer);
    pending.timer = null;
    // A read begun before this local edit must not overwrite it when it lands.
    preferenceRequestRef.current += 1;
    setLoading(false);
    setToolPreferences(prev => {
      const currentToolPrefs = prev[toolId] || DEFAULT_TOOL_PREFERENCES[toolId] || {};
      const newPrefs = {
        ...prev,
        [toolId]: { ...currentToolPrefs, ...updates }
      };

      // Persist the actor/document-scoped pending revision BEFORE the debounce.
      // A failed write stays in memory, but is never labelled durable or synced.
      let draft = null;
      if (supabaseDocId && user) {
        const raw = JSON.stringify({ version: 1, revision: randomUUID(), preferences: newPrefs });
        draft = { raw, preferences: newPrefs, durable: false };
        pending.drafts.set(preferenceScope, draft);
        try {
          localStorage.setItem(pendingDraftKey, raw);
          if (localStorage.getItem(pendingDraftKey) !== raw) throw new Error('Tool settings could not be verified on this device.');
          draft.durable = true;
          setSaveError(null);
        } catch (err) {
          setSaveError(err.message || 'Tool settings are not saved on this device. Keep this document open and try again.');
        }
      }

      // Save to localStorage
      if (documentId) {
        try {
          localStorage.setItem(`toolPrefs_${documentId}`, JSON.stringify(newPrefs));
        } catch (e) {
          console.error('Error saving tool preferences to localStorage:', e);
          if (!draft?.durable) setSaveError(e.message || 'Tool settings are not saved on this device.');
        }
      }

      // Debounced save to Supabase
      if (draft?.durable) schedulePendingDraft(draft);

      return newPrefs;
    });
  }, [documentId, supabaseDocId, user, preferenceScope]);

  // Get preferences for a specific tool (with defaults)
  const getToolPreference = useCallback((toolId) => {
    return toolPreferences[toolId] || DEFAULT_TOOL_PREFERENCES[toolId] || {};
  }, [toolPreferences]);

  return {
    toolPreferences,
    updateToolPreference,
    getToolPreference,
    loading,
    saveError,
    refetch: fetchFromSupabase,
  };
};
