export const CONTENT_TYPE_COLORS = Object.freeze({
  document: '#7ab7e6',
  project: '#d8a84e',
  template: '#c293e6',
});

export function getContentTypeIconColor(contentType, fallback = 'currentColor') {
  return CONTENT_TYPE_COLORS[contentType] || fallback;
}
