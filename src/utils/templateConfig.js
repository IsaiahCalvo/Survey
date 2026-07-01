// Template config helpers lifted out of PDFViewer.jsx (de-fragilize campaign).

// Sanitize a template object before persisting its config to Supabase: drop the
// local-only `supabaseId` (the row's own PK, not part of the config payload) and
// return the rest. Non-object / nullish inputs pass through unchanged.
export const sanitizeTemplateConfig = (template) => {
  if (!template || typeof template !== 'object') return template;
  const { supabaseId, ...rest } = template;
  return rest;
};
