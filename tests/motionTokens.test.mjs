// Drawboard shell audit, Chunk A (2026-10-13): one small set of motion tokens
// (tokens.css) and the shared enter / exit rules built on them (motion.css).
// Keeps the CSS tokens and the JS mirror (src/utils/motion.js) in step, checks
// reduced motion makes every token instant, and pins the wiring that gives
// menus, dialogs and toasts the same motion.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { MOTION_MS } from '../src/utils/motion.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const tokens = read('src/styles/tokens.css');
const motion = read('src/styles/motion.css');

function block(css, startPattern) {
  const start = css.search(startPattern);
  assert.ok(start >= 0, `block ${startPattern} not found`);
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}') { depth -= 1; if (depth === 0) return css.slice(start, i + 1); }
  }
  throw new Error('unbalanced');
}

const TOKEN_FOR = {
  menu: '--motion-menu', menuExit: '--motion-menu-exit',
  dialog: '--motion-dialog', dialogExit: '--motion-dialog-exit',
  toast: '--motion-toast', toastExit: '--motion-toast-exit',
  panel: '--motion-panel', collapse: '--motion-collapse', state: '--motion-state',
};

test('tokens.css holds the Drawboard-measured durations, and src/utils/motion.js mirrors them', () => {
  const root = block(tokens, /MOTION \(Drawboard shell audit[\s\S]*?:root \{/);
  for (const [key, name] of Object.entries(TOKEN_FOR)) {
    const m = root.match(new RegExp(`${name}:\\s*(\\d+)ms;`));
    assert.ok(m, `${name} missing`);
    assert.equal(Number(m[1]), MOTION_MS[key], `${name} vs MOTION_MS.${key}`);
  }
  // The measured numbers themselves.
  assert.equal(MOTION_MS.menu, 100);
  assert.equal(MOTION_MS.dialog, 150);
  assert.equal(MOTION_MS.panel, 200);
  assert.equal(MOTION_MS.collapse, 300);
  assert.ok(MOTION_MS.menuExit < MOTION_MS.menu && MOTION_MS.dialogExit < MOTION_MS.dialog, 'exits are faster');
  assert.match(root, /--motion-menu-shift:\s*8px;/);
  assert.match(root, /--motion-dialog-scale:\s*0\.98;/);
  for (const ease of ['--ease-out', '--ease-standard', '--ease-in', '--ease-emphasized']) {
    assert.match(root, new RegExp(`${ease}:\\s*cubic-bezier\\(`), `${ease} defined`);
  }
});

test('reduced motion sets every duration token to 0ms', () => {
  const reduced = block(tokens, /@media \(prefers-reduced-motion: reduce\) \{\s*:root \{\s*--motion-menu: 0ms/);
  for (const name of Object.values(TOKEN_FOR)) {
    assert.match(reduced, new RegExp(`${name}:\\s*0ms;`), `${name} is 0 under reduced motion`);
  }
});

test('motion.css: keyframes move translate / scale (never transform), shared rules have no specificity and only run without reduced motion', () => {
  const frames = [...motion.matchAll(/@keyframes (sv-[\w-]+) \{([\s\S]*?)\n\}/g)];
  assert.ok(frames.length >= 8, 'the shared keyframes are there');
  for (const [, name, body] of frames) {
    assert.doesNotMatch(body, /\btransform\s*:/, `${name} must not overwrite a component's transform`);
  }
  const shared = block(motion, /@media \(prefers-reduced-motion: no-preference\) \{/);
  assert.match(shared, /:where\(\[role="menu"\]:not\(\.hub-section-menu\)\)/);
  assert.match(shared, /animation: sv-menu-in var\(--motion-menu\) var\(--ease-out\);/);
  assert.match(shared, /:where\(\[role="dialog"\]\[aria-modal="true"\], \[role="alertdialog"\]\[aria-modal="true"\]\) \{\s*animation: sv-dialog-in var\(--motion-dialog\) var\(--ease-out\);/);
  assert.match(shared, /\[style\*="position: fixed"\]:has\(> \[role="dialog"\]\[aria-modal="true"\]\)/, 'the scrim fades with the card');
  assert.match(shared, /\[data-motion-state="closing"\] \{\s*animation: sv-fade-out var\(--motion-dialog-exit\) var\(--ease-in\) forwards;/);
  // Entries carry no fill, so a persistent element is back on its own styles afterwards.
  assert.doesNotMatch(shared, /animation: sv-(menu|dialog|fade)-in[^;]*\b(both|forwards)\b/);
  // The shared enter rules are all zero-specificity.
  const sharedCode = shared.replace(/\/\*[\s\S]*?\*\//g, '');
  const enterRules = [...sharedCode.matchAll(/^\s{2}([^@\s{}][^{}]*)\{\s*animation(?:-name)?: sv-[\w-]+-in/gm)];
  assert.ok(enterRules.length >= 4, `found ${enterRules.length} shared enter rules`);
  for (const rule of enterRules) {
    assert.match(rule[1].trim(), /^:where\(/, `${rule[1].trim()} should be wrapped in :where()`);
  }
  assert.match(read('src/styles.css'), /^@import '\.\/styles\/tokens\.css';\n.*\n@import '\.\/styles\/motion\.css';/m);
});

test('toasts use the shared toast motion (ToastHost and UndoToast), with no motion under reduced motion', () => {
  const host = read('src/components/ToastHost.css');
  assert.match(block(host, /^\.app-toast \{/m), /animation: sv-toast-in-up var\(--motion-toast\) var\(--ease-out\);/);
  assert.match(block(host, /^\.app-toast\[data-state="closing"\] \{/m), /animation: sv-toast-out var\(--motion-toast-exit\) var\(--ease-in\) forwards;/);
  assert.match(host, /html\[data-undo-toast-open\] \.app-toast-host \{\s*bottom: 68px;/);
  assert.match(block(host, /@media \(prefers-reduced-motion: reduce\) \{/), /animation: none;/);
  const undo = read('src/components/collab/UndoToast.css');
  assert.match(block(undo, /^\.undo-toast \{/m), /animation: sv-toast-in-up var\(--motion-toast\) var\(--ease-out\);/);
  assert.match(block(undo, /^\.undo-toast--leaving \{/m), /animation: sv-toast-out var\(--motion-toast-exit\) var\(--ease-in\) forwards;/);
  assert.doesNotMatch(undo, /undo-toast-fade-in/);
  const hostJsx = read('src/components/ToastHost.jsx');
  assert.match(hostJsx, /createToastStore\(\{ exitMs: \(\) => exitMs\('toast'\) \}\)/);
  // Hovering a toast still pauses it (joined with the shared tooltip's own
  // handlers through withOwnHandlers).
  assert.match(hostJsx, /onMouseEnter: \(\) => store\.pause\(t\.id\)/);
  assert.match(hostJsx, /className="app-toast__action"/);
  assert.match(hostJsx, /'app-toast-dismiss'/);
});

test('the shared dialogs keep their card for the exit through MotionPresence', () => {
  const bulk = read('src/home/BulkModals.jsx');
  assert.equal(bulk.split('if (!open) return <MotionPresence open={false} />;').length - 1, 3, 'MoveCopy, Confirm, Rename');
  assert.equal(bulk.split('<MotionPresence open>').length - 1, 3);
  const prompts = read('src/components/dialogPrompts.jsx');
  assert.match(prompts, /if \(!open\) return <MotionPresence open=\{false\} \/>;/);
  assert.match(prompts, /<MotionPresence open>/);
  const sheet = read('src/components/KeyboardShortcutsOverlay.jsx');
  assert.match(sheet, /return <MotionPresence open=\{false\} \/>;/);
  assert.match(sheet, /<MotionPresence open>\s*<div\s+data-keyboard-shortcuts-modal="true"/);
});

test('dialogs that had their own entry now use the dialog token', () => {
  for (const [file, pattern] of [
    ['src/components/AuthModal.css', /animation: sv-dialog-in var\(--motion-dialog\) var\(--ease-out\);/],
    ['src/components/AccountSettings.css', /animation: sv-dialog-in var\(--motion-dialog\) var\(--ease-out\);/],
    ['src/components/collab/ConfirmDeleteModal.css', /confirm-delete-modal-fade-in var\(--motion-dialog\) var\(--ease-out\)/],
    ['src/components/collab/ReSignInModal.css', /re-signin-modal-enter var\(--motion-dialog\) var\(--ease-out\) forwards/],
    ['src/components/PrintPanel.css', /pp-pop var\(--motion-dialog\) var\(--ease-out\)/],
  ]) {
    assert.match(read(file), pattern, file);
  }
  assert.doesNotMatch(read('src/components/SpaceSelectionDialog.jsx'), /animation: 'fadeIn/);
});

test('chrome curves moved onto the tokens: no raw cubic-bezier left in the converted stylesheets', () => {
  for (const file of [
    'src/home/hub.css', 'src/styles/swatches.css', 'src/styles/states.css', 'src/mobile/mobileSurveyPanel.css',
    'src/surveyRailPanel.css', 'src/components/surveyMarkerNotes.css', 'src/components/PrintPanel.css',
    'src/components/collab/UndoToast.css', 'src/components/collab/StorageFailureBanner.css',
    'src/components/collab/ReSignInModal.css', 'src/components/collab/ConfirmDeleteModal.css',
    'src/components/collab/CleanupResidueReviewPanel.css', 'src/components/AccountSettings.css',
  ]) {
    const code = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(code, /cubic-bezier\(/, `${file} still has a raw curve`);
  }
});
