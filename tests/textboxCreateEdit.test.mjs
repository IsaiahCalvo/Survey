import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TEXT_PADDING,
  buildNewTextCommitJSON,
  buildExistingTextCommitJSON,
} from '../src/utils/textEditCommit.js';

// Source contracts for T-01 leftover: textbox create auto-edit type / commit /
// blank / Escape / tight-fit / wrap / re-edit.
// Live proof: debug/scenarios/e2e-textbox-create-edit.spec.mjs
// Distinct from UL-36 Aa re-entry, T-02 callout, V-03 Select text,
// leftover-18, color / Match Fill / zoom / page-field / rotation catalogs.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('TextEditOverlay commits new text, discards blank, Escape cancels', () => {
  const overlay = read('src/components/TextEditOverlay.jsx');
  assert.match(overlay, /data-text-edit-overlay/);
  assert.match(overlay, /isNewText = false/);
  assert.match(overlay, /buildNewTextCommitJSON/);
  assert.match(overlay, /buildExistingTextCommitJSON/);
  assert.match(overlay, /Blank new text — discard/);
  assert.match(overlay, /P1-28: blank existing text deletes the annotation/);
  assert.match(overlay, /if \(e\.key === 'Escape'\)/);
  assert.match(overlay, /cancelRef\.current\(\)/);
  assert.match(overlay, /click-outside commits/);
  assert.match(overlay, /Unmount = commit, not cancel/);
  assert.match(overlay, /host\.offsetWidth/);
  assert.match(overlay, /DEFAULT_FONT_FAMILY = 'Helvetica'/);
  assert.doesNotMatch(overlay, /file\.id\s*=/);

  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /isNewText: true/);
  assert.match(viewer, /editType: 'text'/);
  assert.match(viewer, /onEditCancel=\{\(\) => \{/);
  assert.match(viewer, /setEditingAnnotation\(null\)/);

  const dev = read('src/DevTestRoute.jsx');
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});

test('new-text JSON tight-fits one line, keeps wrap width, rejects blank', () => {
  assert.equal(buildNewTextCommitJSON({
    text: '   ',
    left: 0,
    top: 0,
    innerWrapWidth: 148,
    naturalInnerHeight: 21,
  }), null);
  const tight = buildNewTextCommitJSON({
    text: 'Hi',
    left: 10,
    top: 20,
    innerWrapWidth: 148,
    maxLineWidth: 18,
    lineCount: 1,
    naturalInnerHeight: 21,
  });
  assert.equal(tight.width, Math.ceil(18 + 2) + 2 * TEXT_PADDING);
  assert.ok(tight.width < 148);
  assert.equal(tight.fontFamily, 'Helvetica');
  const wrapped = buildNewTextCommitJSON({
    text: 'The quick brown fox jumps over the lazy dog again',
    left: 0,
    top: 0,
    innerWrapWidth: 148,
    maxLineWidth: 300,
    lineCount: 3,
    naturalInnerHeight: 63,
  });
  assert.equal(wrapped.width, 148 + 2 * TEXT_PADDING);
  assert.ok(wrapped.width > tight.width);
});

test('existing-text JSON locks width, grows height, blank returns null', () => {
  const original = {
    type: 'Textbox',
    left: 10,
    top: 20,
    width: 160,
    height: 40,
    text: 'Hello',
    fontFamily: 'Helvetica',
    data: { id: 'keep-me' },
  };
  assert.equal(buildExistingTextCommitJSON({ original, text: '   ', naturalInnerHeight: 21 }), null);
  const grown = buildExistingTextCommitJSON({
    original,
    text: 'Hello world and more wrap text here',
    naturalInnerHeight: 80,
  });
  assert.equal(grown.width, 160);
  assert.equal(grown.height, 80 + 2 * TEXT_PADDING);
  assert.equal(grown.data.id, 'keep-me');
  assert.equal(grown.fontFamily, 'Helvetica');
});

test('live spec covers type / blur / blank / Escape / tight-fit / wrap / 390 / file.id', () => {
  const spec = read('debug/scenarios/e2e-textbox-create-edit.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop T-01 textbox create\/edit intended \+ break \+ edge/);
  assert.match(spec, /390 T-01 textbox create\/edit intended \+ break \+ edge/);
  assert.match(spec, /typed Hello must commit Hello/);
  assert.match(spec, /single-line Hi must tight-fit under the wide wrap target/);
  assert.match(spec, /wrapped create must keep the drag wrap width/);
  assert.match(spec, /Escape must discard a new box/);
  assert.match(spec, /empty click-out must discard/);
  assert.match(spec, /whitespace click-out must discard/);
  assert.match(spec, /Pen hide must hold Hello/);
  assert.match(spec, /Escape must restore Hello and not commit CHANGED/);
  assert.match(spec, /re-edit must lock wrap width/);
  assert.match(spec, /blank re-edit must delete the box/);
  assert.match(spec, /second box must isolate the first text/);
  assert.match(spec, /undo must drop Second/);
  assert.match(spec, /390 typed Mobile must commit Mobile/);
  assert.match(spec, /390 Escape must discard a new box/);
  assert.match(spec, /390 empty click-out must discard/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
});
