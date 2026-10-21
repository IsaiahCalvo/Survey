// Smart fill (beta) match bookkeeping for SVGAnnotationLayer, kept pure so
// node tests can pin it.

const centreInside = (b, m) => {
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  return cx >= m.x && cx <= m.x + m.width && cy >= m.y && cy <= m.y + m.height;
};

// A found match stays offered until a Survey marker actually sits on it. A
// tap opens the Categorize dialog with a pending marker there; Cancel takes
// that marker away, so the match is offered again without a new search.
export function offeredSmartFillMatches(matches = [], markers = []) {
  if (!matches.length) return matches;
  const live = (markers || []).filter(Boolean);
  if (!live.length) return matches;
  return matches.filter((b) => !live.some((m) => centreInside(b, m)));
}

// Matches found from a marker go once that marker is gone from the page
// (its category deleted, or the marker itself deleted), even when the
// category-delete event did not name it.
export function isSmartFillMatchSourceGone(sourceMarkerId, markers = []) {
  if (sourceMarkerId == null) return false;
  return !(markers || []).some((m) => m && String(m.annotationId ?? m.id) === String(sourceMarkerId));
}
