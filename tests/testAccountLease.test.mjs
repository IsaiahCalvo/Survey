import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  acquireTestAccountLease,
  assertTestAccountLease,
  releaseTestAccountLease,
} from '../scripts/test-account-lease.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'survey-test-account-lease-'));
  const worktreeA = join(root, 'worktree-a');
  const worktreeB = join(root, 'worktree-b');
  const leaseRoot = join(root, 'leases');
  const credentialsPath = join(root, 'credentials.json');
  mkdirSync(worktreeA);
  mkdirSync(worktreeB);
  writeFileSync(credentialsPath, JSON.stringify({
    bots: [
      { id: 'user-0', email: 'bot-0@example.test', password: 'secret-0' },
      { id: 'user-1', email: 'bot-1@example.test', password: 'secret-1' },
    ],
  }));
  return {
    credentialsPath,
    leaseRoot,
    worktreeA,
    worktreeB,
  };
}

test('coordinator assigns one exact account and creates a private worktree credential file', () => {
  const setup = fixture();
  const lease = acquireTestAccountLease({
    taskId: 'KAL-500',
    accountIndex: 0,
    worktreePath: setup.worktreeA,
    credentialsPath: setup.credentialsPath,
    leaseRoot: setup.leaseRoot,
    token: 'lease-token-500',
  });

  assert.deepEqual(
    {
      taskId: lease.taskId,
      accountIndex: lease.accountIndex,
      email: lease.email,
      userId: lease.userId,
    },
    {
      taskId: 'KAL-500',
      accountIndex: 0,
      email: 'bot-0@example.test',
      userId: 'user-0',
    },
  );
  assert.equal(statSync(lease.assignmentPath).mode & 0o777, 0o600);
  const assignment = JSON.parse(readFileSync(lease.assignmentPath, 'utf8'));
  assert.equal(assignment.password, 'secret-0');
  assert.equal(assignment.leaseToken, 'lease-token-500');
});

test('a second task cannot reserve an account already owned by another task', () => {
  const setup = fixture();
  acquireTestAccountLease({
    taskId: 'KAL-500',
    accountIndex: 0,
    worktreePath: setup.worktreeA,
    credentialsPath: setup.credentialsPath,
    leaseRoot: setup.leaseRoot,
    token: 'lease-token-500',
  });

  assert.throws(() => acquireTestAccountLease({
    taskId: 'KAL-501',
    accountIndex: 0,
    worktreePath: setup.worktreeB,
    credentialsPath: setup.credentialsPath,
    leaseRoot: setup.leaseRoot,
    token: 'lease-token-501',
  }), /already leased to KAL-500/i);
});

test('one task cannot silently switch to a different account', () => {
  const setup = fixture();
  acquireTestAccountLease({
    taskId: 'KAL-500',
    accountIndex: 0,
    worktreePath: setup.worktreeA,
    credentialsPath: setup.credentialsPath,
    leaseRoot: setup.leaseRoot,
    token: 'lease-token-500',
  });

  assert.throws(() => acquireTestAccountLease({
    taskId: 'KAL-500',
    accountIndex: 1,
    worktreePath: setup.worktreeA,
    credentialsPath: setup.credentialsPath,
    leaseRoot: setup.leaseRoot,
    token: 'another-token',
  }), /already owns account index 0/i);
});

test('verification rejects a wrong task, token, account index, or worktree', () => {
  const setup = fixture();
  acquireTestAccountLease({
    taskId: 'KAL-500',
    accountIndex: 0,
    worktreePath: setup.worktreeA,
    credentialsPath: setup.credentialsPath,
    leaseRoot: setup.leaseRoot,
    token: 'lease-token-500',
  });

  const base = {
    taskId: 'KAL-500',
    accountIndex: 0,
    worktreePath: setup.worktreeA,
    leaseRoot: setup.leaseRoot,
    token: 'lease-token-500',
  };
  assert.equal(assertTestAccountLease(base).email, 'bot-0@example.test');
  assert.throws(
    () => assertTestAccountLease({ ...base, taskId: 'KAL-501' }),
    /assignment task mismatch/i,
  );
  assert.throws(
    () => assertTestAccountLease({ ...base, token: 'wrong-token' }),
    /lease token mismatch/i,
  );
  assert.throws(
    () => assertTestAccountLease({ ...base, accountIndex: 1 }),
    /account index mismatch/i,
  );
  assert.throws(
    () => assertTestAccountLease({ ...base, worktreePath: setup.worktreeB }),
    /assignment file is missing/i,
  );
});

test('only the owning task and token can release an account', () => {
  const setup = fixture();
  acquireTestAccountLease({
    taskId: 'KAL-500',
    accountIndex: 0,
    worktreePath: setup.worktreeA,
    credentialsPath: setup.credentialsPath,
    leaseRoot: setup.leaseRoot,
    token: 'lease-token-500',
  });

  assert.throws(() => releaseTestAccountLease({
    taskId: 'KAL-500',
    accountIndex: 0,
    worktreePath: setup.worktreeA,
    leaseRoot: setup.leaseRoot,
    token: 'wrong-token',
  }), /lease token mismatch/i);

  releaseTestAccountLease({
    taskId: 'KAL-500',
    accountIndex: 0,
    worktreePath: setup.worktreeA,
    leaseRoot: setup.leaseRoot,
    token: 'lease-token-500',
  });

  const reassigned = acquireTestAccountLease({
    taskId: 'KAL-501',
    accountIndex: 0,
    worktreePath: setup.worktreeB,
    credentialsPath: setup.credentialsPath,
    leaseRoot: setup.leaseRoot,
    token: 'lease-token-501',
  });
  assert.equal(reassigned.taskId, 'KAL-501');
});
