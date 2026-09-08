import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { createPageMutationFile } from '../src/utils/pageMutationFile.js';
import { getPDFId } from '../src/viewerShared.js';

test('managed local replacement keeps its revision and never gains cloud authority', () => {
  const source = new File(['%PDF-first'], 'plan.pdf', { type: 'application/pdf' });
  Object.assign(source, { localId: 'local:first', storageMode: 'local', localRevision: 7, _surveyPdfId: 'local:first' });
  const result = createPageMutationFile(new Uint8Array([1, 2, 3]), source);
  assert.equal(result.localId, source.localId);
  assert.equal(result.localRevision, 7);
  assert.equal(result.storageMode, 'local');
  assert.equal(getPDFId(result), 'local:first');
  assert.equal(Object.hasOwn(result, 'id'), false);
});

test('direct page mutation preserves bookmark and annotation storage identity', async () => {
  const sourceBytes = fs.readFileSync(new URL('../debug/fixtures/text-search-glyph-lab.pdf', import.meta.url));
  const source = new File([sourceBytes], 'identity.pdf', { type: 'application/pdf' });
  source.id = 'document-row-id';
  source.projectId = 'project-id';
  source.supabaseFilePath = 'owner/identity.pdf';
  source.user_id = 'owner-id';

  const sourcePdfId = getPDFId(source);
  const sourceKeys = {
    bookmarks: `pdfSidebar_${sourcePdfId}`,
    annotations: `annotationsByPage_${sourcePdfId}`,
  };
  const persisted = new Map([
    [sourceKeys.bookmarks, JSON.stringify({ bookmarks: [{ id: 'bookmark-1', name: 'Roof', pageIds: [1] }] })],
    [sourceKeys.annotations, JSON.stringify({ 1: { objects: [{ id: 'annotation-1', type: 'rect' }] } })],
  ]);

  const pdf = await PDFDocument.load(sourceBytes);
  pdf.addPage([320, 240]);
  const mutated = createPageMutationFile(await pdf.save(), source);
  const mutatedPdfId = getPDFId(mutated);
  const mutatedKeys = {
    bookmarks: `pdfSidebar_${mutatedPdfId}`,
    annotations: `annotationsByPage_${mutatedPdfId}`,
  };

  assert.notEqual(mutated.size, source.size, 'page mutation must produce different PDF bytes');
  assert.equal(mutatedPdfId, sourcePdfId);
  assert.deepEqual(mutatedKeys, sourceKeys);
  assert.match(persisted.get(mutatedKeys.bookmarks), /bookmark-1/);
  assert.match(persisted.get(mutatedKeys.annotations), /annotation-1/);
});
