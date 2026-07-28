#!/usr/bin/env node

import { spawnSync, execFileSync } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ASSIGNMENT_FILE = '.survey-test-account.json';

function normalizeTaskId(taskId) {
  const normalized = String(taskId || '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9-]{2,64}$/.test(normalized)) {
    throw new Error(`Invalid task id: ${taskId || '(missing)'}`);
  }
  return normalized;
}

function normalizeAccountIndex(accountIndex) {
  const normalized = Number(accountIndex);
  if (!Number.isInteger(normalized) || normalized < 0) {
    throw new Error(`Invalid account index: ${accountIndex}`);
  }
  return normalized;
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

function taskFileName(taskId) {
  return `task-${taskId.toLowerCase()}.json`;
}

function leasePaths({ leaseRoot, taskId, accountIndex, worktreePath }) {
  return {
    accountLockPath: join(leaseRoot, `account-${accountIndex}.json`),
    taskLockPath: join(leaseRoot, taskFileName(taskId)),
    assignmentPath: join(worktreePath, ASSIGNMENT_FILE),
  };
}

export function acquireTestAccountLease({
  taskId,
  accountIndex,
  worktreePath,
  credentialsPath,
  leaseRoot,
  token = randomUUID(),
  now = new Date().toISOString(),
}) {
  const normalizedTaskId = normalizeTaskId(taskId);
  const normalizedAccountIndex = normalizeAccountIndex(accountIndex);
  const normalizedWorktreePath = resolve(worktreePath);
  const normalizedLeaseRoot = resolve(leaseRoot);
  const credentials = readJson(resolve(credentialsPath));
  const account = credentials?.bots?.[normalizedAccountIndex];
  if (!account?.id || !account?.email || !account?.password) {
    throw new Error(`No complete test account exists at index ${normalizedAccountIndex}`);
  }
  if (!existsSync(normalizedWorktreePath)) {
    throw new Error(`Worktree does not exist: ${normalizedWorktreePath}`);
  }

  mkdirSync(normalizedLeaseRoot, { recursive: true, mode: 0o700 });
  const paths = leasePaths({
    leaseRoot: normalizedLeaseRoot,
    taskId: normalizedTaskId,
    accountIndex: normalizedAccountIndex,
    worktreePath: normalizedWorktreePath,
  });

  if (existsSync(paths.taskLockPath)) {
    const existing = readJson(paths.taskLockPath);
    throw new Error(
      `${normalizedTaskId} already owns account index ${existing.accountIndex}`,
    );
  }
  if (existsSync(paths.assignmentPath)) {
    const existing = readJson(paths.assignmentPath);
    throw new Error(
      `${normalizedWorktreePath} already has a test account assignment for ${existing.taskId}`,
    );
  }
  if (existsSync(paths.accountLockPath)) {
    const existing = readJson(paths.accountLockPath);
    throw new Error(
      `Account index ${normalizedAccountIndex} is already leased to ${existing.taskId}`,
    );
  }

  const lock = {
    taskId: normalizedTaskId,
    accountIndex: normalizedAccountIndex,
    email: account.email,
    userId: account.id,
    worktreePath: normalizedWorktreePath,
    leaseToken: token,
    acquiredAt: now,
  };
  const assignment = {
    ...lock,
    password: account.password,
  };

  writeJsonExclusive(paths.accountLockPath, lock);
  try {
    writeJsonExclusive(paths.taskLockPath, lock);
    try {
      writeJsonExclusive(paths.assignmentPath, assignment);
    } catch (error) {
      rmSync(paths.taskLockPath, { force: true });
      throw error;
    }
  } catch (error) {
    rmSync(paths.accountLockPath, { force: true });
    throw error;
  }

  return {
    ...lock,
    assignmentPath: paths.assignmentPath,
  };
}

export function assertTestAccountLease({
  taskId,
  accountIndex,
  worktreePath,
  leaseRoot,
  token,
}) {
  const normalizedTaskId = normalizeTaskId(taskId);
  const normalizedAccountIndex = normalizeAccountIndex(accountIndex);
  const normalizedWorktreePath = resolve(worktreePath);
  const normalizedLeaseRoot = resolve(leaseRoot);
  const paths = leasePaths({
    leaseRoot: normalizedLeaseRoot,
    taskId: normalizedTaskId,
    accountIndex: normalizedAccountIndex,
    worktreePath: normalizedWorktreePath,
  });

  if (!existsSync(paths.assignmentPath)) {
    throw new Error(`Assignment file is missing: ${paths.assignmentPath}`);
  }
  const assignment = readJson(paths.assignmentPath);
  if (assignment.taskId !== normalizedTaskId) {
    throw new Error(
      `Assignment task mismatch: expected ${normalizedTaskId}, received ${assignment.taskId}`,
    );
  }
  if (assignment.leaseToken !== token) {
    throw new Error('Lease token mismatch');
  }
  if (assignment.accountIndex !== normalizedAccountIndex) {
    throw new Error(
      `Account index mismatch: expected ${normalizedAccountIndex}, received ${assignment.accountIndex}`,
    );
  }
  if (resolve(assignment.worktreePath) !== normalizedWorktreePath) {
    throw new Error('Assignment worktree mismatch');
  }

  for (const path of [paths.taskLockPath, paths.accountLockPath]) {
    if (!existsSync(path)) throw new Error(`Lease lock is missing: ${path}`);
    const lock = readJson(path);
    if (
      lock.taskId !== normalizedTaskId
      || lock.accountIndex !== normalizedAccountIndex
      || lock.leaseToken !== token
      || resolve(lock.worktreePath) !== normalizedWorktreePath
    ) {
      throw new Error(`Lease lock mismatch: ${path}`);
    }
  }

  return assignment;
}

export function releaseTestAccountLease(options) {
  const assignment = assertTestAccountLease(options);
  const paths = leasePaths({
    leaseRoot: resolve(options.leaseRoot),
    taskId: assignment.taskId,
    accountIndex: assignment.accountIndex,
    worktreePath: resolve(options.worktreePath),
  });

  rmSync(paths.assignmentPath, { force: true });
  rmSync(paths.taskLockPath, { force: true });
  rmSync(paths.accountLockPath, { force: true });
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
    options[key.slice(2)] = value;
  }
  return { childArgs, command, options };
}

function safeLeaseSummary(lease) {
  return {
    accountIndex: lease.accountIndex,
    assignmentPath: lease.assignmentPath,
    email: lease.email,
    leaseToken: lease.leaseToken,
    taskId: lease.taskId,
    userId: lease.userId,
    worktreePath: lease.worktreePath,
  };
}

function runCli(argv) {
  const { childArgs, command, options } = parseArgs(argv);
  const context = defaultContext(options.worktree || process.cwd());
  const common = {
    accountIndex: options['account-index'],
    leaseRoot: options['lease-root'] || context.leaseRoot,
    taskId: options.task,
    token: options['lease-token'],
    worktreePath: options.worktree || context.worktreePath,
  };

  if (command === 'assign') {
    const lease = acquireTestAccountLease({
      ...common,
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

  if (command === 'release') {
    releaseTestAccountLease(common);
    console.log(JSON.stringify({
      accountIndex: Number(common.accountIndex),
      released: true,
      taskId: normalizeTaskId(common.taskId),
    }));
    return;
  }

  if (command === 'run') {
    if (childArgs.length === 0) throw new Error('run requires a command after --');
    const assignment = assertTestAccountLease(common);
    const result = spawnSync(childArgs[0], childArgs.slice(1), {
      cwd: resolve(common.worktreePath),
      env: {
        ...process.env,
        SURVEY_TEST_ACCOUNT_EMAIL: assignment.email,
        SURVEY_TEST_ACCOUNT_INDEX: String(assignment.accountIndex),
        SURVEY_TEST_ACCOUNT_TASK: assignment.taskId,
        SURVEY_TEST_ACCOUNT_USER_ID: assignment.userId,
        VITE_DEV_AUTO_LOGIN_EMAIL: assignment.email,
        VITE_DEV_AUTO_LOGIN_PASSWORD: assignment.password,
      },
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
    return;
  }

  throw new Error('Usage: test-account-lease.mjs <assign|verify|release|run> [options]');
}

const isCli = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isCli) {
  try {
    runCli(process.argv.slice(2));
  } catch (error) {
    console.error(`[test-account-lease] ${error.message}`);
    process.exitCode = 1;
  }
}
