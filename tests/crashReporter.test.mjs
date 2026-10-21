// Crash reporter (src/utils/crashReporter.js + the client_errors migration):
// what leaves the device, how often, and that the database only accepts
// writes through report_client_error and never lets anyone read the table.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { CRASH_LOG_KEY, readCrashReports, recordCrash, __resetCrashLogForTests } from '../src/utils/crashLog.js';
import {
  MAX_PER_PAGE, browserOf, installCrashReporter, platformOf, scrubCrashText, toReport,
} from '../src/utils/crashReporter.js';

function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('crash reporter: personal details are scrubbed', () => {
  const text = scrubCrashText(
    'Failed for jane.doe@example.com on "Site Plan v2.pdf" doc 3f2a9c1e-1b2c-4d5e-8f90-1234567890ab '
    + 'at https://surveytool.app/app?token=abc#x code 123456789 key eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl',
  );
  assert.doesNotMatch(text, /jane|example\.com|Plan v2|3f2a9c1e|token=abc|123456789|eyJ/);
  assert.match(text, /\[email\]/);
  assert.match(text, /"\[text\]"/);
  assert.match(text, /https:\/\/surveytool\.app\/app/);
  // Document names: quoted, unquoted with spaces, or with no extension at all.
  assert.equal(scrubCrashText('Could not copy "Acme Confidential Site Plan".'), 'Could not copy "[text]".');
  assert.equal(scrubCrashText('Failed to upload any files. Errors: Acme Site Plan v2.pdf: too big'),
    'Failed to upload any files. Errors: [file]: too big');
  assert.equal(scrubCrashText("Cannot read properties of undefined (reading 'x')"), "Cannot read properties of undefined (reading 'x')");
  assert.equal(scrubCrashText("Bad value 'Main Street job'"), "Bad value '[text]'");
  assert.equal(scrubCrashText('word '.repeat(80), 300).length, 300);
});

test('crash reporter: report carries no breadcrumbs, agent string or user id', () => {
  const report = toReport({
    id: 'abc-123', kind: 'error', message: 'boom', stack: 'at a\nat b', route: '/app', build: '1.2.3',
    at: '2026-10-21T00:00:00.000Z', count: 3, actions: ['Save'], agent: 'Mozilla/5.0', memory: { used: 1 },
  }, { win: { innerWidth: 400 }, userAgent: 'Mozilla/5.0 (iPhone) Version/18.1 Mobile/15E148 Safari/604.1' });
  assert.deepEqual(Object.keys(report).sort(), [
    'p_browser', 'p_build', 'p_kind', 'p_message', 'p_occurred_at', 'p_platform', 'p_repeats', 'p_report_id', 'p_route', 'p_stack',
  ]);
  assert.equal(report.p_platform, 'web-phone');
  assert.equal(report.p_browser, 'Safari 18');
  assert.equal(report.p_repeats, 3);
  assert.equal(platformOf({ Capacitor: { getPlatform: () => 'android' } }), 'android-app');
  assert.equal(browserOf('Mozilla/5.0 Chrome/131.0 Safari/537.36'), 'Chrome 131');
});

test('crash reporter: sends the backlog and new crashes once, at most a few per page', async () => {
  __resetCrashLogForTests();
  const now = Date.parse('2026-10-21T12:00:00Z');
  const storage = memoryStorage();
  recordCrash({ kind: 'error', message: 'old one' }, { storage, now: now - 60000 });
  recordCrash({ kind: 'error', message: 'too old' }, { storage, now: now - 2 * 24 * 3600 * 1000 });
  const calls = [];
  const supabase = { rpc: async (name, args) => { calls.push([name, args]); return { data: true, error: null }; } };
  const immediately = (fn) => { fn(); return 0; };

  const stop = installCrashReporter(supabase, { now: () => now, storage, schedule: immediately });
  await tick();
  assert.deepEqual(calls.map(([, a]) => a.p_message), ['old one']);
  assert.equal(calls[0][0], 'report_client_error');
  assert.ok(readCrashReports(storage).find((r) => r.message === 'old one').sentAt, 'stamped as sent');

  for (let i = 0; i < MAX_PER_PAGE + 3; i += 1) recordCrash({ kind: 'error', message: `new ${i}` }, { storage, now: now + i * 60000 });
  await tick();
  assert.equal(calls.length, MAX_PER_PAGE);
  stop();

  // A reload does not resend what already went out.
  const again = [];
  installCrashReporter({ rpc: async (n, a) => { again.push(a.p_message); return { data: true, error: null }; } },
    { now: () => now + 600000, storage, schedule: immediately })();
  await tick();
  assert.ok(!again.includes('old one'));
  assert.ok(JSON.parse(storage.getItem(CRASH_LOG_KEY)).length > 0);
});

test('crash reporter: waits for repeats to fold in, and keeps refused reports for later', async () => {
  __resetCrashLogForTests();
  let clock = Date.parse('2026-10-21T12:00:00Z');
  const storage = memoryStorage();
  const pending = [];
  const calls = [];
  let accept = false;
  const supabase = { rpc: async (name, args) => { calls.push(args); return { data: accept, error: null }; } };
  const stop = installCrashReporter(supabase, { now: () => clock, storage, schedule: (fn, ms) => { pending.push([fn, ms]); return 0; } });

  recordCrash({ kind: 'error', message: 'loop' }, { storage, now: clock });
  recordCrash({ kind: 'error', message: 'loop' }, { storage, now: clock + 1000 });
  recordCrash({ kind: 'error', message: 'loop' }, { storage, now: clock + 2000 });
  assert.equal(pending.length, 1, 'repeats do not queue a second send');
  assert.ok(pending[0][1] > 30000, 'waits out the fold window');
  clock += pending[0][1];
  pending.shift()[0]();
  await tick();
  assert.equal(calls[0].p_repeats, 3);
  assert.equal(readCrashReports(storage)[0].sentAt, null, 'flood guard said no: not stamped');
  stop();

  accept = true;
  installCrashReporter(supabase, { now: () => clock, storage, schedule: (fn) => { fn(); return 0; } })();
  await tick();
  assert.equal(calls.length, 2, 'sent again on the next load');
  assert.ok(readCrashReports(storage)[0].sentAt);
});

const pgBin = ['/usr/lib/postgresql/16/bin', '/opt/homebrew/bin', '/usr/local/bin']
  .find((dir) => existsSync(join(dir, 'initdb')));
const tool = (name) => {
  if (pgBin && existsSync(join(pgBin, name))) return join(pgBin, name);
  try { return execFileSync('which', [name], { encoding: 'utf8' }).trim(); }
  catch { return ''; }
};
const pgEnv = { ...process.env, LC_ALL: 'C', LANG: 'C' };
const isRoot = process.getuid?.() === 0; // initdb refuses to run as root

test('crash reporter: database rules', { skip: isRoot || !tool('initdb') || !tool('pg_ctl') || !tool('psql') }, () => {
  const cluster = mkdtempSync(join(tmpdir(), 'survey-crash-postgres-'));
  const socket = join(cluster, 'socket');
  const data = join(cluster, 'data');
  const port = String(32000 + Math.floor(Math.random() * 10000));
  let started = false;
  const psql = (sql) => execFileSync(tool('psql'), [
    '-h', socket, '-p', port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq',
  ], { input: sql, encoding: 'utf8', env: pgEnv, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  try {
    mkdirSync(socket);
    execFileSync(tool('initdb'), ['-D', data, '-A', 'trust', '-U', 'postgres', '--no-locale'], { stdio: 'ignore', env: pgEnv });
    execFileSync(tool('pg_ctl'), ['-D', data, '-l', join(cluster, 'pg.log'), '-o', `-F -k ${socket} -p ${port}`, '-w', 'start'], { stdio: 'ignore', env: pgEnv });
    started = true;
    psql('create role anon; create role authenticated;');
    psql(readFileSync(new URL('../supabase/migrations/20261021141000_client_errors.sql', import.meta.url), 'utf8'));
    // Mimic Supabase's default grants, which the migration must take back.
    psql('grant select, insert, update, delete on public.client_errors to anon, authenticated;');
    psql(readFileSync(new URL('../supabase/migrations/20261021141000_client_errors.sql', import.meta.url), 'utf8'));

    assert.equal(psql(`set role anon; select public.report_client_error('error', '${'m'.repeat(500)}', null, '/app', 'b', 'web-desktop', 'Chrome 1', null, 5000);`), 't');
    assert.equal(psql(`set role authenticated; select public.report_client_error('nonsense', 'x');`), 'f');
    assert.equal(psql('select length(message) || \'|\' || repeats from public.client_errors;'), '300|1000');
    assert.throws(() => psql('set role anon; select count(*) from public.client_errors;'), /permission denied/);
    assert.throws(() => psql("set role authenticated; insert into public.client_errors (kind, message) values ('error', 'x');"), /permission denied/);

    // A second tab sending the same record stores nothing new.
    psql("set role anon; select public.report_client_error('error', 'twice', p_report_id => 'r1');");
    psql("set role anon; select public.report_client_error('error', 'twice', p_report_id => 'r1');");
    assert.equal(psql("select count(*) from public.client_errors where message = 'twice';"), '1');

    psql("insert into public.client_errors (kind, message) select 'error', 'flood' from generate_series(1, 600);");
    assert.equal(psql("set role anon; select public.report_client_error('error', 'one more');"), 'f', 'flood guard');
  } finally {
    if (started) {
      try { execFileSync(tool('pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop'], { stdio: 'ignore', env: pgEnv }); }
      catch { /* the assertion above reports */ }
    }
    if (existsSync(cluster)) rmSync(cluster, { recursive: true, force: true });
  }
});
