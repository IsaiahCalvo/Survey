// UX: The app has two LOCKED interface reds — destructive #d95a56 and validation #d97766 — do NOT use either here and do NOT change them; this is a page-annotation colour, deliberately distinct from UI chrome.
export const PENDING_REDACTION_OUTLINE_COLOR = '#d0021b';
export const APPLIED_REDACTION_FILL_COLOR = '#000000';

export const PENDING_REDACTION_OUTLINE_PDF_RGB = PENDING_REDACTION_OUTLINE_COLOR
  .match(/[a-f\d]{2}/gi)
  .map((channel) => Number.parseInt(channel, 16) / 255);
