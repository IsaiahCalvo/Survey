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
  [/^make (owner|editor|viewer)\b|^change role\b/i, 'userRole'],
  [/^resend\b/i, 'mail'],
  [/^invite\b/i, 'users'],
  [/^view activity\b/i, 'history'],
  [/^delete\b|^remove\b|^revoke\b/i, 'trash'],
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

// Where an action menu opened from a row's More button goes: under the button,
// its right edge on the button's, flipped above when it would run off the
// bottom. Fixed to the window, so a scrolling list (the access lists) never
// clips it. `rect` is the button's getBoundingClientRect().
export function menuAtButton(rect, { width = 180, height = 160, gap = 4, margin = 8, viewport = { width: 1024, height: 768 } } = {}) {
  const left = Math.max(margin, Math.min(rect.right - width, viewport.width - width - margin));
  const below = rect.bottom + gap;
  const top = below + height <= viewport.height - margin ? below : Math.max(margin, rect.top - gap - height);
  return { left, top };
}

// A menu row is 28px on a mouse and 44px on a touch screen (hub.css), which
// menuAtButton needs to know before the menu is drawn.
export function menuRowHeight() {
  return typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches ? 44 : 28;
}
