/**
 * Document Annotation Sync Service
 * Handles real-time sync of annotations to/from Supabase
 * Uses document-based architecture (not template-based)
 */

import { supabase } from '../supabaseClient';
import { diffDeletedHighlightIds } from './highlightSyncDiff.js';
import { highlightSyncDiag } from './highlightSyncDiag.js';
import { chunkRowsForAnnotationUpsert } from '../utils/annotationBatching.js';
import {
  buildSurveyMarkerRow,
  mapSurveyMarkerRowToLocalAnnotation,
} from './documentSurveyMarkerMapper.js';

const SUPABASE_PAGE_SIZE = 1000;

const isLegacyFabricHighlightRow = (row) =>
  row?.annotation_type === 'highlight' && !!row.annotation_data?.fabricObject;

const classifyAnnotationSyncError = (error) => {
  const message = error?.message || '';
  const code = error?.code || null;
  const status = Number(error?.status) || null;
  const normalizedMessage = typeof message === 'string' ? message.toLowerCase() : '';
  const isRLSError = code === '42501' || normalizedMessage.includes('row-level security');
  const isMissingTable = code === '42P01';
  const isNotFound = status === 404 || normalizedMessage.includes('404') || normalizedMessage.includes('not found');

  if (isRLSError) {
    return {
      errorClass: 'RLS',
      nonRetryable: true,
      isRLSError: true
    };
  }

  if (isMissingTable) {
    return {
      errorClass: 'SCHEMA_MISSING',
      nonRetryable: true,
      isRLSError: false
    };
  }

  if (isNotFound) {
    return {
      errorClass: 'NOT_FOUND',
      nonRetryable: true,
      isRLSError: false
    };
  }

  return {
    errorClass: code || 'UNKNOWN',
    nonRetryable: false,
    isRLSError: false
  };
};

// ============================================
// ANNOTATION CRUD OPERATIONS
// ============================================

/**
 * Get all HIGHLIGHT annotations for a document.
 *
 * 2026-04-27 — ROOT CAUSE FIX. This function used to return EVERY row in
 * `document_annotations` regardless of `annotation_type`, which caused the
 * cross-device data-loss bug: when a device loaded a document that had an
 * ink stroke (annotation_type='ink') in the cloud, the row got pulled into
 * the legacy `highlightAnnotations` state map with empty/null highlight
 * fields. The legacy sync useEffect then immediately re-pushed the same
 * row with `annotation_type: 'highlight'` and `bounds: {}`, OVERWRITING
 * the ink stroke's annotation_data via the (document_id, highlight_id)
 * upsert conflict resolution. The new cloud-sync hook on every device
 * filters its hydrate query by NON_HIGHLIGHT_TYPES, so the now-corrupted
 * row was excluded and devices showed empty pages on next refresh.
 *
 * Filtering this loader by annotation_type='highlight' keeps the legacy
 * highlight pipeline strictly highlight-only, so ink/shape/text/callout
 * rows owned by the new cloud-sync hook are never round-tripped through
 * highlight format.
 */
export async function getDocumentAnnotations(documentId) {
  if (!documentId) return { data: [], error: null };

  const rows = [];
  for (let from = 0; ; from += SUPABASE_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('document_annotations')
      .select('*')
      .eq('document_id', documentId)
      .eq('annotation_type', 'highlight')
      .order('page_number', { ascending: true })
      .range(from, from + SUPABASE_PAGE_SIZE - 1);

    if (error) {
      console.error('[AnnotationSync] Error fetching annotations:', error);
      return { data: [], error };
    }

    rows.push(...(data || []));
    if (!data || data.length < SUPABASE_PAGE_SIZE) break;
  }

  const filteredRows = rows.filter((row) => !isLegacyFabricHighlightRow(row));
  // Bug 1/2 diag — count what the legacy hydrate kept versus dropped. If a
  // highlight ever shows up DARKER on the second device, this log + the SVG
  // layer's surveyHighlightSkip log answer "did the same row come through
  // both legacy and new paths" in a single paste.
  highlightSyncDiag('load.legacy', {
    documentId,
    totalRows: rows.length,
    fabricCarryingDropped: rows.length - filteredRows.length,
    keptCount: filteredRows.length,
    keptIds: filteredRows.map((r) => r.highlight_id),
  });
  return { data: filteredRows, error: null };
}

/**
 * Upsert a single annotation (insert or update)
 */
export async function upsertAnnotation(annotation) {
  const { data, error } = await supabase
    .from('document_annotations')
    .upsert(annotation, {
      onConflict: 'document_id,highlight_id',
      ignoreDuplicates: false
    })
    .select()
    .single();

  if (error) {
    console.error('[AnnotationSync] Error upserting annotation:', error);
    return { data: null, error };
  }

  return { data, error: null };
}

/**
 * Upsert multiple annotations in batch
 */
export async function upsertAnnotations(annotations) {
  if (!annotations || annotations.length === 0) {
    return {
      data: [],
      error: null,
      errorClass: null,
      nonRetryable: false,
      isRLSError: false
    };
  }

  const data = [];
  let error = null;
  const batches = chunkRowsForAnnotationUpsert(annotations);
  for (const batch of batches) {
    const result = await supabase
      .from('document_annotations')
      .upsert(batch, {
        onConflict: 'document_id,highlight_id',
        ignoreDuplicates: false
      })
      .select();
    if (result.error) {
      error = result.error;
      break;
    }
    data.push(...(result.data || []));
  }

  if (error) {
    const classification = classifyAnnotationSyncError(error);
    if (!classification.nonRetryable && !classification.isRLSError) {
      console.error('[AnnotationSync] Error upserting annotations:', error);
    }
    return {
      data: [],
      error,
      errorClass: classification.errorClass,
      nonRetryable: classification.nonRetryable,
      isRLSError: classification.isRLSError
    };
  }

  return {
    data,
    error: null,
    errorClass: null,
    nonRetryable: false,
    isRLSError: false
  };
}

/**
 * Delete an annotation by highlight_id
 */
export async function deleteAnnotation(documentId, highlightId) {
  const { error } = await supabase
    .from('document_annotations')
    .delete()
    .eq('document_id', documentId)
    .eq('highlight_id', highlightId);

  if (error) {
    console.error('[AnnotationSync] Error deleting annotation:', error);
    return { success: false, error };
  }

  return { success: true, error: null };
}

/**
 * Delete multiple annotations by highlight_ids
 */
export async function deleteAnnotations(documentId, highlightIds) {
  if (!highlightIds || highlightIds.length === 0) {
    return { success: true, error: null };
  }

  const { error } = await supabase
    .from('document_annotations')
    .delete()
    .eq('document_id', documentId)
    .in('highlight_id', highlightIds);

  if (error) {
    console.error('[AnnotationSync] Error deleting annotations:', error);
    return { success: false, error };
  }

  return { success: true, error: null };
}

// ============================================
// SYNC OPERATIONS
// ============================================

// Re-export the pure diff helper so existing callers that import it from
// this module keep working. Implementation lives in `highlightSyncDiff.js`
// to keep the helper Supabase-free for unit tests under `node --test`.
export { diffDeletedHighlightIds };

/**
 * Sync all local annotations to Supabase
 * Compares local state with remote and reconciles
 *
 * @param {string} documentId
 * @param {string} userId
 * @param {object} highlightAnnotations  Current highlightAnnotations dict
 * @param {object} [options]
 * @param {object|null} [options.priorHighlightAnnotations]  Last-synced state.
 *   When provided, the function diffs prior vs current to find deleted IDs and
 *   calls `deleteAnnotations()` for them BEFORE the upsert. Without this, the
 *   legacy path leaks cloud rows on every erase and peers keep drawing stale
 *   highlights (Bug 2 fix, 2026-04-30).
 */
export async function syncAnnotationsToSupabase(documentId, userId, highlightAnnotations, options = {}) {
  if (!documentId || !userId) {
    return { success: false, error: 'Missing documentId or userId' };
  }

  // Bug 2 fix: detect erases / removals against the prior synced state and
  // push deletes to the cloud BEFORE the upsert so peers stop rendering
  // erased highlights. Best-effort — a failed delete logs a warning but does
  // not abort the upsert (the upsert remains the more critical write path).
  const priorHighlightAnnotations = options?.priorHighlightAnnotations;
  if (priorHighlightAnnotations) {
    const deletedIds = diffDeletedHighlightIds(priorHighlightAnnotations, highlightAnnotations);
    if (deletedIds.length > 0) {
      const { success: deleteSuccess, error: deleteError } = await deleteAnnotations(documentId, deletedIds);
      // Bug 2 diag — log every delete-diff push so the user can confirm that
      // erases on this device generate cloud DELETE events. If a peer never
      // gets the DELETE, this log is the smoking gun (this device WAS told
      // about it; sync upstream is at fault).
      highlightSyncDiag('push.delete-diff', {
        documentId,
        userId,
        deletedIds,
        deletedCount: deletedIds.length,
        priorCount: Object.keys(priorHighlightAnnotations).length,
        currentCount: Object.keys(highlightAnnotations || {}).length,
        cloudResult: deleteSuccess ? 'OK' : 'FAILED',
        cloudError: deleteSuccess ? null : (deleteError?.message || String(deleteError)),
      });
      if (!deleteSuccess) {
        console.warn('[AnnotationSync] delete-diff failed (continuing with upsert):', deleteError, deletedIds);
      }
    }
  }

  const annotations = Object.entries(highlightAnnotations || {}).map(([highlightId, annotation]) =>
    buildSurveyMarkerRow({
      documentId,
      userId,
      highlightId,
      annotation,
    })
  );

  if (annotations.length === 0) {
    return { success: true, synced: 0 };
  }

  const { data, error, errorClass, nonRetryable, isRLSError } = await upsertAnnotations(annotations);

  if (error) {
    return {
      success: false,
      error,
      errorClass: errorClass || null,
      nonRetryable: !!nonRetryable,
      isRLSError: !!isRLSError
    };
  }

  return {
    success: true,
    synced: data.length,
    error: null,
    errorClass: null,
    nonRetryable: false,
    isRLSError: false
  };
}

/**
 * Load annotations from Supabase and convert to local format
 */
export async function loadAnnotationsFromSupabase(documentId) {
  const { data, error } = await getDocumentAnnotations(documentId);

  if (error) {
    return { highlightAnnotations: {}, error };
  }

  // Convert to local highlightAnnotations format
  const highlightAnnotations = {};
  for (const annotation of data) {
    const localAnnotation = mapSurveyMarkerRowToLocalAnnotation(annotation);
    if (!localAnnotation?.highlightId) continue;
    highlightAnnotations[localAnnotation.highlightId] = localAnnotation;
  }

  return { highlightAnnotations, error: null };
}

// ============================================
// REAL-TIME SUBSCRIPTIONS
// ============================================

/**
 * Subscribe to real-time annotation changes for a document
 * @returns cleanup function to unsubscribe
 */
export function subscribeToDocumentAnnotations(documentId, callbacks = {}) {
  const { onInsert, onUpdate, onDelete, onError } = callbacks;

  const channel = supabase
    .channel(`document-annotations:${documentId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'document_annotations',
        filter: `document_id=eq.${documentId}`
      },
      (payload) => {
        // 2026-04-27 — Skip non-highlight rows. The new cloud-sync hook
        // owns ink/shape/text/callout/etc. via its own subscription;
        // routing those rows through this legacy callback corrupts them
        // (see getDocumentAnnotations comment for the data-loss chain).
        if (payload.new?.annotation_type !== 'highlight') return;
        if (isLegacyFabricHighlightRow(payload.new)) return;
        if (onInsert) {
          onInsert(convertToLocalFormat(payload.new));
        }
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'document_annotations',
        filter: `document_id=eq.${documentId}`
      },
      (payload) => {
        if (payload.new?.annotation_type !== 'highlight') return;
        if (isLegacyFabricHighlightRow(payload.new)) return;
        if (onUpdate) {
          onUpdate(convertToLocalFormat(payload.new), convertToLocalFormat(payload.old));
        }
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'DELETE',
        schema: 'public',
        table: 'document_annotations',
        filter: `document_id=eq.${documentId}`
      },
      (payload) => {
        // DELETE payloads can carry the old row when REPLICA IDENTITY FULL
        // is set. Only forward to the legacy handler if the deleted row
        // was actually a highlight; otherwise the new cloud-sync hook
        // handles it.
        if (payload.old?.annotation_type && payload.old.annotation_type !== 'highlight') return;
        if (isLegacyFabricHighlightRow(payload.old)) return;
        if (onDelete) {
          onDelete(payload.old.highlight_id, convertToLocalFormat(payload.old));
        }
      }
    )
    .subscribe((status, err) => {
      if (err) {
        console.error('[AnnotationSync] Subscription error:', err);
        if (onError) onError(err);
      }
    });

  // Return cleanup function
  return () => {
    supabase.removeChannel(channel);
  };
}

/**
 * Convert Supabase record to local annotation format
 */
function convertToLocalFormat(record) {
  if (!record) return null;
  return mapSurveyMarkerRowToLocalAnnotation(record);
}

// ============================================
// PRESENCE OPERATIONS
// ============================================

const classifyPresenceError = (error) => {
  const message = error?.message || '';
  const code = error?.code || null;
  const status = Number(error?.status) || null;
  const normalizedMessage = typeof message === 'string' ? message.toLowerCase() : '';
  const isRLSError = code === '42501' || normalizedMessage.includes('row-level security');
  const isMissingTable = code === '42P01';
  const isNotFound = status === 404 || normalizedMessage.includes('404') || normalizedMessage.includes('not found');

  if (isRLSError) {
    return {
      errorClass: 'RLS',
      nonRetryable: true,
      isRLSError: true
    };
  }

  if (isMissingTable) {
    return {
      errorClass: 'SCHEMA_MISSING',
      nonRetryable: true,
      isRLSError: false
    };
  }

  if (isNotFound) {
    return {
      errorClass: 'NOT_FOUND',
      nonRetryable: true,
      isRLSError: false
    };
  }

  return {
    errorClass: code || 'UNKNOWN',
    nonRetryable: false,
    isRLSError: false
  };
};

/**
 * Update user presence for a document
 */
export async function updateDocumentPresence(documentId, userId, presenceData = {}) {
  if (!documentId || !userId) return { success: false };

  const { error } = await supabase
    .from('document_presence')
    .upsert({
      document_id: documentId,
      user_id: userId,
      client_type: presenceData.clientType || 'app',
      display_name: presenceData.displayName || null,
      current_page: presenceData.currentPage || null,
      cursor_position: presenceData.cursorPosition || null,
      selected_annotation_id: presenceData.selectedAnnotationId || null,
      last_seen: new Date().toISOString()
    }, {
      onConflict: 'document_id,user_id,client_type'
    });

  if (error) {
    const classification = classifyPresenceError(error);
    // Avoid console noise for non-retryable structural errors and RLS failures.
    if (!classification.nonRetryable && !classification.isRLSError) {
      console.error('[AnnotationSync] Error updating presence:', error);
    }
    return {
      success: false,
      error,
      errorClass: classification.errorClass,
      nonRetryable: classification.nonRetryable,
      isRLSError: classification.isRLSError
    };
  }

  return {
    success: true,
    error: null,
    errorClass: null,
    nonRetryable: false,
    isRLSError: false
  };
}

/**
 * Get active users for a document
 */
export async function getDocumentPresence(documentId) {
  if (!documentId) return { data: [], error: null };

  // Get presence records from last 2 minutes
  const cutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('document_presence')
    .select('*')
    .eq('document_id', documentId)
    .gte('last_seen', cutoff);

  if (error) {
    console.error('[AnnotationSync] Error fetching presence:', error);
    return { data: [], error };
  }

  return { data: data || [], error: null };
}

/**
 * Remove user presence (on disconnect)
 */
export async function removeDocumentPresence(documentId, userId, clientType = 'app') {
  if (!documentId || !userId) return { success: false };

  const { error } = await supabase
    .from('document_presence')
    .delete()
    .eq('document_id', documentId)
    .eq('user_id', userId)
    .eq('client_type', clientType);

  if (error) {
    console.error('[AnnotationSync] Error removing presence:', error);
    return { success: false, error };
  }

  return { success: true };
}

/**
 * Subscribe to presence changes for a document
 */
export function subscribeToDocumentPresence(documentId, onPresenceChange) {
  const channel = supabase
    .channel(`document-presence:${documentId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'document_presence',
        filter: `document_id=eq.${documentId}`
      },
      async () => {
        // Fetch updated presence list
        const { data } = await getDocumentPresence(documentId);
        if (onPresenceChange) {
          onPresenceChange(data);
        }
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

// ============================================
// COLLABORATOR OPERATIONS
// ============================================

/**
 * Get a user's subscription tier
 * @returns {Promise<{tier: string, error: any}>}
 */
export async function getUserSubscriptionTier(userId) {
  if (!userId) return { tier: 'free', error: null };

  const { data, error } = await supabase
    .from('user_subscriptions')
    .select('tier, status')
    .eq('user_id', userId)
    .single();

  if (error) {
    // If no subscription found, default to free
    if (error.code === 'PGRST116') {
      return { tier: 'free', error: null };
    }
    console.error('[AnnotationSync] Error fetching user subscription:', error);
    return { tier: 'free', error };
  }

  // Only return active subscriptions as their tier
  if (data.status !== 'active' && data.status !== 'trialing') {
    return { tier: 'free', error: null };
  }

  return { tier: data.tier || 'free', error: null };
}

/**
 * Check if a user can be added as a collaborator
 * Free tier users cannot be collaborators
 * @returns {Promise<{allowed: boolean, reason?: string, tier?: string}>}
 */
export async function canUserBeCollaborator(userId) {
  const { tier, error } = await getUserSubscriptionTier(userId);

  if (error) {
    return { allowed: false, reason: 'Unable to verify user subscription status.' };
  }

  if (tier === 'free') {
    return {
      allowed: false,
      tier: 'free',
      reason: 'This user is on the Free plan and cannot be added as a collaborator. They need to upgrade to Pro or higher to collaborate on documents.'
    };
  }

  return { allowed: true, tier };
}

/**
 * Get collaborators for a document
 */
export async function getDocumentCollaborators(documentId) {
  if (!documentId) return { data: [], error: null };

  const { data, error } = await supabase
    .from('document_collaborators')
    .select(`
      *,
      user:auth.users(id, email, raw_user_meta_data)
    `)
    .eq('document_id', documentId)
    .eq('status', 'active');

  if (error) {
    console.error('[AnnotationSync] Error fetching collaborators:', error);
    return { data: [], error };
  }

  return { data: data || [], error: null };
}

/**
 * Add a collaborator to a document
 * @param {string} documentId - The document to add collaborator to
 * @param {string} userIdOrEmail - User ID or email of the collaborator
 * @param {string} role - Role: 'viewer', 'commenter', 'editor'
 * @param {string} invitedBy - User ID of who is inviting
 * @returns {Promise<{success: boolean, data?: any, error?: string, requiresUpgrade?: boolean}>}
 */
export async function addDocumentCollaborator(documentId, userIdOrEmail, role = 'editor', invitedBy = null) {
  // Check if it's an email or user ID
  const isEmail = userIdOrEmail.includes('@');

  let eligibilityResult;

  if (isEmail) {
    // Use combined RPC function for email lookup + eligibility check
    const { data, error } = await supabase
      .rpc('check_collaborator_by_email', { email_address: userIdOrEmail });

    if (error) {
      console.error('[AnnotationSync] Error checking collaborator by email:', error);
      return {
        success: false,
        error: 'Unable to verify user. Please try again.',
        requiresUpgrade: false
      };
    }

    eligibilityResult = data?.[0];
  } else {
    // Use RPC function for user ID eligibility check
    const { data, error } = await supabase
      .rpc('check_user_collaborator_eligibility', { target_user_id: userIdOrEmail });

    if (error) {
      console.error('[AnnotationSync] Error checking collaborator eligibility:', error);
      return {
        success: false,
        error: 'Unable to verify user. Please try again.',
        requiresUpgrade: false
      };
    }

    eligibilityResult = data?.[0];
  }

  // Check if user was found
  if (!eligibilityResult || !eligibilityResult.user_id) {
    return {
      success: false,
      error: eligibilityResult?.reason || 'User not found. They need to create an account first.',
      requiresUpgrade: false
    };
  }

  // Check if user can collaborate (not free tier)
  if (!eligibilityResult.can_collaborate) {
    return {
      success: false,
      error: eligibilityResult.reason,
      requiresUpgrade: true,
      userTier: eligibilityResult.tier
    };
  }

  const collaboratorData = {
    document_id: documentId,
    user_id: eligibilityResult.user_id,
    email: eligibilityResult.email,
    role,
    status: 'active',
    invited_by: invitedBy
  };

  const { data, error } = await supabase
    .from('document_collaborators')
    .upsert(collaboratorData, {
      onConflict: 'document_id,user_id'
    })
    .select()
    .single();

  if (error) {
    console.error('[AnnotationSync] Error adding collaborator:', error);
    return { success: false, error: error.message, requiresUpgrade: false };
  }

  return { success: true, data };
}

/**
 * Remove a collaborator from a document
 */
export async function removeDocumentCollaborator(documentId, userId) {
  const { error } = await supabase
    .from('document_collaborators')
    .delete()
    .eq('document_id', documentId)
    .eq('user_id', userId);

  if (error) {
    console.error('[AnnotationSync] Error removing collaborator:', error);
    return { success: false, error };
  }

  return { success: true };
}

/**
 * Update collaborator role
 */
export async function updateCollaboratorRole(documentId, userId, newRole) {
  const { error } = await supabase
    .from('document_collaborators')
    .update({ role: newRole })
    .eq('document_id', documentId)
    .eq('user_id', userId);

  if (error) {
    console.error('[AnnotationSync] Error updating collaborator role:', error);
    return { success: false, error };
  }

  return { success: true };
}

// ============================================
// PROJECT COLLABORATOR OPERATIONS
// ============================================

/**
 * Get collaborators for a project
 */
export async function getProjectCollaborators(projectId) {
  if (!projectId) return { data: [], error: null };

  const { data, error } = await supabase
    .from('project_collaborators')
    .select('*')
    .eq('project_id', projectId)
    .eq('status', 'active');

  if (error) {
    console.error('[AnnotationSync] Error fetching project collaborators:', error);
    return { data: [], error };
  }

  return { data: data || [], error: null };
}

/**
 * Add a collaborator to a project
 * @param {string} projectId - The project to add collaborator to
 * @param {string} userIdOrEmail - User ID or email of the collaborator
 * @param {string} role - Role: 'viewer', 'commenter', 'editor'
 * @param {string} invitedBy - User ID of who is inviting
 * @returns {Promise<{success: boolean, data?: any, error?: string, requiresUpgrade?: boolean}>}
 */
export async function addProjectCollaborator(projectId, userIdOrEmail, role = 'editor', invitedBy = null) {
  // Check if it's an email or user ID
  const isEmail = userIdOrEmail.includes('@');

  let eligibilityResult;

  if (isEmail) {
    // Use combined RPC function for email lookup + eligibility check
    const { data, error } = await supabase
      .rpc('check_collaborator_by_email', { email_address: userIdOrEmail });

    if (error) {
      console.error('[AnnotationSync] Error checking collaborator by email:', error);
      return {
        success: false,
        error: 'Unable to verify user. Please try again.',
        requiresUpgrade: false
      };
    }

    eligibilityResult = data?.[0];
  } else {
    // Use RPC function for user ID eligibility check
    const { data, error } = await supabase
      .rpc('check_user_collaborator_eligibility', { target_user_id: userIdOrEmail });

    if (error) {
      console.error('[AnnotationSync] Error checking collaborator eligibility:', error);
      return {
        success: false,
        error: 'Unable to verify user. Please try again.',
        requiresUpgrade: false
      };
    }

    eligibilityResult = data?.[0];
  }

  // Check if user was found
  if (!eligibilityResult || !eligibilityResult.user_id) {
    return {
      success: false,
      error: eligibilityResult?.reason || 'User not found. They need to create an account first.',
      requiresUpgrade: false
    };
  }

  // Check if user can collaborate (not free tier)
  if (!eligibilityResult.can_collaborate) {
    return {
      success: false,
      error: eligibilityResult.reason,
      requiresUpgrade: true,
      userTier: eligibilityResult.tier
    };
  }

  const collaboratorData = {
    project_id: projectId,
    user_id: eligibilityResult.user_id,
    email: eligibilityResult.email,
    role,
    status: 'active',
    invited_by: invitedBy
  };

  const { data, error } = await supabase
    .from('project_collaborators')
    .upsert(collaboratorData, {
      onConflict: 'project_id,user_id'
    })
    .select()
    .single();

  if (error) {
    console.error('[AnnotationSync] Error adding project collaborator:', error);
    return { success: false, error: error.message, requiresUpgrade: false };
  }

  return { success: true, data };
}

/**
 * Remove a collaborator from a project
 */
export async function removeProjectCollaborator(projectId, userId) {
  const { error } = await supabase
    .from('project_collaborators')
    .delete()
    .eq('project_id', projectId)
    .eq('user_id', userId);

  if (error) {
    console.error('[AnnotationSync] Error removing project collaborator:', error);
    return { success: false, error };
  }

  return { success: true };
}

/**
 * Update project collaborator role
 */
export async function updateProjectCollaboratorRole(projectId, userId, newRole) {
  const { error } = await supabase
    .from('project_collaborators')
    .update({ role: newRole })
    .eq('project_id', projectId)
    .eq('user_id', userId);

  if (error) {
    console.error('[AnnotationSync] Error updating project collaborator role:', error);
    return { success: false, error };
  }

  return { success: true };
}
