// Template config helpers lifted out of PDFViewer.jsx.

// Drop the local-only row identifier (and the shared-with-me note) before
// persisting template config.
export const sanitizeTemplateConfig = (template) => {
  if (!template || typeof template !== 'object') return template;
  // `sharedFrom` marks a template shared with me (this session only).
  const { supabaseId, sharedFrom, ...rest } = template;
  return rest;
};
