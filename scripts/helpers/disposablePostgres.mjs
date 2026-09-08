// Local SQL integration tests only. Never accepts a connection URL, environment
// override, existing cluster, or provider credentials. Nothing is installed.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const quote = value => value == null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;
const roleName = role => {
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error('Invalid fixture SQL role');
  return role;
};
const bounded = (value, low, high, label) => {
  if (!Number.isInteger(value) || value < low || value > high) throw new Error(`Invalid ${label}`);
  return value;
};

/**
 * work({sql,scalar,asRole,actorContext,errorState,session,blocked,applyMigration,
 *       quote,directory,dataDirectory,version}) -> any
 * sql/asRole return {status,stdout,stderr}; required=false allows expected SQL
 * errors. session(name,{role,actorId,isolation}) supplies send/wait/finish/done.
 * All identities and SQL refer solely to this newly owned local fixture.
 */
export async function withDisposablePostgres(work, {
  name = 'fixture', commandTimeoutMs = 20_000, sessionTimeoutMs = 30_000,
} = {}) {
  if (typeof work !== 'function') throw new Error('A fixture callback is required');
  if (!/^[a-z][a-z0-9-]{0,35}$/.test(name)) throw new Error('Invalid fixture name');
  bounded(commandTimeoutMs, 1000, 60_000, 'command timeout');
  bounded(sessionTimeoutMs, 1000, 60_000, 'session timeout');
  if (process.platform === 'win32' || process.getuid?.() === 0) throw new Error('Use a non-root Unix user for disposable PostgreSQL');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PG/i.test(key)));
  Object.assign(env, { LANG: 'C', LC_ALL: 'C' });
  const run = (command, args, required = true) => {
    const raw = spawnSync(command, args, { env, encoding: 'utf8', timeout: commandTimeoutMs, maxBuffer: 4 * 1024 * 1024 });
    const result = { status: raw.status, stdout: String(raw.stdout || '').trim(), stderr: String(raw.stderr || '').trim() };
    if (raw.error) result.stderr = `${result.stderr}\n${raw.error.message}`.trim();
    if (required && (raw.error || raw.status !== 0)) throw new Error(result.stderr || `${command} failed (${raw.status})`);
    return result;
  };
  // Check before allocating a directory. -X below disables user psql startup.
  for (const command of ['initdb', 'pg_ctl', 'psql']) run(command, ['--version']);
  const prefix = `/tmp/survey-pg-${name}-`;
  const directory = mkdtempSync(prefix), dataDirectory = join(directory, 'data');
  const port = '6543'; // Unix sockets are private to the unique directory.
  const args = ['-X', '-h', directory, '-p', port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-Atq'];
  const processes = new Set();
  let initialized = false;
  const sql = (statement, required = true) => run('psql', [...args, '-c', statement], required);
  const scalar = statement => sql(statement).stdout;
  const actorContext = (actorId = null, role = 'authenticated') => `SET ROLE ${roleName(role)}; SET request.jwt.claim.sub=${quote(actorId || '')}; SET request.jwt.claim.role=${quote(role)};`;
  const asRole = (actorId, statement, role = 'authenticated', required = true) => sql(`${actorContext(actorId, role)} ${statement}`, required);
  const errorState = (result, state) => {
    assert.match(state, /^[A-Z0-9]{5}$/);
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, new RegExp(`\\b${state}:`));
  };
  const session = (applicationName, { role = 'service_role', actorId = null, isolation = 'READ COMMITTED' } = {}) => {
    if (!/^[a-zA-Z0-9_-]{1,55}$/.test(applicationName)) throw new Error('Invalid session name');
    if (!['READ COMMITTED', 'REPEATABLE READ', 'SERIALIZABLE'].includes(isolation)) throw new Error('Invalid isolation level');
    const context = actorContext(actorId, role);
    const child = spawn('psql', args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', exited = false, timedOut = false;
    const append = (stream, value) => {
      if (stream === 'stdout') stdout += value; else stderr += value;
      if (stdout.length + stderr.length > 4 * 1024 * 1024) {
        stderr = `${stderr.slice(0, 1000)}\nFixture session output limit exceeded`;
        stdout = stdout.slice(0, 1000); child.kill('SIGKILL');
      }
    };
    child.stdout.on('data', value => append('stdout', value));
    child.stderr.on('data', value => append('stderr', value));
    // Error paths resolve the receipt rather than create an unhandled rejection
    // which could exit Node before the finally block can stop PostgreSQL.
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') append('stderr', error.message); });
    child.on('error', error => append('stderr', error.message));
    let timer;
    const done = new Promise(resolve => child.once('close', status => {
      exited = true; clearTimeout(timer);
      if (timedOut) stderr += '\nFixture session deadline exceeded';
      resolve({ status, stdout: stdout.trim(), stderr: stderr.trim() });
    }));
    const entry = { child, done, get exited() { return exited; } };
    processes.add(entry);
    timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, sessionTimeoutMs);
    const send = statement => {
      if (exited || child.stdin.destroyed || child.stdin.writableEnded) throw new Error(`Fixture session ${applicationName} is closed: ${stderr}`);
      child.stdin.write(`${statement}\n`);
    };
    const wait = async marker => {
      const deadline = Date.now() + Math.min(commandTimeoutMs, sessionTimeoutMs);
      while (!stdout.includes(marker)) {
        if (exited || Date.now() >= deadline) throw new Error(`Fixture session ${applicationName} did not reach ${marker}: ${stderr}`);
        await delay(10);
      }
    };
    send(`${context} SET application_name=${quote(applicationName)}; SET statement_timeout=${quote(`${commandTimeoutMs}ms`)}; BEGIN ISOLATION LEVEL ${isolation};`);
    return { name: applicationName, send, wait, done, async finish(commit = true) {
      if (!exited && !child.stdin.destroyed && !child.stdin.writableEnded) {
        send(commit ? 'COMMIT;' : 'ROLLBACK;'); child.stdin.end();
      }
      return done;
    } };
  };
  const blocked = async applicationName => {
    const deadline = Date.now() + Math.min(commandTimeoutMs, 5000);
    while (Date.now() < deadline) {
      if (scalar(`SELECT count(*) FROM pg_stat_activity WHERE application_name=${quote(applicationName)} AND wait_event_type='Lock'`) === '1') return;
      await delay(10);
    }
    throw new Error(`Fixture session did not block: ${applicationName}`);
  };
  const applyMigration = path => {
    if (!isAbsolute(path)) throw new Error('Use an explicit absolute migration path');
    // Read the exact tracked source; psql never interprets a caller-supplied
    // path as a server connection target or an interactive startup file.
    return sql(readFileSync(path, 'utf8'));
  };
  try {
    run('initdb', ['-D', dataDirectory, '-A', 'trust', '-U', 'postgres', '--no-locale', '-E', 'UTF8']);
    // Set before start: a pg_ctl timeout can occur after the server launched.
    initialized = true;
    run('pg_ctl', ['-D', dataDirectory, '-l', join(directory, 'postgres.log'), '-o', `-c listen_addresses='' -k ${directory} -p ${port}`, '-w', 'start']);
    return await work({ sql, scalar, asRole, actorContext, errorState, session, blocked, applyMigration, quote, directory, dataDirectory, version: scalar('SELECT version()') });
  } finally {
    let safeToRemove = false;
    try {
      for (const { child, exited } of processes) if (!exited) child.kill('SIGKILL');
      // psql termination rolls back open transactions. Drain every tracked child
      // before shutdown, including children already finished during the test.
      let drainTimer;
      try {
        await Promise.race([
          Promise.all([...processes].map(entry => entry.done)),
          new Promise((_, reject) => { drainTimer = setTimeout(() => reject(new Error('Fixture children did not exit')), 5000); }),
        ]);
      } finally { clearTimeout(drainTimer); }
      assert.ok(directory.startsWith(prefix) && directory.slice(prefix.length).match(/^[A-Za-z0-9]+$/)
        && dataDirectory === join(directory, 'data'), 'exact owned temporary paths required');
      if (initialized) {
        const status = run('pg_ctl', ['-D', dataDirectory, 'status'], false);
        if (status.status === 0) run('pg_ctl', ['-D', dataDirectory, '-m', 'immediate', '-w', 'stop']);
        else assert.equal(status.status, 3, 'owned PostgreSQL status must be known');
        assert.equal(run('pg_ctl', ['-D', dataDirectory, 'status'], false).status, 3, 'owned PostgreSQL must be stopped before removal');
      }
      safeToRemove = true;
    } finally {
      if (safeToRemove) rmSync(directory, { recursive: true, force: true });
      else console.error(`PostgreSQL cleanup uncertain; retained owned fixture at ${directory}`);
    }
  }
}
