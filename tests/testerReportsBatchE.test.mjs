// Tester reports, batch E (Nov 25, Grok): #1653, #1654, #1656.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { kindLabel, kindOfObject } from '../src/utils/selectionProperties.js';
import { readableMarkSubject } from '../src/utils/pdfOutsideEdits.js';
import { buildPdfAppAnnotationMetadata } from '../src/utils/pdfAppAnnotationMetadata.js';

const EXPORT = readFileSync(new URL('../src/utils/pdfAnnotationsPdfLib.js', import.meta.url), 'utf8');

test('#1656: Properties names equations and audio notes', () => {
  assert.equal(kindLabel([kindOfObject({ type: 'image', data: { equation: { tex: 'E = mc^2' } } })]), 'Equation');
  assert.equal(kindLabel([kindOfObject({ type: 'image', data: { audio: { src: 'data:audio/webm;base64,AA' } } })]), 'Audio note');
  assert.equal(kindLabel([kindOfObject({ type: 'image', data: {} })]), 'Image');
});

test('#1653: a tape exports with subject Tape', () => {
  assert.equal(readableMarkSubject({ subtype: 'Ink', tape: true }), 'Tape');
  assert.equal(readableMarkSubject({ subtype: 'Ink' }), 'Pen');
  const meta = buildPdfAppAnnotationMetadata({ type: 'path', data: { id: 't1', tape: true, tapeRevealed: true } }, { type: 'path' });
  assert.equal(meta.data.tape, true, 'the flag reaches the export metadata');
  assert.equal(meta.data.tapeRevealed, true);
  assert.match(EXPORT, /tape: metadata\.data\?\.tape === true,/);
});

test('#1654: a revealed tape exports as a faded outline', () => {
  assert.match(EXPORT, /const revealedTape = !hasAnalyticPaperSource\n\s+&& fabricObj\?\.data\?\.tape === true && fabricObj\.data\.tapeRevealed === true;/);
  assert.match(EXPORT, /content\.push\(revealedTape \? 'S' : /);
  assert.match(EXPORT, /\* \(revealedTape \? TAPE_REVEALED_EXPORT_OPACITY : 1\)/);
});

test('#1648: the Pages panel page menus get Template page below', async () => {
  const { availableActions, buildPageMenuItems } = await import('../src/sidebar/pageMenuItems.js');
  const panel = readFileSync(new URL('../src/sidebar/PagesPanel.jsx', import.meta.url), 'utf8');
  const sidebar = readFileSync(new URL('../src/PDFSidebar.jsx', import.meta.url), 'utf8');
  const viewer = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  assert.match(panel, /insertTemplate: onInsertTemplatePage,/);
  assert.match(sidebar, /onInsertTemplatePage=\{onInsertTemplatePage\}/);
  assert.match(viewer, /onInsertTemplatePage: handleInsertTemplatePage,/);
  assert.match(viewer, /onInsertTemplatePage=\{handleInsertTemplatePage\}/);
  assert.equal(availableActions({ insertTemplate: () => {} }).insertTemplate, true);
  assert.ok(typeof buildPageMenuItems === 'function');
});
