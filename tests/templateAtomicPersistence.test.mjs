import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildAtomicTemplatePayload,
  persistTemplateSnapshot,
  reloadTemplatesAfterPendingSave,
} from '../src/home/templatePersistence.js';

const OWNER_A = '11111111-1111-4111-8111-111111111111';
const OWNER_B = '22222222-2222-4222-8222-222222222222';
const ROW_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

test('malformed template snapshots reject before persistence instead of becoming delete-all', async () => {
  for (const templates of [undefined, null, {}, 'bad', [null], [{ name: 'missing logical id' }]]) {
    let called = false;
    await assert.rejects(persistTemplateSnapshot({
      ownerId: OWNER_A,
      templates,
      persist: async () => { called = true; return []; },
    }), /template/i);
    assert.equal(called, false);
  }
});

test('database hook forwards only explicit arrays and never normalizes malformed snapshots to empty', () => {
  const hook = readFileSync(new URL('../src/hooks/useDatabase.js', import.meta.url), 'utf8');
  const start = hook.indexOf('const replaceTemplates =');
  const end = hook.indexOf('\n\n  return {', start);
  const replaceTemplates = hook.slice(start, end);
  assert.match(replaceTemplates, /if \(!Array\.isArray\(templateRows\)\)\s*throw new TypeError/);
  assert.match(replaceTemplates, /mutateTemplate\(templateRows, async \(capturedRows, \{ request \}\)/);
  assert.match(replaceTemplates, /p_templates: capturedRows/);
  assert.doesNotMatch(replaceTemplates, /p_templates: Array\.isArray/);
});

test('empty template snapshots remain an intentional delete-all operation', async () => {
  let captured;
  await persistTemplateSnapshot({
    ownerId: OWNER_A,
    templates: [],
    persist: async (payload) => { captured = payload; return []; },
  });
  assert.deepEqual(captured, []);
});

test('template snapshot lost-success retry reuses row ids and cannot cascade-replace new rows', async () => {
  const templates = [
    { id: 'logical-a', supabaseId: ROW_A, name: 'A', modules: [] },
    { id: 'logical-b', name: 'B', modules: [] },
  ];
  let attempts = 0;
  let committedIds = [];
  let firstPayloadIds;
  const persist = async (payload) => {
    attempts += 1;
    const ids = payload.map((row) => row.supabase_id);
    assert.match(ids[1], /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    if (attempts === 1) firstPayloadIds = ids;
    else assert.deepEqual(ids, firstPayloadIds);
    committedIds = ids;
    const rows = payload.map((row) => ({
      id: row.supabase_id,
      name: row.name,
      config: row.config,
    }));
    if (attempts === 1) throw new Error('response lost after commit');
    return rows;
  };

  await assert.rejects(persistTemplateSnapshot({ ownerId: OWNER_A, templates, persist }), /response lost/);
  const committedAfterLostResponse = [...committedIds];
  const rows = await persistTemplateSnapshot({ ownerId: OWNER_A, templates, persist });
  assert.equal(attempts, 2);
  assert.deepEqual(rows.map((row) => row.id), committedAfterLostResponse);
});

test('derived new-row ids are deterministic per owner and logical template id', () => {
  const template = { id: 'logical-new', name: 'New', modules: [] };
  const first = buildAtomicTemplatePayload([template], { ownerId: OWNER_A });
  const retry = buildAtomicTemplatePayload([{ ...template }], { ownerId: OWNER_A });
  const otherOwner = buildAtomicTemplatePayload([template], { ownerId: OWNER_B });
  assert.equal(first[0].supabase_id, retry[0].supabase_id);
  assert.notEqual(first[0].supabase_id, otherOwner[0].supabase_id);
});

test('template payload strips client-only row identity from persisted config', async () => {
  let captured;
  await persistTemplateSnapshot({
    ownerId: OWNER_A,
    templates: [{ id: 'logical', supabaseId: ROW_A, name: 'Name', modules: [] }],
    persist: async (payload) => { captured = payload; return []; },
  });
  assert.equal(captured[0].supabase_id, ROW_A);
  assert.equal(captured[0].config.supabaseId, undefined);
  assert.equal(captured[0].config.id, 'logical');
});

test('atomic template migration validates ownership and replaces rows in one function', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260811140000_atomic_template_snapshot.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.replace_my_templates/);
  assert.match(sql, /auth\.uid\(\)/);
  assert.match(sql, /Template row does not belong to the signed-in user/);
  assert.match(sql, /DELETE FROM public\.templates/);
  assert.match(sql, /GRANT EXECUTE[^;]+authenticated/s);
  assert.doesNotMatch(sql, /SECURITY DEFINER/i);
});

test('atomic template migration rejects malformed/null payloads before any delete', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260811140000_atomic_template_snapshot.sql', import.meta.url), 'utf8');
  const validation = sql.indexOf("jsonb_typeof(p_templates) <> 'array'");
  const loop = sql.indexOf('FOR entry IN');
  const deletion = sql.indexOf('DELETE FROM public.templates');
  assert.ok(validation >= 0 && validation < loop && loop < deletion);
  assert.doesNotMatch(sql, /COALESCE\(p_templates, '\[\]'::jsonb\)/);
  assert.match(sql, /jsonb_typeof\(entry\) IS DISTINCT FROM 'object'/);
  assert.match(sql, /jsonb_typeof\(entry->'name'\) IS DISTINCT FROM 'string'/);
  assert.match(sql, /jsonb_typeof\(entry->'config'\) IS DISTINCT FROM 'object'/);
});

test('atomic template migration serializes same-owner snapshots and keeps invoker RLS', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260811140000_atomic_template_snapshot.sql', import.meta.url), 'utf8');
  assert.match(sql, /SECURITY INVOKER/i);
  assert.match(sql, /pg_advisory_xact_lock\s*\(/i);
  assert.match(sql, /caller_id::text/);
  assert.match(sql, /WHERE id = requested_id AND user_id = caller_id/);
  assert.doesNotMatch(sql, /SECURITY DEFINER/i);
  assert.match(sql, /REVOKE ALL[^;]+FROM PUBLIC/s);
  assert.match(sql, /GRANT EXECUTE[^;]+TO authenticated/s);
});

test('atomic template migration is retry-idempotent and advances updated_at', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260811140000_atomic_template_snapshot.sql', import.meta.url), 'utf8');
  assert.match(sql, /requested_id := \(entry->>'supabase_id'\)::uuid/);
  assert.match(sql, /UPDATE public\.templates[\s\S]+updated_at = NOW\(\)[\s\S]+WHERE id = requested_id AND user_id = caller_id/);
  assert.match(sql, /INSERT INTO public\.templates \(id, user_id, name, config\)/);
  assert.doesNotMatch(sql, /INSERT INTO public\.templates \(user_id, name, config\)/);
});

test('cancel waits for pending save, then applies only an authoritative reload', async () => {
  const calls = [];
  let settleSave;
  const pendingSave = new Promise((resolve) => { settleSave = resolve; });
  const operation = reloadTemplatesAfterPendingSave({
    pendingSave,
    reload: async () => { calls.push('reload'); return ['authoritative']; },
    apply: (rows) => calls.push(`apply:${rows[0]}`),
  });
  await Promise.resolve();
  assert.deepEqual(calls, []);
  settleSave();
  await operation;
  assert.deepEqual(calls, ['reload', 'apply:authoritative']);
});

test('failed cancel reload preserves the working copy by never applying', async () => {
  const calls = [];
  await assert.rejects(reloadTemplatesAfterPendingSave({
    pendingSave: Promise.reject(new Error('save failed')),
    reload: async () => { throw new Error('reload failed'); },
    apply: () => calls.push('apply'),
  }), /reload failed/);
  assert.deepEqual(calls, []);
});
