// Keep the current whole-library hook contract without silently losing rows
// at PostgREST's response cap. 500 stays below this project's max_rows=1000.
// Seek by a unique, immutable key; sort for display only after the full read.
export const LIBRARY_PAGE_SIZE = 500;
export const LIBRARY_ID_CHUNK_SIZE = 100;

export async function readLibraryRows(createQuery, {
  cursorColumn = 'id', pageSize = LIBRARY_PAGE_SIZE,
} = {}) {
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new TypeError('Invalid library page size');
  const rows = [];
  let cursor = null;
  try {
    for (;;) {
      let query = createQuery().order(cursorColumn, { ascending: true }).limit(pageSize);
      if (cursor !== null) query = query.gt(cursorColumn, cursor);
      const { data, error } = await query;
      if (error) return { data: null, error };
      const batch = data ?? [];
      if (!Array.isArray(batch)) throw new TypeError('Invalid library page');
      // A broken cursor must fail visibly, not loop forever or duplicate rows.
      for (const row of batch) {
        const next = row?.[cursorColumn];
        if (typeof next !== 'string' || !next || (cursor !== null && next <= cursor)) {
          throw new Error('Library cursor did not advance');
        }
        cursor = next;
      }
      rows.push(...batch);
      if (batch.length < pageSize) return { data: rows, error: null };
    }
  } catch (error) {
    return { data: null, error };
  }
}

// Keep UUID lists well below proxy URL limits. Chunks run in order, bounding
// outstanding reads; a failure never publishes a misleading partial library.
export async function readLibraryIdChunks(ids, createQuery) {
  const uniqueIds = [...new Set(ids)];
  const rows = [];
  for (let start = 0; start < uniqueIds.length; start += LIBRARY_ID_CHUNK_SIZE) {
    const chunk = uniqueIds.slice(start, start + LIBRARY_ID_CHUNK_SIZE);
    const result = await readLibraryRows(() => createQuery(chunk));
    if (result.error) return result;
    rows.push(...result.data);
  }
  return { data: rows, error: null };
}

export function sortLibraryRows(rows, timestamp) {
  return [...rows].sort((a, b) => (Date.parse(b[timestamp]) || 0) - (Date.parse(a[timestamp]) || 0)
    || String(a.id).localeCompare(String(b.id)));
}
