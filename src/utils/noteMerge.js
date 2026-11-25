// Audit round 5 #15: two people type in the same note at once. Whoever saves
// second used to replace the other's words. The note now keeps both: the
// other screen's text first, then the words typed here on a new line.

/**
 * The note to save when this screen typed `mine` starting from `base` while
 * another screen saved `theirs`.
 * @returns {{ text: string, merged: boolean } | null} null: nothing to save.
 */
export function mergeNoteEdit({ base, theirs, mine }) {
  const b = String(base ?? '');
  const t = String(theirs ?? '');
  const m = String(mine ?? '');
  if (m === t) return null;
  // Nothing typed here: the other screen's note stands.
  if (m === b) return null;
  // Nobody else changed it: save what was typed.
  if (t === b) return { text: m, merged: false };
  // Typed on top of their words already (seen before the save): keep it.
  if (t && m.startsWith(t)) return { text: m, merged: false };
  if (m && t.includes(m)) return null;
  const added = b && m.startsWith(b) ? m.slice(b.length).replace(/^\s+/, '') : m;
  if (!added) return null;
  return { text: t ? `${t}\n${added}` : added, merged: true };
}
