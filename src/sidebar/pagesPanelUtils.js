// Pages-panel click contract. Extracted so Node can prove jump vs mobile
// multi-select without mounting the thumbnail rail.

export function resolvePageThumbnailClick({
  pageNumber,
  numPages,
  mobileMode = false,
  mobileSelectMode = false,
} = {}) {
  const page = Number.parseInt(pageNumber, 10);
  if (!Number.isInteger(page) || page < 1) return { kind: 'ignore' };
  if (Number.isInteger(numPages) && numPages > 0 && page > numPages) {
    return { kind: 'ignore' };
  }
  if (mobileMode && mobileSelectMode) {
    return { kind: 'toggle-select', pageNumber: page };
  }
  return { kind: 'navigate', pageNumber: page };
}

export function isPagesPanelEmpty(numPages) {
  return !Number.isInteger(numPages) || numPages < 1;
}
