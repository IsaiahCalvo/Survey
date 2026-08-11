#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const REQUIRED_MIGRATIONS = [
  '20260802010000_allow_last_owner_document_cascade.sql',
  '20260810010000_integration_test_bytea_roundtrip.sql',
  '20260811120000_account_deletion_user_references.sql',
  '20260811130000_analytics_ingestion_daily_cap.sql',
  '20260811140000_atomic_template_snapshot.sql',
];
export const REQUIRED_VERCEL_ENV = [
  'AGENT_NATIVE_ANALYTICS_PUBLIC_KEY',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
];

function commandResult(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error([
      `${command} ${args.join(' ')} failed (${result.status ?? 'unknown'})`,
      result.stderr?.trim(),
      result.stdout?.trim(),
    ].filter(Boolean).join('\n'));
  }
  return result.stdout;
}

function commandJson(command, args, cwd) {
  const output = commandResult(command, args, cwd);
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`Expected JSON from ${command} ${args.join(' ')}`);
  }
}

function collectFiles(root, relativePath) {
  const absolutePath = resolve(root, relativePath);
  if (!existsSync(absolutePath)) return [];
  if (!statSync(absolutePath).isDirectory()) return [absolutePath];
  return readdirSync(absolutePath, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => collectFiles(root, join(relativePath, entry.name)));
}

export function computeExpoSourceHash(root = process.cwd()) {
  const inputs = [
    'mobile-expo/App.tsx',
    'mobile-expo/app.json',
    'mobile-expo/eas.json',
    'mobile-expo/index.ts',
    'mobile-expo/package-lock.json',
    'mobile-expo/package.json',
    'mobile-expo/tsconfig.json',
    'mobile-expo/assets',
    'mobile-expo/src',
  ].flatMap((path) => collectFiles(root, path));
  assert.ok(inputs.length > 0, 'No Expo shell source files found');
  const hash = createHash('sha256');
  for (const path of inputs.sort()) {
    hash.update(relative(root, path));
    hash.update('\0');
    hash.update(readFileSync(path));
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function assertLocalMobileRollout(root = process.cwd()) {
  const expectedBodies = new Map([
    [REQUIRED_MIGRATIONS[0], ['kal31_guard_last_owner', 'if not exists', 'return old']],
    [REQUIRED_MIGRATIONS[1], ['integration_test_bytea_roundtrip', 'payload bytea not null', 'enable row level security', 'to service_role']],
    [REQUIRED_MIGRATIONS[2], ['delete_account_owned_rows', 'ON DELETE SET NULL']],
    [REQUIRED_MIGRATIONS[3], ['reserve_analytics_ingestion_slot', 'force row level security', 'global_count >= 10000', 'user_count >= 500']],
    [REQUIRED_MIGRATIONS[4], ['replace_my_templates', 'pg_advisory_xact_lock']],
  ]);
  for (const migration of REQUIRED_MIGRATIONS) {
    const path = resolve(root, 'supabase', 'migrations', migration);
    assert.ok(existsSync(path), `Missing required migration: ${migration}`);
    const source = readFileSync(path, 'utf8').toLowerCase();
    for (const marker of expectedBodies.get(migration)) {
      assert.ok(source.includes(marker.toLowerCase()), `${migration} is missing ${marker}`);
    }
  }

  const deletionSource = readFileSync(resolve(root, 'supabase/functions/delete-account/index.ts'), 'utf8');
  assert.match(deletionSource, /caller\.auth\.getUser\(\)/, 'delete-account must authenticate the caller');
  assert.match(deletionSource, /body\?\.confirmation !== 'DELETE'/, 'delete-account must require explicit confirmation');
  assert.match(deletionSource, /admin\.rpc\('delete_account_owned_rows'/, 'delete-account must use the atomic owned-row RPC');
  assert.match(deletionSource, /deleteDatabaseRows:[\s\S]*removeStorage:[\s\S]*deleteAuthUser:/, 'delete-account retry stages are out of order');

  const vercelConfig = JSON.parse(readFileSync(resolve(root, 'vercel.json'), 'utf8'));
  assert.equal(vercelConfig?.git?.deploymentEnabled, false, 'Vercel Git auto-deploy must remain disabled');

  assertElectronPackagingContract(root);
  assertExpoStaticContract(root);
}

export function assertElectronPackagingContract(root = process.cwd()) {
  const bridgePath = resolve(root, 'src/electronAnalyticsBridge.js');
  assert.ok(existsSync(bridgePath), 'Electron analytics bridge source is missing');
  const mainSource = readFileSync(resolve(root, 'src/electron-main.js'), 'utf8');
  assert.match(mainSource, /require\(['"]\.\/electronAnalyticsBridge['"]\)/, 'Electron main must load its analytics bridge');
  const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  assert.ok(
    packageJson?.build?.files?.includes('src/electronAnalyticsBridge.js'),
    'Electron packaging whitelist omits src/electronAnalyticsBridge.js',
  );
}

export function assertExpoStaticContract(root = process.cwd()) {
  const config = JSON.parse(readFileSync(resolve(root, 'mobile-expo/app.json'), 'utf8'))?.expo;
  const projectId = config?.extra?.eas?.projectId;
  assert.match(projectId || '', /^[0-9a-f-]{36}$/, 'Expo EAS project ID is missing');
  assert.equal(config?.updates?.url, `https://u.expo.dev/${projectId}`, 'Expo Updates URL and EAS project ID differ');
  assert.match(config?.ios?.runtimeVersion || '', /^exposdk:\d+\.\d+\.\d+$/, 'Expo iOS runtimeVersion is not pinned');
}

export function assertBuildFreshnessEvidence(root = process.cwd()) {
  const markerPath = resolve(root, 'dist/release.json');
  assert.ok(existsSync(resolve(root, 'dist/index.html')), 'Current Vite build is missing dist/index.html');
  assert.ok(existsSync(markerPath), 'Current Vite build is missing dist/release.json');
  const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
  const commit = commandResult('git', ['rev-parse', 'HEAD'], root).trim().toLowerCase();
  assert.equal(marker?.commit, commit, 'Vite release marker does not match current HEAD');
  assert.ok(Number.isFinite(Date.parse(marker?.builtAt)), 'Vite release marker builtAt is invalid');
  return { commit, builtAt: marker.builtAt };
}

export function assertReleaseTreeStatus(status) {
  assert.equal(
    String(status || '').trim(),
    '',
    'Release worktree is not clean; commit the reviewed source before generating release evidence',
  );
}

export function assertReleaseTreeClean(root = process.cwd()) {
  assertReleaseTreeStatus(commandResult('git', ['status', '--porcelain', '--untracked-files=all'], root));
}

export function assertExpoUpdateFreshness(payload, expectedSourceHash, expectedRuntimeVersion) {
  assert.equal(payload?.name, 'expo-go', 'Expo update metadata is not for the expo-go branch');
  assert.ok(Array.isArray(payload?.currentPage), 'Expo update output is missing currentPage[]');
  const latest = payload.currentPage[0];
  assert.ok(latest, 'Expo Go branch has no published iOS update');
  assert.equal(latest.platforms, 'ios', 'Latest Expo Go update is not the iOS update');
  assert.equal(latest.runtimeVersion, expectedRuntimeVersion, 'Published Expo runtime does not match app.json');
  assert.match(latest.message || '', new RegExp(`(?:^|\\s)shell:${expectedSourceHash}(?:\\s|$)`), 'Published Expo shell hash is stale or absent');
  assert.match(latest.group || '', /^[0-9a-f-]{36}$/, 'Published Expo update group is missing');
  return { group: latest.group, runtimeVersion: latest.runtimeVersion, sourceHash: expectedSourceHash };
}

export function assertRequiredRemoteMigrations(payload) {
  assert.ok(Array.isArray(payload?.migrations), 'Supabase migration output is missing migrations[]');
  for (const filename of REQUIRED_MIGRATIONS) {
    const version = filename.slice(0, 14);
    assert.ok(
      payload.migrations.some(({ local, remote }) => String(local) === version && String(remote) === version),
      `Required migration is not applied remotely: ${filename}`,
    );
  }
}

export function assertDeleteAccountFunction(payload) {
  assert.ok(Array.isArray(payload?.functions), 'Supabase function output is missing functions[]');
  const deployed = payload.functions.find(({ slug }) => slug === 'delete-account');
  assert.ok(deployed, 'delete-account Edge function is not deployed');
  assert.equal(deployed.status, 'ACTIVE', 'delete-account Edge function is not active');
}

export function assertVercelProductionEnvironment(payload) {
  assert.ok(Array.isArray(payload?.envs), 'Vercel environment output is missing envs[]');
  for (const name of REQUIRED_VERCEL_ENV) {
    const entry = payload.envs.find(({ key }) => key === name);
    assert.ok(entry, `Missing Vercel environment variable: ${name}`);
    const targets = Array.isArray(entry.target) ? entry.target : [entry.target];
    assert.ok(targets.includes('production'), `${name} is not available to Vercel production`);
  }
}

export function verifyLocalDeno(root = process.cwd()) {
  commandResult('deno', [
    'check',
    '--config', 'supabase/functions/deno.json',
    'supabase/functions/delete-account/index.ts',
    'supabase/functions/send-email/index.ts',
  ], root);
}

export function verifyLocalBuildAndExpo(root = process.cwd()) {
  assertReleaseTreeClean(root);
  commandResult('npm', ['run', 'build'], root);
  const build = assertBuildFreshnessEvidence(root);
  const expoRoot = resolve(root, 'mobile-expo');
  commandResult('npm', ['run', 'check'], expoRoot);
  commandResult('npx', ['expo', 'install', '--check'], expoRoot);
  const exportRoot = mkdtempSync(join(tmpdir(), 'survey-expo-readiness-'));
  try {
    commandResult('npx', ['expo', 'export', '--platform', 'ios', '--output-dir', exportRoot], expoRoot);
    const metadata = JSON.parse(readFileSync(resolve(exportRoot, 'metadata.json'), 'utf8'));
    assert.ok(metadata?.fileMetadata?.ios?.bundle, 'Expo export did not produce an iOS bundle');
  } finally {
    rmSync(exportRoot, { recursive: true, force: true });
  }
  return { ...build, expoSourceHash: computeExpoSourceHash(root) };
}

export function verifyRemoteMobileRollout(root, projectRef) {
  assert.match(projectRef, /^[a-z0-9]{20}$/, 'Set SUPABASE_PROJECT_ID to the linked 20-character project ref');
  assertRequiredRemoteMigrations(commandJson('supabase', [
    'migration', 'list', '--linked', '--output-format', 'json',
  ], root));
  assertDeleteAccountFunction(commandJson('supabase', [
    'functions', 'list', '--project-ref', projectRef, '--output-format', 'json',
  ], root));
  assertVercelProductionEnvironment(commandJson('vercel', [
    'env', 'ls', 'production', '--json', '--non-interactive',
  ], root));
  const expoConfig = JSON.parse(readFileSync(resolve(root, 'mobile-expo/app.json'), 'utf8')).expo;
  const expo = assertExpoUpdateFreshness(commandJson('npx', [
    'eas-cli', 'update:list', '--branch', 'expo-go', '--platform', 'ios', '--limit', '1', '--json', '--non-interactive',
  ], resolve(root, 'mobile-expo')), computeExpoSourceHash(root), expoConfig.ios.runtimeVersion);
  return { expo };
}

async function main() {
  const root = resolve(process.cwd());
  const remote = process.argv.includes('--remote');
  if (process.argv.includes('--print-expo-hash')) {
    assertReleaseTreeClean(root);
    console.log(computeExpoSourceHash(root));
    return;
  }
  assertLocalMobileRollout(root);
  verifyLocalDeno(root);
  const evidence = verifyLocalBuildAndExpo(root);
  if (!remote) {
    console.log(`Local build/Expo evidence is current: commit=${evidence.commit} shell=${evidence.expoSourceHash} builtAt=${evidence.builtAt}`);
    return;
  }
  const remoteEvidence = verifyRemoteMobileRollout(root, process.env.SUPABASE_PROJECT_ID || '');
  console.log(`READY: build=${evidence.commit}, shell=${evidence.expoSourceHash}, expoGroup=${remoteEvidence.expo.group}, runtime=${remoteEvidence.expo.runtimeVersion}; migrations, Edge, Vercel, and Expo metadata are current. Code deployment may proceed.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    console.error(`BLOCK CODE DEPLOYMENT: ${error.message}`);
    process.exit(1);
  });
}
