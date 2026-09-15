import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const STRIPE_SDK_VERSION = '20.4.1';
export const STRIPE_API_VERSION = '2026-02-25.clover';
export const SUPABASE_JS_VERSION = '2.110.8';

const REQUIRED_STRIPE_SECRETS = [
  // STRIPE_ENTERPRISE_PRICE_ID is DELIBERATELY absent (2026-08-19, owner
  // decision on KAL-414): Enterprise is a contact-us tier with no self-serve
  // checkout, and removing the secret makes any hand-crafted
  // tier:'enterprise' request fail loudly server-side. Re-add it here AND in
  // the Supabase secrets only when a real Enterprise price is decided.
  'STRIPE_PRO_ANNUAL_PRICE_ID',
  'STRIPE_PRO_MONTHLY_PRICE_ID',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
];

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function commandJson(command, args, cwd) {
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

  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`Expected JSON from ${command} ${args.join(' ')}, received:\n${result.stdout}`);
  }
}

export function localFunctionNames(root) {
  const functionsDir = join(root, 'supabase', 'functions');
  return readdirSync(functionsDir)
    .filter((name) => name !== '_shared')
    .filter((name) => statSync(join(functionsDir, name)).isDirectory())
    .filter((name) => existsSync(join(functionsDir, name, 'index.ts')))
    .sort();
}

export function parseFunctionJwtConfig(configText, functionNames) {
  const configured = new Map();
  let currentFunction = null;

  for (const rawLine of configText.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    const section = line.match(/^\[functions\.([a-z0-9-]+)\]$/);
    if (section) {
      currentFunction = section[1];
      continue;
    }
    if (line.startsWith('[')) currentFunction = null;

    const verifyJwt = line.match(/^verify_jwt\s*=\s*(true|false)$/);
    if (currentFunction && verifyJwt) {
      configured.set(currentFunction, verifyJwt[1] === 'true');
    }
  }

  return new Map(functionNames.map((name) => [name, configured.get(name) ?? true]));
}

export function assertMigrationsInSync(payload) {
  const migrations = payload?.migrations;
  assert.ok(Array.isArray(migrations), 'Supabase migration output did not contain migrations[]');

  const drift = migrations.filter(({ local, remote }) => !local || !remote || local !== remote);
  assert.deepEqual(
    drift,
    [],
    `Supabase migration drift detected: ${JSON.stringify(drift)}`,
  );
}

export function assertFunctionsInSync(payload, functionNames, expectedVerifyJwt) {
  const deployed = payload?.functions;
  assert.ok(Array.isArray(deployed), 'Supabase function output did not contain functions[]');
  const bySlug = new Map(deployed.map((fn) => [fn.slug, fn]));

  for (const name of functionNames) {
    const remote = bySlug.get(name);
    assert.ok(remote, `Supabase function is not deployed: ${name}`);
    assert.equal(remote.status, 'ACTIVE', `Supabase function is not active: ${name}`);
    assert.equal(
      remote.verify_jwt,
      expectedVerifyJwt.get(name),
      `verify_jwt drift for ${name}: local=${expectedVerifyJwt.get(name)} remote=${remote.verify_jwt}`,
    );
  }
}

export function assertRequiredSecrets(payload) {
  const secrets = payload?.secrets;
  assert.ok(Array.isArray(secrets), 'Supabase secret output did not contain secrets[]');
  const names = new Set(secrets.map(({ name }) => name));
  const missing = REQUIRED_STRIPE_SECRETS.filter((name) => !names.has(name));
  assert.deepEqual(missing, [], `Missing Supabase Stripe secrets: ${missing.join(', ')}`);
}

function assertOrdered(text, markers, label) {
  let previous = -1;
  for (const marker of markers) {
    const position = text.indexOf(marker);
    assert.ok(position >= 0, `${label} is missing: ${marker}`);
    assert.ok(position > previous, `${label} is out of order at: ${marker}`);
    previous = position;
  }
}

export function assertStaticReleaseContract(root = process.cwd()) {
  const migrationFiles = readdirSync(join(root, 'supabase', 'migrations'))
    .filter((name) => name.endsWith('.sql'));
  const versions = migrationFiles.map((name) => {
    const match = name.match(/^(\d{14})_[a-z0-9_]+\.sql$/);
    assert.ok(match, `Invalid migration filename: ${name}`);
    return match[1];
  });
  assert.equal(new Set(versions).size, versions.length, 'Duplicate Supabase migration version');

  const vercelConfig = readJson(join(root, 'vercel.json'));
  assert.equal(
    vercelConfig?.git?.deploymentEnabled,
    false,
    'Vercel Git auto-deploy must stay disabled; production deploys only after the backend gate',
  );

  const functionNames = localFunctionNames(root);
  assert.ok(functionNames.length > 0, 'No local Supabase functions found');
  const configText = readFileSync(join(root, 'supabase', 'config.toml'), 'utf8');
  const jwtConfig = parseFunctionJwtConfig(configText, functionNames);
  assert.equal(jwtConfig.get('stripe-webhook'), false, 'Stripe webhook must use Stripe signature auth');
  assert.equal(jwtConfig.get('create-portal-session'), false, 'Portal function must receive browser preflight');

  for (const name of functionNames) {
    const source = readFileSync(join(root, 'supabase', 'functions', name, 'index.ts'), 'utf8');
    assert.doesNotMatch(
      source,
      /https:\/\/(?:esm\.sh|deno\.land|unpkg\.com)/,
      `${name} must not depend on a third-party module CDN during clean CI or deployment`,
    );
    if (source.includes('@supabase/supabase-js')) {
      assert.match(
        source,
        new RegExp(`npm:@supabase/supabase-js@${SUPABASE_JS_VERSION.replaceAll('.', '\\.')}`),
        `${name} must pin the approved Supabase SDK`,
      );
    }
  }

  for (const name of ['create-checkout-session', 'create-portal-session', 'stripe-webhook']) {
    const source = readFileSync(join(root, 'supabase', 'functions', name, 'index.ts'), 'utf8');
    assert.match(source, new RegExp(`npm:stripe@${STRIPE_SDK_VERSION.replaceAll('.', '\\.')}`));
    assert.match(source, new RegExp(`apiVersion:\\s*['"]${STRIPE_API_VERSION.replaceAll('.', '\\.')}['"]`));
  }

  const deployWorkflow = readFileSync(join(root, '.github', 'workflows', 'deploy-production.yml'), 'utf8');
  assert.match(deployWorkflow, /workflow_run:/);
  assertOrdered(deployWorkflow, [
    'supabase db push --linked --yes',
    'supabase functions deploy --project-ref',
    'node scripts/release-integrity.mjs --remote',
    'git ls-remote',
    // 2026-08-18 — the Vercel git deploy hook was replaced by a token-based CLI
    // deploy (Hobby cannot git-connect the private Kal-Voe repo). The contract
    // still pins the same ordering: frontend ships only after the backend gate
    // and before the live release.json revision check.
    'secrets.VERCEL_TOKEN',
    'vercel deploy --prod',
    'release.json',
  ], 'Production workflow');

  const ciWorkflow = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(ciWorkflow, /node scripts\/release-integrity\.mjs --static/);

  // 2026-09-15 — this used to be a hard-coded `assert.match(deployWorkflow,
  // /workflows:\s*\[CI\]/)`. The production deploy is triggered by
  // `workflow_run` on the CI workflow's DISPLAY NAME, not its filename, so
  // renaming ci.yml's `name:` without editing deploy-production.yml would stop
  // every production deploy silently — no red X anywhere. Asserting the pairing
  // instead of the literal string is strictly stronger: it still fails if the
  // deploy trigger drifts, and it now also fails on the rename that a literal
  // check would have sailed straight past.
  const ciWorkflowName = /^name:[ \t]*(.+?)[ \t]*$/m.exec(ciWorkflow)?.[1];
  assert.ok(ciWorkflowName, 'ci.yml must declare a workflow name');
  const quotedCiName = ciWorkflowName.replace(/^['"]|['"]$/g, '');
  const escapedCiName = quotedCiName.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(
    deployWorkflow,
    new RegExp(`workflows:\\s*\\[\\s*['"]?${escapedCiName}['"]?\\s*\\]`),
    `deploy-production.yml must trigger on the CI workflow named "${quotedCiName}" — `
      + 'workflow_run matches the display name, so these two must be renamed together',
  );

  // 2026-09-15 — dependabot-auto-merge.yml is the SECOND workflow_run consumer
  // of the CI workflow's display name, and it was not covered. A rename that
  // missed it would silently stop every dependency bump from being merged, and
  // with nothing red anywhere there would be no signal at all. Same pairing
  // assertion, same reason.
  const autoMergeWorkflow = readFileSync(
    join(root, '.github', 'workflows', 'dependabot-auto-merge.yml'), 'utf8',
  );
  assert.match(
    autoMergeWorkflow,
    new RegExp(`workflows:\\s*\\[\\s*['"]?${escapedCiName}['"]?\\s*\\]`),
    `dependabot-auto-merge.yml must trigger on the CI workflow named "${quotedCiName}" — `
      + 'workflow_run matches the display name, so these two must be renamed together',
  );

  // The auto-merge re-runs CI on main with `gh workflow run` after it merges,
  // because a push made with GITHUB_TOKEN creates no workflow run. That only
  // works while ci.yml accepts a manual dispatch; drop the trigger and every
  // auto-merged bump stops being tested on main and stops deploying, silently.
  assert.match(
    autoMergeWorkflow,
    /gh workflow run ci\.yml/,
    'dependabot-auto-merge.yml must start CI on main after a merge — a push made '
      + 'with GITHUB_TOKEN creates no workflow run of its own',
  );
  assert.match(
    ciWorkflow,
    /^ {2}workflow_dispatch:/m,
    'ci.yml must keep its workflow_dispatch trigger — dependabot-auto-merge.yml '
      + 'dispatches it after a merge, and that is the only way the merge commit '
      + 'gets tested on main and reaches production',
  );

  const desktopReleaseWorkflow = readFileSync(join(root, '.github', 'workflows', 'release.yml'), 'utf8');
  assert.match(
    desktopReleaseWorkflow,
    /max-parallel:\s*1/,
    'Desktop publishers must be serialized so they cannot race to create the same GitHub release',
  );
}

async function smokeFunctions(projectRef, functionNames) {
  const baseUrl = `https://${projectRef}.supabase.co/functions/v1`;
  for (const name of functionNames.filter((name) => name !== 'stripe-webhook')) {
    const response = await fetch(`${baseUrl}/${name}`, { method: 'OPTIONS' });
    assert.ok(response.ok, `${name} preflight failed with HTTP ${response.status}`);
  }

  const webhook = await fetch(`${baseUrl}/stripe-webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  const webhookBody = await webhook.text();
  assert.equal(webhook.status, 400, `Stripe webhook smoke expected HTTP 400, got ${webhook.status}`);
  assert.match(webhookBody, /Missing signature/, 'Stripe webhook did not enforce signature verification');
}

export async function verifyRemoteRelease(root, projectRef) {
  assert.match(projectRef, /^[a-z0-9]{20}$/, 'Invalid SUPABASE_PROJECT_ID');
  const functionNames = localFunctionNames(root);
  const configText = readFileSync(join(root, 'supabase', 'config.toml'), 'utf8');
  const expectedVerifyJwt = parseFunctionJwtConfig(configText, functionNames);

  const migrations = commandJson('supabase', [
    'migration', 'list', '--linked', '--output-format', 'json',
  ], root);
  assertMigrationsInSync(migrations);

  const functions = commandJson('supabase', [
    'functions', 'list', '--project-ref', projectRef, '--output-format', 'json',
  ], root);
  assertFunctionsInSync(functions, functionNames, expectedVerifyJwt);

  const secrets = commandJson('supabase', [
    'secrets', 'list', '--project-ref', projectRef, '--output-format', 'json',
  ], root);
  assertRequiredSecrets(secrets);

  await smokeFunctions(projectRef, functionNames);
}

async function main() {
  const root = resolve(process.cwd());
  const args = process.argv.slice(2);

  if (args.includes('--static')) {
    assertStaticReleaseContract(root);
    console.log('Release contract is structurally safe.');
    return;
  }

  if (args.includes('--remote')) {
    const refIndex = args.indexOf('--project-ref');
    const projectRef = refIndex >= 0 ? args[refIndex + 1] : process.env.SUPABASE_PROJECT_ID;
    assert.ok(projectRef, 'Set SUPABASE_PROJECT_ID or pass --project-ref');
    await verifyRemoteRelease(root, projectRef);
    console.log('Supabase migrations, functions, Stripe secrets, and endpoint smokes are healthy.');
    return;
  }

  throw new Error('Usage: node scripts/release-integrity.mjs --static | --remote [--project-ref <ref>]');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    console.error(error.stack || error);
    process.exit(1);
  });
}
