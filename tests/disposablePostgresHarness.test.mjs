import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { withDisposablePostgres } from '../scripts/helpers/disposablePostgres.mjs';

test('disposable PostgreSQL rejects unsafe helper input before allocating a cluster', async () => {
  await assert.rejects(withDisposablePostgres(null), /callback/);
  await assert.rejects(withDisposablePostgres(() => {}, { name: '../elsewhere' }), /name/);
  await assert.rejects(withDisposablePostgres(() => {}, { commandTimeoutMs: 0 }), /timeout/);
  await assert.rejects(withDisposablePostgres(() => {}, { sessionTimeoutMs: Infinity }), /timeout/);
});

const integration = { skip: process.env.SURVEY_POSTGRES_INTEGRATION !== '1' && 'set SURVEY_POSTGRES_INTEGRATION=1 for installed local PostgreSQL', timeout: 60_000 };
test('private actual PostgreSQL runs two-session locks and removes its stopped cluster', integration, async () => {
  let directory;
  const result = await withDisposablePostgres(async pg => {
    directory = pg.directory;
    assert.equal(pg.scalar("SHOW listen_addresses"), '');
    pg.sql('CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE TABLE fixture(id int PRIMARY KEY, value text); INSERT INTO fixture VALUES(1,\'before\'); GRANT ALL ON fixture TO service_role');
    const first = pg.session('holder');
    first.send("UPDATE fixture SET value='after' WHERE id=1;SELECT 'HELD';"); await first.wait('HELD');
    const second = pg.session('waiter'); second.send("SELECT value FROM fixture WHERE id=1 FOR UPDATE;"); await pg.blocked(second.name);
    assert.equal((await first.finish()).status, 0);
    const read = await second.finish(); assert.equal(read.status, 0); assert.equal(read.stdout, 'after');
    pg.errorState(pg.sql('SELECT 1/0', false), '22012');
    return 'done';
  }, { name: 'helper-test' });
  assert.equal(result, 'done'); assert.equal(existsSync(directory), false);
});

test('callback failure drains an open transaction and still removes only its stopped cluster', integration, async () => {
  let directory;
  await assert.rejects(withDisposablePostgres(async pg => {
    directory = pg.directory;
    const session = pg.session('abandoned', { role: 'postgres' });
    session.send("SELECT pg_advisory_xact_lock(42);SELECT 'HELD';"); await session.wait('HELD');
    throw new Error('fixture callback failed');
  }, { name: 'helper-failure' }), /fixture callback failed/);
  assert.equal(existsSync(directory), false);
});
