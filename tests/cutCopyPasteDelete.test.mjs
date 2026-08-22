import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contracts for UL-27–29 + E-04 context-menu Cut / Copy / Paste /
// Delete (intended + break + edge). Live proof:
// debug/scenarios/e2e-cut-copy-paste-delete.spec.mjs
// Distinct from UL-27–29 same-page smoke, callout last-writer, keyboard
// Delete, survey-marker Delete, UL-32 page ops, and UL-30 arrange.

const CLIP_ITEMS = ['Cut', 'Copy', 'Paste', 'Delete'];

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('shape menu lists Cut/Copy/Paste/Delete; empty page is Paste-only; counter omits clip items', () => {
  const menu = read('src/hooks/useAnnotationContextMenu.jsx');
  assert.match(menu, /item\('Cut', 'cut'/);
  assert.match(menu, /item\('Copy', 'copy'/);
  assert.match(menu, /item\('Paste', 'paste'/);
  assert.match(menu, /item\('Delete', 'delete'/);
  assert.match(menu, /Empty canvas \/ page — only Paste lives here/);
  assert.match(menu, /item\('Continue pin', 'continuePin'/);
  assert.match(menu, /mode: 'cut'/);
  assert.match(menu, /mode: 'copy'/);
  assert.match(menu, /Cut = Copy \+ immediate delete with no confirmation/);
});

test('paste of mode=cut clears clipboard; Delete does not stash; Copy is repeatable', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /if \(clipboardAnnotation\.mode === 'cut'\) \{\s*\n\s*setClipboardAnnotation\(null\);/);
  assert.match(viewer, /mode: 'copy',\s*\n\s*\}\);/);
  assert.match(viewer, /mintPastedCloneIdentity/);
  assert.match(viewer, /action: 'paste'/);
  assert.match(viewer, /action: 'cut'/);
  assert.match(viewer, /action: 'delete'/);

  const menu = read('src/hooks/useAnnotationContextMenu.jsx');
  assert.match(menu, /action: 'cut'/);
  assert.match(menu, /action: 'delete'/);
  const annotationBlock = menu.slice(
    menu.indexOf("} else if (ctx.kind === 'annotation')"),
    menu.indexOf("item('Bring to front', 'bringToFront'"),
  );
  const deleteBlock = annotationBlock.slice(annotationBlock.indexOf("item('Delete', 'delete'"));
  assert.match(deleteBlock, /action: 'delete'/);
  assert.doesNotMatch(deleteBlock, /setClipboardAnnotation\(/);
});

test('live spec covers Delete + one-shot Cut + repeatable Copy + break + edge', () => {
  const spec = read('debug/scenarios/e2e-cut-copy-paste-delete.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /empty clipboard Paste must invent 0/);
  assert.match(spec, /second Copy-paste must mint a unique id/);
  assert.match(spec, /Cut is one-shot/);
  assert.match(spec, /Delete must not populate clipboard/);
  assert.match(spec, /Undo after context-menu Delete/);
  assert.match(spec, /counter menu must omit/);
  assert.match(spec, /callout menu missing/);
  assert.match(spec, /Pen-armed must not rewrite rect stack/);
  assert.match(spec, /Select \/ empty page invents 0/);
  assert.match(spec, /file\.id/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /390/);
  assert.match(spec, /hubPreview/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /e2e-callout-paste/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  for (const label of CLIP_ITEMS) {
    assert.match(spec, new RegExp(label));
  }
});
