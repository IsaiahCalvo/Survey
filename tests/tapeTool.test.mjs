// Tape (beta 'tape-tool', Drawboard PDF Free-form > Tape).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildFreehandCommitJSON, isTapeMark, toggleTapeRevealed } from '../src/utils/annotationCreationCommit.js';
import { quickColoursForTool } from '../src/utils/quickStylePresets.js';
import { getEraserOperation, isPartialEraseEligible } from '../src/utils/eraserPolicy.js';
import { markToolForAnnotation, TOOL_GROUP_BY_TOOL } from '../src/utils/markToolGroup.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';
import { getToolSelectionClass } from '../src/utils/selectModes.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const points = [{ x: 10, y: 50 }, { x: 60, y: 51 }, { x: 140, y: 50 }];

test('a tape stroke is pen ink in its own colour and width, marked as tape', () => {
  const json = buildFreehandCommitJSON({ tool: 'tape', id: 't1', points, strokeColor: '#ddc3ff', highlightColor: '#ff0', strokeWidth: 20 });
  assert.equal(json.type, 'path');
  assert.equal(json.tool, 'pen');
  assert.equal(json.data.tape, true);
  assert.equal(json.fill, '#ddc3ff');
  assert.equal(json.globalCompositeOperation, undefined, 'opaque, never multiply');
  assert.ok(json.height >= 19 && json.height <= 21, `band ${json.height} pt`);
  assert.equal(isTapeMark(json), true);
  const pen = buildFreehandCommitJSON({ tool: 'pen', id: 'p1', points, strokeColor: '#f00', highlightColor: '#ff0', strokeWidth: 3 });
  assert.equal(pen.data.tape, undefined);
  assert.equal(isTapeMark(pen), false);
});

test('the eraser takes a tape whole, never a bite', () => {
  const tape = buildFreehandCommitJSON({ tool: 'tape', id: 't2', points, strokeColor: '#ddc3ff', highlightColor: '#ff0', strokeWidth: 20 });
  assert.equal(isPartialEraseEligible(tape), false);
  assert.equal(getEraserOperation(tape, 'partial'), 'entire');
  const pen = buildFreehandCommitJSON({ tool: 'pen', id: 'p2', points, strokeColor: '#f00', highlightColor: '#ff0', strokeWidth: 3 });
  assert.equal(getEraserOperation(pen, 'partial'), 'partial');
});

test('tape is a Draw tool with its own bar, an ink tool for presses, and a beta flag', () => {
  assert.equal(TOOL_GROUP_BY_TOOL.tape, 'draw');
  assert.equal(markToolForAnnotation({ type: 'path', data: { tape: true } }), 'tape');
  assert.equal(markToolForAnnotation({ type: 'path', data: {} }), 'pen');
  assert.equal(getToolSelectionClass('tape'), 'ink');
  assert.equal(FEATURE_FLAGS['tape-tool']?.stage, 'beta');
  assert.match(read('supabase/migrations/20261110142000_tape_tool_flag.sql'), /\('tape-tool', 'off'/);
  assert.match(read('src/hooks/useDatabase.js'), /tape: \{ strokeColor: '#ddc3ff', strokeWidth: 20, strokeOpacity: 100 \}/);
});

test('a reveal is saved on the mark; a second tap covers it again', () => {
  const tape = buildFreehandCommitJSON({ tool: 'tape', id: 't3', points, strokeColor: '#ddc3ff', highlightColor: '#ff0', strokeWidth: 20 });
  const page = { objects: [{ type: 'rect', data: { id: 'r' } }, tape] };
  const revealed = toggleTapeRevealed(page, 1);
  assert.notEqual(revealed, page, 'a new page, so it saves as an edit');
  assert.equal(revealed.objects[1].data.tapeRevealed, true);
  assert.equal(page.objects[1].data.tapeRevealed, undefined, 'the old page is left alone (Undo)');
  assert.equal(revealed.objects[0], page.objects[0]);
  const covered = toggleTapeRevealed(revealed, 1);
  assert.equal('tapeRevealed' in covered.objects[1].data, false);
  assert.equal(toggleTapeRevealed(page, 0), page, 'not a tape: nothing changes');
});

test("Drawboard's tape discs and widths", () => {
  assert.deepEqual(quickColoursForTool('tape').colours, ['#DDC3FF', '#9FEEB8', '#878E97']);
  assert.deepEqual(quickColoursForTool('tape', true).colours, ['#DDC3FF', '#9FEEB8', '#878E97']);
  assert.deepEqual(quickColoursForTool('pen').colours, ['#FF0000', '#0000FF', '#000000']);
  assert.match(read('src/components/AnnotationSizeControl.jsx'), /tape: \[10, 20, 30, 40, 50, 80, 90, 100\]/);
});

test('render, reveal and tool rows are wired', () => {
  const renderers = read('src/utils/svgAnnotationRenderers.jsx');
  assert.match(renderers, /if \(obj\?\.data\?\.tape === true\) \{[\s\S]{0,400}const revealed = obj\.data\.tapeRevealed === true;/);
  assert.match(renderers, /fill=\{revealed \? 'none' : fill\}/);
  assert.match(renderers, /style=\{revealed \? undefined : \{ filter: TAPE_SHADOW_FILTER \}\}/);
  assert.match(renderers, /TAPE_SHADOW_FILTER = 'drop-shadow\(-2px 2px 0 rgba\(0, 0, 0, 0\.1\)\)'/);
  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /const FREEHAND_CREATION_TOOLS = \['pen', 'highlighter', 'tape', 'survey-marker-freehand'\];/);
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /const \[tapeToolEnabled\] = useState\(\(\) => isFeatureOn\('tape-tool'\)\);/);
  assert.match(viewer, /\.\.\.\(tapeToolEnabled \? \[\{ id: 'tape', label: 'Tape', iconName: 'tape' \}\] : \[\]\)/);
  assert.match(viewer, /handleSaveAnnotations\(hit\.pageNumber, toggleTapeRevealed\(tapedPage, hit\.annotationIndex\)/);
  assert.match(read('src/hooks/useSVGInteraction.js'), /onSaveAnnotations\?\.\(toggleTapeRevealed\(page, index\)/);
  assert.match(read('src/mobile/MobilePdfViewerChrome.jsx'), /\{ id: 'tape', label: 'Tape', icon: 'tape', flag: 'tape-tool' \}/);
});
