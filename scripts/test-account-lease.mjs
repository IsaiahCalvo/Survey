#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ASSIGNMENT_FILE = '.survey-test-account.json';
const COORDINATOR_RECOVERY_CONFIRMATION = 'I_AM_THE_TEST_ACCOUNT_COORDINATOR';

function normalizeTaskId(taskId) {
  const normalized = String(taskId || '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9-]{2,64}$/.test(normalized)) {
    throw new Error(`Invalid task id: ${taskId || '(missing)'}`);
  }
  return normalized;
}

function normalizeIdentity(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`Every account assignment needs an exact ${label}`);
  return normalized;
}

function normalizeBaseline(baseline, email) {
  const tier = String(baseline?.tier || '').trim();
  const status = String(baseline?.status || '').trim();
  if (!tier || !status) {
    throw new Error(`Account ${email} needs an explicit baseline tier and status`);
  }
  return { tier, status };
}

function accountLockKey(userId) {
  return String(userId).replace(/[^A-Za-z0-9._-]/g, (character) => (
    `_${character.codePointAt(0).toString(16)}_`
  ));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJsonExclusive(path, value, mode = 0o600) {
  const handle = openSync(path, 'wx', mode);
  try {
    writeFileSync(handle, `${JSON.stringify(value, null, 2)}\n`);
  } finally {
    closeSync(handle);
  }
  chmodSync(path, mode);
}

function writeJsonAtomic(path, value, mode = 0o600) {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    flag: 'wx',
    mode,
  });
  renameSync(temporaryPath, path);
  chmodSync(path, mode);
}

function removeOwnedJson(
  path,
  { taskId, token },
  extraCheck = () => true,
  { strict = true } = {},
) {
  if (!existsSync(path)) return false;
  const value = readJson(path);
  if (
    value.taskId !== taskId
    || value.leaseToken !== token
    || !extraCheck(value)
  ) {
    if (!strict) return false;
    throw new Error(`Refusing to remove a lease file no longer owned by ${taskId}: ${path}`);
  }
  rmSync(path);
  return true;
}

function taskFileName(taskId) {
  return `task-${taskId.toLowerCase()}.json`;
}

function leasePaths({ leaseRoot, taskId, accounts = [], worktreePath }) {
  return {
    accountLockPaths: accounts.map(({ userId }) => (
      join(leaseRoot, `account-${accountLockKey(userId)}.json`)
    )),
    assignmentPath: join(worktreePath, ASSIGNMENT_FILE),
    runLockPath: join(leaseRoot, `run-${taskId.toLowerCase()}.json`),
    taskLockPath: join(leaseRoot, taskFileName(taskId)),
  };
}

function publicAccounts(accounts) {
  return accounts.map(({ baseline, email, userId }) => ({ baseline, email, userId }));
}

function resolveAccountBundle(credentials, accountAssignments) {
  if (!Array.isArray(accountAssignments) || accountAssignments.length === 0) {
    throw new Error('At least one exact account assignment is required');
  }
  const credentialBots = Array.isArray(credentials?.bots) ? credentials.bots : [];
  const seenEmails = new Set();
  const seenUserIds = new Set();

  return accountAssignments.map((requested) => {
    const email = normalizeIdentity(requested?.email, 'email');
    const userId = normalizeIdentity(requested?.userId, 'userId');
    const baseline = normalizeBaseline(requested?.baseline, email);
    const emailMatch = credentialBots.find((bot) => bot?.email === email);
    const userMatch = credentialBots.find((bot) => bot?.id === userId);
    if (!emailMatch || !userMatch) {
      throw new Error(`No complete test credential exists for ${email} / ${userId}`);
    }
    if (emailMatch !== userMatch) {
      throw new Error(`${email} and ${userId} do not identify the same credential`);
    }
    if (!emailMatch.password) {
      throw new Error(`Credential for ${email} is missing a password`);
    }
    if (seenEmails.has(email) || seenUserIds.has(userId)) {
      throw new Error(`Duplicate account in requested bundle: ${email} / ${userId}`);
    }
    seenEmails.add(email);
    seenUserIds.add(userId);
    return { baseline, email, password: emailMatch.password, userId };
  });
}

function readOwnedTaskLock({ leaseRoot, taskId, token, worktreePath }) {
  const normalizedTaskId = normalizeTaskId(taskId);
  const normalizedLeaseRoot = resolve(leaseRoot);
  const normalizedWorktreePath = resolve(worktreePath);
  const taskLockPath = join(normalizedLeaseRoot, taskFileName(normalizedTaskId));
  if (!existsSync(taskLockPath)) {
    throw new Error(`Task lease is missing: ${taskLockPath}`);
  }
  const taskLock = readJson(taskLockPath);
  if (taskLock.taskId !== normalizedTaskId) throw new Error('Task lease identity mismatch');
  if (taskLock.leaseToken !== token) throw new Error('Lease token mismatch');
  if (resolve(taskLock.worktreePath) !== normalizedWorktreePath) {
    throw new Error('Assignment worktree mismatch');
  }
  return { normalizedLeaseRoot, normalizedTaskId, normalizedWorktreePath, taskLock, taskLockPath };
}

export function acquireTestAccountLease({
  taskId,
  accountAssignments,
  worktreePath,
  credentialsPath,
  leaseRoot,
  token = randomUUID(),
  now = new Date().toISOString(),
}) {
  const normalizedTaskId = normalizeTaskId(taskId);
  const normalizedWorktreePath = resolve(worktreePath);
  const normalizedLeaseRoot = resolve(leaseRoot);
  if (!existsSync(normalizedWorktreePath)) {
    throw new Error(`Worktree does not exist: ${normalizedWorktreePath}`);
  }
  const accounts = resolveAccountBundle(readJson(resolve(credentialsPath)), accountAssignments);
  mkdirSync(normalizedLeaseRoot, { recursive: true, mode: 0o700 });
  const paths = leasePaths({
    accounts,
    leaseRoot: normalizedLeaseRoot,
    taskId: normalizedTaskId,
    worktreePath: normalizedWorktreePath,
  });

  const publicBundle = {
    accounts: publicAccounts(accounts),
    acquiredAt: now,
    cleanupAttestation: null,
    leaseToken: token,
    state: 'acquiring',
    taskId: normalizedTaskId,
    worktreePath: normalizedWorktreePath,
  };
  const assignment = {
    ...publicBundle,
    accounts,
  };
  if (existsSync(paths.taskLockPath)) {
    const existing = readJson(paths.taskLockPath);
    const resumable = existing.state === 'acquiring'
      && existing.taskId === normalizedTaskId
      && existing.leaseToken === token
      && resolve(existing.worktreePath) === normalizedWorktreePath
      && JSON.stringify(existing.accounts) === JSON.stringify(publicBundle.accounts);
    if (!resumable) {
      throw new Error(`${normalizedTaskId} already owns a test-account bundle`);
    }
  } else {
    if (existsSync(paths.assignmentPath)) {
      const existing = readJson(paths.assignmentPath);
      throw new Error(`${normalizedWorktreePath} already has an assignment for ${existing.taskId}`);
    }
    // Journal intent before taking any account lock. A crash can then be
    // resumed only by this exact task/token/bundle instead of stranding an
    // anonymous partial bundle.
    writeJsonExclusive(paths.taskLockPath, publicBundle);
  }

  try {
    for (let index = 0; index < accounts.length; index += 1) {
      const account = accounts[index];
      const accountLockPath = paths.accountLockPaths[index];
      try {
        writeJsonExclusive(accountLockPath, {
          ...publicBundle,
          account: publicAccounts([account])[0],
        });
      } catch (error) {
        if (error?.code === 'EEXIST') {
          const existing = readJson(accountLockPath);
          if (
            existing.taskId === normalizedTaskId
            && existing.leaseToken === token
            && existing.account?.email === account.email
            && existing.account?.userId === account.userId
          ) {
            continue;
          }
          throw new Error(
            `${account.email} / ${account.userId} is already leased to ${existing.taskId}`,
          );
        }
        throw error;
      }
    }
    try {
      writeJsonExclusive(paths.assignmentPath, assignment);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const existing = readJson(paths.assignmentPath);
      const sameAssignment =
        existing.taskId === normalizedTaskId
        && existing.leaseToken === token
        && resolve(existing.worktreePath) === normalizedWorktreePath
        && JSON.stringify(publicAccounts(existing.accounts))
          === JSON.stringify(publicAccounts(assignment.accounts));
      if (!sameAssignment) {
        throw new Error(`${normalizedWorktreePath} has a conflicting assignment`);
      }
    }
    writeJsonAtomic(paths.taskLockPath, { ...publicBundle, state: 'active' });
  } catch (error) {
    // This process observed the failure, so ownership-checked rollback is
    // safe. A hard crash skips this catch and leaves the journal resumable.
    removeOwnedJson(paths.assignmentPath, {
      taskId: normalizedTaskId,
      token,
    });
    for (let index = 0; index < paths.accountLockPaths.length; index += 1) {
      const account = accounts[index];
      removeOwnedJson(
        paths.accountLockPaths[index],
        { taskId: normalizedTaskId, token },
        (value) => (
          value.account?.email === account.email
          && value.account?.userId === account.userId
        ),
        { strict: false },
      );
    }
    removeOwnedJson(paths.taskLockPath, {
      taskId: normalizedTaskId,
      token,
    });
    throw error;
  }

  return {
    ...publicBundle,
    state: 'active',
    assignmentPath: paths.assignmentPath,
  };
}

export function assertTestAccountLease({ taskId, worktreePath, leaseRoot, token }) {
  const owned = readOwnedTaskLock({ leaseRoot, taskId, token, worktreePath });
  const { taskLock } = owned;
  if (taskLock.state !== 'active') throw new Error('Test-account lease acquisition is incomplete');
  if (taskLock.releaseStartedAt) throw new Error('Test-account lease release is in progress');
  const paths = leasePaths({
    accounts: taskLock.accounts,
    leaseRoot: owned.normalizedLeaseRoot,
    taskId: owned.normalizedTaskId,
    worktreePath: owned.normalizedWorktreePath,
  });
  if (!existsSync(paths.assignmentPath)) {
    throw new Error(`Assignment file is missing: ${paths.assignmentPath}`);
  }
  const assignment = readJson(paths.assignmentPath);
  if (
    assignment.taskId !== owned.normalizedTaskId
    || assignment.leaseToken !== token
    || resolve(assignment.worktreePath) !== owned.normalizedWorktreePath
  ) {
    throw new Error('Private assignment does not match the task lease');
  }
  if (JSON.stringify(publicAccounts(assignment.accounts)) !== JSON.stringify(taskLock.accounts)) {
    throw new Error('Private assignment account bundle does not match the task lease');
  }
  for (let index = 0; index < paths.accountLockPaths.length; index += 1) {
    const path = paths.accountLockPaths[index];
    if (!existsSync(path)) throw new Error(`Account lease lock is missing: ${path}`);
    const lock = readJson(path);
    const expected = taskLock.accounts[index];
    if (
      lock.taskId !== owned.normalizedTaskId
      || lock.leaseToken !== token
      || lock.account?.email !== expected.email
      || lock.account?.userId !== expected.userId
    ) {
      throw new Error(`Account lease lock mismatch: ${path}`);
    }
  }
  return {
    ...assignment,
    cleanupAttestation: taskLock.cleanupAttestation || null,
    cleanupAttestationPending: taskLock.cleanupAttestationPending || null,
  };
}

export function loadVerifiedTestAccounts({
  env = process.env,
  minimumAccounts = 1,
} = {}) {
  const required = [
    'SURVEY_TEST_LEASE_TASK',
    'SURVEY_TEST_LEASE_TOKEN',
    'SURVEY_TEST_LEASE_ROOT',
    'SURVEY_TEST_LEASE_WORKTREE',
  ];
  if (required.some((key) => !env[key])) {
    throw new Error(
      'Real-account harnesses must run through test-account-lease.mjs run with a verified lease',
    );
  }
  const assignment = assertTestAccountLease({
    leaseRoot: env.SURVEY_TEST_LEASE_ROOT,
    taskId: env.SURVEY_TEST_LEASE_TASK,
    token: env.SURVEY_TEST_LEASE_TOKEN,
    worktreePath: env.SURVEY_TEST_LEASE_WORKTREE,
  });
  if (assignment.cleanupAttestation || assignment.cleanupAttestationPending) {
    throw new Error('Cleanup was already attested; leased credentials are frozen');
  }
  if (assignment.accounts.length < minimumAccounts) {
    throw new Error(
      `Harness requires ${minimumAccounts} leased accounts; task has only ${assignment.accounts.length}`,
    );
  }
  return assignment.accounts;
}

export function beginTestAccountRun({
  command = [],
  pid = process.pid,
  now = new Date().toISOString(),
  ...owner
}) {
  const normalizedTaskId = normalizeTaskId(owner.taskId);
  const normalizedLeaseRoot = resolve(owner.leaseRoot);
  const normalizedWorktreePath = resolve(owner.worktreePath);
  const runLockPath = join(normalizedLeaseRoot, `run-${normalizedTaskId.toLowerCase()}.json`);
  try {
    // Reserve the run before reading cleanup state. Attestation publishes its
    // pending marker before checking this lock, so the two transitions cannot
    // both succeed even when they start concurrently.
    writeJsonExclusive(runLockPath, {
      command,
      leaseToken: owner.token,
      pid,
      startedAt: now,
      taskId: normalizedTaskId,
      worktreePath: normalizedWorktreePath,
    });
  } catch (error) {
    if (error?.code === 'EEXIST') {
      const active = readJson(runLockPath);
      throw new Error(`A test run is already active for ${normalizedTaskId} (pid ${active.pid})`);
    }
    throw error;
  }
  try {
    const assignment = assertTestAccountLease(owner);
    if (assignment.cleanupAttestation || assignment.cleanupAttestationPending) {
      throw new Error('Cleanup was already attested; no further test run is allowed');
    }
    return readJson(runLockPath);
  } catch (error) {
    removeOwnedJson(runLockPath, {
      taskId: normalizedTaskId,
      token: owner.token,
    });
    throw error;
  }
}

export function endTestAccountRun(owner) {
  const assignment = assertTestAccountLease(owner);
  const paths = leasePaths({
    accounts: assignment.accounts,
    leaseRoot: resolve(owner.leaseRoot),
    taskId: assignment.taskId,
    worktreePath: resolve(owner.worktreePath),
  });
  if (!existsSync(paths.runLockPath)) throw new Error('Active test-run lock is missing');
  const active = readJson(paths.runLockPath);
  if (active.leaseToken !== owner.token) throw new Error('Active test-run lease token mismatch');
  rmSync(paths.runLockPath);
}

function recordChildProcess(owner, childPid) {
  const assignment = assertTestAccountLease(owner);
  const paths = leasePaths({
    accounts: assignment.accounts,
    leaseRoot: resolve(owner.leaseRoot),
    taskId: assignment.taskId,
    worktreePath: resolve(owner.worktreePath),
  });
  if (!existsSync(paths.runLockPath)) throw new Error('Active test-run lock is missing');
  const active = readJson(paths.runLockPath);
  if (active.leaseToken !== owner.token) throw new Error('Active test-run lease token mismatch');
  writeJsonAtomic(paths.runLockPath, { ...active, childPid });
}

function defaultIsProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

export function recoverInterruptedTestAccountRun({
  coordinatorConfirmation,
  expectedPid,
  isProcessAlive = defaultIsProcessAlive,
  ...owner
}) {
  if (coordinatorConfirmation !== COORDINATOR_RECOVERY_CONFIRMATION) {
    throw new Error('Exact coordinator confirmation is required to recover a run lock');
  }
  const assignment = assertTestAccountLease(owner);
  const paths = leasePaths({
    accounts: assignment.accounts,
    leaseRoot: resolve(owner.leaseRoot),
    taskId: assignment.taskId,
    worktreePath: resolve(owner.worktreePath),
  });
  if (!existsSync(paths.runLockPath)) throw new Error('No interrupted test-run lock exists');
  const active = readJson(paths.runLockPath);
  if (Number(active.pid) !== Number(expectedPid)) throw new Error('Interrupted run PID mismatch');
  for (const pid of [active.pid, active.childPid].filter(Boolean)) {
    if (isProcessAlive(Number(pid))) {
      throw new Error(`Test process ${pid} is still alive`);
    }
  }
  rmSync(paths.runLockPath);
}

export function attestTestAccountCleanup({
  restoredAccounts,
  artifactsCleared,
  attestedBy,
  now = new Date().toISOString(),
  ...owner
}) {
  const assignment = assertTestAccountLease(owner);
  if (artifactsCleared !== true) {
    throw new Error('Test artifacts must be verified clear before attestation');
  }
  if (!String(attestedBy || '').trim()) throw new Error('Cleanup attestation needs an attester');
  if (!Array.isArray(restoredAccounts) || restoredAccounts.length !== assignment.accounts.length) {
    throw new Error('Cleanup attestation must cover every leased account exactly once');
  }
  const restoredByUserId = new Map(restoredAccounts.map((account) => [account.userId, account]));
  for (const account of assignment.accounts) {
    const restored = restoredByUserId.get(account.userId);
    if (
      !restored
      || restored.email !== account.email
      || restored.tier !== account.baseline.tier
      || restored.status !== account.baseline.status
    ) {
      throw new Error(`Cleanup baseline mismatch for ${account.email} / ${account.userId}`);
    }
  }
  if (restoredByUserId.size !== assignment.accounts.length) {
    throw new Error('Cleanup attestation contains duplicate or unleased accounts');
  }

  const owned = readOwnedTaskLock(owner);
  const paths = leasePaths({
    accounts: assignment.accounts,
    leaseRoot: resolve(owner.leaseRoot),
    taskId: assignment.taskId,
    worktreePath: resolve(owner.worktreePath),
  });
  const cleanupAttestationPending = {
    attestedBy: String(attestedBy).trim(),
    startedAt: now,
  };
  writeJsonAtomic(owned.taskLockPath, {
    ...owned.taskLock,
    cleanupAttestationPending,
  });
  if (existsSync(paths.runLockPath)) {
    const active = readJson(paths.runLockPath);
    writeJsonAtomic(owned.taskLockPath, {
      ...owned.taskLock,
      cleanupAttestationPending: null,
    });
    throw new Error(`Cannot attest cleanup during active test run (pid ${active.pid})`);
  }
  const cleanupAttestation = {
    artifactsCleared: true,
    attestedAt: now,
    attestedBy: String(attestedBy).trim(),
    restoredAccounts: restoredAccounts.map(({ email, status, tier, userId }) => ({
      email,
      status,
      tier,
      userId,
    })),
  };
  writeJsonAtomic(owned.taskLockPath, {
    ...owned.taskLock,
    cleanupAttestation,
    cleanupAttestationPending: null,
  });
  return cleanupAttestation;
}

export function releaseTestAccountLease(owner) {
  const owned = readOwnedTaskLock(owner);
  const paths = leasePaths({
    accounts: owned.taskLock.accounts,
    leaseRoot: owned.normalizedLeaseRoot,
    taskId: owned.normalizedTaskId,
    worktreePath: owned.normalizedWorktreePath,
  });
  if (existsSync(paths.runLockPath)) {
    const active = readJson(paths.runLockPath);
    throw new Error(`Cannot release during active test run (pid ${active.pid})`);
  }
  if (!owned.taskLock.cleanupAttestation?.artifactsCleared) {
    throw new Error('Verified cleanup attestation is required before release');
  }

  if (!owned.taskLock.releaseStartedAt) {
    assertTestAccountLease(owner);
    owned.taskLock = {
      ...owned.taskLock,
      releaseStartedAt: new Date().toISOString(),
    };
    writeJsonAtomic(owned.taskLockPath, owned.taskLock);
  }
  for (let index = 0; index < paths.accountLockPaths.length; index += 1) {
    const expected = owned.taskLock.accounts[index];
    removeOwnedJson(
      paths.accountLockPaths[index],
      { taskId: owned.normalizedTaskId, token: owner.token },
      (value) => (
        value.account?.email === expected.email
        && value.account?.userId === expected.userId
      ),
    );
  }
  removeOwnedJson(paths.assignmentPath, {
    taskId: owned.normalizedTaskId,
    token: owner.token,
  });
  // Task lock is deliberately last. If interrupted, it preserves ownership and
  // releaseTestAccountLease can safely finish from the releaseStartedAt journal.
  removeOwnedJson(paths.taskLockPath, {
    taskId: owned.normalizedTaskId,
    token: owner.token,
  });
}

function defaultContext(cwd = process.cwd()) {
  const gitCommonDir = execFileSync(
    'git',
    ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    { cwd, encoding: 'utf8' },
  ).trim();
  const mainRoot = dirname(gitCommonDir);
  return {
    credentialsPath: join(
      mainRoot,
      '.planning/phases/28-transport-spike-auth-validator/.bot-credentials.json',
    ),
    leaseRoot: join(gitCommonDir, 'codex-test-account-leases'),
    worktreePath: resolve(cwd),
  };
}

function parseArgs(argv) {
  const command = argv[0];
  const separatorIndex = argv.indexOf('--');
  const optionArgs = separatorIndex >= 0 ? argv.slice(1, separatorIndex) : argv.slice(1);
  const childArgs = separatorIndex >= 0 ? argv.slice(separatorIndex + 1) : [];
  const options = {};
  for (let index = 0; index < optionArgs.length; index += 2) {
    const key = optionArgs[index];
    const value = optionArgs[index + 1];
    if (!key?.startsWith('--') || value == null) {
      throw new Error(`Invalid argument near: ${key || '(missing)'}`);
    }
    const normalizedKey = key.slice(2);
    options[normalizedKey] = options[normalizedKey] == null
      ? value
      : [...(Array.isArray(options[normalizedKey]) ? options[normalizedKey] : [options[normalizedKey]]), value];
  }
  return { childArgs, command, options };
}

function values(value) {
  return value == null ? [] : (Array.isArray(value) ? value : [value]);
}

function parseAccount(value, restored = false) {
  const [email, userId, tier, status] = String(value).split('|');
  if (!email || !userId || !tier || !status) {
    throw new Error('Account must be exact email|userId|tier|status');
  }
  return restored
    ? { email, userId, tier, status }
    : { email, userId, baseline: { tier, status } };
}

function safeLeaseSummary(lease) {
  return {
    accounts: publicAccounts(lease.accounts),
    assignmentPath: lease.assignmentPath,
    leaseToken: lease.leaseToken,
    taskId: lease.taskId,
    worktreePath: lease.worktreePath,
  };
}

const LEASED_CHILD_SUPERVISOR = `
  import { spawn } from 'node:child_process';
  let target = null;
  process.once('message', ({ command, cwd, env }) => {
    target = spawn(command[0], command.slice(1), { cwd, env, stdio: 'inherit' });
    target.once('error', () => {
      process.exitCode = 1;
      if (process.connected) process.disconnect();
    });
    target.once('exit', (code, signal) => {
      process.exitCode = signal ? 1 : (code ?? 1);
      if (process.connected) process.disconnect();
    });
  });
  process.once('disconnect', () => {
    if (target && target.exitCode == null && target.signalCode == null) {
      target.kill('SIGTERM');
    }
    if (!target) process.exit(1);
  });
`;

async function runCli(argv) {
  const { childArgs, command, options } = parseArgs(argv);
  const context = defaultContext(options.worktree || process.cwd());
  const common = {
    leaseRoot: options['lease-root'] || context.leaseRoot,
    taskId: options.task,
    token: options['lease-token'],
    worktreePath: options.worktree || context.worktreePath,
  };

  if (command === 'assign') {
    const lease = acquireTestAccountLease({
      ...common,
      accountAssignments: values(options.account).map((value) => parseAccount(value)),
      credentialsPath: options.credentials || context.credentialsPath,
    });
    console.log(JSON.stringify(safeLeaseSummary(lease), null, 2));
    return;
  }
  if (command === 'verify') {
    const assignment = assertTestAccountLease(common);
    console.log(JSON.stringify(safeLeaseSummary({
      ...assignment,
      assignmentPath: join(resolve(common.worktreePath), ASSIGNMENT_FILE),
    }), null, 2));
    return;
  }
  if (command === 'attest-cleanup') {
    const attestation = attestTestAccountCleanup({
      ...common,
      artifactsCleared: options['artifacts-cleared'] === 'true',
      attestedBy: options['attested-by'],
      restoredAccounts: values(options.restored).map((value) => parseAccount(value, true)),
    });
    console.log(JSON.stringify(attestation, null, 2));
    return;
  }
  if (command === 'recover-run') {
    recoverInterruptedTestAccountRun({
      ...common,
      coordinatorConfirmation: options['coordinator-confirmation'],
      expectedPid: options['expected-pid'],
    });
    console.log(JSON.stringify({ recovered: true, taskId: normalizeTaskId(common.taskId) }));
    return;
  }
  if (command === 'release') {
    releaseTestAccountLease(common);
    console.log(JSON.stringify({ released: true, taskId: normalizeTaskId(common.taskId) }));
    return;
  }
  if (command === 'run') {
    if (childArgs.length === 0) throw new Error('run requires a command after --');
    const assignment = assertTestAccountLease(common);
    beginTestAccountRun({ ...common, command: childArgs });
    // The supervisor starts inert. Record its PID first, then authorize it to
    // spawn the real command. If this coordinator process crashes, IPC closes
    // and the supervisor kills its child, eliminating the spawn/record orphan.
    const child = spawn(process.execPath, ['--input-type=module', '--eval', LEASED_CHILD_SUPERVISOR], {
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    });
    recordChildProcess(common, child.pid);
    child.send({
      command: childArgs,
      cwd: resolve(common.worktreePath),
      env: {
        ...process.env,
        SURVEY_TEST_LEASE_ROOT: resolve(common.leaseRoot),
        SURVEY_TEST_LEASE_TASK: assignment.taskId,
        SURVEY_TEST_LEASE_TOKEN: common.token,
        SURVEY_TEST_LEASE_WORKTREE: resolve(common.worktreePath),
      },
    });
    let exitCode;
    try {
      exitCode = await new Promise((resolveExit, reject) => {
        child.once('error', reject);
        child.once('exit', (code, signal) => resolveExit(signal ? 1 : (code ?? 1)));
      });
    } finally {
      endTestAccountRun(common);
    }
    process.exitCode = exitCode;
    return;
  }
  throw new Error(
    'Usage: test-account-lease.mjs <assign|verify|run|attest-cleanup|recover-run|release>',
  );
}

const isCli = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isCli) {
  try {
    await runCli(process.argv.slice(2));
  } catch (error) {
    console.error(`[test-account-lease] ${error.message}`);
    process.exitCode = 1;
  }
}
