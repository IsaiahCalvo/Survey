// The box a Pages-tab thumbnail is drawn in (owner 2026-10-07: "the pages are
// being shown too big ... when I rotate them ... they're way too long").
//
// Every thumbnail fits ONE square, keeping the page's shape (Drawboard's page
// strip works the same way): its longer side is the square's side, which is
// the card's width but never more than THUMBNAIL_BOX_MAX. So a wide drawing
// sheet fills the width, and the same sheet turned on its side is no taller
// than a letter page - turning a page never makes its row balloon.
//
// Pure (no DOM), so the size rule is unit-tested; PagesPanel draws the box
// with the CSS from thumbnailBoxStyle.

export const THUMBNAIL_BOX_MAX = 200;
const LETTER_RATIO = 11 / 8.5;

const ratioOf = (ratio) => (Number.isFinite(ratio) && ratio > 0 ? ratio : LETTER_RATIO);

/**
 * { width, height } in px of the thumbnail of a page whose height / width is
 * `ratio`, in a card `available` px wide.
 */
export function thumbnailBoxSize(ratio, available, max = THUMBNAIL_BOX_MAX) {
  const r = ratioOf(ratio);
  const side = Math.max(0, Math.min(Number(available) || 0, max));
  return r >= 1
    ? { width: side / r, height: side }
    : { width: side, height: side * r };
}

/** Inline style for the thumbnail box: width from the card, height from the shape. */
export function thumbnailBoxStyle(ratio, max = THUMBNAIL_BOX_MAX) {
  const r = ratioOf(ratio);
  const widthShare = r >= 1 ? 1 / r : 1;
  return {
    width: `calc(min(100%, ${max}px) * ${Number(widthShare.toFixed(5))})`,
    aspectRatio: `${Number((1 / r).toFixed(5))}`,
  };
}
