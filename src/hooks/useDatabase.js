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
  const [loadedProjectScopeKey, setLoadedProjectScopeKey] = useState(null);
  const initialLoading = loadedProjectScopeKey !== projectScopeKey;
  const projectScopeKeyRef = useRef(projectScopeKey);
  const projectRequestRef = useRef(0);
  projectScopeKeyRef.current = projectScopeKey;
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!user || !isSupabaseAvailable()) {
      projectRequestRef.current += 1;
      setProjects([]);
      setError(null);
      setLoading(false);
      setLoadedProjectScopeKey(projectScopeKey);
      return;
    }

    void fetchProjects({ initialScopeKey: projectScopeKey }).catch(() => undefined);
  }, [user]);

  // KAL-280 — restoring a project from Archive puts it back in this list. The
  // Archive screen is a sibling of the hub, not a parent, so it announces the
  // change rather than pushing rows down: subscribers simply refetch.
  useEffect(() => {
    if (!user || !isSupabaseAvailable()) return undefined;
    return subscribeLibraryChange(() => {
      fetchProjects({ initialScopeKey: projectScopeKeyRef.current }).catch(() => {});
    });
  }, [user]);

  const fetchProjects = async ({ initialScopeKey = null } = {}) => {
    const requestScopeKey = initialScopeKey || projectScopeKey;
    const requestId = ++projectRequestRef.current;
    const isCurrentRequest = () => isScopedRequestCurrent({
      requestId,
      latestRequestId: projectRequestRef.current,
      requestScopeKey,
      currentScopeKey: projectScopeKeyRef.current,
    });
    try {
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
          .eq('user_id', user.id)
          // KAL-280 — user-archived projects live in Archive, not the library.
          // Separate column from `archived` (the Free-tier downgrade flag).
          .is('user_archived_at', null)),
        readLibraryRows(() => supabase
          .from('project_collaborators')
          .select('project_id')
          .eq('user_id', user.id)
          .eq('status', 'active'), { cursorColumn: 'project_id' }),
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
            .is('user_archived_at', null));
          if (sharedResult.error) throw sharedResult.error;
          collaboratorProjects = sharedResult.data || [];
        }
      }

      const projectsData = [...new Map(
        [...ownedProjects, ...collaboratorProjects].map((project) => [project.id, project]),
      ).values()].sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0));
      if (!isCurrentRequest()) return [];
      setProjects(projectsData);
      return projectsData; // Return the data so callers can use it immediately
    } catch (err) {
      if (!isCurrentRequest()) return [];
      setError(err.message);
      throw err; // Re-throw so callers can handle errors
    } finally {
      if (isCurrentRequest()) {
        setLoading(false);
        setLoadedProjectScopeKey(requestScopeKey);
      }
    }
  };

  const createProject = async (projectData) => {
    if (!user || !isSupabaseAvailable()) return;

    try {
      const { data, error } = await supabase
        .from('projects')
        .insert({ user_id: user.id, ...projectData })
        .select()
        .single();

      if (error) throw error;
      setProjects((current) => [data, ...current]);
      return data;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const updateProject = async (id, updates) => {
    try {
      const { data, error } = await supabase
        .from('projects')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      setProjects((current) => current.map((p) => (p.id === id ? data : p)));
      return data;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const deleteProject = async (id) => {
    try {
      const { error } = await supabase.from('projects').delete().eq('id', id);

      if (error) throw error;
      setProjects((current) => current.filter((p) => p.id !== id));
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  return {
    projects,
    loading,
    initialLoading,
    error,
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
  const [loadedDocumentScopeKey, setLoadedDocumentScopeKey] = useState(null);
  const initialLoading = enabled && loadedDocumentScopeKey !== documentScopeKey;
  const documentScopeKeyRef = useRef(documentScopeKey);
  const documentRequestRef = useRef(0);
  documentScopeKeyRef.current = documentScopeKey;
  const [error, setError] = useState(null);


  useEffect(() => {
    if (!enabled || !user || !isSupabaseAvailable()) {
      documentRequestRef.current += 1;
      setDocuments([]);
      setError(null);
      setLoading(false);
      setLoadedDocumentScopeKey(documentScopeKey);
      return;
    }

    // Boot/dep-change load goes through the coalescer so the simultaneous burst
    // from the live library consumers collapses to ONE round-trip. See KAL-251.
    // PDFViewer uses mutation-only mode and never starts this read.
    // The loader records the failure in hook state, then rejects so explicit
    // refetch callers can react to it. This boot-only caller has no awaiter,
    // so consume that rejection after state is updated instead of leaking an
    // unhandled promise rejection into Expo/WebView.
    void loadDocuments({ coalesce: true, initialScopeKey: documentScopeKey }).catch(() => undefined);
  }, [user, projectId, enabled]);

  // KAL-280 — same as projects: a document restored from Archive reappears
  // here without waiting for a remount. Not coalesced, because the archive
  // mutation has already landed and this read must see it.
  useEffect(() => {
    if (!enabled || !user || !isSupabaseAvailable()) return undefined;
    return subscribeLibraryChange(() => {
      void loadDocuments({ initialScopeKey: documentScopeKeyRef.current }).catch(() => undefined);
    });
  }, [user, projectId, enabled]);

  // Pure query worker: runs the owned + collaborator-probe + conditional id=in
  // sequence as ONE unit and RETURNS the merged array (no setState here), so it
  // can be shared verbatim across instances by the coalescer.
  const runDocumentsQuery = async () => {
    const ownedQuery = () => {
      let query = supabase
        .from('documents')
        .select('*')
        .eq('user_id', user.id)
        .eq('archived', false)
        // KAL-280 — user-archived documents live in Archive, not the library.
        // This is a SEPARATE column from `archived` above: that one is the
        // Free-tier downgrade flag, this one is the 30-day recoverable Archive.
        .is('user_archived_at', null);

      if (projectId) query = query.eq('project_id', projectId);
      return query;
    };

    // The owned-documents read and the collaborator probe are independent —
    // run them concurrently instead of as a 2-step waterfall. Supabase resolves
    // (never rejects) with {data,error}, so the throw-on-owned-error semantics
    // below are preserved (the dependent missingIds query stays sequential).
    const [ownedRes, collaboratorRows] = await Promise.all([
      readLibraryRows(ownedQuery),
      readLibraryRows(() => supabase
        .from('document_collaborators')
        .select('document_id')
        .eq('user_id', user.id)
        .eq('status', 'active'), { cursorColumn: 'document_id' }),
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
          if (projectId) collaboratorQuery = collaboratorQuery.eq('project_id', projectId);
          return collaboratorQuery;
        });
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
    if (!enabled || !user || !isSupabaseAvailable()) return [];
    const requestScopeKey = initialScopeKey || documentScopeKey;
    const requestId = ++documentRequestRef.current;
    const isCurrentRequest = () => isScopedRequestCurrent({
      requestId,
      latestRequestId: documentRequestRef.current,
      requestScopeKey,
      currentScopeKey: documentScopeKeyRef.current,
    });
    try {
      setLoading(true);
      setError(null);
      const key = `documents:${user.id}:${projectId ?? 'null'}`;
      const merged = coalesce
        ? await coalesceRead(key, runDocumentsQuery)
        : await runDocumentsQuery();
      if (!isCurrentRequest()) return [];
      setDocuments(merged);
      return merged;
    } catch (err) {
      if (!isCurrentRequest()) return [];
      setError(err.message);
      throw err;
    } finally {
      if (isCurrentRequest()) {
        setLoading(false);
        setLoadedDocumentScopeKey(requestScopeKey);
      }
    }
  };

  const createDocument = async (documentData) => {
    if (!user || !isSupabaseAvailable()) return;

    // 2026-04-30 — stamp provenance metadata into every new document row:
    // device the upload happened on (mac / windows / web / dev / mobile),
    // the user's tier at upload time (free / pro / enterprise), and the app
    // version that produced this row. Columns added by the
    // 20260430000001_add_document_provenance migration. Caller-supplied
    // documentData keys WIN if they collide (rare; mostly used for tests).
    const provenance = buildDocumentProvenance({ subscriptionTier: tier });

    try {
      // Content-addressed dedup: the same bytes in the same project are ONE
      // document. If a matching row already exists (even archived), reuse it —
      // un-archiving as needed — instead of spawning a duplicate/blank copy.
      const sha = documentData.content_sha256;
      if (sha) {
        let lookup = supabase
          .from('documents')
          .select('*')
          .eq('user_id', user.id)
          .eq('content_sha256', sha)
          .limit(1);
        lookup = (documentData.project_id == null)
          ? lookup.is('project_id', null)
          : lookup.eq('project_id', documentData.project_id);
        const { data: existing, error: lookupErr } = await lookup.maybeSingle();
        if (lookupErr && !isSupabaseNotFoundError(lookupErr)) throw lookupErr;
        if (existing) {
          if (existing.archived) {
            const { data: revived, error: reviveErr } = await supabase
              .from('documents')
              .update({ archived: false, updated_at: new Date().toISOString() })
              .eq('id', existing.id)
              .select()
              .single();
            if (reviveErr) throw reviveErr;
            setDocuments((current) => [revived, ...current.filter((d) => d.id !== revived.id)]);
            return revived;
          }
          setDocuments((current) => [existing, ...current.filter((d) => d.id !== existing.id)]);
          return existing;
        }
      }

      const { data, error } = await supabase
        .from('documents')
        .insert({
          user_id: user.id,
          ...provenance,
          ...documentData,
        })
        .select()
        .single();

      // KAL-267: two near-simultaneous uploads of identical bytes can both pass
      // the SELECT dedup check above; the loser's insert then trips the unique
      // content-hash index (23505). That's a dedup HIT, not a failure — fetch
      // and reuse the winner's row.
      if (error && error.code === '23505' && sha) {
        let retry = supabase
          .from('documents')
          .select('*')
          .eq('user_id', user.id)
          .eq('content_sha256', sha)
          .limit(1);
        retry = (documentData.project_id == null)
          ? retry.is('project_id', null)
          : retry.eq('project_id', documentData.project_id);
        const { data: winner, error: retryErr } = await retry.maybeSingle();
        if (!retryErr && winner) {
          setDocuments((current) => [winner, ...current.filter((d) => d.id !== winner.id)]);
          return winner;
        }
      }

      if (error) throw error;
      setDocuments((current) => [data, ...current]);
      return data;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const updateDocument = async (id, updates) => {
    try {
      const { data, error } = await supabase
        .from('documents')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      setDocuments((current) => current.map((d) => (d.id === id ? data : d)));
      return data;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const deleteDocument = async (id) => {
    try {
      const { error } = await supabase
        .from('documents')
        .update({ archived: true, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (error && !isSupabaseNotFoundError(error)) throw error;
      setDocuments((current) => current.filter((d) => d.id !== id));
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const updateLastOpened = async (id) => {
    try {
      await supabase
        .from('documents')
        .update({ last_opened_at: new Date().toISOString() })
        .eq('id', id);
    } catch (err) {
      console.error('Error updating last opened:', err);
    }
  };

  return {
    documents,
    loading,
    initialLoading,
    error,
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
  if (templateReadScopeRef.current?.key !== templateScopeKey
    || templateReadScopeRef.current?.autoLoad !== autoLoad) {
    templateReadScopeRef.current = {
      key: templateScopeKey, autoLoad, initialMount: templateReadScopeRef.current === null,
    };
  }
  const templateReadScope = templateReadScopeRef.current;
  const [templateStateScope, setTemplateStateScope] = useState(templateReadScope);
  const templateStateScopeRef = useRef(templateStateScope);
  templateStateScopeRef.current = templateStateScope;
  const initialLoading = autoLoad && loadedTemplateReadScope !== templateReadScope;
  templateScopeKeyRef.current = templateScopeKey;
  const [error, setError] = useState(null);

  useEffect(() => {
    templateMountedRef.current = true;
    return () => {
      templateMountedRef.current = false;
      templateRequestRef.current += 1;
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
      return;
    }

    // Default consumers still share their initial boot read. Reactivation and
    // account changes must not rejoin a retired scope's in-flight snapshot.
    // Preserve loadTemplates' rejecting refetch contract while consuming the
    // boot-only rejection after it has populated the hook's error state.
    void loadTemplates({ coalesce: templateReadScope.initialMount, initialScopeKey: templateScopeKey }).catch(() => undefined);
  }, [templateScopeKey, autoLoad]);

  // KAL-280 — a template restored from (or permanently deleted in) Archive has
  // to leave/rejoin this list without a reload, same as documents and projects.
  useEffect(() => {
    if (!autoLoad || !user || !isSupabaseAvailable()) return undefined;
    return subscribeLibraryChange(() => {
      void loadTemplates({ initialScopeKey: templateScopeKeyRef.current }).catch(() => undefined);
    });
  }, [templateScopeKey, autoLoad]);

  const runTemplatesQuery = async () => {
    const { data, error } = await readLibraryRows(() => supabase
      .from('templates')
      .select('*')
      .eq('user_id', user.id)
      // KAL-280 — user-archived templates live in Archive, not the library.
      .is('user_archived_at', null));
    if (error) throw error;
    return sortLibraryRows(data || [], 'created_at');
  };

  const loadTemplates = async ({ coalesce = false, initialScopeKey = null } = {}) => {
    const isCurrentScope = () => templateMountedRef.current && templateReadScopeRef.current === templateReadScope;
    if (!isCurrentScope() || !user || !isSupabaseAvailable()) return [];
    const requestScopeKey = initialScopeKey || templateScopeKey;
    const requestId = ++templateRequestRef.current;
    const isCurrentRequest = () => isCurrentScope() && isScopedRequestCurrent({
      requestId,
      latestRequestId: templateRequestRef.current,
      requestScopeKey,
      currentScopeKey: templateScopeKeyRef.current,
    });
    try {
      if (templateStateScopeRef.current !== templateReadScope) {
        setTemplateStateScope(templateReadScope);
        setTemplates([]);
      }
      setLoading(true);
      setError(null);
      const key = `templates:${user.id}`;
      const rows = coalesce
        ? await coalesceRead(key, runTemplatesQuery)
        : await runTemplatesQuery();
      if (!isCurrentRequest()) return [];
      setTemplates(rows);
      return rows;
    } catch (err) {
      if (!isCurrentRequest()) return [];
      setError(err.message);
      throw err;
    } finally {
      if (isCurrentRequest()) {
        setLoading(false);
        setLoadedTemplateReadScope(templateReadScope);
      }
    }
  };

  const createTemplate = async (templateData) => {
    if (!user || !isSupabaseAvailable()) return;

    try {
      const { data, error } = await supabase
        .from('templates')
        .insert({ user_id: user.id, ...templateData })
        .select()
        .single();

      if (error) throw error;
      setTemplates((current) => [data, ...current]);
      return data;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const updateTemplate = async (id, updates) => {
    try {
      const { data, error } = await supabase
        .from('templates')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      setTemplates((current) => current.map((t) => (t.id === id ? data : t)));
      return data;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const deleteTemplate = async (id) => {
    try {
      const { error } = await supabase.from('templates').delete().eq('id', id);

      if (error) throw error;
      setTemplates((current) => current.filter((t) => t.id !== id));
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const replaceTemplates = async (templateRows) => {
    if (!user || !isSupabaseAvailable()) return [];
    if (!Array.isArray(templateRows)) {
      throw new TypeError('Template snapshot must be an array.');
    }
    try {
      setError(null);
      const { data, error } = await supabase.rpc('replace_my_templates', {
        p_templates: templateRows,
      });
      if (error) throw error;
      const rows = Array.isArray(data) ? data : [];
      setTemplates(rows);
      return rows;
    } catch (err) {
      setError(err.message);
      throw err;
    }
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
