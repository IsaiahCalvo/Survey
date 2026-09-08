import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createElement, useCallback } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { cleanupDocumentStorage } from '../src/services/documentStorageCleanup.js';

const read = name => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');
const id = '22222222-2222-4222-8222-222222222222';
const path = 'owner/exact.pdf';
// Evaluate actual callers and helper. Only the external SDK and local cache
// boundary are faked; these tests do not claim to prove SQL locking behavior.
function fixture(kind, options = {}) {
  const exactPath = options.invalidPath ? 'owner/control\u0000.pdf' : (options.path ?? path);
  const trace = [], warnings = [], invalidated = [];
  const client = {
    async rpc(name, args) {
      trace.push([name, args]);
      if (name.startsWith('purge_archived_')) return options.purgeError ? { error: { message: 'purge unavailable' } }
        : { data: { ok: true, orphaned_paths: [exactPath], deleted_document_ids: [id] }, error: null };
      if (name === 'retire_document_storage_paths') {
        if (options.retireError) return { error: { message: 'retirement unavailable' } };
        return { data: { retired_paths: options.shared ? [] : [exactPath], referenced_paths: options.shared ? [exactPath] : [] } };
      }
      if (name === 'ack_document_storage_cleanup') return { data: { acknowledged_paths: options.ackPending ? [] : [exactPath], pending_paths: options.ackPending ? [exactPath] : [] } };
      throw Error(`Unexpected RPC ${name}`);
    },
    storage: { from: bucket => ({ async remove(paths) {
      trace.push(['remove', bucket, [...paths]]);
      return options.removeError ? { error: { message: 'storage unavailable' } } : { data: paths.map(name => ({ name })), error: null };
    } }) },
  };
  const context = { supabase: client, cleanupDocumentStorage,
    console: { error() {}, warn: (...args) => warnings.push(args) },
    purgeAnnotationDoc: async key => { trace.push(['localPurge', key]); },
    useCallback, useAuth: () => ({ user: { id: 'owner' } }),
    isSupabaseAvailable: () => options.available !== false,
    storageDownloads: () => ({ invalidate: key => invalidated.push(key) }),
  };
  let source;
  if (kind === 'storage') {
    source = read('hooks/useDatabase.js').split('export const useStorage = () => {')[1].split('// CONNECTED SERVICES HOOKS')[0];
    source = `globalThis.useStorage = () => {${source}`;
  } else source = read(`services/${kind}ArchiveService.js`).replace(/^import .*;\s*$/gm, '').replace(/^export /gm, '');
  vm.runInNewContext(source, context);
  let storage;
  if (kind === 'storage') renderToStaticMarkup(createElement(function HookProbe() { storage = context.useStorage(); return null; }));
  return { trace, warnings, invalidated, run: () => kind === 'storage' ? storage.deleteDocumentFile(exactPath)
    : context[kind === 'document' ? 'deleteDocumentForever' : 'deleteProjectForever'](id) };
}

test('document purge succeeds but keeps storage and reports pending cleanup when retirement RPC is unavailable', async () => {
  const f = fixture('document', { retireError: true });
  const result = await f.run();
  assert.equal(result.success, true);
  assert.equal(result.storageCleanupPending, true);
  assert.equal(f.trace.some(([name]) => name === 'remove'), false);
  assert.equal(f.trace.some(([name]) => name === 'localPurge'), true);
  assert.equal(f.warnings.length, 1);
});

for (const kind of ['document', 'project', 'storage']) {
  test(`${kind} retires exact paths before Storage and acknowledges removal`, async () => {
    const f = fixture(kind); const result = await f.run();
    assert.deepEqual(f.trace.filter(([name]) => name !== 'localPurge' && !name.startsWith('purge_archived_')).map(([name]) => name),
      ['retire_document_storage_paths', 'remove', 'ack_document_storage_cleanup']);
    assert.deepEqual(f.trace.find(([name]) => name === 'remove').slice(1), ['documents', [path]]);
    if (kind === 'storage') assert.deepEqual(f.invalidated, [path]);
    else { assert.equal(result.success, true); assert.equal(result.storageCleanupPending, undefined); }
  });
  test(`${kind} retains a newly referenced shared path without treating it as failure`, async () => {
    const f = fixture(kind, { shared: true }); const result = await f.run();
    assert.equal(f.trace.some(([name]) => name === 'remove'), false);
    assert.deepEqual(f.warnings, []);
    if (kind === 'storage') assert.deepEqual(f.invalidated, [path]);
    else { assert.equal(result.success, true); assert.equal(result.storageCleanupPending, undefined); }
  });
  for (const failure of ['retireError', 'removeError', 'ackPending']) {
    test(`${kind} reports ${failure} as pending without unsafe fallback`, async () => {
      const f = fixture(kind, { [failure]: true });
      if (kind === 'storage') {
        await assert.rejects(f.run(), error => error.code === 'storage-cleanup-pending');
        assert.deepEqual(f.invalidated, [], 'keep failed-delete cache semantics');
      } else {
        const result = await f.run();
        assert.equal(result.success, true); assert.equal(result.storageCleanupPending, true);
        assert.equal(f.trace.some(([name]) => name === 'localPurge'), true);
        assert.equal(f.warnings.length, 1);
      }
      assert.equal(f.trace.filter(([name]) => name === 'remove').length, failure === 'retireError' ? 0 : 1);
    });
  }
}

test('unavailable Supabase rejects storage deletion without network or cache changes', async () => {
  const f = fixture('storage', { available: false });
  await assert.rejects(f.run(), /Supabase not available/);
  assert.deepEqual(f.trace, []); assert.deepEqual(f.invalidated, []);
});

for (const kind of ['document', 'project']) {
  test(`${kind} failed row purge never attempts storage or local cleanup`, async () => {
    const f = fixture(kind, { purgeError: true });
    assert.equal((await f.run()).success, false);
    assert.deepEqual(f.trace.map(([name]) => name), [`purge_archived_${kind}`]);
  });
  test(`${kind} invalid storage paths keep committed row success but report pending cleanup`, async () => {
    const f = fixture(kind, { invalidPath: true });
    const result = await f.run();
    assert.equal(result.success, true); assert.equal(result.storageCleanupPending, true);
    assert.deepEqual(f.trace.map(([name]) => name), [`purge_archived_${kind}`, 'localPurge']);
  });
}

test('invalid direct storage path rejects before network or cache changes', async () => {
  const f = fixture('storage', { invalidPath: true });
  await assert.rejects(f.run(), /valid exact object paths/);
  assert.deepEqual(f.trace, []); assert.deepEqual(f.invalidated, []);
});

for (const kind of ['document', 'project', 'storage']) {
  test(`${kind} passes legacy raw keys unchanged through retirement, removal, and acknowledgement`, async () => {
    const legacy = 'owner/legacy/../100%25?.#pdf';
    const f = fixture(kind, { path: legacy });
    const result = await f.run();
    const requests = f.trace.filter(([name]) => ['retire_document_storage_paths', 'remove', 'ack_document_storage_cleanup'].includes(name));
    assert.deepEqual(requests.map(([name, args, paths]) => [name, name === 'remove' ? paths : [...args.p_paths]]), [
      ['retire_document_storage_paths', [legacy]], ['remove', [legacy]], ['ack_document_storage_cleanup', [legacy]],
    ]);
    if (kind === 'storage') assert.deepEqual(f.invalidated, [legacy]);
    else { assert.equal(result.success, true); assert.equal(result.storageCleanupPending, undefined); }
    assert.deepEqual(f.warnings, []);
  });
}
