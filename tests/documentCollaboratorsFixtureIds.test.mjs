// Signed-out hub previews use fixture document ids like 'd3'. Asking
// PostgREST for their collaborators or owner profile is a guaranteed 400
// ("invalid input syntax for type uuid") and a console error, so both lookups
// must short-circuit on a non-uuid id before touching supabase.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SOURCE = readFileSync(new URL('../src/services/documentAnnotationService.js', import.meta.url), 'utf8');

function body(name) {
  const start = SOURCE.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  return SOURCE.slice(start, SOURCE.indexOf('\n}\n', start));
}

test('collaborator and owner lookups skip non-uuid (fixture) document ids', () => {
  const re = SOURCE.match(/const DOCUMENT_UUID_RE = (\/.+\/i);/);
  assert.ok(re, 'uuid pattern defined');
  // eslint-disable-next-line no-eval
  const pattern = eval(re[1]);
  assert.equal(pattern.test('d3'), false);
  assert.equal(pattern.test('33333333-3333-4333-8333-333333333333'), true);
  for (const name of ['getDocumentCollaborators', 'getDocumentOwnerProfile']) {
    const fn = body(name);
    const guard = fn.indexOf('isDocumentUuid(documentId)');
    assert.ok(guard >= 0, `${name} checks the id`);
    assert.ok(guard < fn.indexOf('supabase'), `${name} checks before any request`);
  }
});
