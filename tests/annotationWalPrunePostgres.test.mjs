// w36 (2026-09-25): the proposed WAL / history prune
// (supabase/proposed/20260925_w36_prune_annotation_wal_and_history.sql) run
// against a disposable local Postgres with the REAL WAL migration
// (append trigger, snapshot guard, RPCs), like scripts/test-annotation-wal-postgres.mjs.
// Skipped where no local Postgres binaries exist (initdb/pg_ctl/psql).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const walMigration = join(root, 'supabase/migrations/20260727131230_annotation_wal_concurrency.sql');
const pruneSql = join(root, 'supabase/proposed/20260925_w36_prune_annotation_wal_and_history.sql');
const hasPostgres = ['initdb', 'pg_ctl', 'psql'].every((bin) => spawnSync('which', [bin]).status === 0);
// macOS postmaster refuses to start without a valid locale in the env.
const env = { ...process.env, LC_ALL: 'C', LANG: 'C' };
const OWNER = '10000000-0000-0000-0000-000000000001';
const DOC = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

test('w36 prune: WAL rows a checkpoint covers go, nothing an open or the next append needs does', { skip: !hasPostgres && 'no local Postgres' }, async (t) => {
  const temp = mkdtempSync(join(tmpdir(), 'survey-w36-prune-'));
  const data = join(temp, 'data');
  const socket = join(temp, 'socket');
  const port = 59000 + Math.floor(Math.random() * 3000);
  const psqlArgs = ['-h', socket, '-p', String(port), '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq'];
  const run = (command, args) => {
    const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', env });
    if (result.status !== 0) throw new Error(`${command} failed (${result.status})\n${result.stdout}\n${result.stderr}`);
    return String(result.stdout || '').trim();
  };
  const sql = (source) => run('psql', [...psqlArgs, '-c', `
    DO $$ BEGIN PERFORM set_config('request.jwt.claim.sub', '${OWNER}', false); END $$;
    ${source}
  `]);
  const sqlFails = (source) => spawnSync('psql', [...psqlArgs, '-c', source], { encoding: 'utf8', env });

  run('mkdir', ['-p', socket]);
  run('initdb', ['-D', data, '--auth=trust', '--no-locale', '-E', 'UTF8']);
  const started = spawnSync('pg_ctl', ['-D', data, '-l', join(temp, 'pg.log'), '-o', `-F -p ${port} -k ${socket}`, '-w', 'start'], { encoding: 'utf8', timeout: 15000, env });
  if (started.status !== 0) {
    let log = '';
    try { log = readFileSync(join(temp, 'pg.log'), 'utf8'); } catch { /* none */ }
    // A sandbox that forbids local sockets/shared memory is not a failure of
    // the SQL under test.
    t.skip(`local Postgres would not start here: ${(log || started.stderr).slice(-400)}`);
    rmSync(temp, { recursive: true, force: true });
    return;
  }
  t.after(() => {
    spawnSync('pg_ctl', ['-D', data, '-m', 'immediate', 'stop'], { stdio: 'ignore', env });
    rmSync(temp, { recursive: true, force: true });
  });

  // Supabase-shaped stand-ins (roles, auth.uid, access checks), then the
  // real WAL migration, then the proposed prune.
  sql(`
    CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE TABLE public.documents (id uuid PRIMARY KEY, user_id uuid NOT NULL,
      locked_at timestamptz, locked_by uuid, locked_label text);
    CREATE TABLE public.annotation_updates (
      seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
      client_id text NOT NULL, client_seq bigint NOT NULL, data bytea NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(document_id, client_id, client_seq));
    CREATE INDEX annotation_updates_doc_seq_idx ON public.annotation_updates(document_id, seq);
    CREATE TABLE public.annotation_snapshots (
      document_id uuid PRIMARY KEY REFERENCES public.documents(id) ON DELETE CASCADE,
      at_seq bigint NOT NULL DEFAULT 0, snapshot bytea NOT NULL,
      encoding_version int NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE public.document_history_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), document_id uuid NOT NULL,
      event_type text NOT NULL, payload jsonb, occurred_at timestamptz NOT NULL DEFAULT now());
    GRANT ALL ON TABLE public.annotation_updates, public.annotation_snapshots, public.document_history_events
      TO anon, authenticated, service_role;
    CREATE FUNCTION public.user_can_access_document(uuid, text) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT true $$;
    CREATE FUNCTION public.kal49_document_is_locked(doc_id uuid) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT false $$;
    CREATE FUNCTION public.kal49_lock_document(doc_id uuid, label text DEFAULT NULL)
      RETURNS public.documents LANGUAGE plpgsql SECURITY DEFINER AS $$
      DECLARE d public.documents; BEGIN SELECT * INTO d FROM public.documents WHERE id = doc_id; RETURN d; END $$;
    INSERT INTO public.documents(id, user_id)
      SELECT ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, '${OWNER}' FROM generate_series(1, 7) n;
  `);
  run('psql', [...psqlArgs, '-f', walMigration]);
  run('psql', [...psqlArgs, '-f', pruneSql]);

  // Appends through the real RPC (seq = MAX+1 under the document lock).
  const append = (doc, n, prefix = 'w') => sql(`
    SELECT count(*) FROM (
      SELECT public.append_annotation_update('${doc}', '${prefix}', g, '\\x01'::bytea)
        FROM generate_series((SELECT COALESCE(max(client_seq), 0) + 1 FROM public.annotation_updates
                               WHERE document_id = '${doc}' AND client_id = '${prefix}'),
                             (SELECT COALESCE(max(client_seq), 0) + ${n} FROM public.annotation_updates
                               WHERE document_id = '${doc}' AND client_id = '${prefix}')) g) x`);
  const age = (doc, days, belowSeq = 1e12) => sql(`
    ALTER TABLE public.annotation_updates DISABLE TRIGGER USER;
    UPDATE public.annotation_updates SET created_at = now() - make_interval(days => ${days})
     WHERE document_id = '${doc}' AND seq <= ${belowSeq};
    ALTER TABLE public.annotation_updates ENABLE TRIGGER USER;`);
  const checkpoint = (doc, atSeq, { minutesAgo = 120 } = {}) => sql(`
    ALTER TABLE public.annotation_snapshots DISABLE TRIGGER USER;
    INSERT INTO public.annotation_snapshots(document_id, at_seq, snapshot, writer_id, writer_epoch, updated_at)
    VALUES ('${doc}', ${atSeq}, '\\x00', 'w', 1, now() - make_interval(mins => ${minutesAgo}))
    ON CONFLICT (document_id) DO UPDATE SET at_seq = EXCLUDED.at_seq, updated_at = EXCLUDED.updated_at;
    ALTER TABLE public.annotation_snapshots ENABLE TRIGGER USER;`);
  const seqs = (doc) => sql(`SELECT string_agg(seq::text, ',' ORDER BY seq) FROM public.annotation_updates WHERE document_id = '${doc}'`);
  const count = (doc) => Number(sql(`SELECT count(*) FROM public.annotation_updates WHERE document_id = '${doc}'`));

  // Doc 1: 300 old rows, checkpoint at the head (300).
  append(DOC(1), 300); age(DOC(1), 10); checkpoint(DOC(1), 300);
  // Doc 2: 300 rows, checkpoint at 250 (rows 251..300 not covered), all old.
  append(DOC(2), 300); age(DOC(2), 10); checkpoint(DOC(2), 250);
  // Doc 3: 300 old rows but the checkpoint changed 5 minutes ago (an open may
  // still be paging its tail from the previous one).
  append(DOC(3), 300); age(DOC(3), 10); checkpoint(DOC(3), 300, { minutesAgo: 5 });
  // Doc 4: 300 rows, only the first 100 old; checkpoint at the head.
  append(DOC(4), 300); age(DOC(4), 10, 100); checkpoint(DOC(4), 300);
  // Doc 5: 300 old rows, no checkpoint at all.
  append(DOC(5), 300); age(DOC(5), 10);
  // Doc 6: 100 rows, idle for 40 days, checkpoint at the head.
  append(DOC(6), 100); age(DOC(6), 40); checkpoint(DOC(6), 100);
  // Doc 7 (no documents row needed beyond the seed): 300 old rows, but row 50
  // carries a newer created_at (seq and created_at can invert by a lock
  // wait): the prune still removes a seq PREFIX, never leaving a hole.

  append(DOC(7), 300); age(DOC(7), 10); checkpoint(DOC(7), 300);
  sql(`ALTER TABLE public.annotation_updates DISABLE TRIGGER USER;
       UPDATE public.annotation_updates SET created_at = now() WHERE document_id = '${DOC(7)}' AND seq = 50;
       ALTER TABLE public.annotation_updates ENABLE TRIGGER USER;`);

  // Run as the service role (the grant path; cron runs as the owner).
  const [docs, rows] = sql('SET ROLE service_role; SELECT documents_pruned, rows_deleted FROM public.prune_annotation_updates()').split('|').map(Number);

  assert.equal(seqs(DOC(1)).split(',')[0], '220', 'doc 1: kept at_seq - 80 .. head (220..300)');
  assert.equal(count(DOC(1)), 81);
  assert.equal(seqs(DOC(2)).split(',')[0], '170', 'doc 2: kept at_seq - 80 and every row after the checkpoint');
  assert.equal(count(DOC(2)), 131);
  assert.equal(count(DOC(3)), 300, 'doc 3: checkpoint just changed, untouched');
  assert.equal(seqs(DOC(4)).split(',')[0], '101', 'doc 4: rows younger than 7 days stay even far below at_seq');
  assert.equal(count(DOC(5)), 300, 'doc 5: no checkpoint, untouched');
  assert.equal(seqs(DOC(6)), '100', 'doc 6: idle past 30 days: only the head row (= at_seq) stays');
  assert.equal(seqs(DOC(7)).split(',')[0], '220', 'doc 7: a prefix, the inverted row 50 included (no hole)');
  assert.equal(docs, 5);
  assert.equal(rows, 219 + 169 + 100 + 99 + 219);

  // The next append continues after the head; the checkpoint RPC still works.
  append(DOC(1), 1);
  assert.equal(seqs(DOC(1)).split(',').at(-1), '301', 'no seq reused after a prune');
  append(DOC(6), 1);
  assert.equal(seqs(DOC(6)), '100,101');
  assert.equal(sql(`SELECT public.store_annotation_snapshot('${DOC(6)}', 101, '\\x01', 1, 'w2', 2, 100, 'w', 1)`), 't',
    'a checkpoint on top of a pruned WAL is accepted');

  // A second run finds nothing new; unsafe settings are refused.
  assert.equal(sql('SELECT rows_deleted FROM public.prune_annotation_updates()'), '0');
  for (const call of [
    'public.prune_annotation_updates(p_keep_days => 1)',
    'public.prune_annotation_updates(p_keep_rows => 10)',
    'public.prune_annotation_updates(p_quiet_minutes => 1)',
    'public.prune_annotation_updates(p_idle_days => 3)',
  ]) {
    const refused = sqlFails(`SELECT * FROM ${call}`);
    assert.notEqual(refused.status, 0, call);
    assert.match(refused.stderr, /unsafe settings/);
  }

  // Service-only.
  assert.equal(sql(`SELECT concat_ws(',',
    has_function_privilege('authenticated', 'public.prune_annotation_updates(integer,integer,integer,integer,integer)', 'EXECUTE'),
    has_function_privilege('anon', 'public.prune_annotation_updates(integer,integer,integer,integer,integer)', 'EXECUTE'),
    has_function_privilege('service_role', 'public.prune_annotation_updates(integer,integer,integer,integer,integer)', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.prune_document_history_events(integer,integer,integer,integer)', 'EXECUTE'),
    has_function_privilege('service_role', 'public.prune_document_history_events(integer,integer,integer,integer)', 'EXECUTE'),
    has_table_privilege('authenticated', 'public.annotation_updates', 'DELETE'))`), 'f,f,t,f,t,f',
  'only the service role (and pg_cron as the owner) may prune; the WAL stays append-only for users');

  // History: the newest 200 per document stay (what the panel shows), younger than
  // 14 days stay, delete-type (trash) rows stay.
  sql(`
    INSERT INTO public.document_history_events(document_id, event_type, occurred_at)
      SELECT '${DOC(1)}', 'local_annotation_history_added', now() - make_interval(days => 20, secs => g) FROM generate_series(1, 400) g;
    INSERT INTO public.document_history_events(document_id, event_type, occurred_at)
      SELECT '${DOC(1)}', 'annotation_deleted', now() - make_interval(days => 25, secs => g) FROM generate_series(1, 30) g;
    INSERT INTO public.document_history_events(document_id, event_type, occurred_at)
      SELECT '${DOC(2)}', 'local_annotation_history_added', now() - make_interval(days => 3, secs => g) FROM generate_series(1, 400) g;
  `);
  assert.equal(sql('SELECT public.prune_document_history_events()'), '200');
  assert.equal(sql(`SELECT count(*) FROM public.document_history_events WHERE document_id = '${DOC(1)}' AND event_type <> 'annotation_deleted'`), '200');
  assert.equal(sql(`SELECT count(*) FROM public.document_history_events WHERE event_type = 'annotation_deleted'`), '30', 'trash rows are the 30-day sweep\'s job');
  assert.equal(sql(`SELECT count(*) FROM public.document_history_events WHERE document_id = '${DOC(2)}'`), '400', 'recent activity stays');
  const refused = sqlFails('SELECT public.prune_document_history_events(p_keep_per_document => 100)');
  assert.notEqual(refused.status, 0);
  assert.notEqual(sqlFails('SELECT public.prune_document_history_events(p_max_age_days => 7)').status, 0);
  // The optional age cap (owner decision): activity older than it goes even
  // inside the newest 200; trash rows still stay.
  assert.equal(sql('SELECT public.prune_document_history_events(p_max_age_days => 30)'), '0');
  sql(`INSERT INTO public.document_history_events(document_id, event_type, occurred_at)
       SELECT '${DOC(3)}', 'checkpoint_added', now() - make_interval(days => 45, secs => g) FROM generate_series(1, 10) g;`);
  assert.equal(sql('SELECT public.prune_document_history_events(p_max_age_days => 30)'), '10');
  assert.equal(sql(`SELECT count(*) FROM public.document_history_events WHERE event_type = 'annotation_deleted'`), '30');
});
