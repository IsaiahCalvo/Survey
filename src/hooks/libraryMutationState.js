/** Apply acknowledged changes without dropping rows the pending read has not
 * returned yet. These are local list changes, not write receipts or authority. */
export function applyLibraryMutation(rows, change) {
  if (change.kind === 'replace') return change.rows;
  if (change.kind === 'delete') return rows.filter(row => row.id !== change.id);
  if (change.kind === 'upsert') return [change.row, ...rows.filter(row => row.id !== change.row.id)];
  if (change.kind === 'update') return rows.map(row => row.id === change.row.id ? change.row : row);
  throw new TypeError('Invalid library change');
}

/** One active read owns this journal. Keep at most one patch per row and one
 * replacement snapshot, not one entry per autosave. A later read owns a new
 * journal; canceled/completed reads release theirs. Never share this across
 * accounts, scopes, hooks or database transactions. */
export function createLibraryReadReconciler() {
  let snapshot = null;
  const patches = new Map();
  return Object.freeze({
    record(change) {
      // Own nested row/config values before returning them to other callers.
      const captured = JSON.parse(JSON.stringify(change));
      if (captured.kind === 'replace') {
        if (!Array.isArray(captured.rows)) throw new TypeError('Invalid library snapshot');
        snapshot = captured.rows; patches.clear();
      } else {
        const id = captured.kind === 'delete' ? captured.id : captured.row?.id;
        if (typeof id !== 'string' || !id || !['upsert', 'update', 'delete'].includes(captured.kind)) {
          throw new TypeError('Invalid library row change');
        }
        const previous = patches.get(id);
        if (captured.kind === 'update' && previous?.kind === 'delete') return;
        if (captured.kind === 'update' && previous?.kind === 'upsert') captured.kind = 'upsert';
        // An explicit upsert moves to the front at that acknowledgement, but
        // updating an earlier created row must keep its original position.
        if (change.kind === 'upsert') patches.delete(id);
        patches.set(id, captured);
      }
    },
    apply(rows) {
      const inserted = [];
      for (const change of patches.values()) {
        if (change.kind === 'upsert') inserted.push(change.row);
      }
      const retained = [];
      for (const row of snapshot ?? rows) {
        const change = patches.get(row.id);
        if (change?.kind === 'upsert' || change?.kind === 'delete') continue;
        retained.push(change?.kind === 'update' ? change.row : row);
      }
      return [...inserted.reverse(), ...retained];
    },
  });
}
