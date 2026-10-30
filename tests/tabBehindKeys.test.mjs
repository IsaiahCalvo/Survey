// Keys belong to the front tab (docs/TAB-SWITCHING.md S6, S9). Every open tab
// keeps its viewer mounted, and keys always reach window / document, so each
// of a tab's own window- or document-wide key handlers must stand down while
// the tab is behind. The behaviour (Escape and a Space tap in the front tab
// leave the tool of a tab behind alone) runs in
// tests/e2e-signed-in/tab-behind-keys.spec.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
const viewer = read('PDFViewer.jsx');

// The effect that adds `listener`, from its useEffect( to the listener's add.
function effectAdding(source, addCall) {
  const at = source.indexOf(addCall);
  assert.ok(at > 0, `${addCall} exists`);
  const start = source.lastIndexOf('useEffect(', at);
  return source.slice(start, at);
}

test('PDFViewer: each document-wide key handler of a tab is off while the tab is behind', () => {
  const gated = [
    // Delete / Backspace on a selected native text highlight.
    ["document.addEventListener('keydown', handleNativeTextMarkupDelete, { capture: true })", /if \(isActive === false\) return undefined;/],
    // Escape deselects, then puts the tool down to Pan; backdrop press deselects.
    ["if (escapeDeselects) window.addEventListener('keydown', clear, true)", /if \(isActive === false\) return undefined;/],
    // Escape cancels a Survey marker placement.
    ["window.addEventListener('keydown', onKeyDown, true);\n    return () => window.removeEventListener('keydown', onKeyDown, true);\n  }, [categorizeDialogMarkerId", /isActive === false/],
    // Escape clears the live text selection / closes its color picker.
    ["document.addEventListener('keydown', onKeyDown, true);\n    return () => {\n      window.clearTimeout(timer);", /if \(isActive === false\) return undefined;/],
    // Ctrl+P and the Electron Print menu.
    ["window.addEventListener('keydown', keyHandler, true)", /if \(isActive === false \|\| typeof window === 'undefined'\) return undefined;/],
  ];
  for (const [add, guard] of gated) assert.match(effectAdding(viewer, add), guard, add.split('\n')[0]);
  // Already gated before this pass: undo / redo and the tool letters.
  assert.match(viewer, /if \(!undoRedoKeyActiveRef\.current\) return;/);
  assert.match(effectAdding(viewer, "window.addEventListener('keydown', handleKeyDown);\n"), /if \(isInTabBehind\(pdfjsWrapperRef\.current\)\) return;/);
  assert.match(viewer, /<RegionSelectionTool\s+active=\{showRegionSelection\}\s+tabActive=\{isActive !== false\}/);
});

test('the viewer, the page canvas and the region tool check their own tab', () => {
  const container = read('components/PdfjsViewerContainer.jsx');
  assert.match(container, /const activateSpacePan = \(event\) => \{\s*if \(!isSpaceKey\(event\)\) return;[\s\S]{0,300}if \(isInTabBehind\(scrollerRef\.current\)\) return;/);
  assert.match(container, /if \(event\?\.type === 'keyup' && !spacePanRef\.current && isInTabBehind\(scrollerRef\.current\)\) return;/);

  const pal = read('PageAnnotationLayer.jsx');
  assert.equal((pal.match(/if \(isInTabBehind\(canvasRef\.current\)\) return;/g) || []).length, 2, 'Escape / Delete on the page canvas');

  const region = read('RegionSelectionTool.jsx');
  assert.match(region, /if \(!active \|\| !tabActive\) return;/);
  assert.match(region, /\}, \[active, tabActive, undoLastRegionEdit, redoLastRegionEdit\]\);/);
});
