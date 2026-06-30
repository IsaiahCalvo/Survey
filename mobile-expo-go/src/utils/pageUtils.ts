export const MAX_VISIBLE_CHECKLIST_ITEMS = 4;
export const CHECKLIST_ITEM_HEIGHT = 36;
export const CHECKLIST_ITEM_GAP = 5;
export const SURVEY_SHEET_FIXED_HEIGHT = 314;
export const PANEL_MAX_CHECKLIST_WINDOW_HEIGHT =
  (MAX_VISIBLE_CHECKLIST_ITEMS * CHECKLIST_ITEM_HEIGHT) +
  ((MAX_VISIBLE_CHECKLIST_ITEMS - 1) * CHECKLIST_ITEM_GAP);

export function getChecklistWindowHeight(itemCount: number) {
  const visibleCount = Math.min(MAX_VISIBLE_CHECKLIST_ITEMS, Math.max(1, itemCount));
  return (visibleCount * CHECKLIST_ITEM_HEIGHT) + ((visibleCount - 1) * CHECKLIST_ITEM_GAP);
}

export function capBottomPanelHeight(contentHeight: number, bottomInset: number, maxHeight: number) {
  return Math.min(maxHeight, Math.ceil(contentHeight + bottomInset));
}

export function summarizePages(pages: number[]) {
  if (!pages.length) return 'No pages';
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  if (sorted.length === 1) return `Page ${sorted[0]}`;
  const consecutive = sorted.every((page, index) => index === 0 || page === sorted[index - 1] + 1);
  return consecutive ? `Pages ${sorted[0]}-${sorted[sorted.length - 1]}` : `Pages ${sorted.join(', ')}`;
}

export function parsePageRangeDraft(value: string, maxPage: number) {
  const pages = new Set<number>();
  const errors: string[] = [];
  value.split(',').map((part) => part.trim()).filter(Boolean).forEach((part) => {
    const rangeMatch = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const start = Number.parseInt(rangeMatch[1], 10);
      const end = Number.parseInt(rangeMatch[2], 10);
      if (start > end) {
        errors.push(`${part} is backwards.`);
        return;
      }
      for (let page = start; page <= end; page += 1) {
        if (page < 1 || page > maxPage) errors.push(`${page} is outside this PDF.`);
        else pages.add(page);
      }
      return;
    }
    const page = Number.parseInt(part, 10);
    if (!Number.isFinite(page) || String(page) !== part) {
      errors.push(`${part} is not a page.`);
      return;
    }
    if (page < 1 || page > maxPage) errors.push(`${page} is outside this PDF.`);
    else pages.add(page);
  });
  return { pages: [...pages].sort((a, b) => a - b), error: errors[0] ?? null };
}
