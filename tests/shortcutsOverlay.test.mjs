import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contracts for V-09 shortcuts overlay intended + break + edge.
// Live proof: debug/scenarios/e2e-shortcuts-overlay.spec.mjs
// Distinct from P-04 tool-key arm, V-05/V-08/E-05 catalog samples,
// leftover-18.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('overlay catalogs the live chords and omits Duplicate/z-order', () => {
  const overlay = read('src/components/KeyboardShortcutsOverlay.jsx');
  assert.match(overlay, /Press '\?' to toggle/);
  assert.match(overlay, /useKeyPress\('\?', \(\) => \{/);
  assert.match(overlay, /setIsOpen\(\(prev\) => !prev\)/);
  assert.match(overlay, /useFocusTrap\(modalContentRef, isOpen, \{ onEscape: closeOverlay \}\)/);
  assert.match(overlay, /onClick=\{\(\) => setIsOpen\(false\)\}/);
  assert.match(overlay, /aria-label="Close"/);
  assert.match(overlay, /data-keyboard-shortcuts-modal="true"/);

  assert.match(overlay, /category: 'Navigation'/);
  assert.match(overlay, /category: 'Actions'/);
  assert.match(overlay, /category: 'Tools'/);
  assert.match(overlay, /category: 'Interface'/);
  assert.match(overlay, /description: 'Previous\/Next page'/);
  assert.match(overlay, /description: 'First page'/);
  assert.match(overlay, /description: 'Last page'/);
  assert.match(overlay, /description: 'Zoom in'/);
  assert.match(overlay, /description: 'Zoom out'/);
  assert.match(overlay, /description: 'Fit page'/);
  assert.match(overlay, /keys: \['Ctrl', '1'\], description: 'Fit width'/);
  assert.match(overlay, /keys: \['Ctrl', '2'\], description: 'Fit height'/);
  assert.match(overlay, /keys: \['Ctrl', 'M'\], description: 'Manual lock'/);
  assert.match(overlay, /description: 'Open document'/);
  assert.match(overlay, /keys: \['Ctrl', 'S'\], description: 'Save document'/);
  assert.match(overlay, /keys: \['Ctrl', 'Z'\], description: 'Undo'/);
  assert.match(overlay, /keys: \['Ctrl', 'Shift', 'Z'\], description: 'Redo'/);
  assert.match(overlay, /keys: \['Delete'\], description: 'Delete selected'/);
  assert.match(overlay, /description: 'Search text'/);
  assert.match(overlay, /keys: \['F3'\], description: 'Find next'/);
  assert.match(overlay, /keys: \['Shift', 'F3'\], description: 'Find previous'/);
  assert.match(overlay, /keys: \['V'\], description: 'Select annotations'/);
  assert.match(overlay, /keys: \['Shift', 'V'\], description: 'Select text on the page'/);
  assert.match(overlay, /keys: \['P'\], description: 'Pen'/);
  assert.match(overlay, /keys: \['H'\], description: 'Highlighter'/);
  assert.match(overlay, /keys: \['E'\], description: 'Eraser'/);
  assert.match(overlay, /keys: \['Shift', 'E'\], description: 'Partial erase'/);
  assert.match(overlay, /keys: \['T'\], description: 'Text'/);
  assert.match(overlay, /keys: \['Q'\], description: 'Callout'/);
  assert.match(overlay, /keys: \['L'\], description: 'Line'/);
  assert.match(overlay, /keys: \['A'\], description: 'Arrow'/);
  assert.match(overlay, /keys: \['C'\], description: 'Counter'/);
  assert.match(overlay, /description: 'Toggle sidebar'/);
  assert.match(overlay, /description: 'Toggle shortcuts'/);
  assert.match(overlay, /keys: \['Esc'\], description: 'Close dialogs\/cancel'/);

  assert.doesNotMatch(overlay, /description: 'Duplicate'/);
  assert.doesNotMatch(overlay, /Bring to [Ff]ront/);
  assert.doesNotMatch(overlay, /Bring forward/);
  assert.doesNotMatch(overlay, /keys: \['Backspace'\]/);
});

test('useKeyPress ignores INPUT / TEXTAREA / contentEditable; AppShell hides overlay on viewer; DevTestRoute remounts; no file.id', () => {
  const hook = read('src/utils/hooks.js');
  assert.match(hook, /export function useKeyPress\(targetKey, callback, options = \{\}\) \{/);
  assert.match(hook, /ignoreWhenTyping = true/);
  assert.match(hook, /tag === 'INPUT' \|\| tag === 'TEXTAREA'/);
  assert.match(hook, /isContentEditable === true/);
  assert.match(hook, /contentEditable === 'plaintext-only'/);
  assert.match(hook, /if \(isTypingTarget\(event\.target\) \|\| isTypingTarget\(active\)\) return;/);

  const overlay = read('src/components/KeyboardShortcutsOverlay.jsx');
  assert.match(overlay, /useKeyPress ignores INPUT \/ TEXTAREA \/ contentEditable/);

  const trap = read('src/hooks/useFocusTrap.js');
  assert.match(trap, /if \(e\.key === 'Escape'\)/);
  assert.match(trap, /onEscape\?\.\(\)/);
  assert.match(trap, /window\.addEventListener\('keydown', handleKey, true\)/);

  const shell = read('src/AppShell.jsx');
  assert.match(shell, /KeyboardShortcutsOverlay only renders on the home tab/);
  assert.match(shell, /isDevTestPdfRoute/);
  assert.match(shell, /has\('testPdf'\)/);
  assert.match(shell, /!isViewerVisible && !isDevTestPdfRoute && <KeyboardShortcutsOverlay/);
  assert.doesNotMatch(shell, /!isViewerVisible && <KeyboardShortcutsOverlay \/>/);

  const dev = read('src/DevTestRoute.jsx');
  assert.match(dev, /<KeyboardShortcutsOverlay \/>/);
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});

test('live spec covers open / catalog / Esc / outside / Close / toggle / INPUT no-steal / 390 / hub', () => {
  const spec = read('debug/scenarios/e2e-shortcuts-overlay.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop shortcuts overlay intended \+ break \+ edge/);
  assert.match(spec, /390 shortcuts overlay intended \+ break \+ edge/);
  assert.match(spec, /lists the real catalog/);
  assert.match(spec, /Partial erase/);
  assert.match(spec, /Fit width/);
  assert.match(spec, /Fit height/);
  assert.match(spec, /Manual lock/);
  assert.match(spec, /Save document/);
  assert.match(spec, /Find next/);
  assert.match(spec, /Find previous/);
  assert.match(spec, /Undo/);
  assert.match(spec, /Redo/);
  assert.match(spec, /Delete selected/);
  assert.match(spec, /Esc dismisses/);
  assert.match(spec, /click-outside/);
  assert.match(spec, /Close button dismisses/);
  assert.match(spec, /second `\?` toggles closed/);
  assert.match(spec, /zoom INPUT `\?` must not open overlay/);
  assert.match(spec, /search INPUT `\?` must not open overlay/);
  assert.match(spec, /search INPUT must keep the `\?` character/);
  assert.match(spec, /390 page INPUT `\?` must not open overlay/);
  assert.match(spec, /390 overlay exists/);
  assert.match(spec, /hubPreview must not mount the overlay/);
  assert.match(spec, /file\.id stays null/);
  assert.match(spec, /0 0 612 792/);
  assert.match(spec, /Do not stamp/);
  assert.match(spec, /file\.id/);
});
