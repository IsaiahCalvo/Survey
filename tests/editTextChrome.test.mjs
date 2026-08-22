import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contracts for UL-36 Edit text (Aa) intended + break + edge.
// Live proof: debug/scenarios/e2e-edit-text-chrome.spec.mjs
// Distinct from T-01 create auto-edit, T-02 callout formatting,
// V-03 Select text, leftover-18.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('desktop Aa enters text/callout edit; disabled with no selection; hidden off those tools', () => {
  const shell = read('src/AppShell.jsx');
  assert.match(shell, /Rich-text edit entry button/);
  assert.match(shell, /same path as double-clicking the text/);
  assert.match(shell, /bottomToolbarApi\.onEnterTextEdit/);
  assert.match(shell, /contextTool === 'text'/);
  assert.match(shell, /contextTool === 'callout'/);
  assert.match(shell, /!!bottomToolbarApi\.richTextEditor/);
  assert.match(shell, /disabled=\{!bottomToolbarApi\.canEnterTextEdit\}/);
  assert.match(shell, /onClick=\{\(\) => bottomToolbarApi\.onEnterTextEdit\(\)\}/);
  assert.match(shell, /aria-label="Edit text"/);
  assert.match(shell, /aria-pressed=\{!!bottomToolbarApi\.richTextEditor\}/);
  assert.match(shell, /Select a text box or callout to edit its text/);

  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /const handleEnterTextEditFromStrip = useCallback\(\(\) => \{/);
  assert.match(viewer, /handleRequestCalloutEditMode\(calloutSel\.id, calloutSel\.pageNumber\)/);
  assert.match(viewer, /if \(type !== 'textbox'\) return;/);
  assert.match(viewer, /editType: 'text'/);
  assert.match(viewer, /onEnterTextEdit: handleEnterTextEditFromStrip/);
  assert.match(viewer, /canEnterTextEdit: !!\(selectedToolbarCallout/);
  assert.match(viewer, /String\(selectedToolbarAnnotation\.annotation\?\.type \|\| ''\)\.toLowerCase\(\) === 'textbox'\)/);
  assert.match(viewer, /selectionMappedTool = 'text'/);
  assert.match(viewer, /selectionMappedTool = 'callout'/);
});

test('390 Text formatting enters edit when selected; else opens defaults; no file.id', () => {
  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.match(mobile, /aria-label="Text formatting"/);
  assert.match(mobile, /if \(api\.canEnterTextEdit \|\| api\.richTextEditor\) api\.onEnterTextEdit\(\);/);
  assert.match(mobile, /setTextDefaultsOpen\(true\)/);
  assert.match(mobile, /tool === 'text' \|\| tool === 'callout' \|\| api\.richTextEditor/);

  const dev = read('src/DevTestRoute.jsx');
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});

test('live spec covers text/callout enter, disabled/hidden, 390 defaults, hub, file.id', () => {
  const spec = read('debug/scenarios/e2e-edit-text-chrome.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop Edit text intended \+ break \+ edge/);
  assert.match(spec, /390 Edit text intended \+ break \+ edge/);
  assert.match(spec, /armed Text with no selection must disable Edit text/);
  assert.match(spec, /disabled Aa must not open overlay/);
  assert.match(spec, /armed Callout with no selection must disable Edit text/);
  assert.match(spec, /Pen-armed must hide Edit text/);
  assert.match(spec, /marquee must not enter text edit/);
  assert.match(spec, /selected text\/callout must enable Edit text/);
  assert.match(spec, /Edit text must open the same-surface overlay/);
  assert.match(spec, /second Aa click must stay in edit/);
  assert.match(spec, /selected Callout also enters/);
  assert.match(spec, /selected rect must hide Edit text/);
  assert.match(spec, /390 unselected Aa must not enter overlay/);
  assert.match(spec, /390 Aa must enter overlay/);
  assert.match(spec, /390 Pen-armed must hide Text formatting/);
  assert.match(spec, /hubPreview Edit text must be 0/);
  assert.match(spec, /0 0 612 792/);
  assert.match(spec, /Do not stamp/);
  assert.match(spec, /file\.id/);
});
