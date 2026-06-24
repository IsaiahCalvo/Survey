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

// The survey-content fields a Survey Marker carries IDENTICALLY in both the
// desktop and mobile apps. This is the shared CORE only — each app keeps its
// own marker type that extends this with app-specific fields (desktop: Excel-
// sync / audit / persistence columns; mobile: on-screen id, coordinates, notes,
// photos). Deliberately excludes fields whose shape differs across apps
// (entity reference, coordinates vs bounds, note string vs object). Full marker
// unification (mobile fully adopting the desktop shape) is the deferred next
// phase — see README. Touching this must not change any Excel-sync field.
export type SurveyMarkerCore = {
  moduleId: string;
  categoryId: string | null;
  name: string;
  checklistResponses: ChecklistResponses;
};

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
