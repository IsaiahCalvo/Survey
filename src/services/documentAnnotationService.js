/**
 * Document Annotation Sync Service
 * Handles real-time sync of annotations to/from Supabase
 * Uses document-based architecture (not template-based)
 */

import { supabase } from '../supabaseClient';

// ============================================
// ANNOTATION CRUD OPERATIONS
// ============================================

/**
 * Get all annotations for a document
 */
export async function getDocumentAnnotations(documentId) {
  if (!documentId) return { data: [], error: null };

  const { data, error } = await supabase
    .from('document_annotations')
    .select('*')
    .eq('document_id', documentId)
    .order('page_number', { ascending: true });

  if (error) {
    console.error('[AnnotationSync] Error fetching annotations:', error);
    return { data: [], error };
  }

  return { data: data || [], error: null };
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
    return { data: [], error: null };
  }

  const { data, error } = await supabase
    .from('document_annotations')
    .upsert(annotations, {
      onConflict: 'document_id,highlight_id',
      ignoreDuplicates: false
    })
    .select();

  if (error) {
    console.error('[AnnotationSync] Error upserting annotations:', error);
    return { data: [], error };
  }

  return { data: data || [], error: null };
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

/**
 * Sync all local annotations to Supabase
 * Compares local state with remote and reconciles
 */
export async function syncAnnotationsToSupabase(documentId, userId, highlightAnnotations) {
  if (!documentId || !userId) {
    return { success: false, error: 'Missing documentId or userId' };
  }

  const annotations = Object.entries(highlightAnnotations || {}).map(([highlightId, annotation]) => ({
    document_id: documentId,
    user_id: userId,
    highlight_id: highlightId,
    annotation_type: 'highlight',
    page_number: annotation.pageNumber || 1,
    bounds: annotation.bounds || {},
    category_id: annotation.categoryId || null,
    module_id: annotation.moduleId || null,
    space_id: annotation.spaceId || null,
    name: annotation.name || null,
    notes: annotation.notes || annotation.note || null,
    ball_in_court_entity_id: annotation.ballInCourtEntityId || null,
    ball_in_court_name: annotation.ballInCourtName || null,
    checklist_responses: annotation.checklistResponses || {},
    changed_by: annotation.changedBy || null,
    changed_date: annotation.changedDate || null,
    color: annotation.color || '#FFFF00',
    opacity: annotation.opacity || 0.3,
    last_modified_by: userId,
    version: (annotation.version || 0) + 1
  }));

  if (annotations.length === 0) {
    return { success: true, synced: 0 };
  }

  const { data, error } = await upsertAnnotations(annotations);

  if (error) {
    return { success: false, error };
  }

  return { success: true, synced: data.length };
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
    highlightAnnotations[annotation.highlight_id] = {
      pageNumber: annotation.page_number,
      bounds: annotation.bounds,
      categoryId: annotation.category_id,
      moduleId: annotation.module_id,
      spaceId: annotation.space_id,
      name: annotation.name,
      notes: annotation.notes,
      note: annotation.notes, // Alias
      ballInCourtEntityId: annotation.ball_in_court_entity_id,
      ballInCourtName: annotation.ball_in_court_name,
      checklistResponses: annotation.checklist_responses || {},
      changedBy: annotation.changed_by,
      changedDate: annotation.changed_date,
      color: annotation.color,
      opacity: annotation.opacity,
      version: annotation.version,
      supabaseId: annotation.id, // Track the Supabase record ID
      lastSyncedAt: annotation.updated_at
    };
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
  return {
    highlightId: record.highlight_id,
    pageNumber: record.page_number,
    bounds: record.bounds,
    categoryId: record.category_id,
    moduleId: record.module_id,
    spaceId: record.space_id,
    name: record.name,
    notes: record.notes,
    note: record.notes,
    ballInCourtEntityId: record.ball_in_court_entity_id,
    ballInCourtName: record.ball_in_court_name,
    checklistResponses: record.checklist_responses || {},
    changedBy: record.changed_by,
    changedDate: record.changed_date,
    color: record.color,
    opacity: record.opacity,
    version: record.version,
    supabaseId: record.id,
    lastSyncedAt: record.updated_at,
    userId: record.user_id,
    lastModifiedBy: record.last_modified_by
  };
}

// ============================================
// PRESENCE OPERATIONS
// ============================================

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
    console.error('[AnnotationSync] Error updating presence:', error);
    return { success: false, error };
  }

  return { success: true };
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
