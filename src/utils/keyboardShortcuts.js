/**
 * keyboardShortcuts.js — what the keyboard shortcuts sheet lists, and the key
 * that opens it.
 *
 * Intended UX (KAL-444): the sheet is the one place a person can read every
 * key the app answers to, and it opens from wherever they are — Home or a
 * document — with "?" (Shift+/), Cmd/Ctrl+/, or the keyboard button. A help
 * sheet that lists keys that do nothing (it used to promise Home, End, the
 * arrow keys for pages, and Ctrl+W / Ctrl+Tab for tabs) teaches people the
 * app is broken, so every row here is checked against the real key handlers
 * by tests/keyboardShortcutsSheet.test.mjs, and a new handler with no row
 * fails that test too.
 *
 * Data only — no React, no DOM — so the sheet, the tests and the
 * click-every-control walkthrough read one list. Tool letters are not retyped
 * here: they come from src/utils/toolShortcuts.js, the map the keyboard
 * handler and the tool tooltips already obey.
 *
 * A chord is written lowercase, joined by '+': modifiers first ('mod' is Cmd
 * on a Mac and Ctrl elsewhere; 'shift'; 'alt'), then the key ('f', '0', '[',
 * '?' — Shift+/ on most layouts — or a name: 'space', 'enter', 'escape',
 * 'delete', 'backspace', 'arrows', 'click').
 */
import { TOOL_SHORTCUTS } from './toolShortcuts.js';

/** A tool binding from toolShortcuts.js written as a chord. */
export const toolChord = (shortcut) => [
  shortcut.alt ? 'alt' : '',
  shortcut.shift ? 'shift' : '',
  shortcut.key,
].filter(Boolean).join('+');

/**
 * The sheet, top to bottom. Each item: `chords` (one row may answer to more
 * than one chord — shown as "A or B"), `label`, and `desktopAppOnly` for keys
 * that only the installed desktop app's menu provides (a browser keeps those
 * keys for itself, so the web sheet does not offer them).
 */
export const SHORTCUT_SECTIONS = [
  {
    title: 'Tools',
    items: TOOL_SHORTCUTS.map((shortcut) => ({ chords: [toolChord(shortcut)], label: shortcut.label })),
  },
  {
    title: 'View',
    items: [
      { chords: ['mod+='], label: 'Zoom in' },
      { chords: ['mod+-'], label: 'Zoom out' },
      { chords: ['mod+0'], label: 'Fit page' },
      { chords: ['mod+1'], label: 'Fit width' },
      { chords: ['mod+2'], label: 'Fit height' },
      // UX: a fit mode re-fits whenever the window changes size; this keeps
      // the zoom where it is instead.
      { chords: ['mod+m'], label: 'Keep this zoom (stop fitting)' },
      { chords: ['space'], label: 'Hold to pan' },
      // Drawboard canvas audit chunk 6: one view at a time, gliding.
      { chords: ['pageup'], label: 'Scroll up one screen' },
      { chords: ['pagedown'], label: 'Scroll down one screen' },
    ],
  },
  {
    title: 'Search',
    items: [
      { chords: ['mod+f'], label: 'Search text' },
      { chords: ['enter', 'mod+g'], label: 'Next match' },
      { chords: ['shift+enter', 'mod+shift+g'], label: 'Previous match' },
    ],
  },
  {
    title: 'Edit',
    items: [
      { chords: ['mod+z'], label: 'Undo' },
      { chords: ['mod+shift+z', 'mod+y'], label: 'Redo' },
      { chords: ['mod+c'], label: 'Copy' },
      { chords: ['mod+x'], label: 'Cut' },
      { chords: ['mod+v'], label: 'Paste at the pointer' },
      { chords: ['mod+d'], label: 'Duplicate' },
      { chords: ['delete', 'backspace'], label: 'Delete' },
      { chords: ['arrows'], label: 'Nudge' },
      { chords: ['shift+arrows'], label: 'Nudge 10×' },
      { chords: ['mod+]'], label: 'Bring forward' },
      { chords: ['mod+shift+]'], label: 'Bring to front' },
      { chords: ['mod+['], label: 'Send backward' },
      { chords: ['mod+shift+['], label: 'Send to back' },
      { chords: ['escape'], label: 'Deselect, or put the tool down' },
    ],
  },
  {
    title: 'Selecting',
    items: [
      { chords: ['shift+click'], label: 'Add to the selection' },
      { chords: ['alt+click'], label: 'Remove from the selection' },
      // UX: was "Cycle Window, Crossing, and Fence" — Space has toggled only
      // Window and Crossing (for the box and the lasso alike) since Fence left.
      { chords: ['space'], label: 'While dragging: switch Window / Crossing' },
    ],
  },
  {
    // UX: these keys only act while a polygon or polyline is being placed —
    // listed separately so they read as part of that flow.
    title: 'Polygon & Polyline',
    items: [
      { chords: ['click'], label: 'Place the next point' },
      { chords: ['shift+click'], label: 'Keep the next segment at 45°' },
      { chords: ['enter'], label: 'Finish the shape' },
      { chords: ['escape'], label: 'Discard the unfinished shape' },
    ],
  },
  {
    // UX: these act while the Pages panel is the last thing clicked.
    title: 'Pages panel',
    items: [
      { chords: ['mod+a'], label: 'Select every page' },
    ],
  },
  {
    title: 'Document',
    items: [
      { chords: ['mod+s'], label: 'Save' },
      { chords: ['mod+p'], label: 'Print' },
      // Both print the annotations; Shift prints them from a temporary
      // flattened PDF instead of from the page view.
      { chords: ['mod+shift+p'], label: 'Print a flattened copy' },
      { chords: ['mod+o'], label: 'Open a PDF', desktopAppOnly: true },
      { chords: ['mod+shift+e'], label: 'Export annotated PDF', desktopAppOnly: true },
    ],
  },
  {
    title: 'Help',
    items: [
      { chords: ['?', 'mod+/'], label: 'Show or hide this list' },
    ],
  },
];

/** Every chord the sheet promises, for the tests. */
export const documentedChords = (sections = SHORTCUT_SECTIONS) => [
  ...new Set(sections.flatMap((section) => section.items.flatMap((item) => item.chords))),
];

const NAMED_KEYS = {
  space: 'Space',
  enter: 'Enter',
  escape: 'Esc',
  delete: 'Delete',
  backspace: 'Backspace',
  arrows: 'Arrow keys',
  pageup: 'Page Up',
  pagedown: 'Page Down',
  click: 'Click',
  '=': '+',
};

/**
 * The keycaps for one chord. `isMac` turns 'mod' into ⌘; elsewhere it is
 * Ctrl. Alt stays "Alt" on every platform because the tool tooltips print
 * "Alt+V" and the sheet must say the same thing they do.
 */
export function chordKeycaps(chord, { isMac = false } = {}) {
  const parts = String(chord).split('+');
  // A chord ending in '+' itself is not used; '=' stands for the plus key.
  const key = parts.pop();
  const caps = parts.map((part) => {
    if (part === 'mod') return isMac ? '⌘' : 'Ctrl';
    if (part === 'shift') return 'Shift';
    if (part === 'alt') return 'Alt';
    return part;
  });
  caps.push(NAMED_KEYS[key] || (key.length === 1 ? key.toUpperCase() : key));
  return caps;
}

/** The sheet for one platform: desktop-app-only rows dropped on the web. */
export function shortcutSectionsFor({ isDesktopApp = false } = {}) {
  return SHORTCUT_SECTIONS
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => isDesktopApp || !item.desktopAppOnly),
    }))
    .filter((section) => section.items.length > 0);
}

/**
 * Does this keydown open (or close) the sheet? "?" — Shift+/ on most
 * layouts, its own key on others — or Cmd/Ctrl+/. Never with Alt, which
 * types other characters on many layouts.
 */
export function isShortcutsSheetKey(event) {
  if (!event || event.altKey) return false;
  const mod = Boolean(event.metaKey || event.ctrlKey);
  if (event.key === '?' && !mod) return true;
  return mod && !event.shiftKey && (event.key === '/' || event.code === 'Slash');
}

/** Window event the sheet listens for; anything can open it with this. */
export const OPEN_SHORTCUTS_EVENT = 'survey:open-keyboard-shortcuts';

export function openKeyboardShortcuts() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(OPEN_SHORTCUTS_EVENT));
}
