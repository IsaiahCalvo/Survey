/**
 * HocuspocusYjsProvider arg validation + missing-package path.
 * Missing-package case skips when a local stub/real package is present
 * (coverage loop installs a stub under node_modules for success-path chips).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHocuspocusYjsProvider } from '../src/lib/collab/HocuspocusYjsProvider.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HAS_HOCUSPOCUS = existsSync(resolve(ROOT, 'node_modules/@hocuspocus/provider/package.json'));

test('createHocuspocusYjsProvider rejects missing required args', async () => {
  await assert.rejects(
    () => createHocuspocusYjsProvider({ ydoc: {}, supabase: {} }),
    /documentId required/,
  );
  await assert.rejects(
    () => createHocuspocusYjsProvider({ documentId: 'd1', supabase: {} }),
    /ydoc required/,
  );
  await assert.rejects(
    () => createHocuspocusYjsProvider({ documentId: 'd1', ydoc: {} }),
    /supabase client required/,
  );
});

test(
  'createHocuspocusYjsProvider surfaces missing @hocuspocus/provider',
  { skip: HAS_HOCUSPOCUS && '@hocuspocus/provider present (stub or real)' },
  async () => {
    await assert.rejects(
      () => createHocuspocusYjsProvider({
        documentId: 'd1',
        ydoc: {},
        supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
      }),
      /@hocuspocus\/provider not installed/,
    );
  },
);
