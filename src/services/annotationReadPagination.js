// KAL-241 — keyset (seek) pagination loop for the durable annotation hydrate read.
//
// Extracted from annotationCloudSync.loadPagedAnnotationRows so the cursor logic
// — the part that must never skip or duplicate a row — can be unit-tested without
// the Vite-only Supabase client (which can't load under the Node test runner).
//
// Contract: `fetchPage(cursorId)` resolves to `{ data, error }`, where `data` is
// the next slice of rows ordered by a unique, non-null key and each row exposes
// that key as `row.id`. The loop seeds with `cursorId = null` (first page) and
// then resumes from the last row's id. A page shorter than `pageSize` ends the
// scan. Any `error` short-circuits and returns the rows gathered so far alongside
// the error (matching the previous reader's partial-on-error behavior).

export async function collectKeysetRows({ pageSize, fetchPage }) {
  if (!Number.isInteger(pageSize) || pageSize <= 0) {
    throw new Error('collectKeysetRows: pageSize must be a positive integer');
  }
  if (typeof fetchPage !== 'function') {
    throw new Error('collectKeysetRows: fetchPage must be a function');
  }
  const rows = [];
  let cursorId = null;
  for (;;) {
    const { data, error } = await fetchPage(cursorId);
    if (error) return { rows, error };
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
    cursorId = batch[batch.length - 1].id;
  }
  return { rows, error: null };
}
