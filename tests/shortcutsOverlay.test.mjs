import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contracts for V-09 shortcuts overlay intended + break + edge.
// Live proof: debug/scenarios/e2e-shortcuts-overlay.spec.mjs
// Distinct from P-04 tool-key arm, V-05/V-08/E-05 catalog samples,
// leftover-18.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('overlay catalogs the live chords and omits Undo/Redo/Delete/Duplicate/z-order', () => {
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
  assert.match(overlay, /description: 'Open document'/);
  assert.match(overlay, /description: 'Search text'/);
  assert.match(overlay, /keys: \['V'\], description: 'Select annotations'/);
  assert.match(overlay, /keys: \['Shift', 'V'\], description: 'Select text on the page'/);
  assert.match(overlay, /keys: \['P'\], description: 'Pen'/);
  assert.match(overlay, /keys: \['H'\], description: 'Highlighter'/);
  assert.match(overlay, /keys: \['E'\], description: 'Eraser'/);
  assert.match(overlay, /keys: \['T'\], description: 'Text'/);
  assert.match(overlay, /keys: \['Q'\], description: 'Callout'/);
  assert.match(overlay, /keys: \['L'\], description: 'Line'/);
  assert.match(overlay, /keys: \['A'\], description: 'Arrow'/);
  assert.match(overlay, /keys: \['C'\], description: 'Counter'/);
  assert.match(overlay, /description: 'Toggle sidebar'/);
  assert.match(overlay, /description: 'Toggle shortcuts'/);
  assert.match(overlay, /keys: \['Esc'\], description: 'Close dialogs\/cancel'/);

  assert.doesNotMatch(overlay, /\bUndo\b/);
  assert.doesNotMatch(overlay, /\bRedo\b/);
  assert.doesNotMatch(overlay, /Duplicate/);
  assert.doesNotMatch(overlay, /Bring to [Ff]ront/);
  assert.doesNotMatch(overlay, /Bring forward/);
  assert.doesNotMatch(overlay, /description: 'Delete'/);
  assert.doesNotMatch(overlay, /Fit height/);
  assert.doesNotMatch(overlay, /Fit width/);
  assert.doesNotMatch(overlay, /\bF3\b/);
});

test('useKeyPress has no INPUT guard; AppShell hides overlay on viewer; DevTestRoute remounts; no file.id', () => {
  const hook = read('src/utils/hooks.js');
  assert.match(hook, /export function useKeyPress\(targetKey, callback, options = \{\}\) \{/);
  assert.match(hook, /if \(event\.key === targetKey\)/);
  assert.doesNotMatch(hook, /INPUT|TEXTAREA|contentEditable|isFormField/);

  const trap = read('src/hooks/useFocusTrap.js');
  assert.match(trap, /if \(e\.key === 'Escape'\)/);
  assert.match(trap, /onEscape\?\.\(\)/);
  assert.match(trap, /window\.addEventListener\('keydown', handleKey, true\)/);

  const shell = read('src/AppShell.jsx');
  assert.match(shell, /KeyboardShortcutsOverlay only renders on the home tab/);
  assert.match(shell, /!isViewerVisible && <KeyboardShortcutsOverlay/);

  const dev = read('src/DevTestRoute.jsx');
  assert.match(dev, /<KeyboardShortcutsOverlay \/>/);
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});

test('live spec covers open / catalog / Esc / outside / Close / toggle / INPUT steal / 390 / hub', () => {
  const spec = read('debug/scenarios/e2e-shortcuts-overlay.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop shortcuts overlay intended \+ break \+ edge/);
  assert.match(spec, /390 shortcuts overlay intended \+ break \+ edge/);
  assert.match(spec, /lists the real catalog/);
  assert.match(spec, /Esc dismisses/);
  assert.match(spec, /click-outside/);
  assert.match(spec, /Close button dismisses/);
  assert.match(spec, /second `\?` toggles closed/);
  assert.match(spec, /documented steal/);
  assert.match(spec, /zoom INPUT `\?` must open overlay/);
  assert.match(spec, /search INPUT `\?` must open overlay/);
  assert.match(spec, /390 overlay exists/);
  assert.match(spec, /hubPreview home tab still has the overlay/);
  assert.match(spec, /file\.id stays null/);
  assert.match(spec, /0 0 612 792/);
  assert.match(spec, /Do not stamp\s+file\.id/);
});
