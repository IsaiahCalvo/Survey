// The size of a newly inserted blank page (owner 2026-10-07: "if we insert a
// page, it just matches the page above it's dimensions").
//
// - The reference is the page the blank goes AFTER (the page above it). A
//   blank inserted at the very top (afterPage 0) takes the page below it,
//   which is page 1.
// - The blank matches the reference AS IT IS SHOWN: a 17x11 sheet stored with
//   a 90 degree turn shows standing up (11x17), so the blank is 11x17 too.
//   The blank itself is stored unturned (rotation 0).
//
// Pure, shared by the pdf-lib rewrite (utils/pdfPageMutation.js) and the
// instant page view (utils/pageViewDocument.js) so the two always agree.

const normRotation = (value) => ((Math.round(Number(value) || 0) % 360) + 360) % 360;

/** 1-based page whose size a blank inserted after `afterPage` copies. */
export function blankPageReferencePage(afterPage, pageCount) {
  const count = Math.max(1, Math.floor(Number(pageCount) || 1));
  const after = Math.floor(Number(afterPage) || 0);
  return Math.min(count, Math.max(1, after));
}

/**
 * The blank page's { width, height } (PDF points, rotation 0) for a
 * reference page of unturned size `width` x `height` shown at `rotation`.
 */
export function blankPageSize({ width, height, rotation = 0 } = {}) {
  const w = Number(width);
  const h = Number(height);
  if (!(w > 0) || !(h > 0)) return { width: 612, height: 792 };
  return normRotation(rotation) % 180 !== 0 ? { width: h, height: w } : { width: w, height: h };
}
