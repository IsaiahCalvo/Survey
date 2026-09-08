import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuitSaveRegistry } from '../src/services/quitSaveRegistry.js';

test('all tabs save locally, including inactive tabs; home-only windows acknowledge empty work', async () => {
  const tabs = [{ id: 'a', file: {} }, { id: 'b', file: {} }];
  const registry = createQuitSaveRegistry(() => tabs);
  const calls = [];
  for (const id of ['a', 'b']) registry.register(id, {
    saveLocal: async () => { calls.push(id); return { saved: true, revision: id }; },
    getRevision: () => id,
  });
  assert.deepEqual(await registry.prepare(), { saved: true, tabIds: ['a', 'b'] });
  assert.deepEqual(calls, ['a', 'b']);
  assert.deepEqual(await registry.confirm(), { saved: true, tabIds: ['a', 'b'] });
  const empty = createQuitSaveRegistry(() => []);
  assert.deepEqual(await empty.prepare(), { saved: true, tabIds: [] });
  assert.deepEqual(await empty.confirm(), { saved: true, tabIds: [] });
});

test('pending or failed local save never produces a positive window acknowledgment', async () => {
  let finish;
  const registry = createQuitSaveRegistry(() => [{ id: 'a', file: null }]);
  registry.register('a', { saveLocal: () => new Promise((resolve) => { finish = resolve; }), getRevision: () => 'a' });
  let settled = false;
  const preparing = registry.prepare().then((value) => { settled = true; return value; });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal((await registry.confirm()).saved, false);
  finish({ saved: false });
  assert.equal((await preparing).saved, false);
});

test('new edits, changed tabs, missing callbacks and canceled saves fail closed', async () => {
  for (const mode of ['revision', 'tab', 'missing', 'cancel']) {
    let revision = 'saved';
    let tabs = [{ id: 'a', file: {} }];
    const registry = createQuitSaveRegistry(() => tabs);
    if (mode !== 'missing') registry.register('a', {
      saveLocal: async () => ({ saved: true, revision }), getRevision: () => revision,
    });
    const result = await registry.prepare();
    if (mode === 'missing') assert.equal(result.saved, false);
    if (mode === 'revision') revision = 'new edit';
    if (mode === 'tab') tabs = [{ id: 'a', file: {} }];
    if (mode === 'cancel') registry.cancel();
    assert.equal((await registry.confirm()).saved, false);
  }
});

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
async function until(check) {
  for (let i = 0; i < 100 && !check(); i++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(check(), 'expected proof callback was not reached');
}
function proofParticipant(overrides = {}) {
  const receipt = {};
  return { saveLocal: async () => ({ saved: true, revision: 'r1' }), getRevision: () => 'r1',
    prepareClose: async () => receipt, validateClose: async () => true,
    isCloseCurrent: value => value === receipt, ...overrides };
}

test('complete local-only proof contract may explicitly validate a null receipt', async () => {
  for (const current of [true, false]) {
    const registry = createQuitSaveRegistry(() => [{ id: 'a', file: null }]);
    let validations = 0;
    registry.register('a', proofParticipant({
      prepareClose: async () => null,
      isCloseCurrent: value => value === null && current,
      validateClose: async value => { assert.equal(value, null); validations++; return true; },
    }));
    assert.equal((await registry.prepareTabClose('a')).saved, current);
    assert.equal(validations, current ? 1 : 0);
  }
});

test('proof trio runs after local save and confirm waits for a fresh validation', async () => {
  const registry = createQuitSaveRegistry(() => [{ id: 'a', file: null, actorUserId: 'actor' }]);
  const calls = []; const validation = deferred();
  const p = proofParticipant({
    saveLocal: async () => { calls.push('local'); return { saved: true, revision: 'r1' }; },
    prepareClose: async ({ signal }) => { assert.equal(signal.aborted, false); calls.push('proof'); return receipt; },
    validateClose: (value, { signal }) => { assert.equal(value, receipt); assert.equal(signal.aborted, false); calls.push('validate'); return validation.promise; },
    isCloseCurrent: value => value === receipt,
  });
  const receipt = {};
  registry.register('a', p);
  assert.equal((await registry.prepare()).saved, true);
  assert.deepEqual(calls, ['local', 'proof']);
  let settled = false;
  const confirming = registry.confirm().then(result => { settled = true; return result; });
  await Promise.resolve();
  assert.equal(settled, false);
  validation.resolve(true);
  assert.equal((await confirming).saved, true);
  assert.deepEqual(calls, ['local', 'proof', 'validate']);
});

test('partial or invalid proof trio fails closed before local save', async () => {
  for (const trio of [ { prepareClose() {} }, { validateClose() {}, isCloseCurrent() {} },
    { prepareClose() {}, validateClose: null, isCloseCurrent() {} } ]) {
    const registry = createQuitSaveRegistry(() => [{ id: 'a', file: null }]);
    let writes = 0;
    registry.register('a', { saveLocal: async () => { writes++; return { saved: true, revision: 'r1' }; }, getRevision: () => 'r1', ...trio });
    assert.equal((await registry.prepare()).saved, false);
    assert.equal(writes, 0);
  }
});

test('false verification, stale proof and edits during final validation cannot approve close', async () => {
  for (const mode of ['false', 'undefined', 'proof-stale', 'revision', 'participant', 'actor', 'file']) {
    let tabs = [{ id: 'a', file: {}, actorUserId: 'actor' }];
    const registry = createQuitSaveRegistry(() => tabs);
    let revision = 'r1', current = true;
    const validation = deferred();
    const p = proofParticipant({ getRevision: () => revision,
      isCloseCurrent: () => current, validateClose: () => validation.promise });
    registry.register('a', p);
    assert.equal((await registry.prepare()).saved, true);
    const confirming = registry.confirm();
    if (mode === 'proof-stale') current = false;
    if (mode === 'revision') revision = 'r2';
    if (mode === 'participant') registry.register('a', { ...p });
    if (mode === 'actor') tabs = [{ ...tabs[0], actorUserId: 'other' }];
    if (mode === 'file') tabs = [{ ...tabs[0], file: {} }];
    validation.resolve(mode === 'false' ? false : mode === 'undefined' ? undefined : true);
    assert.equal((await confirming).saved, false, mode);
  }
});

test('cancel aborts pending proof and validation, ignoring a late success', async () => {
  for (const phase of ['prepare', 'confirm']) {
    const registry = createQuitSaveRegistry(() => [{ id: 'a', file: null }]);
    const pending = deferred(); let signal;
    const p = proofParticipant({ [phase === 'prepare' ? 'prepareClose' : 'validateClose']:
      (...args) => { signal = args.at(-1).signal; return pending.promise; } });
    registry.register('a', p);
    let result;
    if (phase === 'prepare') result = registry.prepare();
    else { await registry.prepare(); result = registry.confirm(); }
    await until(() => signal);
    registry.cancel();
    assert.equal(signal.aborted, true);
    assert.equal((await result).saved, false, 'cancel must settle without a cooperative underlying promise');
    pending.resolve(true);
    assert.equal((await registry.confirm()).saved, false);
  }
});

test('targeted close ignores other tabs but captures exact file, actor and participant', async () => {
  let tabs = [{ id: 'a', file: {}, actorUserId: 'actor' }, { id: 'b', file: {}, actorUserId: 'actor' }];
  const registry = createQuitSaveRegistry(() => tabs);
  const validation = deferred();
  registry.register('a', proofParticipant({ validateClose: () => validation.promise }));
  registry.register('b', { saveLocal: () => { throw new Error('other tab must not save'); }, getRevision: () => 'changed' });
  const closing = registry.prepareTabClose('a');
  await Promise.resolve();
  tabs = [tabs[0], { ...tabs[1], file: {}, actorUserId: 'another' }];
  validation.resolve(true);
  assert.deepEqual(await closing, { saved: true, tabIds: ['a'] });
  assert.equal((await registry.prepareTabClose('missing')).saved, false);
});

test('same-tab remount or superseding attempt cannot complete an old targeted close', async () => {
  const tab = { id: 'a', file: {}, actorUserId: 'actor' };
  const registry = createQuitSaveRegistry(() => [tab]);
  const oldPending = deferred(); let oldSignal;
  registry.register('a', proofParticipant({ prepareClose: options => { oldSignal = options.signal; return oldPending.promise; } }));
  const oldClosing = registry.prepareTabClose('a');
  await until(() => oldSignal);
  registry.register('a', proofParticipant());
  const freshClosing = registry.prepareTabClose('a');
  assert.equal(oldSignal.aborted, true);
  assert.equal((await oldClosing).saved, false);
  assert.equal((await freshClosing).saved, true);
  oldPending.resolve({});
});

test('native confirm cannot adopt a later targeted preparation, including the same sole tab', async () => {
  const tab = { id: 'a', file: {}, actorUserId: 'actor' };
  const registry = createQuitSaveRegistry(() => [tab]);
  registry.register('a', proofParticipant());
  const native = await registry.prepare();
  await registry.prepare({ tabId: 'a' });
  assert.equal((await registry.confirm(native)).saved, false);
  assert.equal((await registry.confirm()).saved, true);
  assert.equal((await registry.prepareTabClose(undefined)).saved, false);
});

test('proof methods added during local save cannot silently downgrade to the old local-only contract', async () => {
  const registry = createQuitSaveRegistry(() => [{ id: 'a', file: null }]);
  const local = deferred();
  const participant = { saveLocal: () => local.promise, getRevision: () => 'r1' };
  registry.register('a', participant);
  const pending = registry.prepare();
  Object.assign(participant, proofParticipant());
  local.resolve({ saved: true, revision: 'r1' });
  assert.equal((await pending).saved, false);
});

test('a completed confirmation is never reused instead of a fresh verification', async () => {
  const registry = createQuitSaveRegistry(() => [{ id: 'a', file: null }]);
  let reads = 0;
  registry.register('a', proofParticipant({ validateClose: async () => ++reads === 1 }));
  await registry.prepare();
  assert.equal((await registry.confirm()).saved, true);
  assert.equal((await registry.confirm()).saved, false);
  assert.equal(reads, 2);
});
