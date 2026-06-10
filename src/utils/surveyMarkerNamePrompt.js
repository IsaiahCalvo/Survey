// Name Prompt Modal commit semantics (BL-22). The input state uses a null
// sentinel: null = untouched (display the category-derived default), any
// string — including '' — is the user's text shown verbatim. Committing an
// empty/whitespace name falls back to the default because markers must keep
// a non-empty name (items-map and Excel-sync flows match by name).
export const resolveSurveyMarkerPromptName = (input, defaultName) =>
  (input ?? defaultName).trim() || defaultName;
