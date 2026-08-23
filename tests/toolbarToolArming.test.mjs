import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Live toolbar / category-strip click-to-arm (Rectangle / Ellipse have
// no overlay letter). Live proof: debug/scenarios/e2e-toolbar-tool-arming.spec.mjs
// Distinct from leftover-18 / remapped-after-CW / Ctrl+2 / Ctrl+M /
// rail Previous/Next / keyboard P-04 letters / ⇧V / Shift+E / create-path clicks.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('toolbar strip lists Rectangle / Ellipse click-to-arm; overlay omits those keys', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /id: 'rect', label: 'Rectangle'/);
  assert.match(viewer, /id: 'ellipse', label: 'Ellipse'/);
  assert.match(viewer, /id: 'pen', label: 'Pen'/);
  assert.match(viewer, /id: 'highlighter', label: 'Highlighter'/);
  assert.match(viewer, /id: 'eraser', label: 'Eraser'/);
  assert.match(viewer, /id: 'line', label: 'Line'/);
  assert.match(viewer, /id: 'arrow', label: 'Arrow'/);
  assert.match(viewer, /id: 'counter', label: 'Counter'/);
  assert.match(viewer, /id: 'text', label: 'Text'/);
  assert.match(viewer, /id: 'callout', label: 'Callout'/);
  assert.match(viewer, /setActiveTool\(t\.id\)/);
  assert.match(viewer, /TODO: Revisit the user-created Note tool/);
  assert.match(viewer, /showTextMarkupHighlightMenu = false/);
  assert.match(viewer, /\/\/ \{ id: 'note', label: 'Note'/);

  const shared = read('src/viewerShared.js');
  assert.match(shared, /REVIEW_TOOL_IDS = \['text', 'callout'\]/);

  const shell = read('src/AppShell.jsx');
  assert.match(shell, /data-select-mode-caret="true"/);
  assert.match(shell, /bottomToolbarApi\.setActiveTool\(isTextSelect \? 'text-select' : 'select'\)/);

  const overlay = read('src/components/KeyboardShortcutsOverlay.jsx');
  assert.match(overlay, /description: 'Pen'/);
  assert.doesNotMatch(overlay, /description: 'Rectangle'/);
  assert.doesNotMatch(overlay, /description: 'Ellipse'/);
  assert.doesNotMatch(overlay, /keys: \['R'\]/);
  assert.doesNotMatch(overlay, /keys: \['O'\]/);

  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.match(mobile, /id: 'rect', label: 'Rectangle'/);
  assert.match(mobile, /id: 'ellipse', label: 'Ellipse'/);
  assert.match(mobile, /const selectTool = \(toolId\) =>/);
  assert.match(mobile, /aria-label="Document tools"/);
});

test('keyboard leftover stays letters; this leftover is click-to-arm', () => {
  const keys = read('debug/scenarios/e2e-tool-key-arming.spec.mjs');
  assert.match(keys, /P must arm Pen/);
  assert.doesNotMatch(keys, /Rectangle button must arm Rectangle/);

  const matrix = read('debug/scenarios/e2e-keyboard-shortcut-matrix.spec.mjs');
  assert.match(matrix, /tool letters/);
  assert.doesNotMatch(matrix, /Rectangle button must arm Rectangle/);

  const create = read('debug/scenarios/e2e-shape-live-create.spec.mjs');
  assert.match(create, /shape-creation-preview/);
  assert.doesNotMatch(create, /re-click Rectangle stays Rectangle/);
});

test('live spec covers toolbar click-to-arm intended + break + edge; skip leftover-18 and key/CW replay', () => {
  const spec = read('debug/scenarios/e2e-toolbar-tool-arming.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /testPdf=text-search-glyph-lab\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop toolbar click-to-arm intended \+ break \+ edge/);
  assert.match(spec, /390 toolbar click-to-arm edge/);
  assert.match(spec, /Select button must arm Select/);
  assert.match(spec, /Select click must leave Pan/);
  assert.match(spec, /Rectangle button must arm Rectangle/);
  assert.match(spec, /Ellipse button must arm Ellipse/);
  assert.match(spec, /Highlighter button must arm Highlighter/);
  assert.match(spec, /Eraser button must arm Eraser/);
  assert.match(spec, /Callout button must arm Callout/);
  assert.match(spec, /re-click Rectangle stays Rectangle/);
  assert.match(spec, /R after Select stays Select/);
  assert.match(spec, /hubPreview has no Draw/);
  assert.match(spec, /toolbar clicks invent 0 annotations/);
  assert.match(spec, /390 Rectangle button must arm Rectangle/);
  assert.match(spec, /Layers panel compile-hidden/);
  assert.match(spec, /Attachments panel compile-hidden/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /Control\+2/);
  assert.doesNotMatch(spec, /Control\+m/);
  assert.doesNotMatch(spec, /Next page click must move a page/);
  assert.doesNotMatch(spec, /P must arm Pen/);
  assert.doesNotMatch(spec, /viewBox `0 0 792 612`/);
  assert.doesNotMatch(spec, /rotatePageSpaceInk|page-rotate-remap/);

  const dev = read('src/DevTestRoute.jsx');
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});
