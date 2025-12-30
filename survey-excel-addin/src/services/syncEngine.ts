/**
 * Sync Engine
 * Core logic for bidirectional sync between Excel and Supabase
 */

import { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase, isSupabaseInitialized } from './supabaseClient';
import {
  initExcelEvents,
  onCellChange,
  onSheetAdded,
  onSheetDeleted,
  getUsedRange,
  updateCell,
  insertRow,
  deleteRow,
  cleanupEventHandlers,
} from './excelService';
import {
  SurveyItem,
  SurveySession,
  ExcelSchemaMapping,
  SyncStatus,
  ExcelChangeEvent,
  STANDARD_COLUMNS,
  parseSheetName,
} from '../types/survey';

export interface SyncEngineCallbacks {
  onStatusChange?: (status: SyncStatus) => void;
  onError?: (error: Error) => void;
  onItemSynced?: (item: SurveyItem) => void;
  onConflict?: (local: unknown, remote: SurveyItem) => void;
}

export class SyncEngine {
  private sessionId: string | null = null;
  private userId: string | null = null;
  private channel: RealtimeChannel | null = null;
  private status: SyncStatus = 'disconnected';
  private callbacks: SyncEngineCallbacks;
  private schemaMappings: Map<string, ExcelSchemaMapping> = new Map();
  private pendingChanges: Set<string> = new Set(); // Track our own changes to ignore
  private cleanupFunctions: Array<() => void> = [];

  constructor(callbacks: SyncEngineCallbacks = {}) {
    this.callbacks = callbacks;
  }

  /**
   * Connect to a survey session
   */
  async connect(sessionId: string, userId: string): Promise<void> {
    if (!isSupabaseInitialized()) {
      throw new Error('Supabase not initialized');
    }

    this.sessionId = sessionId;
    this.userId = userId;
    this.setStatus('connecting');

    try {
      // Load schema mappings
      await this.loadSchemaMappings();

      // Initialize Excel event handlers
      await initExcelEvents();

      // Set up Excel change listeners
      this.setupExcelListeners();

      // Subscribe to Supabase real-time
      await this.subscribeToChanges();

      // Update presence
      await this.updatePresence();

      this.setStatus('connected');
      console.log('[SyncEngine] Connected to session:', sessionId);
    } catch (error) {
      this.setStatus('error');
      this.callbacks.onError?.(error as Error);
      throw error;
    }
  }

  /**
   * Disconnect from the session
   */
  async disconnect(): Promise<void> {
    // Remove presence
    if (this.sessionId && this.userId) {
      await this.removePresence();
    }

    // Unsubscribe from real-time
    if (this.channel) {
      await getSupabase()?.removeChannel(this.channel);
      this.channel = null;
    }

    // Clean up Excel event handlers
    this.cleanupFunctions.forEach((fn) => fn());
    this.cleanupFunctions = [];
    cleanupEventHandlers();

    this.sessionId = null;
    this.userId = null;
    this.setStatus('disconnected');

    console.log('[SyncEngine] Disconnected');
  }

  /**
   * Get current sync status
   */
  getStatus(): SyncStatus {
    return this.status;
  }

  /**
   * Load schema mappings from Supabase
   */
  private async loadSchemaMappings(): Promise<void> {
    const supabase = getSupabase();
    if (!supabase || !this.sessionId) return;

    const { data, error } = await supabase
      .from('excel_schema_mapping')
      .select('*')
      .eq('session_id', this.sessionId);

    if (error) throw error;

    this.schemaMappings.clear();
    (data || []).forEach((mapping: ExcelSchemaMapping) => {
      this.schemaMappings.set(mapping.sheet_name, mapping);
    });

    console.log('[SyncEngine] Loaded', this.schemaMappings.size, 'schema mappings');
  }

  /**
   * Set up Excel change listeners
   */
  private setupExcelListeners(): void {
    // Listen for cell changes
    const unsubChange = onCellChange((event) => this.handleExcelChange(event));
    this.cleanupFunctions.push(unsubChange);

    // Listen for sheet additions
    const unsubAdded = onSheetAdded((name, index) => this.handleSheetAdded(name, index));
    this.cleanupFunctions.push(unsubAdded);

    // Listen for sheet deletions
    const unsubDeleted = onSheetDeleted((id) => this.handleSheetDeleted(id));
    this.cleanupFunctions.push(unsubDeleted);
  }

  /**
   * Subscribe to Supabase real-time changes
   */
  private async subscribeToChanges(): Promise<void> {
    const supabase = getSupabase();
    if (!supabase || !this.sessionId) return;

    this.channel = supabase
      .channel(`survey_items:${this.sessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'survey_items',
          filter: `session_id=eq.${this.sessionId}`,
        },
        (payload) => this.handleRemoteInsert(payload.new as SurveyItem)
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'survey_items',
          filter: `session_id=eq.${this.sessionId}`,
        },
        (payload) => this.handleRemoteUpdate(payload.new as SurveyItem)
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'survey_items',
          filter: `session_id=eq.${this.sessionId}`,
        },
        (payload) => this.handleRemoteDelete(payload.old as SurveyItem)
      )
      .subscribe((status) => {
        console.log('[SyncEngine] Subscription status:', status);
        if (status === 'SUBSCRIBED') {
          this.setStatus('connected');
        } else if (status === 'CHANNEL_ERROR') {
          this.setStatus('error');
        }
      });
  }

  /**
   * Handle Excel cell change
   */
  private async handleExcelChange(event: ExcelChangeEvent): Promise<void> {
    console.log('[SyncEngine] Excel change:', event);

    // Get schema mapping for this sheet
    const mapping = this.schemaMappings.get(event.sheetName);
    if (!mapping) {
      console.log('[SyncEngine] No mapping for sheet:', event.sheetName);
      return;
    }

    // Skip header row
    if (event.rowIndex < mapping.data_start_row - 1) {
      return;
    }

    // Calculate which field was changed based on column
    const dataRowIndex = event.rowIndex - (mapping.data_start_row - 1);
    const field = this.getFieldFromColumn(mapping, event.columnIndex);

    if (!field) {
      console.log('[SyncEngine] Unknown column:', event.columnIndex);
      return;
    }

    // Find the survey item for this row
    const item = await this.getItemByExcelRow(
      mapping.module_id,
      mapping.category_id,
      dataRowIndex
    );

    if (!item) {
      // This might be a new row - handle accordingly
      console.log('[SyncEngine] No item found for row:', dataRowIndex);
      return;
    }

    // Mark as pending to ignore our own real-time update
    this.pendingChanges.add(item.highlight_id);

    // Update the item in Supabase
    await this.updateSurveyItem(item.highlight_id, field, event.newValue);

    // Clear pending after a short delay
    setTimeout(() => this.pendingChanges.delete(item.highlight_id), 1000);
  }

  /**
   * Handle worksheet added
   */
  private async handleSheetAdded(name: string, index: number): Promise<void> {
    console.log('[SyncEngine] Sheet added:', name);

    const parsed = parseSheetName(name);
    if (!parsed) {
      console.log('[SyncEngine] Could not parse sheet name:', name);
      return;
    }

    // TODO: Create new module/category in Supabase
    // This requires additional logic to map to template structure
  }

  /**
   * Handle worksheet deleted
   */
  private async handleSheetDeleted(id: string): Promise<void> {
    console.log('[SyncEngine] Sheet deleted:', id);
    // TODO: Handle category/module deletion
  }

  /**
   * Handle remote item insert (from Survey App)
   */
  private async handleRemoteInsert(item: SurveyItem): Promise<void> {
    // Skip if this is our own change
    if (this.pendingChanges.has(item.highlight_id)) {
      return;
    }

    console.log('[SyncEngine] Remote insert:', item.highlight_id);

    // Find the correct sheet for this item
    const mapping = this.findMappingForItem(item);
    if (!mapping) {
      console.log('[SyncEngine] No mapping for item:', item.module_id, item.category_id);
      return;
    }

    // Insert a new row in Excel
    const rowValues = this.itemToExcelRow(item, mapping);
    await insertRow(mapping.sheet_name, mapping.data_start_row - 1 + (item.excel_row_index || 0), rowValues);

    this.callbacks.onItemSynced?.(item);
  }

  /**
   * Handle remote item update (from Survey App)
   */
  private async handleRemoteUpdate(item: SurveyItem): Promise<void> {
    // Skip if this is our own change
    if (this.pendingChanges.has(item.highlight_id)) {
      return;
    }

    console.log('[SyncEngine] Remote update:', item.highlight_id);

    const mapping = this.findMappingForItem(item);
    if (!mapping || item.excel_row_index === null) {
      return;
    }

    // Update the specific cells that changed
    const excelRow = mapping.data_start_row + item.excel_row_index;

    // Update all fields
    if (item.changed_by !== undefined) {
      await updateCell(mapping.sheet_name, excelRow - 1, STANDARD_COLUMNS.CHANGED_BY, item.changed_by);
    }
    if (item.changed_date !== undefined) {
      await updateCell(mapping.sheet_name, excelRow - 1, STANDARD_COLUMNS.CHANGED_DATE, item.changed_date);
    }
    if (item.name !== undefined) {
      await updateCell(mapping.sheet_name, excelRow - 1, STANDARD_COLUMNS.ITEM_NAME, item.name);
    }
    // TODO: Update checklist responses, ball in court, notes

    this.callbacks.onItemSynced?.(item);
  }

  /**
   * Handle remote item delete (from Survey App)
   */
  private async handleRemoteDelete(item: SurveyItem): Promise<void> {
    console.log('[SyncEngine] Remote delete:', item.highlight_id);

    const mapping = this.findMappingForItem(item);
    if (!mapping || item.excel_row_index === null) {
      return;
    }

    await deleteRow(mapping.sheet_name, mapping.data_start_row - 1 + item.excel_row_index);
  }

  /**
   * Update presence in Supabase
   */
  private async updatePresence(): Promise<void> {
    const supabase = getSupabase();
    if (!supabase || !this.sessionId || !this.userId) return;

    await supabase.from('survey_presence').upsert({
      session_id: this.sessionId,
      user_id: this.userId,
      client_type: 'excel',
      last_seen: new Date().toISOString(),
    }, {
      onConflict: 'session_id,user_id,client_type',
    });
  }

  /**
   * Remove presence on disconnect
   */
  private async removePresence(): Promise<void> {
    const supabase = getSupabase();
    if (!supabase || !this.sessionId || !this.userId) return;

    await supabase
      .from('survey_presence')
      .delete()
      .eq('session_id', this.sessionId)
      .eq('user_id', this.userId)
      .eq('client_type', 'excel');
  }

  /**
   * Update survey item in Supabase
   */
  private async updateSurveyItem(
    highlightId: string,
    field: string,
    value: unknown
  ): Promise<void> {
    const supabase = getSupabase();
    if (!supabase || !this.sessionId) return;

    const { error } = await supabase
      .from('survey_items')
      .update({ [field]: value, version: supabase.rpc('increment_version') })
      .eq('session_id', this.sessionId)
      .eq('highlight_id', highlightId);

    if (error) {
      console.error('[SyncEngine] Failed to update item:', error);
      this.callbacks.onError?.(new Error(error.message));
    }
  }

  /**
   * Get survey item by Excel row index
   */
  private async getItemByExcelRow(
    moduleId: string,
    categoryId: string,
    rowIndex: number
  ): Promise<SurveyItem | null> {
    const supabase = getSupabase();
    if (!supabase || !this.sessionId) return null;

    const { data, error } = await supabase
      .from('survey_items')
      .select('*')
      .eq('session_id', this.sessionId)
      .eq('module_id', moduleId)
      .eq('category_id', categoryId)
      .eq('excel_row_index', rowIndex)
      .single();

    if (error) return null;
    return data;
  }

  /**
   * Find schema mapping for a survey item
   */
  private findMappingForItem(item: SurveyItem): ExcelSchemaMapping | undefined {
    for (const [, mapping] of this.schemaMappings) {
      if (mapping.module_id === item.module_id && mapping.category_id === item.category_id) {
        return mapping;
      }
    }
    return undefined;
  }

  /**
   * Get field name from column index using schema mapping
   */
  private getFieldFromColumn(mapping: ExcelSchemaMapping, columnIndex: number): string | null {
    // Standard columns
    if (columnIndex === STANDARD_COLUMNS.CHANGED_BY) return 'changed_by';
    if (columnIndex === STANDARD_COLUMNS.CHANGED_DATE) return 'changed_date';
    if (columnIndex === STANDARD_COLUMNS.ITEM_NAME) return 'name';

    // Check column mapping for checklist items
    const columnLetter = String.fromCharCode(65 + columnIndex);
    const fieldName = mapping.column_mapping[columnLetter];

    return fieldName || null;
  }

  /**
   * Convert survey item to Excel row values
   */
  private itemToExcelRow(item: SurveyItem, mapping: ExcelSchemaMapping): unknown[] {
    const row: unknown[] = [];

    row[STANDARD_COLUMNS.CHANGED_BY] = item.changed_by || '';
    row[STANDARD_COLUMNS.CHANGED_DATE] = item.changed_date || '';
    row[STANDARD_COLUMNS.ITEM_NAME] = item.name || '';

    // Add checklist responses based on column mapping
    for (const [col, field] of Object.entries(mapping.column_mapping)) {
      const colIndex = col.charCodeAt(0) - 65;
      if (field.startsWith('checklist_')) {
        const checklistId = field.replace('checklist_', '');
        row[colIndex] = item.checklist_responses[checklistId] || '';
      }
    }

    // Ball in court (second to last)
    // Notes (last)
    row.push(item.ball_in_court_name || '');
    row.push(item.notes || '');

    return row;
  }

  /**
   * Set status and notify
   */
  private setStatus(status: SyncStatus): void {
    this.status = status;
    this.callbacks.onStatusChange?.(status);
  }
}

// Singleton instance
let syncEngineInstance: SyncEngine | null = null;

export function getSyncEngine(callbacks?: SyncEngineCallbacks): SyncEngine {
  if (!syncEngineInstance) {
    syncEngineInstance = new SyncEngine(callbacks);
  }
  return syncEngineInstance;
}

export function resetSyncEngine(): void {
  if (syncEngineInstance) {
    syncEngineInstance.disconnect();
    syncEngineInstance = null;
  }
}
