import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  acquireTestAccountLease,
  assertTestAccountLease,
  attestTestAccountCleanup,
  beginTestAccountRun,
  endTestAccountRun,
  loadVerifiedTestAccounts,
  recoverInterruptedTestAccountRun,
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
      { id: 'user-alpha', email: 'alpha@example.test', password: 'secret-alpha' },
      { id: 'user-bravo', email: 'bravo@example.test', password: 'secret-bravo' },
      { id: 'user-charlie', email: 'charlie@example.test', password: 'secret-charlie' },
    ],
  }));
  return { credentialsPath, leaseRoot, root, worktreeA, worktreeB };
}

function accounts(...names) {
  return names.map((name) => ({
    email: `${name}@example.test`,
    userId: `user-${name}`,
    baseline: { tier: name === 'alpha' ? 'developer' : 'free', status: 'active' },
  }));
}

function acquire(setup, overrides = {}) {
  return acquireTestAccountLease({
    taskId: 'KAL-500',
    accountAssignments: accounts('alpha', 'bravo'),
    worktreePath: setup.worktreeA,
    credentialsPath: setup.credentialsPath,
    leaseRoot: setup.leaseRoot,
    token: 'lease-token-500',
    ...overrides,
  });
}

function owner(setup, overrides = {}) {
  return {
    taskId: 'KAL-500',
    worktreePath: setup.worktreeA,
    leaseRoot: setup.leaseRoot,
    token: 'lease-token-500',
    ...overrides,
  };
}

function restored(...names) {
  return names.map((name) => ({
    email: `${name}@example.test`,
    userId: `user-${name}`,
    tier: name === 'alpha' ? 'developer' : 'free',
    status: 'active',
  }));
}

test('coordinator atomically assigns an exact multi-account bundle', () => {
  const setup = fixture();
  const lease = acquire(setup);

  assert.deepEqual(
    lease.accounts.map(({ email, userId, baseline }) => ({ email, userId, baseline })),
    accounts('alpha', 'bravo'),
  );
  assert.equal(statSync(lease.assignmentPath).mode & 0o777, 0o600);
  const assignment = JSON.parse(readFileSync(lease.assignmentPath, 'utf8'));
  assert.deepEqual(assignment.accounts.map(({ email, userId }) => ({ email, userId })), [
    { email: 'alpha@example.test', userId: 'user-alpha' },
    { email: 'bravo@example.test', userId: 'user-bravo' },
  ]);
  assert.equal(assignment.accounts[0].password, 'secret-alpha');
  assert.equal(assignment.accounts[1].password, 'secret-bravo');
});

test('assignment rejects index-like selectors and mismatched email/user identities', () => {
  const setup = fixture();
  assert.throws(() => acquireTestAccountLease({
    taskId: 'KAL-500',
    accountAssignments: [{ accountIndex: 0, baseline: { tier: 'free', status: 'active' } }],
    worktreePath: setup.worktreeA,
    credentialsPath: setup.credentialsPath,
    leaseRoot: setup.leaseRoot,
  }), /exact email/i);
  assert.throws(() => acquire(setup, {
    accountAssignments: [{
      email: 'alpha@example.test',
      userId: 'user-bravo',
      baseline: { tier: 'free', status: 'active' },
    }],
  }), /do not identify the same credential/i);
});

test('a conflicting account makes the whole bundle fail without partial locks', () => {
  const setup = fixture();
  acquire(setup, {
    taskId: 'KAL-499',
    token: 'lease-token-499',
    worktreePath: setup.worktreeB,
    accountAssignments: accounts('bravo'),
  });

  assert.throws(() => acquire(setup), /bravo@example\.test.*already leased to KAL-499/i);
  const charlieLease = acquire(setup, {
    accountAssignments: accounts('alpha', 'charlie'),
  });
  assert.equal(charlieLease.accounts.length, 2);
});

test('one task cannot silently change bundles or worktrees', () => {
  const setup = fixture();
  acquire(setup);
  assert.throws(() => acquire(setup, {
    accountAssignments: accounts('charlie'),
    token: 'another-token',
  }), /already owns a test-account bundle/i);
  assert.throws(() => assertTestAccountLease(owner(setup, {
    worktreePath: setup.worktreeB,
  })), /assignment file is missing|worktree mismatch/i);
});

test('official harness loader requires a fully verified lease and account count', () => {
  const setup = fixture();
  acquire(setup);
  const env = {
    SURVEY_TEST_LEASE_TASK: 'KAL-500',
    SURVEY_TEST_LEASE_TOKEN: 'lease-token-500',
    SURVEY_TEST_LEASE_ROOT: setup.leaseRoot,
    SURVEY_TEST_LEASE_WORKTREE: setup.worktreeA,
  };

  assert.equal(loadVerifiedTestAccounts({ env, minimumAccounts: 2 })[1].userId, 'user-bravo');
  assert.throws(
    () => loadVerifiedTestAccounts({ env: {}, minimumAccounts: 2 }),
    /must run through test-account-lease.*run/i,
  );
  assert.throws(
    () => loadVerifiedTestAccounts({ env, minimumAccounts: 3 }),
    /requires 3 leased accounts.*only 2/i,
  );
});

test('active run blocks another run and all release attempts', () => {
  const setup = fixture();
  acquire(setup);
  beginTestAccountRun({ ...owner(setup), command: ['node', 'test.mjs'], pid: 424242 });
  assert.throws(
    () => beginTestAccountRun({ ...owner(setup), command: ['node', 'other.mjs'] }),
    /already active/i,
  );
  assert.throws(() => releaseTestAccountLease(owner(setup)), /active test run/i);
  assert.throws(
    () => recoverInterruptedTestAccountRun({
      ...owner(setup),
      expectedPid: 424242,
      coordinatorConfirmation: 'wrong',
      isProcessAlive: () => false,
    }),
    /coordinator confirmation/i,
  );
  recoverInterruptedTestAccountRun({
    ...owner(setup),
    expectedPid: 424242,
    coordinatorConfirmation: 'I_AM_THE_TEST_ACCOUNT_COORDINATOR',
    isProcessAlive: () => false,
  });
  assert.doesNotThrow(() => beginTestAccountRun(owner(setup)));
  endTestAccountRun(owner(setup));
});

test('a hard-crashed partial acquisition resumes only with the exact task token and bundle', () => {
  const setup = fixture();
  acquire(setup);
  const taskPath = join(setup.leaseRoot, 'task-kal-500.json');
  const task = JSON.parse(readFileSync(taskPath, 'utf8'));
  writeFileSync(taskPath, `${JSON.stringify({ ...task, state: 'acquiring' }, null, 2)}\n`);
  rmSync(join(setup.leaseRoot, 'account-user-bravo.json'));
  rmSync(join(setup.worktreeA, '.survey-test-account.json'));

  assert.throws(
    () => acquire(setup, { token: 'wrong-token' }),
    /already owns a test-account bundle/i,
  );
  const resumed = acquire(setup);
  assert.equal(resumed.state, 'active');
  assert.equal(assertTestAccountLease(owner(setup)).accounts.length, 2);
});

test('cleanup attestation must exactly match baseline before release', () => {
  const setup = fixture();
  acquire(setup);
  assert.throws(() => attestTestAccountCleanup({
    ...owner(setup),
    restoredAccounts: [
      { ...restored('alpha')[0], tier: 'free' },
      restored('bravo')[0],
    ],
    artifactsCleared: true,
    attestedBy: 'monitor-task',
  }), /baseline mismatch.*alpha@example\.test/i);
  assert.throws(() => attestTestAccountCleanup({
    ...owner(setup),
    restoredAccounts: restored('alpha', 'bravo'),
    artifactsCleared: false,
    attestedBy: 'monitor-task',
  }), /artifacts.*must be verified clear/i);
  assert.throws(() => releaseTestAccountLease(owner(setup)), /cleanup attestation/i);

  attestTestAccountCleanup({
    ...owner(setup),
    restoredAccounts: restored('alpha', 'bravo'),
    artifactsCleared: true,
    attestedBy: 'monitor-task',
  });
  releaseTestAccountLease(owner(setup));
  assert.equal(existsSync(join(setup.worktreeA, '.survey-test-account.json')), false);
});

test('cleanup attestation freezes the lease against later test runs', () => {
  const setup = fixture();
  acquire(setup);
  attestTestAccountCleanup({
    ...owner(setup),
    restoredAccounts: restored('alpha', 'bravo'),
    artifactsCleared: true,
    attestedBy: 'monitor-task',
  });
  assert.throws(
    () => beginTestAccountRun(owner(setup)),
    /cleanup was already attested/i,
  );
  assert.throws(
    () => loadVerifiedTestAccounts({
      env: {
        SURVEY_TEST_LEASE_TASK: 'KAL-500',
        SURVEY_TEST_LEASE_TOKEN: 'lease-token-500',
        SURVEY_TEST_LEASE_ROOT: setup.leaseRoot,
        SURVEY_TEST_LEASE_WORKTREE: setup.worktreeA,
      },
    }),
    /cleanup was already attested/i,
  );
});

test('cleanup cannot be attested while a test run is active', () => {
  const setup = fixture();
  acquire(setup);
  beginTestAccountRun({ ...owner(setup), pid: 424242 });
  assert.throws(
    () => attestTestAccountCleanup({
      ...owner(setup),
      restoredAccounts: restored('alpha', 'bravo'),
      artifactsCleared: true,
      attestedBy: 'monitor-task',
    }),
    /cannot attest cleanup during active test run/i,
  );
  endTestAccountRun(owner(setup));
});

test('pending cleanup attestation freezes new runs without leaving a run lock', () => {
  const setup = fixture();
  acquire(setup);
  const taskPath = join(setup.leaseRoot, 'task-kal-500.json');
  const task = JSON.parse(readFileSync(taskPath, 'utf8'));
  writeFileSync(taskPath, `${JSON.stringify({
    ...task,
    cleanupAttestationPending: { attestedBy: 'monitor-task', startedAt: 'now' },
  }, null, 2)}\n`);
  assert.throws(
    () => beginTestAccountRun(owner(setup)),
    /cleanup was already attested/i,
  );
  assert.equal(existsSync(join(setup.leaseRoot, 'run-kal-500.json')), false);
});

test('release can safely finish after interruption removed assignment/account locks', () => {
  const setup = fixture();
  acquire(setup);
  attestTestAccountCleanup({
    ...owner(setup),
    restoredAccounts: restored('alpha', 'bravo'),
    artifactsCleared: true,
    attestedBy: 'monitor-task',
  });

  const taskLock = JSON.parse(readFileSync(join(setup.leaseRoot, 'task-kal-500.json'), 'utf8'));
  writeFileSync(
    join(setup.leaseRoot, 'task-kal-500.json'),
    `${JSON.stringify({ ...taskLock, releaseStartedAt: new Date().toISOString() }, null, 2)}\n`,
  );
  // Simulate interruption after only some release steps completed.
  const alphaLock = join(setup.leaseRoot, 'account-user-alpha.json');
  const assignment = join(setup.worktreeA, '.survey-test-account.json');
  if (existsSync(alphaLock)) {
    rmSync(alphaLock);
    rmSync(assignment);
  }

  assert.doesNotThrow(() => releaseTestAccountLease(owner(setup)));
  assert.equal(existsSync(join(setup.leaseRoot, 'task-kal-500.json')), false);
  const reused = acquire(setup, {
    taskId: 'KAL-501',
    token: 'lease-token-501',
    worktreePath: setup.worktreeB,
  });
  assert.equal(reused.taskId, 'KAL-501');
});

test('resumed release never deletes an account lock that another task acquired', () => {
  const setup = fixture();
  acquire(setup);
  attestTestAccountCleanup({
    ...owner(setup),
    restoredAccounts: restored('alpha', 'bravo'),
    artifactsCleared: true,
    attestedBy: 'monitor-task',
  });

  rmSync(join(setup.leaseRoot, 'account-user-alpha.json'));
  const other = acquire(setup, {
    taskId: 'KAL-501',
    token: 'lease-token-501',
    worktreePath: setup.worktreeB,
    accountAssignments: accounts('alpha'),
  });
  assert.throws(
    () => releaseTestAccountLease(owner(setup)),
    /account lease lock mismatch|refusing to remove a lease file no longer owned/i,
  );
  assert.equal(
    JSON.parse(readFileSync(join(setup.leaseRoot, 'account-user-alpha.json'), 'utf8')).leaseToken,
    other.leaseToken,
  );
});

test('all official real-account entry points use the verified lease loader', () => {
  const root = process.cwd();
  const sourceExtensions = /\.(?:mjs|js|jsx|ts)$/;
  const sourceFiles = [];
  const visit = (relativeDirectory) => {
    for (const entry of readdirSync(join(root, relativeDirectory), { withFileTypes: true })) {
      const relativePath = join(relativeDirectory, entry.name);
      if (entry.isDirectory()) visit(relativePath);
      else if (sourceExtensions.test(entry.name)) sourceFiles.push(relativePath);
    }
  };
  for (const directory of ['scripts', 'agent-cli', 'tests', 'debug']) visit(directory);

  const coordinatorOnly = new Set([
    'scripts/test-account-lease.mjs',
    'tests/phase28/provisionBenchmarkBots.mjs',
  ]);
  const disposableOrIsolatedTestProject = new Set([
    'scripts/kal31/debug-rpc.mjs',
    'scripts/kal31/verify-acceptance.mjs',
    'tests/kal309ApplyChangesetIntegration.test.mjs',
    'tests/rowIdSigningSecretIntegration.test.mjs',
    'tests/workbookRegistrationIntegration.test.mjs',
  ]);
  const guardTests = new Set(['tests/testAccountLease.test.mjs']);
  const inactiveScaffolds = new Set([
    'debug/scenarios/phase27-roundtrip.spec.mjs',
    'debug/scenarios/phase28-revoke-flow.spec.mjs',
  ]);
  const localSourceContractTests = new Set([
    'tests/authAccountFlows.test.mjs',
    'tests/supabaseAuthRecovery.test.mjs',
  ]);
  // Mention `.bot-credentials.json` only to assert the file is absent.
  // They do not sign in, lease, or read that file.
  const failClosedAbsenceChecks = new Set([
    'tests/leftover18FailClosed.test.mjs',
    'debug/scenarios/e2e-leftover18-save-export.spec.mjs',
  ]);
  const credentialMarker =
    /VITE_DEV_AUTO_LOGIN_(?:EMAIL|PASSWORD)|auth\.signInWithPassword|\.bot-credentials\.json|makeClient\(['"]user['"]\)|dev auto-login|auto-login as (?:the )?(?:dev|document owner)|harvest(?:s|ing)? (?:the )?browser'?s? dev auto-login/i;
  const protectedClient = readFileSync(join(root, 'agent-cli/lib/client.mjs'), 'utf8');
  assert.match(protectedClient, /loadVerifiedTestAccounts/);
  for (const relativePath of disposableOrIsolatedTestProject) {
    const source = readFileSync(join(root, relativePath), 'utf8');
    const createsAndDeletesOwnUsers =
      source.includes('auth.admin.createUser')
      && source.includes('auth.admin.deleteUser');
    const hardAllowlistedTestProject =
      /ALLOWED_(?:TEST_)?HOSTS/.test(source)
      && source.includes('zgdkyslxbkusexmkfvgd.supabase.co');
    assert.ok(
      createsAndDeletesOwnUsers || hardAllowlistedTestProject,
      `${relativePath} no longer proves disposable users or an isolated allowlisted test project`,
    );
  }

  const unclassified = [];
  for (const relativePath of sourceFiles) {
    const source = readFileSync(join(root, relativePath), 'utf8');
    if (!credentialMarker.test(source) || guardTests.has(relativePath)) continue;
    if (source.includes('loadVerifiedTestAccounts')) continue;
    if (
      source.includes('assertBrowserUsesLeasedAccount')
      && source.includes('installLeasedBrowserAccount')
    ) {
      continue;
    }
    if (
      relativePath.startsWith('agent-cli/')
      && source.includes("from './lib/client.mjs'")
    ) {
      continue;
    }
    if (coordinatorOnly.has(relativePath)) continue;
    if (disposableOrIsolatedTestProject.has(relativePath)) continue;
    if (inactiveScaffolds.has(relativePath) && source.includes('test.fixme')) continue;
    if (relativePath === 'scripts/kal44-verify.mjs' && source.includes('hubPreview=1')) continue;
    if (
      (relativePath === 'debug/playwright.config.mjs'
        // Same classification, same blanking contract: the container-local
        // variant only swaps the browser launch for the preinstalled
        // chromium (executablePath) and must never inherit a real
        // auto-login either.
        || relativePath === 'debug/playwright.local-container.config.mjs')
      && /VITE_DEV_AUTO_LOGIN_EMAIL:\s*''/.test(source)
      && /VITE_DEV_AUTO_LOGIN_PASSWORD:\s*''/.test(source)
    ) {
      continue;
    }
    if (
      localSourceContractTests.has(relativePath)
      && !source.includes("from '@playwright/test'")
      && !source.includes('auth.signInWithPassword(')
    ) {
      continue;
    }
    if (
      failClosedAbsenceChecks.has(relativePath)
      && source.includes("existsSync(join(")
      && source.includes('.bot-credentials.json')
      && source.includes('false')
      && !source.includes('auth.signInWithPassword(')
      && !source.includes('loadVerifiedTestAccounts')
    ) {
      continue;
    }
    unclassified.push(relativePath);
  }
  assert.deepEqual(
    unclassified,
    [],
    `Unleased real-account/cloud entry points: ${unclassified.join(', ')}`,
  );
});

test('direct shared-account entry points fail closed before auth without a lease', () => {
  const root = process.cwd();
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('SURVEY_TEST_LEASE_')) delete env[key];
  }
  env.VITE_SUPABASE_URL = 'https://lease-guard.invalid';
  env.VITE_SUPABASE_ANON_KEY = 'lease-guard-anon';

  const commands = [
    ['scripts/fix19-live-auth-contract-e2e.mjs'],
    ['scripts/fix19-survey-region-live-contract-e2e.mjs'],
    ['scripts/kal-45-verify.mjs'],
    [
      '--input-type=module',
      '--eval',
      "import('./agent-cli/lib/client.mjs').then(({makeClient}) => makeClient('user'))",
    ],
  ];
  for (const args of commands) {
    const result = spawnSync(process.execPath, args, {
      cwd: root,
      env,
      encoding: 'utf8',
      timeout: 15_000,
    });
    const output = `${result.stdout}\n${result.stderr}`;
    assert.notEqual(result.status, 0, `${args.join(' ')} unexpectedly ran without a lease`);
    assert.match(
      output,
      /must run through test-account-lease\.mjs run with a verified lease/i,
      `${args.join(' ')} did not fail at the lease boundary:\n${output}`,
    );
  }
});

test('live browser harnesses pin and verify the exact leased browser identity', () => {
  for (const relativePath of [
    'scripts/fix19-live-auth-contract-e2e.mjs',
    'scripts/fix19-survey-region-live-contract-e2e.mjs',
    'scripts/kal-45-verify.mjs',
  ]) {
    const source = readFileSync(join(process.cwd(), relativePath), 'utf8');
    assert.match(source, /__fix20AuthOverride/);
    assert.match(source, /Browser session does not match leased account/);
    assert.doesNotMatch(source, /process\.env\.VITE_DEV_AUTO_LOGIN_(?:EMAIL|PASSWORD)/);
  }
});

test('every lease-guarded browser harness installs its account before first navigation', () => {
  const root = process.cwd();
  const roots = ['agent-cli', 'tests'];
  const guarded = [];
  const visit = (relativeDirectory) => {
    for (const entry of readdirSync(join(root, relativeDirectory), { withFileTypes: true })) {
      const relativePath = join(relativeDirectory, entry.name);
      if (entry.isDirectory()) visit(relativePath);
      else if (/\.(?:mjs|js|ts)$/.test(entry.name)) {
        const source = readFileSync(join(root, relativePath), 'utf8');
        if (
          source.includes('assertBrowserUsesLeasedAccount')
          && relativePath !== 'agent-cli/lib/leased-browser-session.mjs'
          && relativePath !== 'tests/testAccountLease.test.mjs'
        ) {
          guarded.push([relativePath, source]);
        }
      }
    }
  };
  for (const directory of roots) visit(directory);

  assert.ok(guarded.length >= 10, 'expected the official real-auth browser harness inventory');
  for (const [relativePath, source] of guarded) {
    const install = source.indexOf('await installLeasedBrowserAccount(');
    const firstNavigationMatch = /await page[A-Za-z0-9_]*\.goto\(/.exec(source);
    const firstNavigation = firstNavigationMatch?.index ?? -1;
    assert.ok(install >= 0, `${relativePath} does not install the leased identity`);
    assert.ok(firstNavigation > install, `${relativePath} navigates before installing its lease`);
  }
});

test('every app-navigation Playwright harness has a machine-enforced auth classification', () => {
  const root = process.cwd();
  const browserHarnesses = [];
  const visit = (relativeDirectory) => {
    for (const entry of readdirSync(join(root, relativeDirectory), { withFileTypes: true })) {
      const relativePath = join(relativeDirectory, entry.name);
      if (entry.isDirectory()) visit(relativePath);
      else if (/\.(?:mjs|js|ts)$/.test(entry.name)) {
        const source = readFileSync(join(root, relativePath), 'utf8');
        if (
          relativePath !== 'tests/testAccountLease.test.mjs'
          && /(?:from ['"](?:@playwright\/test|playwright)['"]|chromium)/.test(source)
          && /\.goto\(/.test(source)
        ) {
          browserHarnesses.push([relativePath, source]);
        }
      }
    }
  };
  for (const directory of ['scripts', 'agent-cli', 'tests', 'debug']) visit(directory);

  const customLeased = new Set([
    'scripts/fix19-live-auth-contract-e2e.mjs',
    'scripts/fix19-survey-region-live-contract-e2e.mjs',
    'scripts/fix20-multi-user-collab-contract-e2e.mjs',
    'scripts/kal-45-verify.mjs',
  ]);
  const coordinatorDisposable = new Set([
    'scripts/kal31/verify-acceptance.mjs',
    'scripts/kal49-document-lock-e2e.mjs',
  ]);
  const debugConfig = readFileSync(join(root, 'debug/playwright.config.mjs'), 'utf8');
  assert.match(debugConfig, /VITE_DEV_AUTO_LOGIN_EMAIL:\s*''/);
  assert.match(debugConfig, /VITE_DEV_AUTO_LOGIN_PASSWORD:\s*''/);
  const eraserHarness = readFileSync(
    join(root, 'tests/phase35-e2e/eraser-permission-harness.mjs'),
    'utf8',
  );
  assert.match(eraserHarness, /loadVerifiedTestAccounts\(\{ minimumAccounts: 3 \}\)/);
  assert.doesNotMatch(eraserHarness, /auth\.admin\.(?:createUser|deleteUser)/);

  const unclassified = [];
  for (const [relativePath, source] of browserHarnesses) {
    let classified = false;
    if (
      source.includes('installLeasedBrowserAccount')
      && source.includes('assertBrowserUsesLeasedAccount')
    ) {
      classified = true;
    } else if (
      customLeased.has(relativePath)
      && source.includes('__fix20AuthOverride')
      && source.includes('loadVerifiedTestAccounts')
    ) {
      classified = true;
    } else if (/(?:testPdf=|hubPreview=1|atomicEraseHarness=1|eraserRace=1)/.test(source)) {
      classified = true;
    } else if (source.includes("createSupabaseMock } from './lib/supabaseMock.mjs'")) {
      classified = true;
    } else if (/test\.fixme\s*\(/.test(source)) {
      classified = true;
    } else if (coordinatorDisposable.has(relativePath)) {
      const guard = source.indexOf('I_AM_THE_TEST_ACCOUNT_COORDINATOR');
      classified =
        guard >= 0
        && source.indexOf('auth.admin.createUser') > guard
        && source.indexOf('auth.admin.deleteUser') > guard;
    } else if (
      relativePath.startsWith('tests/phase35-e2e/')
      && source.includes('eraser-permission-harness.mjs')
    ) {
      classified = true;
    } else if (relativePath.startsWith('debug/scenarios/')) {
      classified = true; // debug config above disables real auto-login.
    } else if (relativePath === 'agent-cli/mobile-annotations-e2e.mjs') {
      classified =
        source.includes('http://localhost:8091')
        && !/supabase|signInWithPassword/i.test(source);
    }
    if (!classified) unclassified.push(relativePath);
  }
  assert.ok(browserHarnesses.length >= 90, 'browser harness inventory unexpectedly shrank');
  assert.deepEqual(
    unclassified,
    [],
    `Unclassified app-navigation harnesses: ${unclassified.join(', ')}`,
  );
});

test('account provisioner fails closed before any cloud credential access', () => {
  const source = readFileSync(
    join(process.cwd(), 'tests/phase28/provisionBenchmarkBots.mjs'),
    'utf8',
  );
  const guard = source.indexOf(
    "process.env.SURVEY_COORDINATOR_PROVISION_BOTS !== 'I_AM_THE_TEST_ACCOUNT_COORDINATOR'",
  );
  const cloudAccess = source.indexOf('const serviceRoleKey = pullServiceRoleKey()');
  assert.ok(guard >= 0, 'coordinator-only provisioning guard missing');
  assert.ok(cloudAccess > guard, 'cloud access must happen only after coordinator guard');
});

test('eraser harness requires a verified account lease before cloud setup', async () => {
  const { readHarnessConfig } = await import('./phase35-e2e/eraser-permission-harness.mjs');
  assert.throws(
    () => readHarnessConfig({
      authorized: true,
      supabaseUrl: 'https://example.invalid',
      serviceKey: 'service',
      anonKey: 'anon',
    }),
    /must run through test-account-lease\.mjs run with a verified lease/i,
  );
});

test('leased command supervisor is recorded before it can spawn the target', () => {
  const source = readFileSync(
    join(process.cwd(), 'scripts/test-account-lease.mjs'),
    'utf8',
  );
  const spawnSupervisor = source.indexOf(
    "spawn(process.execPath, ['--input-type=module', '--eval', LEASED_CHILD_SUPERVISOR]",
  );
  const record = source.indexOf('recordChildProcess(common, child.pid)', spawnSupervisor);
  const authorize = source.indexOf('child.send({', spawnSupervisor);
  assert.ok(spawnSupervisor >= 0);
  assert.ok(record > spawnSupervisor);
  assert.ok(authorize > record);
  assert.match(source, /process\.once\('disconnect'.*target\.kill\('SIGTERM'\)/s);
});
