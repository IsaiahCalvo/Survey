import assert from 'node:assert/strict';
import test from 'node:test';
import {
  runCompensatingBatch,
  retryCompensatingCleanup,
} from '../src/home/compensatingBatch.js';
import { readFileSync } from 'node:fs';

const dashboardSource = readFileSync(new URL('../src/Dashboard.jsx', import.meta.url), 'utf8');

test('second-item failure rolls back the first durable creation', async () => {
  const durable = [];
  const rolledBack = [];
  await assert.rejects(
    runCompensatingBatch(
      ['first', 'second'],
      async (item) => {
        if (item === 'second') throw new Error('second file failed');
        durable.push(item);
        return item;
      },
      async (item) => {
        durable.splice(durable.indexOf(item), 1);
        rolledBack.push(item);
      },
    ),
    /second file failed/,
  );
  assert.deepEqual(durable, []);
  assert.deepEqual(rolledBack, ['first']);
});

test('retry after compensated failure creates one copy per item', async () => {
  const durable = [];
  let failSecond = true;
  const create = async (item) => {
    if (item === 'second' && failSecond) throw new Error('second file failed');
    durable.push(item);
    return item;
  };
  const rollback = async (item) => durable.splice(durable.lastIndexOf(item), 1);
  await assert.rejects(runCompensatingBatch(['first', 'second'], create, rollback));
  failSecond = false;
  await runCompensatingBatch(['first', 'second'], create, rollback);
  assert.deepEqual(durable, ['first', 'second']);
});

test('cleanup failures retain only unfinished rollback work and retry it', async () => {
  const durable = [];
  let failCleanupOnce = true;
  const create = async (item) => {
    if (item === 'third') throw new Error('create failed');
    const value = `copy:${item}`;
    durable.push(value);
    return value;
  };
  const rollback = async (value) => {
    if (value === 'copy:first' && failCleanupOnce) {
      failCleanupOnce = false;
      throw new Error('cleanup failed');
    }
    const index = durable.indexOf(value);
    if (index >= 0) durable.splice(index, 1);
  };

  let failure;
  try {
    await runCompensatingBatch(['first', 'second', 'third'], create, rollback);
  } catch (error) {
    failure = error;
  }
  assert.ok(failure);
  assert.deepEqual(durable, ['copy:first']);
  assert.deepEqual(failure.compensation.pending, ['copy:first']);

  await retryCompensatingCleanup(failure.compensation, rollback);
  assert.deepEqual(durable, []);
  assert.deepEqual(failure.compensation.pending, []);
});

test('batch retry drains pending compensation before creating new values', async () => {
  const calls = [];
  const recovery = { pending: ['stale-copy'] };
  const rollback = async (value) => { calls.push(`rollback:${value}`); };
  const create = async (value) => { calls.push(`create:${value}`); return value; };

  await runCompensatingBatch(['fresh'], create, rollback, { recovery });
  assert.deepEqual(calls, ['rollback:stale-copy', 'create:fresh']);
  assert.deepEqual(recovery.pending, []);
});

test('an ambiguous current create contributes its stable recovery value to rollback', async () => {
  const rolledBack = [];
  await assert.rejects(runCompensatingBatch(
    ['first'],
    async () => {
      const error = new Error('response lost');
      error.recoveryValue = { id: 'stable-row', file_path: 'stable.pdf' };
      throw error;
    },
    async (value) => rolledBack.push(value),
  ));
  assert.deepEqual(rolledBack, [{ id: 'stable-row', file_path: 'stable.pdf' }]);
});

test('document duplicate compensation treats an incomplete storage delete as retryable cleanup', () => {
  assert.match(
    dashboardSource,
    /source: 'survey-hub-duplicate-rollback',[\s\S]*requireStorageCleanup: true/,
  );
  assert.match(dashboardSource, /if \(storageCleanupError && requireStorageCleanup\) throw storageCleanupError/);
});
