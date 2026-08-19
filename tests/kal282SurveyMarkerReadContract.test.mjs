// tests/kal282SurveyMarkerReadContract.test.mjs — KAL-282.
//
// Two contracts on the LEGACY Survey Marker read path. Both are static source
// assertions: documentAnnotationService.js imports the Vite-only Supabase
// client, so it cannot be loaded under the node test runner (same reason
// annotationReadPagination.js was extracted for tests/kal241). The cursor
// logic itself is behaviourally tested in tests/kal241/keysetPagination.test.mjs;
// what is pinned here is the WIRING and the deliberate query SCOPE.
//
// (1) getDocumentAnnotations must page by KEYSET on the primary key.
//     It used to page with OFFSET (`.range(from, from + 999)`) ordered by
//     `page_number`. page_number is NOT unique — thousands of markers spread
//     over a few dozen pages — so ties order arbitrarily and not stably between
//     the statements fetching each window. A row could therefore land on both
//     sides of a window boundary (returned twice) or neither (skipped). Seeking
//     on the unique, non-null `id` makes both impossible.
//
// (2) countSurveyMarkersReferencingChecklistItem must stay CROSS-DOCUMENT.
//     This one is the inverse: an audit flagged the missing `document_id`
//     filter as a bug, and it is not. A checklist item belongs to a template,
//     a template is used by many documents, and the only caller (the Survey Hub
//     templates editor) runs with no document open. Scoping it to one document
//     would under-count and let the editor permanently delete an item that
//     Survey Markers in other documents still reference.
//
// HOW TO VERIFY THESE ARE LOAD-BEARING:
//   (1) Put `.range(` back in getDocumentAnnotations, or re-order by
//       page_number — the first three assertions fail.
//   (2) Add `.eq('document_id', ...)` to either checklist-count query — the
//       cross-document assertions fail.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const read = (rel) => readFileSync(resolve(REPO_ROOT, rel), 'utf8');

const SERVICE = read('src/services/documentAnnotationService.js');

// Slice out just getDocumentAnnotations so assertions cannot accidentally be
// satisfied by some other reader elsewhere in the same 900-line module.
function getDocumentAnnotationsBody() {
  const start = SERVICE.indexOf('export async function getDocumentAnnotations(');
  assert.notEqual(start, -1, 'getDocumentAnnotations not found');
  const next = SERVICE.indexOf('\nexport ', start + 1);
  return SERVICE.slice(start, next === -1 ? SERVICE.length : next);
}

test('[KAL-282] getDocumentAnnotations pages by keyset on the unique primary key', () => {
  const body = getDocumentAnnotationsBody();

  assert.match(
    body,
    /collectKeysetRows\(\{/,
    'must page through the shared keyset helper (collectKeysetRows)',
  );
  assert.match(
    body,
    /\.gt\('id',\s*cursorId\)/,
    "must seek with .gt('id', cursorId)",
  );
  assert.match(
    body,
    /\.order\('id',\s*\{\s*ascending:\s*true\s*\}\)/,
    'must order by the unique id, not page_number',
  );
});

// Absence assertions must read CODE, not prose: the function carries a comment
// explaining what the old `.range()` / page_number loop did wrong, and that
// explanation must not be mistaken for the thing it warns about.
const stripLineComments = (source) =>
  source
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');

test('[KAL-282] getDocumentAnnotations no longer uses OFFSET pagination', () => {
  const body = stripLineComments(getDocumentAnnotationsBody());

  assert.doesNotMatch(
    body,
    /\.range\(/,
    'OFFSET .range() pagination must not come back — it can skip or duplicate rows',
  );
  assert.doesNotMatch(
    body,
    /\.order\('page_number'/,
    'page_number is not unique and must not be the pagination ordering',
  );
});

test('[KAL-282] the collectKeysetRows import is actually wired up', () => {
  assert.match(
    SERVICE,
    /import \{ collectKeysetRows \} from '\.\/annotationReadPagination\.js';/,
  );
});

// The agent-cli tools deliberately MIRROR this reader rather than importing it
// (they run headless against the real backend). The standing project rule is
// that the mirror moves in the same commit as the app, otherwise the harness
// reports a ground-truth row count the app would never produce.
for (const relPath of ['agent-cli/index.mjs', 'agent-cli/survey-roundtrip.mjs']) {
  test(`[KAL-282] ${relPath} mirrors the keyset read, not the old offset read`, () => {
    const source = read(relPath);

    assert.match(source, /\.gt\('id',\s*cursorId\)/, 'mirror must seek by id');
    assert.doesNotMatch(
      source,
      /\.order\('page_number',\s*\{\s*ascending:\s*true\s*\}\)\s*\n\s*\.range\(/,
      'mirror must not page by OFFSET over the non-unique page_number ordering',
    );
  });
}

test('[KAL-282] the checklist-item usage count stays CROSS-DOCUMENT by design', () => {
  const start = SERVICE.indexOf('export async function countSurveyMarkersReferencingChecklistItem(');
  assert.notEqual(start, -1, 'countSurveyMarkersReferencingChecklistItem not found');
  const end = SERVICE.indexOf('\nexport ', start + 1);
  // Includes the in-memory fallback, which is declared between this function
  // and the next `export` and must stay unscoped for the same reason.
  const body = stripLineComments(SERVICE.slice(start, end === -1 ? SERVICE.length : end));

  // Covers both the primary `cs` count and its in-memory fallback.
  assert.doesNotMatch(
    body,
    /\.eq\('document_id'/,
    'must NOT be scoped to one document — the caller has no document open, and '
      + 'scoping it would let the templates editor hard-delete a checklist item '
      + 'that Survey Markers in other documents still reference',
  );
});

test('[KAL-282] the deliberate cross-document scope is documented at the source', () => {
  assert.match(
    SERVICE,
    /THE MISSING `document_id` FILTER IS DELIBERATE/,
    'the rationale comment must stay so the next audit does not re-flag it',
  );
});
