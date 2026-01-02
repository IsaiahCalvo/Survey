/**
 * Survey Real-time Service
 * Handles Supabase real-time subscriptions and database operations for multi-user survey collaboration.
 * This service manages the central sync hub - all clients (app and Excel add-in) communicate through here.
 */

import { supabase, isSupabaseAvailable } from '../supabaseClient';

// ============================================
// SESSION MANAGEMENT
// ============================================

/**
 * Create a new survey session for real-time collaboration
 * @param {string} templateId - Supabase template ID
 * @param {string} userId - Supabase user ID
 * @param {string} documentId - Optional Supabase document ID
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} - Created session
 */
export async function createSurveySession(templateId, userId, documentId = null, options = {}) {
  if (!isSupabaseAvailable()) {
    throw new Error('Supabase not available');
  }


  const sessionData = {
    template_id: templateId,
    user_id: userId,
    document_id: documentId,
    excel_file_path: options.excelFilePath || null,
    excel_file_id: options.excelFileId || null,
    is_active: true,
  };

  const { data, error } = await supabase
    .from('survey_sessions')
    .insert(sessionData)
    .select()
    .single();

  if (error) {
    console.error('[SurveyRealtimeService] Failed to create session:', error);
    // Check if this is a foreign key violation (template doesn't exist in Supabase)
    if (error.code === '23503' || error.message?.includes('foreign key')) {
      throw new Error(`Template not found in Supabase. Please save your template to the cloud first. (Template ID: ${templateId})`);
    }
    throw error;
  }

  return data;
}

/**
 * Get or create a survey session for a template
 * @param {string} templateId - Supabase template ID
 * @param {string} userId - Supabase user ID
 * @returns {Promise<Object>} - Session object
 */
export async function getOrCreateSession(templateId, userId, documentId = null) {
  if (!isSupabaseAvailable()) {
    throw new Error('Supabase not available');
  }

  // First try to find an existing active session
  const { data: existing, error: fetchError } = await supabase
    .from('survey_sessions')
    .select('*')
    .eq('template_id', templateId)
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle();

  if (fetchError && fetchError.code !== 'PGRST116') throw fetchError;

  if (existing) {
    return existing;
  }

  // Create new session
  return createSurveySession(templateId, userId, documentId);
}

/**
 * Update a survey session
 * @param {string} sessionId - Session UUID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} - Updated session
 */
export async function updateSurveySession(sessionId, updates) {
  if (!isSupabaseAvailable()) {
    throw new Error('Supabase not available');
  }

  const { data, error } = await supabase
    .from('survey_sessions')
    .update(updates)
    .eq('id', sessionId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Close/deactivate a survey session
 * @param {string} sessionId - Session UUID
 */
export async function closeSurveySession(sessionId) {
  if (!isSupabaseAvailable()) return;

  try {
    await supabase
      .from('survey_sessions')
      .update({ is_active: false })
      .eq('id', sessionId);
  } catch (error) {
    console.error('Error closing survey session:', error);
  }
}

// ============================================
// SURVEY ITEMS CRUD
// ============================================

/**
 * Upsert a survey item (highlight annotation)
 * @param {string} sessionId - Session UUID
 * @param {Object} item - Survey item data
 * @returns {Promise<Object>} - Upserted item
 */
export async function upsertSurveyItem(sessionId, item) {
  if (!isSupabaseAvailable()) {
    throw new Error('Supabase not available');
  }

  const itemData = {
    session_id: sessionId,
    highlight_id: item.highlightId || item.id,
    module_id: item.moduleId,
    category_id: item.categoryId,
    name: item.name || null,
    page_number: item.pageNumber || item.page || null,
    bounds: item.bounds || null,
    ball_in_court_entity_id: item.ballInCourtEntityId || item.ballInCourt?.entityId || null,
    ball_in_court_name: item.ballInCourtName || item.ballInCourt?.name || null,
    changed_by: item.changedBy || null,
    changed_date: item.changedDate || null,
    notes: item.notes || null,
    checklist_responses: item.checklistResponses || {},
    excel_row_index: item.excelRowIndex || null,
    version: item.version || 1,
  };

  const { data, error } = await supabase
    .from('survey_items')
    .upsert(itemData, { onConflict: 'session_id,highlight_id' })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Batch upsert multiple survey items
 * @param {string} sessionId - Session UUID
 * @param {Array<Object>} items - Array of survey items
 * @returns {Promise<Array<Object>>} - Upserted items
 */
export async function batchUpsertSurveyItems(sessionId, items) {
  if (!isSupabaseAvailable() || !items.length) {
    return [];
  }

  const itemsData = items.map(item => ({
    session_id: sessionId,
    highlight_id: item.highlightId || item.id,
    module_id: item.moduleId,
    category_id: item.categoryId,
    name: item.name || null,
    page_number: item.pageNumber || item.page || null,
    bounds: item.bounds || null,
    ball_in_court_entity_id: item.ballInCourtEntityId || item.ballInCourt?.entityId || null,
    ball_in_court_name: item.ballInCourtName || item.ballInCourt?.name || null,
    changed_by: item.changedBy || null,
    changed_date: item.changedDate || null,
    notes: item.notes || null,
    checklist_responses: item.checklistResponses || {},
    excel_row_index: item.excelRowIndex || null,
    version: (item.version || 0) + 1,
  }));

  const { data, error } = await supabase
    .from('survey_items')
    .upsert(itemsData, { onConflict: 'session_id,highlight_id' })
    .select();

  if (error) throw error;
  return data || [];
}

/**
 * Get all survey items for a session
 * @param {string} sessionId - Session UUID
 * @returns {Promise<Array<Object>>} - Survey items
 */
export async function getSurveyItems(sessionId) {
  if (!isSupabaseAvailable()) {
    return [];
  }

  const { data, error } = await supabase
    .from('survey_items')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

/**
 * Delete a survey item
 * @param {string} sessionId - Session UUID
 * @param {string} highlightId - Highlight ID to delete
 */
export async function deleteSurveyItem(sessionId, highlightId) {
  if (!isSupabaseAvailable()) return;

  const { error } = await supabase
    .from('survey_items')
    .delete()
    .eq('session_id', sessionId)
    .eq('highlight_id', highlightId);

  if (error) throw error;
}

// ============================================
// EXCEL SCHEMA MAPPING
// ============================================

/**
 * Save Excel schema mapping for a session
 * @param {string} sessionId - Session UUID
 * @param {Object} mapping - Schema mapping object
 * @returns {Promise<Object>} - Saved mapping
 */
export async function saveExcelSchemaMapping(sessionId, mapping) {
  if (!isSupabaseAvailable()) {
    throw new Error('Supabase not available');
  }

  const mappingData = {
    session_id: sessionId,
    sheet_name: mapping.sheetName,
    sheet_index: mapping.sheetIndex || null,
    module_id: mapping.moduleId,
    category_id: mapping.categoryId,
    column_mapping: mapping.columnMapping || {},
    header_row: mapping.headerRow || 1,
    data_start_row: mapping.dataStartRow || 2,
  };

  const { data, error } = await supabase
    .from('excel_schema_mapping')
    .upsert(mappingData, { onConflict: 'session_id,sheet_name' })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Get Excel schema mappings for a session
 * @param {string} sessionId - Session UUID
 * @returns {Promise<Array<Object>>} - Schema mappings
 */
export async function getExcelSchemaMappings(sessionId) {
  if (!isSupabaseAvailable()) {
    return [];
  }

  const { data, error } = await supabase
    .from('excel_schema_mapping')
    .select('*')
    .eq('session_id', sessionId);

  if (error) throw error;
  return data || [];
}

// ============================================
// PRESENCE TRACKING
// ============================================

/**
 * Update user presence in a session
 * @param {string} sessionId - Session UUID
 * @param {string} userId - User UUID
 * @param {string} clientType - 'app', 'excel', or 'web'
 * @param {Object} options - Additional presence data
 */
export async function updatePresence(sessionId, userId, clientType, options = {}) {
  if (!isSupabaseAvailable()) return;

  const presenceData = {
    session_id: sessionId,
    user_id: userId,
    client_type: clientType,
    display_name: options.displayName || null,
    cursor_position: options.cursorPosition || null,
    last_seen: new Date().toISOString(),
  };

  try {
    await supabase
      .from('survey_presence')
      .upsert(presenceData, { onConflict: 'session_id,user_id,client_type' });
  } catch (error) {
    console.error('Error updating presence:', error);
  }
}

/**
 * Remove user presence (on disconnect)
 * @param {string} sessionId - Session UUID
 * @param {string} userId - User UUID
 * @param {string} clientType - 'app', 'excel', or 'web'
 */
export async function removePresence(sessionId, userId, clientType) {
  if (!isSupabaseAvailable()) return;

  try {
    await supabase
      .from('survey_presence')
      .delete()
      .eq('session_id', sessionId)
      .eq('user_id', userId)
      .eq('client_type', clientType);
  } catch (error) {
    console.error('Error removing presence:', error);
  }
}

/**
 * Get all active users in a session
 * @param {string} sessionId - Session UUID
 * @returns {Promise<Array<Object>>} - Active users
 */
export async function getSessionPresence(sessionId) {
  if (!isSupabaseAvailable()) {
    return [];
  }

  // Get presence records from last 2 minutes (active users)
  const cutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('survey_presence')
    .select('*')
    .eq('session_id', sessionId)
    .gte('last_seen', cutoff);

  if (error) throw error;
  return data || [];
}

// ============================================
// REAL-TIME SUBSCRIPTIONS
// ============================================

/**
 * Subscribe to survey item changes for a session
 * @param {string} sessionId - Session UUID
 * @param {Object} callbacks - Event callbacks
 * @returns {Object} - Subscription channel
 */
export function subscribeToSurveyItems(sessionId, callbacks = {}) {
  if (!isSupabaseAvailable()) {
    return null;
  }

  const channel = supabase
    .channel(`survey_items:${sessionId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'survey_items',
        filter: `session_id=eq.${sessionId}`,
      },
      (payload) => {
        callbacks.onInsert?.(convertItemFromDb(payload.new));
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'survey_items',
        filter: `session_id=eq.${sessionId}`,
      },
      (payload) => {
        callbacks.onUpdate?.(convertItemFromDb(payload.new), convertItemFromDb(payload.old));
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'DELETE',
        schema: 'public',
        table: 'survey_items',
        filter: `session_id=eq.${sessionId}`,
      },
      (payload) => {
        callbacks.onDelete?.(convertItemFromDb(payload.old));
      }
    )
    .subscribe((status) => {
      callbacks.onStatus?.(status);
    });

  return channel;
}

/**
 * Subscribe to presence changes for a session
 * @param {string} sessionId - Session UUID
 * @param {Object} callbacks - Event callbacks
 * @returns {Object} - Subscription channel
 */
export function subscribeToPresence(sessionId, callbacks = {}) {
  if (!isSupabaseAvailable()) {
    return null;
  }

  const channel = supabase
    .channel(`survey_presence:${sessionId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'survey_presence',
        filter: `session_id=eq.${sessionId}`,
      },
      (payload) => {
        callbacks.onPresenceChange?.(payload);
      }
    )
    .subscribe();

  return channel;
}

/**
 * Unsubscribe from a channel
 * @param {Object} channel - Supabase channel
 */
export async function unsubscribe(channel) {
  if (channel) {
    try {
      await supabase.removeChannel(channel);
    } catch (error) {
      console.error('Error unsubscribing:', error);
    }
  }
}

// ============================================
// SYNC LOG
// ============================================

/**
 * Log a sync change for debugging/audit
 * @param {string} sessionId - Session UUID
 * @param {Object} logEntry - Log entry data
 */
export async function logSyncChange(sessionId, logEntry) {
  if (!isSupabaseAvailable()) return;

  try {
    await supabase
      .from('survey_sync_log')
      .insert({
        session_id: sessionId,
        item_id: logEntry.itemId || null,
        change_type: logEntry.changeType,
        source: logEntry.source,
        user_id: logEntry.userId || null,
        old_values: logEntry.oldValues || null,
        new_values: logEntry.newValues || null,
      });
  } catch (error) {
    console.error('Error logging sync change:', error);
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Convert database item to app format
 * @param {Object} dbItem - Item from database
 * @returns {Object} - App-format item
 */
export function convertItemFromDb(dbItem) {
  if (!dbItem) return null;

  return {
    id: dbItem.highlight_id,
    highlightId: dbItem.highlight_id,
    moduleId: dbItem.module_id,
    categoryId: dbItem.category_id,
    name: dbItem.name,
    pageNumber: dbItem.page_number,
    bounds: dbItem.bounds,
    ballInCourt: dbItem.ball_in_court_entity_id ? {
      entityId: dbItem.ball_in_court_entity_id,
      name: dbItem.ball_in_court_name,
    } : null,
    changedBy: dbItem.changed_by,
    changedDate: dbItem.changed_date,
    notes: dbItem.notes,
    checklistResponses: dbItem.checklist_responses || {},
    excelRowIndex: dbItem.excel_row_index,
    version: dbItem.version,
    dbId: dbItem.id,
    createdAt: dbItem.created_at,
    updatedAt: dbItem.updated_at,
  };
}

/**
 * Convert app item to database format
 * @param {Object} appItem - Item from app
 * @param {string} sessionId - Session UUID
 * @returns {Object} - Database-format item
 */
export function convertItemToDb(appItem, sessionId) {
  return {
    session_id: sessionId,
    highlight_id: appItem.highlightId || appItem.id,
    module_id: appItem.moduleId,
    category_id: appItem.categoryId,
    name: appItem.name || null,
    page_number: appItem.pageNumber || appItem.page || null,
    bounds: appItem.bounds || null,
    ball_in_court_entity_id: appItem.ballInCourt?.entityId || null,
    ball_in_court_name: appItem.ballInCourt?.name || null,
    changed_by: appItem.changedBy || null,
    changed_date: appItem.changedDate || null,
    notes: appItem.notes || null,
    checklist_responses: appItem.checklistResponses || {},
    excel_row_index: appItem.excelRowIndex || null,
  };
}

/**
 * Convert highlight annotations to survey items for sync
 * @param {Object} highlightAnnotations - Highlight annotations keyed by module/category
 * @returns {Array<Object>} - Flat array of survey items
 */
export function flattenHighlightAnnotations(highlightAnnotations) {
  const items = [];

  for (const [moduleId, categories] of Object.entries(highlightAnnotations || {})) {
    for (const [categoryId, highlights] of Object.entries(categories || {})) {
      for (const highlight of highlights || []) {
        items.push({
          ...highlight,
          moduleId,
          categoryId,
        });
      }
    }
  }

  return items;
}

/**
 * Convert flat survey items back to highlight annotations structure
 * @param {Array<Object>} items - Flat array of survey items
 * @returns {Object} - Highlight annotations keyed by module/category
 */
export function unflattenToHighlightAnnotations(items) {
  const annotations = {};

  for (const item of items || []) {
    const { moduleId, categoryId, ...highlightData } = item;

    if (!annotations[moduleId]) {
      annotations[moduleId] = {};
    }
    if (!annotations[moduleId][categoryId]) {
      annotations[moduleId][categoryId] = [];
    }

    annotations[moduleId][categoryId].push({
      id: item.highlightId || item.id,
      ...highlightData,
    });
  }

  return annotations;
}
