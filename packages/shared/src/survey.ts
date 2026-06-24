// Core Survey domain shapes — ported verbatim from the mobile App.tsx type
// definitions (which match the desktop template/region data structures).
//
// NOTE: the full `Marker` model is intentionally NOT shared yet. Desktop and
// mobile model it differently and it is entangled with the Excel-sync identity
// records; unifying it is scheduled as its own phase (see the migration plan).
// Only the marker SUB-shapes that already match (Entity, ChecklistResponses)
// live here.

export type ChecklistSelection = 'Y' | 'N' | 'N/A';

export type ChecklistResponse = {
  selection?: ChecklistSelection;
  note?: string;
};

// Keyed by checklist-item id.
export type ChecklistResponses = Record<string, ChecklistResponse>;

export type Entity = {
  id: string;
  name: string;
  color: string;
};

export type SurveyChecklistItem = {
  id: string;
  text: string;
  archived?: boolean;
};

export type SurveyCategory = {
  id: string;
  name: string;
  checklist: SurveyChecklistItem[];
};

export type SurveyModule = {
  id: string;
  name: string;
  categories: SurveyCategory[];
};

export type SurveyTemplate = {
  id: string;
  name: string;
  modules: SurveyModule[];
  entities: Entity[];
};

// --- Regions / Spaces (normalized 0..1 bounds; visibility flags) ---

export type RegionBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type RegionConfig = {
  id: string;
  name: string;
  page: number;
  bounds: RegionBounds;
  surveyBound: boolean;
  showCanvasAnnotations: boolean;
  showSurveyAnnotations: boolean;
};

export type SpaceConfig = {
  id: string;
  name: string;
  pages: number[];
  expanded: boolean;
  regions: RegionConfig[];
};
