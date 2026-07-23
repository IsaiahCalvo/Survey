import test from 'node:test';
import assert from 'node:assert/strict';

import { createServer } from 'vite';

function rowClient(row) {
  return {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({ data: row, error: null }),
              };
            },
          };
        },
      };
    },
  };
}

test('initial lock read bypasses a stale unlocked metadata cache', async () => {
  const vite = await createServer({
    configFile: false,
    appType: 'custom',
    server: { middlewareMode: true, hmr: false },
  });
  try {
    const { fetchDocumentLockState } = await vite.ssrLoadModule(
      '/src/services/documentLockService.js',
    );
    const metadata = await vite.ssrLoadModule('/src/services/documentMetadataResolver.js');
    metadata.__resetDocumentMetadataCacheForTests();
    await metadata.resolveDocumentMetadata('doc-1', {
      supabase: rowClient({
        id: 'doc-1',
        locked_at: null,
        locked_by: null,
        locked_label: null,
      }),
    });

    const fresh = await fetchDocumentLockState('doc-1', rowClient({
      id: 'doc-1',
      locked_at: '2026-07-23T12:00:00.000Z',
      locked_by: 'owner-1',
      locked_label: 'IFC',
    }));
    assert.deepEqual(fresh, {
      lockedAt: '2026-07-23T12:00:00.000Z',
      lockedBy: 'owner-1',
      lockedLabel: 'IFC',
    });
  } finally {
    await vite.close();
  }
});

test('newer Realtime lock state wins over an older delayed initial fetch', async () => {
  const vite = await createServer({
    configFile: false,
    appType: 'custom',
    server: { middlewareMode: true, hmr: false },
  });
  try {
    const { createDocumentLockStateSequence } = await vite.ssrLoadModule(
      '/src/services/documentLockService.js',
    );
    const applied = [];
    const sequence = createDocumentLockStateSequence((state) => applied.push(state));
    const initialGeneration = sequence.snapshot();

    sequence.applyRealtime({ lockedAt: 'new-lock', lockedBy: 'owner', lockedLabel: null });
    const didApplyStaleFetch = sequence.applyInitial(initialGeneration, {
      lockedAt: null,
      lockedBy: null,
      lockedLabel: null,
    });

    assert.equal(didApplyStaleFetch, false);
    assert.deepEqual(applied, [
      { lockedAt: 'new-lock', lockedBy: 'owner', lockedLabel: null },
    ]);
  } finally {
    await vite.close();
  }
});

test('document lock Realtime subscription maps remote UPDATE and tears down', async () => {
  const vite = await createServer({
    configFile: false,
    appType: 'custom',
    server: { middlewareMode: true, hmr: false },
  });
  try {
    const { subscribeDocumentLockState } = await vite.ssrLoadModule(
      '/src/services/documentLockService.js',
    );
    let handler = null;
    let subscribed = false;
    let removed = null;
    const channel = {
      on(event, filter, callback) {
        assert.equal(event, 'postgres_changes');
        assert.deepEqual(filter, {
          event: 'UPDATE',
          schema: 'public',
          table: 'documents',
          filter: 'id=eq.doc-1',
        });
        handler = callback;
        return this;
      },
      subscribe() {
        subscribed = true;
        return this;
      },
    };
    const client = {
      channel(name) {
        assert.match(name, /^document-lock:doc-1:/);
        return channel;
      },
      removeChannel(value) {
        removed = value;
      },
    };
    const states = [];
    const unsubscribe = subscribeDocumentLockState('doc-1', (state) => {
      states.push(state);
    }, client);

    assert.equal(subscribed, true);
    handler({
      new: {
        id: 'doc-1',
        locked_at: '2026-07-23T12:00:00.000Z',
        locked_by: 'owner-1',
        locked_label: 'IFC',
      },
    });
    handler({ new: { id: 'other-doc', locked_at: 'ignored' } });
    handler({
      new: {
        id: 'doc-1',
        locked_at: null,
        locked_by: null,
        locked_label: null,
      },
    });

    assert.deepEqual(states, [
      {
        lockedAt: '2026-07-23T12:00:00.000Z',
        lockedBy: 'owner-1',
        lockedLabel: 'IFC',
      },
      { lockedAt: null, lockedBy: null, lockedLabel: null },
    ]);
    unsubscribe();
    assert.equal(removed, channel);
  } finally {
    await vite.close();
  }
});
