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
  // Phone pass (KAL-652): these rows sat bare among rows with icons.
  [/^edit details\b/i, 'editList'],
  [/^(add|edit) labels?\b/i, 'tag'],
  [/^pdf tools\b/i, 'document'],
  [/^merge\b/i, 'pages'],
  [/^(un)?lock\b/i, 'lock'],
  [/^share\b/i, 'share'],
  [/^get link\b/i, 'hyperlink'],
  [/^add member\b/i, 'users'],
  // "Manage project" opens the team list; "Project settings" has the gear.
  [/^manage project\b/i, 'userRole'],
  [/^manage\b/i, 'settings'],
  [/^close\b/i, 'lock'],
  [/^reopen\b/i, 'undo'],
  [/^leave\b/i, 'signout'],
  [/^(make|making) available offline\b/i, 'download'],
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
// A caller may put { separator: true, key } between groups of rows. A line
// never starts or ends a group of rows or sits next to another line, so a
// group that comes out empty (a row that only shows for some people) leaves
// no stray line.
function tidySeparators(rows) {
  const out = [];
  for (const row of rows) {
    if (row.separator && (!out.length || out[out.length - 1].separator)) continue;
    out.push(row);
  }
  while (out.length && out[out.length - 1].separator) out.pop();
  return out;
}

export function arrangeMenuItems(items = []) {
  const list = items.filter(Boolean);
  const safe = tidySeparators(list.filter((item) => !item.danger));
  const danger = list.filter((item) => item.danger);
  if (!danger.length) return safe;
  if (!safe.some((item) => !item.separator)) return danger;
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
