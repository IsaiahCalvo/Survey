// kits-admin edge function logic: admin check first, then the body schema.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleKitsAdmin } from '../supabase/functions/_shared/kitsAdmin.js';

const userClient = (admin) => ({ rpc: async (name) => { assert.equal(name, 'is_feature_flag_admin'); return { data: admin, error: null }; } });
const noService = new Proxy({}, { get() { throw new Error('service role must not be touched'); } });

test('non-admins are refused before anything else, including the service role', async () => {
  for (const admin of [false, null, 'true']) {
    assert.equal((await handleKitsAdmin({ action: 'list' }, { userClient: userClient(admin), service: noService })).status, 403);
  }
});

test('bad bodies are refused with a 400 and never reach the service role', async () => {
  for (const body of [null, [], { action: 'drop' }, { action: 'assign', email: { a: 1 } }, { action: 'assign', kitId: 'x'.repeat(101) }]) {
    const r = await handleKitsAdmin(body, { userClient: userClient(true), service: noService });
    assert.equal(r.status, 400, JSON.stringify(body));
  }
});
