import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('toolbar text markup, redact, and hyperlink icons match the text-selection bar icons', () => {
  const icons = read('src/Icons.jsx');
  const pairs = [
    ['hyperlink', 'textHyperlinkUrl'],
    ['formatHyperlink', 'textHyperlinkUrl'],
    ['textHighlightTool', 'textHighlightUrl'],
    ['formatHighlight', 'textHighlightUrl'],
    ['textUnderlineTool', 'textUnderlineUrl'],
    ['formatUnderline', 'textUnderlineUrl'],
    ['textSquiggleTool', 'textSquiggleUrl'],
    ['formatSquiggle', 'textSquiggleUrl'],
    ['textStrikeTool', 'textStrikethroughUrl'],
    ['formatStrikethrough', 'textStrikethroughUrl'],
    ['textRedactTool', 'textRedactUrl'],
    ['formatRedact', 'textRedactUrl'],
  ];

  for (const [iconName, assetUrl] of pairs) {
    const pattern = new RegExp(`${iconName}:\\s*\\([^)]*\\)\\s*=>\\s*renderMaskIcon\\(${assetUrl}\\b`);
    assert.match(icons, pattern, `expected ${iconName} to use ${assetUrl}`);
  }
});

test('PinToolButton uses clear shortcut tooltip without "Add a comment on the page N"', () => {
  const pinControls = read('src/components/pins/PinControls.jsx');
  assert.doesNotMatch(pinControls, /Add a comment on the page/);
  assert.match(pinControls, /`\$\{label\} \(N\)`/);
  assert.match(pinControls, /extraItems = \[\]/);
});

test('desktop Text (review) sub-row groups beta tools into compact ReviewToolGroupButton slots', () => {
  const viewer = read('src/PDFViewer.jsx');
  const start = viewer.indexOf("{subRowCategory === 'review' &&");
  const end = viewer.indexOf("{subRowCategory === 'survey' &&", start);
  assert.ok(start > 0 && end > start, 'review sub-row slice should exist');
  const slice = viewer.slice(start, end);

  assert.match(slice, /groupId="text-markup"/);
  assert.match(slice, /groupId="redact"/);
  assert.match(slice, /groupId="insert"/);
  assert.match(slice, /<PinToolButton/);
  assert.match(slice, /extraItems=\{noteExtraTools\}/);
});
