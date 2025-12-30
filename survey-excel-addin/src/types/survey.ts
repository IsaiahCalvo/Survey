/**
 * Survey Types
 * Shared types for Survey App <-> Excel sync
 */

// Survey item (highlight annotation) as stored in Supabase
export interface SurveyItem {
  id: string;
  session_id: string;
  highlight_id: string;
  module_id: string;
  category_id: string;
  name: string | null;
  page_number: number | null;
  bounds: Record<string, number> | null;
  ball_in_court_entity_id: string | null;
  ball_in_court_name: string | null;
  changed_by: string | null;
  changed_date: string | null;
  notes: string | null;
  checklist_responses: Record<string, string>;
  excel_row_index: number | null;
  version: number;
  created_at: string;
  updated_at: string;
}

// Survey session
export interface SurveySession {
  id: string;
  template_id: string;
  user_id: string;
  document_id: string | null;
  excel_file_path: string | null;
  excel_file_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// Excel schema mapping
export interface ExcelSchemaMapping {
  id: string;
  session_id: string;
  sheet_name: string;
  sheet_index: number | null;
  module_id: string;
  category_id: string;
  column_mapping: ColumnMapping;
  header_row: number;
  data_start_row: number;
  created_at: string;
  updated_at: string;
}

// Column mapping structure
export interface ColumnMapping {
  [columnLetter: string]: string; // e.g., { "A": "changed_by", "B": "changed_date", ... }
}

// User presence
export interface SurveyPresence {
  id: string;
  session_id: string;
  user_id: string;
  client_type: 'app' | 'excel' | 'web';
  display_name: string | null;
  cursor_position: CursorPosition | null;
  last_seen: string;
}

// Cursor position for presence
export interface CursorPosition {
  moduleId?: string;
  categoryId?: string;
  highlightId?: string;
  sheetName?: string;
  cellAddress?: string;
}

// Sync status
export type SyncStatus = 'disconnected' | 'connecting' | 'connected' | 'syncing' | 'error';

// Change event from Supabase real-time
export interface SyncChangeEvent {
  type: 'insert' | 'update' | 'delete';
  item: SurveyItem;
  oldItem?: SurveyItem;
}

// Excel cell change event
export interface ExcelChangeEvent {
  sheetName: string;
  sheetIndex: number;
  address: string;
  rowIndex: number;
  columnIndex: number;
  oldValue: unknown;
  newValue: unknown;
}

// Standard column layout for Survey exports
export const STANDARD_COLUMNS = {
  CHANGED_BY: 0,      // Column A
  CHANGED_DATE: 1,    // Column B
  ITEM_NAME: 2,       // Column C
  // Columns D onwards are checklist items
  // Second-to-last column is Ball in Court
  // Last column is Notes
} as const;

// Parse sheet name to extract module and category
export function parseSheetName(sheetName: string): { categoryName: string; moduleName: string } | null {
  // Format: "{Category} - {Module}"
  const match = sheetName.match(/^(.+)\s*-\s*(.+)$/);
  if (match) {
    return {
      categoryName: match[1].trim(),
      moduleName: match[2].trim(),
    };
  }
  return null;
}

// Convert column index to letter (0 = A, 1 = B, etc.)
export function columnIndexToLetter(index: number): string {
  let letter = '';
  while (index >= 0) {
    letter = String.fromCharCode((index % 26) + 65) + letter;
    index = Math.floor(index / 26) - 1;
  }
  return letter;
}

// Convert column letter to index (A = 0, B = 1, etc.)
export function columnLetterToIndex(letter: string): number {
  let index = 0;
  for (let i = 0; i < letter.length; i++) {
    index = index * 26 + (letter.charCodeAt(i) - 64);
  }
  return index - 1;
}
