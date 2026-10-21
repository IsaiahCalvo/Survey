#!/usr/bin/env node
// scripts/backup-drill.mjs — prove a database dump restores.
//
//   node scripts/backup-drill.mjs --linked          # production (CI: backup-drill.yml)
//   node scripts/backup-drill.mjs --db-url <url>    # any database, e.g. the E2E stack
//
// Dumps roles, schema and data with the Supabase CLI, starts a throwaway local
// stack (its own project_id and 545xx ports, no migrations), restores the dump
// into it the way Supabase's restore guide does, then checks that every table
// came back with the row count the dump holds and that row-level security is on
// for as many tables as before. Then it stops the stack and deletes the dump.
//
// Prints counts only, never row contents: CI logs on this repo are public.
// Prints totals, and table names only where something does not match.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_ID = 'survey-backup-drill';
const CLI_VERSION = '2.111.0'; // same pin as scripts/e2e-local-supabase.mjs and the deploy workflow
const log = (msg) => console.log(`[backup-drill] ${msg}`);
const fail = (msg) => { console.error(`[backup-drill] FAILED: ${msg}`); process.exitCode = 1; };

// Same CLI choice as the E2E stack: an installed CLI only if it is the pinned one.
function supabaseCli() {
  if (process.env.SUPABASE_CLI) return process.env.SUPABASE_CLI.split(' ');
  const probe = spawnSync('supabase', ['--version'], { encoding: 'utf8' });
  if (probe.status === 0 && probe.stdout.trim() === CLI_VERSION) return ['supabase'];
  return ['npx', '--yes', `supabase@${CLI_VERSION}`];
}

function run(cmd, args, { capture = false, env } = {}) {
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'],
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    // psql names the failing statement; values inside (...) are redacted so a
    // duplicate-key or constraint error cannot print row data into a CI log.
    const reason = (result.stderr || '').split('\n').find((l) => /ERROR|error/.test(l)) || '';
    if (reason) console.error(`[backup-drill] ${reason.replace(/\([^)]*\)=\([^)]*\)/g, '(…)=(…)').slice(0, 300)}`);
    throw new Error(`${path.basename(cmd)} ${args.filter((a) => !a.startsWith('postgres')).join(' ')} exited ${result.status}`);
  }
  return result.stdout;
}

const cli = (args, opts) => { const [cmd, ...pre] = supabaseCli(); return run(cmd, [...pre, ...args], opts); };

/** Rows per table in a `--use-copy --data-only` dump: lines between COPY and \. */
export function countCopyRows(sql) {
  const counts = new Map();
  let table = null;
  for (const line of sql.split('\n')) {
    if (table) {
      if (line === '\\.') table = null;
      else counts.set(table, counts.get(table) + 1);
      continue;
    }
    const match = line.match(/^COPY ("?[\w-]+"?)\.("?[\w-]+"?) .*FROM stdin;$/);
    if (match) {
      table = `${match[1].replace(/"/g, '')}.${match[2].replace(/"/g, '')}`;
      counts.set(table, 0);
    }
  }
  return counts;
}

/**
 * A roles dump without `GRANT SET ON PARAMETER` lines: those are Supabase's own
 * grants to its built-in roles, which every new project and local stack already
 * has, and only a superuser may run them (the restore runs as `postgres`).
 */
export function restorableRoles(sql) {
  return sql.split('\n').filter((line) => !/^GRANT SET ON PARAMETER /.test(line)).join('\n');
}

/**
 * A data dump without COPY blocks that hold no rows. Empty blocks restore
 * nothing, and some name Supabase-owned tables (storage.buckets_vectors) that
 * `postgres` may not write even when there is nothing to write.
 */
export function withoutEmptyCopies(sql) {
  const lines = sql.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (/^COPY .* FROM stdin;$/.test(lines[i]) && lines[i + 1] === '\\.') { i += 1; continue; }
    out.push(lines[i]);
  }
  return out.join('\n');
}

/** The repo's config.toml, moved to its own project id and 545xx ports. */
export function drillConfig(source) {
  const disable = new Set(['studio', 'inbucket', 'analytics', 'edge_runtime', 'db.seed', 'db.pooler']);
  let section = '';
  return source.split('\n').map((line) => {
    const header = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (header) { section = header[1].trim(); return line; }
    if (/^project_id\s*=/.test(line)) return `project_id = "${PROJECT_ID}"`;
    if (disable.has(section) && /^enabled\s*=/.test(line)) return 'enabled = false';
    if (/^(shadow_)?port\s*=\s*543\d\d\s*$/.test(line)) return line.replace(/543(\d\d)/, '545$1');
    return line;
  }).join('\n');
}

function main() {
  const args = process.argv.slice(2);
  const source = args[0] === '--db-url' ? ['--db-url', args[1]] : ['--linked'];
  if (args[0] !== '--linked' && args[0] !== '--db-url') {
    throw new Error('usage: backup-drill.mjs --linked | --db-url <url>');
  }

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-drill-'));
  const stackDir = path.join(work, 'stack');
  const files = { roles: path.join(work, 'roles.sql'), schema: path.join(work, 'schema.sql'), data: path.join(work, 'data.sql') };
  let started = false;
  try {
    log('dumping roles, schema and data');
    cli(['db', 'dump', ...source, '--role-only', '-f', files.roles]);
    cli(['db', 'dump', ...source, '-f', files.schema]);
    cli(['db', 'dump', ...source, '--use-copy', '--data-only', '-f', files.data]);
    fs.writeFileSync(files.roles, restorableRoles(fs.readFileSync(files.roles, 'utf8')));
    fs.writeFileSync(files.data, withoutEmptyCopies(fs.readFileSync(files.data, 'utf8')));
    const expected = countCopyRows(fs.readFileSync(files.data, 'utf8'));
    const schemaSql = fs.readFileSync(files.schema, 'utf8');
    const expectedRls = (schemaSql.match(/ENABLE ROW LEVEL SECURITY/g) || []).length;
    const expectedPolicies = (schemaSql.match(/^CREATE POLICY /gm) || []).length;
    const totalRows = [...expected.values()].reduce((a, b) => a + b, 0);
    log(`dump holds ${totalRows} rows in ${expected.size} tables, ${expectedRls} tables with RLS, ${expectedPolicies} policies`);

    fs.mkdirSync(path.join(stackDir, 'supabase', 'migrations'), { recursive: true });
    fs.writeFileSync(
      path.join(stackDir, 'supabase', 'config.toml'),
      drillConfig(fs.readFileSync(path.join(ROOT, 'supabase/config.toml'), 'utf8')),
    );
    log('starting a throwaway local stack');
    started = true;
    cli(['start', '--workdir', stackDir, '-x', 'studio,imgproxy,mailpit,postgres-meta,edge-runtime,logflare,vector,supavisor'], { capture: true });
    const status = JSON.parse(cli(['status', '--workdir', stackDir, '-o', 'json'], { capture: true }).replace(/^[^{]*/, ''));
    const dbUrl = status.DB_URL;
    if (!/@(127\.0\.0\.1|localhost):545\d\d\//.test(dbUrl)) throw new Error('drill stack is not the local 545xx stack');

    log('restoring');
    run('psql', [
      '--single-transaction', '--variable', 'ON_ERROR_STOP=1', '--quiet', '--no-psqlrc',
      '--file', files.roles,
      '--file', files.schema,
      '--command', 'SET session_replication_role = replica',
      '--file', files.data,
      dbUrl,
    ], { capture: true });

    const query = (sql) => run('psql', ['--no-psqlrc', '-At', '-F', '|', '-c', sql, dbUrl], { capture: true }).trim();
    const mismatched = [];
    let restoredRows = 0;
    for (const [table, rows] of expected) {
      const [schema, name] = table.split('.');
      const got = Number(query(`select count(*) from "${schema}"."${name}"`));
      restoredRows += got;
      if (got !== rows) mismatched.push(table);
    }
    const restoredRls = Number(query(
      "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relrowsecurity and n.nspname = 'public'",
    ));
    const restoredPolicies = Number(query('select count(*) from pg_policies'));
    log(`restored ${restoredRows} of ${totalRows} rows, ${restoredPolicies} policies`);
    if (mismatched.length) fail(`row counts differ in: ${mismatched.join(', ')}`);
    if (restoredRls < expectedRls) fail(`row-level security is on for ${restoredRls} tables, dump had ${expectedRls}`);
    if (restoredPolicies < expectedPolicies) fail(`${restoredPolicies} policies restored, dump had ${expectedPolicies}`);
    if (!process.exitCode) log('OK: every table restored with its rows, and RLS and its policies are back on');
  } finally {
    if (started) {
      try { cli(['stop', '--workdir', stackDir, '--no-backup'], { capture: true }); } catch { /* best effort */ }
    }
    fs.rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    fail(error.message);
  }
}
