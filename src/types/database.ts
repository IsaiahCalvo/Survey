// Database type definitions for Supabase tables

export interface UserSettings {
  id: string;
  user_id: string;
  default_zoom: number;
  default_view_mode: 'single' | 'continuous';
  theme: 'light' | 'dark';
  show_toolbar: boolean;
  show_page_numbers: boolean;
  auto_save: boolean;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  user_id: string;
  name: string;
  description?: string;
  color?: string; // Hex color code
  created_at: string;
  updated_at: string;
}

export interface Template {
  id: string;
  user_id: string;
  name: string;
  description?: string;
  config?: Record<string, any>; // JSON configuration
  file_path?: string; // Path in Supabase Storage
  created_at: string;
  updated_at: string;
}

export interface Document {
  id: string;
  user_id: string;
  project_id: string;
  template_id?: string;
  name: string;
  description?: string;
  file_path: string; // Path in Supabase Storage
  file_size?: number; // Size in bytes
  page_count?: number;
  is_survey_mode: boolean;
  current_page: number;
  zoom_level: number;
  created_at: string;
  updated_at: string;
  last_opened_at?: string;
}

export interface Space {
  id: string;
  document_id: string;
  name: string;
  description?: string;
  color?: string; // Hex color code
  start_page: number;
  end_page: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// Helper types for creating new records (without auto-generated fields)
export type NewUserSettings = Omit<UserSettings, 'id' | 'created_at' | 'updated_at'>;
export type NewProject = Omit<Project, 'id' | 'created_at' | 'updated_at'>;
export type NewTemplate = Omit<Template, 'id' | 'created_at' | 'updated_at'>;
export type NewDocument = Omit<Document, 'id' | 'created_at' | 'updated_at' | 'last_opened_at'>;
export type NewSpace = Omit<Space, 'id' | 'created_at' | 'updated_at'>;

// Update types (optional fields)
export type UpdateUserSettings = Partial<Omit<UserSettings, 'id' | 'user_id' | 'created_at' | 'updated_at'>>;
export type UpdateProject = Partial<Omit<Project, 'id' | 'user_id' | 'created_at' | 'updated_at'>>;
export type UpdateTemplate = Partial<Omit<Template, 'id' | 'user_id' | 'created_at' | 'updated_at'>>;
export type UpdateDocument = Partial<Omit<Document, 'id' | 'user_id' | 'created_at' | 'updated_at'>>;
export type UpdateSpace = Partial<Omit<Space, 'id' | 'document_id' | 'created_at' | 'updated_at'>>;

// Extended types with relations
export interface DocumentWithProject extends Document {
  project?: Project;
  template?: Template;
  spaces?: Space[];
}

export interface ProjectWithDocuments extends Project {
  documents?: Document[];
}
