import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  moveOrCopyDocumentsAtomically,
  parseDocumentBatchRecovery,
} from '../src/home/documentBatchOperations.js';

test('copy rolls back every earlier copy when each later stage fails, then retries cleanly', async () => {
  for (const failAt of [0, 1, 2]) {
    const durable = [];
    let attempts = 0;
    let shouldFail = true;
    const documents = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const copyDocument = async (document) => {
      if (shouldFail && attempts++ === failAt) throw new Error(`failed:${failAt}`);
      const copy = { id: `copy-${document.id}` };
      durable.push(copy.id);
      return copy;
    };
    const rollbackCopy = async (copy) => {
      const index = durable.indexOf(copy.id);
      if (index >= 0) durable.splice(index, 1);
    };
    let nextId = 0;
    const readDocument = async () => null;

    await assert.rejects(moveOrCopyDocumentsAtomically({
      documents, mode: 'copy', projectId: 'dest', copyDocument, rollbackCopy,
      readDocument, makeOperationId: () => `operation-${nextId++}`,
    }));
    assert.deepEqual(durable, []);

    shouldFail = false;
    await moveOrCopyDocumentsAtomically({
      documents, mode: 'copy', projectId: 'dest', copyDocument, rollbackCopy,
      readDocument, makeOperationId: () => `retry-${nextId++}`,
    });
    assert.deepEqual(durable, ['copy-a', 'copy-b', 'copy-c']);
  }
});

test('move restores original project after a failure and a retry moves every row once', async () => {
  const durable = new Map([['a', null], ['b', 'old'], ['c', null]]);
  let calls = 0;
  let shouldFail = true;
  const documents = [...durable].map(([id, project_id]) => ({ id, project_id }));
  const moveDocument = async (document, projectId) => {
    if (shouldFail && calls++ === 1) throw new Error('middle move failed');
    durable.set(document.id, projectId);
  };
  const rollbackMove = async ({ document, previousProjectId }) => {
    durable.set(document.id, previousProjectId);
  };
  const readDocument = async (id) => ({ id, project_id: durable.get(id) });

  await assert.rejects(moveOrCopyDocumentsAtomically({
    documents, mode: 'move', projectId: 'dest', moveDocument, rollbackMove, readDocument,
  }));
  assert.deepEqual([...durable.values()], [null, 'old', null]);

  shouldFail = false;
  await moveOrCopyDocumentsAtomically({
    documents, mode: 'move', projectId: 'dest', moveDocument, rollbackMove, readDocument,
  });
  assert.deepEqual([...durable.values()], ['dest', 'dest', 'dest']);
});

test('a committed copy with a lost response is reconciled and its bytes are never rolled back', async () => {
  const rows = new Map();
  const rolledBack = [];
  const result = await moveOrCopyDocumentsAtomically({
    documents: [{ id: 'source-a', project_id: 'old' }],
    mode: 'copy',
    projectId: 'dest',
    makeOperationId: () => 'copy-stable-id',
    copyDocument: async (_document, projectId, operation) => {
      const row = { id: operation.operationId, project_id: projectId, file_path: 'stable.pdf' };
      rows.set(row.id, row);
      const error = new Error('response lost after commit');
      error.recoveryValue = row;
      throw error;
    },
    readDocument: async (id) => rows.get(id) || null,
    rollbackCopy: async (row) => rolledBack.push(row.id),
  });

  assert.deepEqual(result.map((row) => row.id), ['copy-stable-id']);
  assert.deepEqual(rolledBack, []);
  assert.equal(rows.get('copy-stable-id').file_path, 'stable.pdf');
});

test('an unresolved response persists the stable id and original copy mode across changed-mode retry', async () => {
  const rows = new Map();
  let durableRecovery = null;
  let first = true;
  let reconcileOnline = false;
  const callbacks = {
    copyDocument: async (_document, projectId, operation) => {
      const row = rows.get(operation.operationId)
        || { id: operation.operationId, project_id: projectId };
      rows.set(row.id, row);
      if (first) {
        first = false;
        throw new Error('lost');
      }
      return row;
    },
    readDocument: async (id) => {
      if (!reconcileOnline) throw new Error('reconcile offline');
      return rows.get(id) || null;
    },
    rollbackCopy: async () => {},
    moveDocument: async () => assert.fail('retry must not reinterpret copy recovery as move'),
    rollbackMove: async () => assert.fail('copy recovery must not use move rollback'),
  };

  await assert.rejects(moveOrCopyDocumentsAtomically({
    documents: [{ id: 'source' }], mode: 'copy', projectId: 'copy-dest',
    makeOperationId: () => 'stable-copy',
    onRecoveryChange: (value) => { if (value) durableRecovery = structuredClone(value); },
    ...callbacks,
  }));
  const restored = parseDocumentBatchRecovery(JSON.stringify(durableRecovery));
  assert.equal(restored.mode, 'copy');
  assert.equal(restored.projectId, 'copy-dest');
  assert.equal(restored.items[0].operationId, 'stable-copy');

  reconcileOnline = true;
  const result = await moveOrCopyDocumentsAtomically({
    documents: [], mode: 'move', projectId: 'different-dest', recovery: restored,
    onRecoveryChange: (value) => { durableRecovery = value; },
    ...callbacks,
  });
  assert.deepEqual(result.map((row) => row.id), ['stable-copy']);
  assert.equal(durableRecovery, null);
});

test('a failed copy includes its uploaded orphan in retryable cleanup', async () => {
  let cleanupAttempts = 0;
  let recovery;
  const orphan = { id: 'stable-copy', file_path: 'stable.pdf' };
  const execute = () => moveOrCopyDocumentsAtomically({
    documents: [{ id: 'source' }], mode: 'copy', projectId: 'dest',
    makeOperationId: () => orphan.id,
    copyDocument: async () => {
      const error = new Error('insert rejected');
      error.recoveryValue = orphan;
      throw error;
    },
    readDocument: async () => null,
    rollbackCopy: async () => {
      cleanupAttempts += 1;
      if (cleanupAttempts === 1) throw new Error('storage delete offline');
    },
    onRecoveryChange: (value) => { if (value) recovery = structuredClone(value); },
  });

  await assert.rejects(execute(), (error) => error.recovery?.phase === 'cleanup');
  assert.deepEqual(recovery.completed, [orphan]);
  await moveOrCopyDocumentsAtomically({
    documents: [], mode: 'move', projectId: 'wrong', recovery,
    rollbackCopy: async () => { cleanupAttempts += 1; },
    rollbackMove: async () => assert.fail('original copy cleanup must be preserved'),
    onRecoveryChange: (value) => { recovery = value; },
  });
  assert.equal(recovery, null);
  assert.equal(cleanupAttempts, 2);
});

test('project move/copy returns its promise and modal stays open with an error on rejection', () => {
  const projects = readFileSync(new URL('../src/home/ProjectsFolderTree.jsx', import.meta.url), 'utf8');
  const modal = readFileSync(new URL('../src/home/BulkModals.jsx', import.meta.url), 'utf8');
  const dashboard = readFileSync(new URL('../src/Dashboard.jsx', import.meta.url), 'utf8');
  assert.match(projects, /onConfirm=\{\(destId, mode\) => moveCopyFiles\(moveIds, destId, mode\)\}/);
  assert.match(modal, /await onConfirm\?\.\(destId, mode\);\s*onClose\?\.\(\);\s*\} catch \(error\) \{/);
  assert.match(modal, /setSubmitError\(error\?\.message/);
  assert.match(dashboard, /survey-document-move-copy-recovery:/);
  assert.match(dashboard, /survey-duplicate-documents-recovery:/);
  assert.match(dashboard, /survey-duplicate-projects-recovery:/);
  assert.match(dashboard, /retryCompensatingCleanup\([\s\S]+duplicateDocumentsRecoveryRef\.current/);
  assert.match(dashboard, /retryCompensatingCleanup\([\s\S]+duplicateProjectsRecoveryRef\.current/);
  assert.match(dashboard, /id: stableCopyId/);
  assert.match(dashboard, /id: stableProjectId/);
});
