import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SHORTCUT_SECTIONS,
  chordKeycaps,
  documentedChords,
  isShortcutsSheetKey,
  isSnappingToggleKey,
  shortcutSectionsFor,
  toolChord,
} from '../src/utils/keyboardShortcuts.js';
import { TOOL_SHORTCUTS } from '../src/utils/toolShortcuts.js';
import { isRedoKeyEvent, isUndoKeyEvent } from '../src/utils/undoRedoHotkeys.js';
import { isTypingTarget, nudgeDeltaForKey } from '../src/utils/annotationFamilyRules.js';
import { isAnnotationSnapFree, isSnapFreeModifier } from '../src/utils/snapGuides.js';

// KAL-444: the keyboard shortcuts sheet must tell the truth in both
// directions. (1) Every row it shows has a key handler that does what the row
// says. (2) Every key the viewer's handlers answer to is either on the sheet
// or listed below as deliberately left off, with the reason. The old sheet
// promised Home / End / arrow-key page turns, Ctrl+W, Ctrl+Tab and "Reset
// zoom" — none of which did anything — and left out Undo, Copy, Delete,
// Print and a dozen more that did.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

const SRC = {
  viewer: read('src/PDFViewer.jsx'),
  svg: read('src/components/SVGAnnotationLayer.jsx'),
  interaction: read('src/hooks/useSVGInteraction.js'),
  container: read('src/components/PdfjsViewerContainer.jsx'),
  search: read('src/sidebar/SearchTextPanel.jsx'),
  pages: read('src/sidebar/PagesPanel.jsx'),
  region: read('src/RegionSelectionTool.jsx'),
  shell: read('src/AppShell.jsx'),
  dashboard: read('src/Dashboard.jsx'),
  electron: read('src/electron-main.js'),
  preload: read('src/preload.js'),
  overlay: read('src/components/KeyboardShortcutsOverlay.jsx'),
  sidebar: read('src/PDFSidebar.jsx'),
  hub: read('src/home/HubShell.jsx'),
};

// ---------------------------------------------------------------------------
// The viewer's main keyboard handler (PDFViewer "Keyboard shortcuts" effect),
// read as data: every branch's chord and what it does.
// ---------------------------------------------------------------------------

function mainHandlerBlock() {
  const start = SRC.viewer.indexOf('  // Keyboard shortcuts\n  useEffect(() => {\n    const handleKeyDown = (e) => {');
  assert.ok(start > 0, 'the main viewer keyboard handler moved — update this test');
  const end = SRC.viewer.indexOf("    window.addEventListener('keydown', handleKeyDown);", start);
  assert.ok(end > start);
  return SRC.viewer.slice(start, end);
}

/** [{ chord, body }] for every branch of the main handler. */
function mainHandlerBranches() {
  const block = mainHandlerBlock();
  const modStart = block.indexOf('if (!isFormField && (e.metaKey || e.ctrlKey)) {');
  assert.ok(modStart > 0, 'the Cmd/Ctrl section of the main handler moved');
  const branches = [];

  // Plain-key section: `if ((e.key === 'p' || e.key === 'P') && !e.metaKey ...`
  const plain = block.slice(0, modStart);
  const plainRe = /^\s*if \(\((?:e\.code === 'Key[A-Z]' \|\| )?e\.key === '([a-z])'[^\n]*$/gm;
  const plainMatches = [...plain.matchAll(plainRe)];
  plainMatches.forEach((match, i) => {
    const line = match[0];
    const shift = /(?<!!)e\.shiftKey/.test(line);
    const alt = /(?<!!)e\.altKey/.test(line);
    assert.match(line, /!e\.metaKey && !e\.ctrlKey/, `plain branch without a Cmd/Ctrl guard: ${line.trim()}`);
    // The branch runs until the next branch starts.
    const body = plain.slice(match.index, plainMatches[i + 1]?.index ?? plain.length);
    branches.push({ chord: [alt ? 'alt' : '', shift ? 'shift' : '', match[1]].filter(Boolean).join('+'), body });
  });

  // Cmd/Ctrl section: `if (key === 'f') {`
  const modEnd = block.indexOf("if (scrollMode === 'single')", modStart);
  const mod = block.slice(modStart, modEnd > 0 ? modEnd : undefined);
  const modRe = /if \(key === '(.)'(?: \|\| key === '(.)')?([^\n]*)/g;
  for (const match of mod.matchAll(modRe)) {
    const body = mod.slice(match.index, mod.indexOf('\n          }', match.index));
    const key = match[1] === '+' ? '=' : match[1];
    branches.push({ chord: `mod+${key}`, body });
  }
  return branches;
}

test('the main viewer handler is found and read (sanity)', () => {
  const chords = mainHandlerBranches().map((b) => b.chord);
  assert.ok(chords.length >= 25, `only ${chords.length} branches read: ${chords.join(' ')}`);
  for (const expected of ['v', 'alt+v', 'shift+v', 'shift+e', 'mod+f', 'mod+0', 'mod+=']) {
    assert.ok(chords.includes(expected), `missing ${expected}`);
  }
});

test('every tool row on the sheet is a branch of the handler that arms that tool', () => {
  const branches = new Map(mainHandlerBranches().map((b) => [b.chord, b.body]));
  const SELECT_MODE = { rectangle: ['select', 'rectangle'], lasso: ['select', 'lasso'], text: ['text-select', undefined] };
  for (const shortcut of TOOL_SHORTCUTS) {
    const chord = toolChord(shortcut);
    const body = branches.get(chord);
    assert.ok(body, `"${shortcut.label}  ${shortcut.badge}" is on the sheet but no branch handles ${chord}`);
    const family = body.match(/activateSelectFamilyMode\('(\w+)'\)/);
    const tool = family ? SELECT_MODE[family[1]][0] : body.match(/setActiveTool\('([\w-]+)'\)/)?.[1];
    assert.equal(tool, shortcut.tool, `${chord} arms ${tool}, the sheet says ${shortcut.label}`);
    if (shortcut.selectionMode) assert.equal(SELECT_MODE[family[1]][1], shortcut.selectionMode);
    if (shortcut.eraserMode) assert.match(body, new RegExp(`setEraserMode\\('${shortcut.eraserMode}'\\)`));
  }
});

test('the zoom rows say what the zoom keys do', () => {
  const branches = new Map(mainHandlerBranches().map((b) => [b.chord, b.body]));
  const label = (chord) => SHORTCUT_SECTIONS.flatMap((s) => s.items).find((i) => i.chords.includes(chord))?.label;
  assert.match(branches.get('mod+='), /zoomIn\(\)/);
  assert.equal(label('mod+='), 'Zoom in');
  assert.match(branches.get('mod+-'), /zoomOut\(\)/);
  assert.equal(label('mod+-'), 'Zoom out');
  assert.match(branches.get('mod+0'), /ZOOM_MODES\.FIT_PAGE/);
  assert.equal(label('mod+0'), 'Fit page');
  assert.match(branches.get('mod+1'), /ZOOM_MODES\.FIT_WIDTH/);
  assert.equal(label('mod+1'), 'Fit width');
  assert.match(branches.get('mod+2'), /ZOOM_MODES\.FIT_HEIGHT/);
  assert.equal(label('mod+2'), 'Fit height');
  assert.match(branches.get('mod+m'), /ZOOM_MODES\.MANUAL/);
  assert.match(branches.get('mod+f'), /openSearchPanel/);
  assert.match(branches.get('mod+s'), /handleSaveDocument\(\)/);
  assert.match(branches.get('mod+v'), /paste/i);
  // The desktop app catches Cmd/Ctrl + = - 0 before the page sees them and
  // forwards them; its 0 must land on the same Fit page as the browser's.
  assert.match(SRC.electron, /input\.key === '0'/);
  assert.match(SRC.viewer, /direction === 'reset'\) zoomControllerRef\.current\?\.setMode\(ZOOM_MODES\.FIT_PAGE\)/);
});

// ---------------------------------------------------------------------------
// Keys handled outside the main handler: checked by running the shared
// predicate where one exists, otherwise by the handler's own source.
// ---------------------------------------------------------------------------

const ev = (key, mods = {}) => ({
  key,
  code: /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : '',
  metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
  ...mods,
});

/** chord -> proof that something handles it (true, or a failing message). */
const HANDLED = {
  'mod+z': () => isUndoKeyEvent(ev('z', { metaKey: true })) && isUndoKeyEvent(ev('z', { ctrlKey: true })),
  'mod+shift+z': () => isRedoKeyEvent(ev('Z', { metaKey: true, shiftKey: true })) && isRedoKeyEvent(ev('z', { ctrlKey: true, shiftKey: true })),
  'mod+y': () => isRedoKeyEvent(ev('y', { metaKey: true })) && isRedoKeyEvent(ev('y', { ctrlKey: true })),
  arrows: () => ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].every((k) => nudgeDeltaForKey(ev(k)) !== null),
  'shift+arrows': () => {
    const small = nudgeDeltaForKey(ev('ArrowRight'));
    const large = nudgeDeltaForKey(ev('ArrowRight', { shiftKey: true }));
    return large.dx === small.dx * 10; // the row says "Nudge 10×"
  },
  '?': () => isShortcutsSheetKey(ev('?', { shiftKey: true })) && isShortcutsSheetKey(ev('?')),
  'mod+/': () => isShortcutsSheetKey({ ...ev('/', { metaKey: true }), code: 'Slash' })
    && isShortcutsSheetKey({ ...ev('/', { ctrlKey: true }), code: 'Slash' }),
  'mod+c': () => /isCopy = !e\.shiftKey && k(?:ey)? === 'c'/.test(SRC.svg),
  'mod+x': () => /isCut = !e\.shiftKey && k(?:ey)? === 'x'/.test(SRC.svg),
  'mod+d': () => /if \(key === 'd'\) \{[\s\S]{0,300}onDuplicateFamily\(/.test(SRC.svg),
  'mod+]': () => /isBracketRight = (?:e\.)?code === 'BracketRight'/.test(SRC.svg) && /e\.shiftKey \? 'front' : 'forward'/.test(SRC.svg),
  'mod+shift+]': () => /e\.shiftKey \? 'front' : 'forward'/.test(SRC.svg),
  'mod+[': () => /isBracketLeft = (?:e\.)?code === 'BracketLeft'/.test(SRC.svg) && /e\.shiftKey \? 'back' : 'backward'/.test(SRC.svg),
  'mod+shift+[': () => /e\.shiftKey \? 'back' : 'backward'/.test(SRC.svg),
  delete: () => /e\.key !== 'Delete' && e\.key !== 'Backspace'/.test(SRC.svg),
  backspace: () => /e\.key !== 'Delete' && e\.key !== 'Backspace'/.test(SRC.svg),
  escape: () => /resolveEscape\(/.test(SRC.viewer) && /'switch-to-pan'/.test(SRC.viewer)
    && /e\.key === 'Escape'\) \{[\s\S]{0,200}cancelPolyDraft\(\)/.test(SRC.svg),
  // Chunk 6 (Drawboard canvas audit): PageUp / PageDown glide one view.
  pageup: () => /event\.key !== 'PageDown' && event\.key !== 'PageUp'/.test(SRC.container)
    && /event\.key === 'PageDown' \? screen : -screen/.test(SRC.container),
  pagedown: () => /event\.key !== 'PageDown' && event\.key !== 'PageUp'/.test(SRC.container)
    && /event\.key === 'PageDown' \? screen : -screen/.test(SRC.container),
  // Hold Space: pan without putting the tool down. While a box or lasso is
  // being dragged, Space switches Window / Crossing instead.
  space: () => /addEventListener\('keydown', activateSpacePan, true\)/.test(SRC.container)
    && /isSpaceKey = \(event\) => event\?\.code === 'Space'/.test(SRC.container)
    && /\(e\.code === 'Space' \|\| e\.key === ' '\) && lassoStateRef\.current/.test(SRC.interaction)
    && /\(e\.code === 'Space' \|\| e\.key === ' '\) && marqueeStateRef\.current/.test(SRC.interaction)
    && /direction === 'window' \? 'crossing' : 'window'/.test(read('src/utils/marqueeSelection.js')),
  enter: () => /e\.key === 'Enter' && isInputFocused/.test(SRC.search)
    && /if \(e\.key === 'Enter'\) \{[\s\S]{0,200}commitPolyDraft\('finish'\)/.test(SRC.svg),
  'shift+enter': () => /e\.key === 'Enter' && isInputFocused\) \{\s*e\.preventDefault\(\);\s*if \(e\.shiftKey\) \{\s*goToPrevMatchRef/.test(SRC.search),
  'mod+g': () => /isCmdOrCtrlG = \(e\.ctrlKey \|\| e\.metaKey\) && !e\.altKey && e\.key\.toLowerCase\(\) === 'g'/.test(SRC.search),
  'mod+shift+g': () => /isCmdOrCtrlG\) \{\s*e\.preventDefault\(\);\s*if \(e\.shiftKey\) \{\s*goToPrevMatchRef/.test(SRC.search),
  click: () => /addPolyDraftPoint\(draft, resolveCreationSnap\(last, point, e\)\)/.test(SRC.svg),
  'shift+click': () => /addPolyDraftPoint\(draft, resolveCreationSnap\(last, point, e\)\)/.test(SRC.svg)
    && /if \(e\.shiftKey\) \{[\s\S]{0,900}setSelectedIds/.test(SRC.interaction),
  // Visio's Ctrl / Cmd + drag to copy, and Photoshop's Alt + right-drag (Mac:
  // Control + Option + drag) for the width and opacity.
  'mod+drag': () => /const copyDrop = moveDrag && !ds\.orbitBase/.test(SRC.interaction)
    && /onCopyDragDropRef\.current\(\{ indices: \[moveIndex\] \}/.test(SRC.interaction),
  'alt+right-drag': () => /if \(event\.button === 2\) return true;/.test(read('src/utils/brushAdjustGesture.js')),
  'ctrl+alt+drag': () => /return event\.button === 0 && event\.ctrlKey === true;/.test(read('src/utils/brushAdjustGesture.js')),
  'alt+click': () => /if \(e\.altKey\) \{\s*setSelectedIds\(\(previous\) => \{\s*const next = new Set\(previous\);\s*next\.delete\(index\)/.test(SRC.interaction),
  'mod+a': () => /\(event\.metaKey \|\| event\.ctrlKey\) && !event\.altKey && !event\.shiftKey && String\(event\.key\)\.toLowerCase\(\) === 'a'/.test(SRC.pages),
  'mod+p': () => /const isP = e\.key === 'p'/.test(SRC.viewer) && /openPanel\('window keydown'\)/.test(SRC.viewer),
  'mod+shift+p': () => /openPanel\('window keydown shift', \{ withMarkup: true \}\)/.test(SRC.viewer),
  // Desktop app only: the menu accelerator, and a renderer that listens.
  // Snapping (owner 2026-10-22): Shift+S flips the device switch; Alt held
  // mid-drag skips it for that drag.
  'shift+s': () => isSnappingToggleKey(ev('S', { shiftKey: true }))
    && !isSnappingToggleKey(ev('s')) && !isSnappingToggleKey(ev('S', { shiftKey: true, ctrlKey: true }))
    && /useSnappingShortcut\(/.test(SRC.shell),
  'alt+drag': () => isSnapFreeModifier({ altKey: true }) && isAnnotationSnapFree({ altKey: true }),
  'mod+o': () => /accelerator: 'CmdOrCtrl\+O'/.test(SRC.electron) && /electronAPI\.onOpenPdfMenu\(/.test(SRC.dashboard),
  'mod+shift+e': () => /accelerator: 'CmdOrCtrl\+Shift\+E'/.test(SRC.electron) && /electronAPI\.onExportAnnotatedPdfMenu\(/.test(SRC.viewer),
};

test('every row on the sheet has a key handler behind it', () => {
  const fromMain = new Set(mainHandlerBranches().map((b) => b.chord));
  const unbacked = documentedChords().filter((chord) => {
    if (fromMain.has(chord)) return false;
    const proof = HANDLED[chord];
    return !(proof && proof());
  });
  assert.deepEqual(unbacked, [], `rows with no working key: ${unbacked.join(', ')}`);
});

test('the rows the old sheet got wrong stay off it', () => {
  const chords = documentedChords();
  // No handler anywhere for these (page keys only ran in a "single page"
  // scroll mode the viewer forces back to continuous; tabs have no keys).
  for (const dead of ['home', 'end', 'mod+w', 'mod+tab', 'mod+shift+tab', 'b']) {
    assert.ok(!chords.includes(dead), `${dead} is listed but does nothing`);
  }
  assert.match(SRC.viewer, /\/\/ Enforce continuous mode\n\s*useEffect\(\(\) => \{\n\s*if \(scrollMode !== 'continuous'\)/);
  const labels = SHORTCUT_SECTIONS.flatMap((s) => s.items.map((i) => i.label));
  assert.ok(!labels.some((l) => /Fence/.test(l)), 'Space no longer cycles to Fence');
  assert.ok(!labels.includes('Reset zoom'), 'Cmd/Ctrl+0 fits the page');
});

// ---------------------------------------------------------------------------
// The other direction: a key a handler answers to must be on the sheet, or
// be named here as deliberately left off.
// ---------------------------------------------------------------------------

/** Chords handled on purpose but not on the sheet, and why. */
const UNLISTED_CHORDS = {
  'mod+shift+y': 'a harmless extra spelling of Redo (Cmd/Ctrl+Y with Shift held)',
  'mod+shift+d': 'developer debug overlay',
  'ctrl+shift+v': 'developer switch between the SVG and canvas renderers',
  'mod+shift+l': 'support: save a diagnostic log (also File > Save log in the desktop app)',
};

test('every Cmd/Ctrl chord the main handler answers to is on the sheet', () => {
  const chords = new Set(documentedChords());
  const missing = mainHandlerBranches().map((b) => b.chord).filter((c) => !chords.has(c) && !UNLISTED_CHORDS[c]);
  assert.deepEqual(missing, [], `handled but not on the sheet: ${missing.join(', ')}`);
});

test('the shared Redo predicate answers to nothing the sheet does not account for', () => {
  const chords = new Set([...documentedChords(), ...Object.keys(UNLISTED_CHORDS)]);
  for (const letter of 'abcdefghijklmnopqrstuvwxyz') {
    for (const shift of [false, true]) {
      const e = ev(shift ? letter.toUpperCase() : letter, { metaKey: true, shiftKey: shift });
      if (!isUndoKeyEvent(e) && !isRedoKeyEvent(e)) continue;
      const chord = `mod+${shift ? 'shift+' : ''}${letter}`;
      assert.ok(chords.has(chord), `${chord} undoes/redoes but is not accounted for`);
    }
  }
});

test('the developer and support chords really are handled (so the list above is not stale)', () => {
  assert.match(SRC.viewer, /\(event\.metaKey \|\| event\.ctrlKey\) \|\| !event\.shiftKey \|\| key !== 'd'/);
  assert.match(SRC.viewer, /e\.ctrlKey && e\.shiftKey && e\.key === 'V'/);
  assert.match(SRC.shell, /\(event\.metaKey \|\| event\.ctrlKey\)\s*&& event\.shiftKey\s*&& \(event\.key === 'L' \|\| event\.key === 'l'\)/);
});

// Every key literal any viewer key handler compares against.
const SWEEP_FILES = ['viewer', 'svg', 'interaction', 'container', 'search', 'pages', 'region', 'shell'];
const KEY_LITERAL_RES = [
  /(?<!typeof )\b(?:e|ev|evt|event)\??\.(?:key|code)\s*(?:\.toLowerCase\(\))?\s*[!=]==\s*'([^']*)'/g,
  /(?<![.\w])(?:key|k)\s*[!=]==\s*'([^']*)'/g,
  /String\((?:e|event)\.key\)\.toLowerCase\(\)\s*===\s*'([^']*)'/g,
];
const KEY_ALIASES = {
  ' ': 'space', Space: 'space', Spacebar: 'space',
  Escape: 'escape', Enter: 'enter', Delete: 'delete', Backspace: 'backspace',
  ArrowUp: 'arrows', ArrowDown: 'arrows', ArrowLeft: 'arrows', ArrowRight: 'arrows',
  BracketRight: ']', BracketLeft: '[', Slash: '/', '+': '=',
};
/** Keys compared against on purpose with no row of their own, and why. */
const UNLISTED_KEYS = {
  Shift: 'the modifier itself (held during a counter drag or a nudge burst)',
  F3: 'Windows-style spelling of Next / Previous match (Cmd/Ctrl+G is listed)',
  Home: 'moves within an open menu, not a document key',
  End: 'moves within an open menu, not a document key',
  ContextMenu: 'the keyboard\'s own context-menu key, opening a right-click menu',
  F10: 'Shift+F10, the standard keyboard spelling of a right-click',
  zoomGeneration: 'not a key: a prop-comparison loop variable that happens to be named key',
};

test('every key a viewer handler compares against is on the sheet or named as left off', () => {
  const documentedKeys = new Set(documentedChords().map((c) => c.split('+').pop()));
  const missing = new Map();
  for (const name of SWEEP_FILES) {
    for (const re of KEY_LITERAL_RES) {
      for (const match of SRC[name].matchAll(re)) {
        const raw = match[1];
        if (raw === 'string') continue; // typeof e.key === 'string'
        if (UNLISTED_KEYS[raw]) continue;
        const key = KEY_ALIASES[raw] || (/^Key[A-Z]$/.test(raw) ? raw.slice(3).toLowerCase() : raw.toLowerCase());
        if (documentedKeys.has(key) || Object.keys(UNLISTED_CHORDS).some((c) => c.endsWith(`+${key}`))) continue;
        missing.set(raw, name);
      }
    }
  }
  assert.deepEqual([...missing.entries()], [], 'a handler answers to a key the sheet never mentions');
});

// ---------------------------------------------------------------------------
// Opening the sheet.
// ---------------------------------------------------------------------------

test('"?" and Cmd/Ctrl+/ open the sheet; a plain slash or Alt chord does not', () => {
  assert.equal(isShortcutsSheetKey(ev('?', { shiftKey: true })), true);
  assert.equal(isShortcutsSheetKey({ ...ev('/', { ctrlKey: true }), code: 'Slash' }), true);
  assert.equal(isShortcutsSheetKey({ ...ev('/', { metaKey: true }), code: 'Slash' }), true);
  assert.equal(isShortcutsSheetKey({ ...ev('/'), code: 'Slash' }), false);
  assert.equal(isShortcutsSheetKey({ ...ev('?', { altKey: true, shiftKey: true }) }), false);
  assert.equal(isShortcutsSheetKey({ ...ev('?', { metaKey: true, shiftKey: true }) }), false, 'Cmd+Shift+/ is the Mac Help-menu search');
});

test('the key is ignored while typing — the same guard the other single-key shortcuts use', () => {
  const el = (tagName, extra = {}) => ({ tagName, isContentEditable: false, closest: () => null, ...extra });
  assert.equal(isTypingTarget(el('INPUT')), true, 'Survey panel fields, search, rename');
  assert.equal(isTypingTarget(el('TEXTAREA')), true);
  assert.equal(isTypingTarget(el('DIV', { isContentEditable: true })), true, 'a text box annotation being edited');
  assert.equal(isTypingTarget(el('TEXTAREA', { closest: (s) => (s === '.fabric-hidden-textarea' ? {} : null) })), true);
  assert.equal(isTypingTarget(el('DIV')), false);
  assert.equal(isTypingTarget(el('BUTTON')), false);
  // The sheet's own listener applies it before toggling (unless the sheet is
  // already open, when the key closes it).
  assert.match(SRC.overlay, /if \(!isShortcutsSheetKey\(event\)\) return;\s*if \(!isOpenRef\.current && isTypingTarget\(document\.activeElement\)\) return;/);
  assert.doesNotMatch(SRC.overlay, /useKeyPress\('\?'/, 'the unguarded listener is gone');
});

test('the sheet is mounted in the viewer as well as on Home', () => {
  assert.match(SRC.shell, /\n\s*<KeyboardShortcutsOverlay \/>/);
  assert.doesNotMatch(SRC.shell, /!isViewerVisible && <KeyboardShortcutsOverlay/);
});

test('there is a way in that is not a key: viewer rail button, Home account menu, desktop Help menu', () => {
  assert.match(SRC.sidebar, /aria-label="Keyboard shortcuts"[\s\S]{0,200}onClick=\{openKeyboardShortcuts\}/);
  assert.match(SRC.hub, /openKeyboardShortcuts\(\); \}\}>\s*<Icon name="keyboard"[^>]*\/>Keyboard shortcuts/);
  assert.match(SRC.hub, /<ProfileMenu userName=\{userName\} userMeta=\{userMeta\} showShortcuts \/>/);
  assert.match(SRC.electron, /label: 'Keyboard Shortcuts',[\s\S]{0,200}webContents\.send\('menu:keyboard-shortcuts'\)/);
  assert.match(SRC.preload, /onKeyboardShortcutsMenu:[\s\S]{0,150}'menu:keyboard-shortcuts'/);
  assert.match(SRC.overlay, /electronAPI\.onKeyboardShortcutsMenu\(open\)/);
});

test('keycaps: Cmd on a Mac, Ctrl elsewhere, Alt everywhere (as the tool tooltips say)', () => {
  assert.deepEqual(chordKeycaps('mod+shift+z', { isMac: true }), ['⌘', 'Shift', 'Z']);
  assert.deepEqual(chordKeycaps('mod+shift+z', { isMac: false }), ['Ctrl', 'Shift', 'Z']);
  assert.deepEqual(chordKeycaps('alt+v'), ['Alt', 'V']);
  assert.deepEqual(chordKeycaps('mod+='), ['Ctrl', '+']);
  assert.deepEqual(chordKeycaps('?'), ['?']);
  assert.deepEqual(chordKeycaps('escape'), ['Esc']);
  // Every tool row prints exactly the badge its tooltip prints.
  for (const shortcut of TOOL_SHORTCUTS) {
    assert.equal(chordKeycaps(toolChord(shortcut)).join('+'), shortcut.badge, shortcut.label);
  }
});

test('the web sheet leaves off the keys only the desktop app menu provides', () => {
  const web = shortcutSectionsFor({ isDesktopApp: false }).flatMap((s) => s.items.flatMap((i) => i.chords));
  const app = shortcutSectionsFor({ isDesktopApp: true }).flatMap((s) => s.items.flatMap((i) => i.chords));
  assert.ok(!web.includes('mod+o') && !web.includes('mod+shift+e'));
  assert.ok(app.includes('mod+o') && app.includes('mod+shift+e'));
});
