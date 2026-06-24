export type ChecklistSelection = 'Y' | 'N' | 'N/A';
export type ChecklistResponse = {
    selection?: ChecklistSelection;
    note?: string;
};
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
//# sourceMappingURL=survey.d.ts.map