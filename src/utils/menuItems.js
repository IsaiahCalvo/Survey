// Pure helpers for action menus (components/MenuRows.jsx draws the rows).
// No React here, so node tests can import it.

// First match wins, so the longer phrases come before the single words.
const ICON_BY_LABEL = [
  [/^move\b/i, 'moveTo'],
  [/^copy to\b/i, 'moveTo'],
  [/^duplicate\b/i, 'duplicate'],
  [/^copy\b/i, 'copy'],
  [/^cut\b/i, 'scissors'],
  [/^paste\b/i, 'paste'],
  [/^rename\b/i, 'edit'],
  [/^pdf tools\b/i, 'document'],
  [/^merge\b/i, 'pages'],
  [/^(un)?lock\b/i, 'lock'],
  [/^share\b/i, 'share'],
  [/^get link\b/i, 'share'],
  [/^add member\b/i, 'users'],
  [/^manage\b/i, 'settings'],
  [/^upload\b/i, 'upload'],
  [/^download\b|^export\b/i, 'download'],
  [/^restore\b/i, 'undo'],
  [/^delete\b|^remove\b/i, 'trash'],
];

export function menuIconFor(label) {
  const text = String(label || '').trim();
  const hit = ICON_BY_LABEL.find(([pattern]) => pattern.test(text));
  return hit ? hit[1] : null;
}

/** Danger rows last, behind one separator; the other rows keep their order. */
export function arrangeMenuItems(items = []) {
  const list = items.filter(Boolean);
  const safe = list.filter((item) => !item.danger);
  const danger = list.filter((item) => item.danger);
  if (!danger.length || !safe.length) return list;
  return [...safe, { separator: true, key: 'danger-separator' }, ...danger];
}
