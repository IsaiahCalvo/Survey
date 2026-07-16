// Template config helpers lifted out of PDFViewer.jsx.

// Drop the local-only row identifier before persisting template config.
export const sanitizeTemplateConfig = (template) => {
  if (!template || typeof template !== 'object') return template;
  const { supabaseId, ...rest } = template;
  return rest;
};
