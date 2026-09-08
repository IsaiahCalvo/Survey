// Actual WAL SQL/locking proof; access checks remain deliberately stubbed.
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { withDisposablePostgres } from './helpers/disposablePostgres.mjs';

const root = resolve(import.meta.dirname, '..');
const migration = join(root, 'supabase/migrations/20260727131230_annotation_wal_concurrency.sql');
const OWNER = '10000000-0000-0000-0000-000000000001';
if (process.argv.length !== 2) throw new Error('This local fixture accepts no arguments.');

await withDisposablePostgres(async pg => {
  const sql = source => pg.sql(`
    DO $$ BEGIN PERFORM set_config('request.jwt.claim.sub', '${OWNER}', false); END $$;
    ${source}
  `).stdout;
  const startSession = (name, source) => {
    // Preserve the original postgres-owned fixture context; real authorization
    // remains outside this harness, except explicit SET ROLE assertions below.
    const session = pg.session(name, { role: 'postgres', actorId: OWNER });
    session.send(source + ';');
    return session;
  };
  const hold = async (name, source) => {
    const session = startSession(name, source);
    session.send("SELECT 'FIXTURE_HELD';");
    await session.wait('FIXTURE_HELD');
    return session;
  };
  sql(`
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE ROLE anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE TABLE public.documents (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL,
      locked_at timestamptz,
      locked_by uuid,
      locked_label text
    );
    CREATE TABLE public.annotation_updates (
      seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
      client_id text NOT NULL,
      client_seq bigint NOT NULL,
      data bytea NOT NULL,
      UNIQUE(document_id, client_id, client_seq)
    );
    CREATE INDEX annotation_updates_doc_seq_idx
      ON public.annotation_updates(document_id, seq);
    CREATE TABLE public.annotation_snapshots (
      document_id uuid PRIMARY KEY REFERENCES public.documents(id) ON DELETE CASCADE,
      at_seq bigint NOT NULL DEFAULT 0,
      snapshot bytea NOT NULL,
      encoding_version int NOT NULL DEFAULT 1,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    -- Supabase grants API roles broad table privileges by default; the migration
    -- must explicitly preserve the WAL's append-only contract.
    GRANT ALL ON TABLE public.annotation_updates, public.annotation_snapshots
      TO anon, authenticated, service_role;
    CREATE FUNCTION public.user_can_access_document(uuid, text)
    RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
      SELECT COALESCE(
        NULLIF(current_setting('test.annotation_access', true), ''),
        'true'
      )::boolean
    $$;
    CREATE FUNCTION public.kal49_document_is_locked(doc_id uuid)
    RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
      SELECT EXISTS (
        SELECT 1 FROM public.documents
        WHERE id = doc_id AND locked_at IS NOT NULL
      )
    $$;
    CREATE FUNCTION public.kal49_lock_document(doc_id uuid, label text DEFAULT NULL)
    RETURNS public.documents LANGUAGE plpgsql SECURITY DEFINER AS $$
    DECLARE updated public.documents;
    BEGIN
      UPDATE public.documents SET locked_at = now(), locked_label = label
      WHERE id = doc_id RETURNING * INTO updated;
      RETURN updated;
    END $$;
    INSERT INTO public.documents(id, user_id) VALUES
      ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001'),
      ('00000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001'),
      ('00000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001'),
      ('00000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001'),
      ('00000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001'),
      ('00000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001'),
      ('00000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001'),
      ('00000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000001'),
      ('00000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000001'),
      ('00000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000001'),
      ('00000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000001'),
      ('00000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000001'),
      ('00000000-0000-0000-0000-000000000013', '10000000-0000-0000-0000-000000000001'),
      ('00000000-0000-0000-0000-000000000014', '10000000-0000-0000-0000-000000000001'),
      ('00000000-0000-0000-0000-000000000015', '10000000-0000-0000-0000-000000000001'),
      ('00000000-0000-0000-0000-000000000016', '10000000-0000-0000-0000-000000000001');
    INSERT INTO public.annotation_updates(
      seq, document_id, client_id, client_seq, data
    ) OVERRIDING SYSTEM VALUE VALUES
      (1, '00000000-0000-0000-0000-000000000009', 'historic', 1, '\\x91'),
      (3, '00000000-0000-0000-0000-000000000009', 'historic', 2, '\\x93');
  `);
  pg.applyMigration(migration);

  assert.equal(sql(`
    SELECT concat_ws(',',
      has_function_privilege('anon',
        'public.append_annotation_update(uuid,text,bigint,bytea)', 'EXECUTE'),
      has_function_privilege('authenticated',
        'public.append_annotation_update(uuid,text,bigint,bytea)', 'EXECUTE'),
      has_function_privilege('service_role',
        'public.append_annotation_update(uuid,text,bigint,bytea)', 'EXECUTE'),
      has_function_privilege('anon',
        'public.store_annotation_snapshot(uuid,bigint,bytea,integer,text,bigint,bigint,text,bigint)', 'EXECUTE'),
      has_function_privilege('authenticated',
        'public.store_annotation_snapshot(uuid,bigint,bytea,integer,text,bigint,bigint,text,bigint)', 'EXECUTE'),
      has_function_privilege('service_role',
        'public.store_annotation_snapshot(uuid,bigint,bytea,integer,text,bigint,bigint,text,bigint)', 'EXECUTE'),
      has_function_privilege('authenticated',
        'public.serialize_annotation_update_insert()', 'EXECUTE'),
      has_function_privilege('service_role',
        'public.guard_annotation_snapshot_write()', 'EXECUTE'),
      has_function_privilege('anon',
        'public.kal49_lock_document(uuid,text)', 'EXECUTE'),
      has_function_privilege('authenticated',
        'public.kal49_lock_document(uuid,text)', 'EXECUTE'),
      has_function_privilege('service_role',
        'public.kal49_lock_document(uuid,text)', 'EXECUTE'),
      has_table_privilege('anon', 'public.annotation_updates', 'UPDATE'),
      has_table_privilege('authenticated', 'public.annotation_updates', 'DELETE'),
      has_table_privilege('service_role', 'public.annotation_updates', 'UPDATE')
    )
  `), 'f,t,t,f,t,t,f,f,f,t,t,f,f,f',
  'Supabase default grants are explicitly narrowed for RPC, triggers, and immutable WAL rows');
  for (const mutation of ['UPDATE', 'DELETE']) {
    const attemptedWalMutation = pg.sql(`
      SET ROLE authenticated;
      ${mutation === 'UPDATE'
        ? "UPDATE public.annotation_updates SET actor_user_id = NULL"
        : 'DELETE FROM public.annotation_updates'}
    `, false);
    assert.notEqual(attemptedWalMutation.status, 0);
    assert.match(attemptedWalMutation.stderr, /permission denied for table annotation_updates/);
  }

  const seqs = sql(`
    SET ROLE authenticated;
    SELECT seq FROM public.append_annotation_update(
      '00000000-0000-0000-0000-000000000001', 'writer-a', 1, '\\x01'
    );
    SELECT seq FROM public.append_annotation_update(
      '00000000-0000-0000-0000-000000000001', 'writer-a', 2, '\\x02'
    );
    SELECT seq FROM public.append_annotation_update(
      '00000000-0000-0000-0000-000000000002', 'writer-b', 1, '\\x03'
    );
  `).split('\n').filter((value) => /^\d+$/.test(value));
  assert.deepEqual(seqs, ['1', '2', '1'], 'sequences are gapless and document-local');

  sql(`
    BEGIN;
    INSERT INTO public.annotation_updates(document_id, client_id, client_seq, data)
    VALUES ('00000000-0000-0000-0000-000000000001', 'rolled-back', 1, '\\x04');
    ROLLBACK;
  `);
  assert.equal(sql(`
    SELECT seq FROM public.append_annotation_update(
      '00000000-0000-0000-0000-000000000001', 'writer-a', 3, '\\x05'
    )
  `), '3', 'rollback consumes no frontier value');

  assert.equal(sql(`
    SELECT seq FROM public.append_annotation_update(
      '00000000-0000-0000-0000-000000000001', 'writer-a', 3, '\\x05'
    )
  `), '3', 'exact idempotent replay returns its original sequence');
  const collision = pg.sql(`
    DO $$ BEGIN PERFORM set_config('request.jwt.claim.sub', '${OWNER}', false); END $$;
    SELECT seq FROM public.append_annotation_update(
      '00000000-0000-0000-0000-000000000001', 'writer-a', 3, '\\xff'
    )
  `, false);
  assert.notEqual(collision.status, 0);
  assert.match(collision.stderr, /client sequence collision/);

  assert.equal(sql(`
    SELECT seq FROM public.append_annotation_update(
      '00000000-0000-0000-0000-000000000009', 'post-migration', 1, '\\x94'
    )
  `), '4', 'new writes continue after preserved historical identity gaps');

  assert.equal(sql(`
    SELECT seq FROM public.append_annotation_update(
      '00000000-0000-0000-0000-000000000011', 'legacy-receipt', 1, '\\x11'
    );
    UPDATE public.annotation_updates
       SET actor_user_id = NULL
     WHERE document_id = '00000000-0000-0000-0000-000000000011'
       AND client_id = 'legacy-receipt'
       AND client_seq = 1;
  `).split('\n').find((value) => /^\d+$/.test(value)), '1');
  assert.equal(sql(`
    DO $$ BEGIN
      PERFORM set_config(
        'request.jwt.claim.sub',
        '20000000-0000-0000-0000-000000000002',
        false
      );
      PERFORM set_config('test.annotation_access', 'true', false);
    END $$;
    SELECT seq FROM public.append_annotation_update(
      '00000000-0000-0000-0000-000000000011', 'legacy-receipt', 1, '\\x11'
    )
  `), '1', 'a second current editor may confirm an exact actorless legacy receipt');
  assert.equal(sql(`
    SELECT actor_user_id IS NULL
    FROM public.annotation_updates
    WHERE document_id = '00000000-0000-0000-0000-000000000011'
      AND client_id = 'legacy-receipt'
      AND client_seq = 1
  `), 't', 'legacy retry never claims unknowable actor provenance');
  const revokedLegacyRetry = pg.sql(`
    DO $$ BEGIN
      PERFORM set_config(
        'request.jwt.claim.sub',
        '20000000-0000-0000-0000-000000000002',
        false
      );
      PERFORM set_config('test.annotation_access', 'false', false);
    END $$;
    SELECT seq FROM public.append_annotation_update(
      '00000000-0000-0000-0000-000000000011', 'legacy-receipt', 1, '\\x11'
    )
  `, false);
  assert.notEqual(revokedLegacyRetry.status, 0);
  assert.match(revokedLegacyRetry.stderr, /annotation write is not permitted/);

  assert.equal(sql(`
    SELECT seq FROM public.append_annotation_update(
      '00000000-0000-0000-0000-000000000012', 'actor-receipt', 1, '\\x12'
    )
  `), '1');
  assert.equal(sql(`
    SELECT set_config('test.annotation_access', 'false', false);
    SELECT seq FROM public.append_annotation_update(
      '00000000-0000-0000-0000-000000000012', 'actor-receipt', 1, '\\x12'
    )
  `).split('\n').at(-1), '1',
  'the same actor can confirm an exact immutable receipt after access is revoked');
  const crossActorReceipt = pg.sql(`
    DO $$ BEGIN
      PERFORM set_config(
        'request.jwt.claim.sub',
        '20000000-0000-0000-0000-000000000002',
        false
      );
      PERFORM set_config('test.annotation_access', 'true', false);
    END $$;
    SELECT seq FROM public.append_annotation_update(
      '00000000-0000-0000-0000-000000000012', 'actor-receipt', 1, '\\x12'
    )
  `, false);
  assert.notEqual(crossActorReceipt.status, 0);
  assert.match(crossActorReceipt.stderr, /annotation write is not permitted/);

  assert.equal(sql(`
    SELECT public.store_annotation_snapshot(
      '00000000-0000-0000-0000-000000000001', 3, '\\xaa', 1,
      'old-writer', 7, NULL, NULL, 0
    )
  `), 't');
  assert.equal(sql(`
    SELECT public.store_annotation_snapshot(
      '00000000-0000-0000-0000-000000000001', 3, '\\xbb', 1,
      'repair-writer', 8, 3, 'old-writer', 7
    )
  `), 't', 'fresh writer can CAS-repair an equal-frontier snapshot it loaded');
  assert.equal(sql(`
    SELECT public.store_annotation_snapshot(
      '00000000-0000-0000-0000-000000000001', 3, '\\xcc', 1,
      'stale-writer', 8, 3, 'old-writer', 7
    )
  `), 'f', 'stale equal-frontier provenance cannot overwrite the repair');

  assert.equal(sql(`
    SELECT seq FROM public.append_annotation_update(
      '00000000-0000-0000-0000-000000000001', 'snapshot-a', 1, '\\x06'
    )
  `), '4');
  assert.equal(sql(`
    SELECT public.store_annotation_snapshot(
      '00000000-0000-0000-0000-000000000001', 4, '\\xa4', 1,
      'snapshot-a', 9, 3, 'repair-writer', 8
    )
  `), 't');
  assert.equal(sql(`
    SELECT seq FROM public.append_annotation_update(
      '00000000-0000-0000-0000-000000000001', 'snapshot-b', 1, '\\x07'
    )
  `), '5');
  assert.equal(sql(`
    SELECT public.store_annotation_snapshot(
      '00000000-0000-0000-0000-000000000001', 5, '\\xb5', 1,
      'snapshot-b', 10, 3, 'repair-writer', 8
    )
  `), 'f', 'advancing the frontier cannot bypass a stale loaded snapshot base');
  assert.equal(sql(`
    SELECT public.store_annotation_snapshot(
      '00000000-0000-0000-0000-000000000001', 5, '\\xb5', 1,
      'snapshot-b', 10, 4, 'snapshot-a', 9
    )
  `), 't', 'reload of the latest base permits the merged frontier replacement');
  assert.equal(sql(`
    SELECT public.store_annotation_snapshot(
      '00000000-0000-0000-0000-000000000001', 5, '\\xb5', 1,
      'snapshot-b', 10, 4, 'snapshot-a', 9
    )
  `), 't', 'exact lost-response retry is idempotent');
  assert.equal(sql(`
    SELECT public.store_annotation_snapshot(
      '00000000-0000-0000-0000-000000000001', 5, '\\xff', 1,
      'snapshot-b', 10, 5, 'snapshot-b', 10
    )
  `), 'f', 'same version with different bytes is not an idempotent retry');
  assert.equal(sql(`
    SELECT seq FROM public.append_annotation_update(
      '00000000-0000-0000-0000-000000000001', 'after-snapshot', 1, '\\x08'
    )
  `), '6');
  assert.equal(sql(`
    SELECT public.store_annotation_snapshot(
      '00000000-0000-0000-0000-000000000001', 5, '\\xb5', 1,
      'snapshot-b', 10, 4, 'snapshot-a', 9
    )
  `), 't', 'exact snapshot retry remains recognizable after the WAL head advances');
  assert.equal(sql(`
    SELECT public.store_annotation_snapshot(
      '00000000-0000-0000-0000-000000000001', 6, '\\xb6', 1,
      'snapshot-b', 11, 5, 'snapshot-b', 10
    )
  `), 't', 'a strictly newer snapshot generation may publish merged bytes at an advanced WAL frontier');
  assert.equal(sql(`
    SELECT public.store_annotation_snapshot(
      '00000000-0000-0000-0000-000000000001', 7, '\\xfe', 1,
      'ahead-writer', 12, 6, 'snapshot-b', 11
    )
  `), 'f', 'snapshot frontier cannot advance ahead of committed WAL');
  assert.equal(sql(`
    SELECT public.store_annotation_snapshot(
      '00000000-0000-0000-0000-000000000010', 0, '\\x90', 1,
      'new-writer', 1, 0, NULL, 0
    )
  `), 'f', 'a missing row requires the explicit absent base triple');
  assert.equal(sql(`
    SELECT public.store_annotation_snapshot(
      '00000000-0000-0000-0000-000000000010', 0, '\\x90', 1,
      'new-writer', 1, NULL, NULL, 0
    )
  `), 't', 'the explicit absent base triple creates the first snapshot');
  assert.equal(sql(`
    SELECT concat_ws(',', at_seq, encode(snapshot, 'hex'), writer_id, writer_epoch)
    FROM public.annotation_snapshots
    WHERE document_id = '00000000-0000-0000-0000-000000000010'
  `), '0,90,new-writer,1', 'first snapshot bytes and version are stored');
  assert.equal(sql(`
    INSERT INTO public.annotation_snapshots (
      document_id, at_seq, snapshot, encoding_version,
      writer_id, writer_epoch, base_at_seq, base_writer_id, base_writer_epoch
    ) VALUES (
      '00000000-0000-0000-0000-000000000010', 0, '\\x90', 1,
      'new-writer', 1, NULL, NULL, 0
    )
    ON CONFLICT (document_id) DO UPDATE SET
      at_seq = EXCLUDED.at_seq,
      snapshot = EXCLUDED.snapshot,
      encoding_version = EXCLUDED.encoding_version,
      writer_id = EXCLUDED.writer_id,
      writer_epoch = EXCLUDED.writer_epoch,
      base_at_seq = 999,
      base_writer_id = 'metadata-tamper',
      base_writer_epoch = 999,
      updated_at = TIMESTAMPTZ '2099-01-01 00:00:00+00';
    SELECT concat_ws(',',
      encode(snapshot, 'hex'),
      base_at_seq IS NULL,
      base_writer_id IS NULL,
      base_writer_epoch,
      updated_at < TIMESTAMPTZ '2099-01-01 00:00:00+00'
    )
    FROM public.annotation_snapshots
    WHERE document_id = '00000000-0000-0000-0000-000000000010'
  `).split('\n').at(-1), '90,t,t,0,t',
  'direct exact upsert is a full-row no-op, including base metadata and updated_at');
  const directAba = pg.sql(`
    DO $$ BEGIN PERFORM set_config('request.jwt.claim.sub', '${OWNER}', false); END $$;
    INSERT INTO public.annotation_snapshots (
      document_id, at_seq, snapshot, encoding_version,
      writer_id, writer_epoch, base_at_seq, base_writer_id, base_writer_epoch
    ) VALUES (
      '00000000-0000-0000-0000-000000000010', 0, '\\x91', 1,
      'new-writer', 1, 0, 'new-writer', 1
    )
    ON CONFLICT (document_id) DO UPDATE SET
      at_seq = EXCLUDED.at_seq,
      snapshot = EXCLUDED.snapshot,
      encoding_version = EXCLUDED.encoding_version,
      writer_id = EXCLUDED.writer_id,
      writer_epoch = EXCLUDED.writer_epoch,
      base_at_seq = EXCLUDED.base_at_seq,
      base_writer_id = EXCLUDED.base_writer_id,
      base_writer_epoch = EXCLUDED.base_writer_epoch
  `, false);
  assert.notEqual(directAba.status, 0);
  assert.match(directAba.stderr, /stale annotation snapshot replacement/);
  assert.equal(sql(`
    SELECT seq FROM public.append_annotation_update(
      '00000000-0000-0000-0000-000000000010', 'after-direct-snapshot', 1, '\\xa0'
    )
  `), '1');
  assert.equal(sql(`
    INSERT INTO public.annotation_snapshots (
      document_id, at_seq, snapshot, encoding_version,
      writer_id, writer_epoch, base_at_seq, base_writer_id, base_writer_epoch
    ) VALUES (
      '00000000-0000-0000-0000-000000000010', 0, '\\x90', 1,
      'new-writer', 1, NULL, NULL, 0
    )
    ON CONFLICT (document_id) DO UPDATE SET
      at_seq = EXCLUDED.at_seq,
      snapshot = EXCLUDED.snapshot,
      encoding_version = EXCLUDED.encoding_version,
      writer_id = EXCLUDED.writer_id,
      writer_epoch = EXCLUDED.writer_epoch,
      base_at_seq = annotation_snapshots.base_at_seq,
      base_writer_id = annotation_snapshots.base_writer_id,
      base_writer_epoch = annotation_snapshots.base_writer_epoch;
    SELECT encode(snapshot, 'hex')
    FROM public.annotation_snapshots
    WHERE document_id = '00000000-0000-0000-0000-000000000010'
  `).split('\n').at(-1), '90',
  'direct exact upsert remains recognizable after the WAL head advances');
  assert.equal(sql(`
    SELECT seq FROM public.append_annotation_update(
      '00000000-0000-0000-0000-000000000001', 'epoch-regression', 1, '\\xe7'
    )
  `), '7');
  assert.equal(sql(`
    SELECT public.store_annotation_snapshot(
      '00000000-0000-0000-0000-000000000001', 7, '\\xb7', 1,
      'snapshot-b', 10, 6, 'snapshot-b', 11
    )
  `), 'f', 'snapshot generation regression is rejected even at an advanced frontier');

  const directMissingBase = pg.sql(`
    DO $$ BEGIN PERFORM set_config('request.jwt.claim.sub', '${OWNER}', false); END $$;
    INSERT INTO public.annotation_snapshots (
      document_id, at_seq, snapshot, encoding_version,
      writer_id, writer_epoch, base_at_seq, base_writer_id, base_writer_epoch
    ) VALUES (
      '00000000-0000-0000-0000-000000000014', 0, '\\x14', 1,
      'direct-first', 1, 0, NULL, 0
    )
  `, false);
  assert.notEqual(directMissingBase.status, 0);
  assert.match(directMissingBase.stderr, /stale annotation snapshot absent base/);
  assert.equal(sql(`
    SELECT count(*) FROM public.annotation_snapshots
    WHERE document_id = '00000000-0000-0000-0000-000000000014'
  `), '0');

  assert.equal(sql(`
    SELECT public.store_annotation_snapshot(
      '00000000-0000-0000-0000-000000000014', 0, '\\xa1', 1,
      'writer-a', 1, NULL, NULL, 0
    )
  `), 't');
  assert.equal(sql(`
    SELECT public.store_annotation_snapshot(
      '00000000-0000-0000-0000-000000000014', 0, '\\xb2', 1,
      'writer-b', 2, 0, 'writer-a', 1
    )
  `), 't');
  assert.equal(sql(`
    SELECT public.store_annotation_snapshot(
      '00000000-0000-0000-0000-000000000014', 0, '\\xa1', 1,
      'writer-a', 1, 0, 'writer-b', 2
    )
  `), 'f', 'a writer cannot reuse an old full snapshot token after another writer');
  assert.equal(sql(`
    SELECT public.store_annotation_snapshot(
      '00000000-0000-0000-0000-000000000014', 0, '\\xa3', 1,
      'writer-a', 3, 0, 'writer-b', 2
    )
  `), 't');
  assert.equal(sql(`
    SELECT public.store_annotation_snapshot(
      '00000000-0000-0000-0000-000000000014', 0, '\\xc4', 1,
      'writer-c', 4, 0, 'writer-a', 1
    )
  `), 'f', 'a stale base cannot pass after the writer identity cycles back');

  assert.equal(sql(`
    SELECT public.store_annotation_snapshot(
      '00000000-0000-0000-0000-000000000015', 0, '\\x15', 1,
      'move-source', 1, NULL, NULL, 0
    )
  `), 't');
  const movedDocumentId = pg.sql(`
    DO $$ BEGIN PERFORM set_config('request.jwt.claim.sub', '${OWNER}', false); END $$;
    UPDATE public.annotation_snapshots
       SET document_id = '00000000-0000-0000-0000-000000000016'
     WHERE document_id = '00000000-0000-0000-0000-000000000015'
  `, false);
  assert.notEqual(movedDocumentId.status, 0);
  assert.match(movedDocumentId.stderr, /snapshot document identity cannot change/);
  assert.equal(sql(`
    SELECT concat_ws(',',
      count(*) FILTER (
        WHERE document_id = '00000000-0000-0000-0000-000000000015'
      ),
      count(*) FILTER (
        WHERE document_id = '00000000-0000-0000-0000-000000000016'
      )
    )
    FROM public.annotation_snapshots
  `), '1,0', 'direct UPDATE cannot move a snapshot across document lock domains');

  const heldSnapshotAdvisory = await hold('heldSnapshotAdvisory', `
    SELECT pg_advisory_xact_lock(
      hashtextextended('00000000-0000-0000-0000-000000000015', 0)
    );
  `);
  const directUpdateStartedAt = Date.now();
  const contendedDirectUpdate = pg.sql(`
    DO $$ BEGIN PERFORM set_config('request.jwt.claim.sub', '${OWNER}', false); END $$;
    UPDATE public.annotation_snapshots
       SET updated_at = now()
     WHERE document_id = '00000000-0000-0000-0000-000000000015'
  `, false);
  const directUpdateMs = Date.now() - directUpdateStartedAt;
  assert.notEqual(contendedDirectUpdate.status, 0);
  assert.match(contendedDirectUpdate.stderr, /annotation snapshot write contention/);
  assert.ok(directUpdateMs < 500,
    `direct UPDATE must fail instead of inverting the RPC lock order (${directUpdateMs}ms)`);
  assert.equal((await heldSnapshotAdvisory.finish()).status, 0);

  const owner = OWNER;
  const appendFirst = await hold('appendFirst', `
    SELECT seq FROM public.append_annotation_update(
      '00000000-0000-0000-0000-000000000003', 'append-first', 1, '\\x31'
    );
  `);
  const appendSecond = startSession('appendSecond', `
    SELECT seq FROM public.append_annotation_update(
      '00000000-0000-0000-0000-000000000003', 'append-second', 1, '\\x32'
    )
  `);
  await pg.blocked(appendSecond.name);
  const [appendFirstResult, appendSecondResult] = await Promise.all([appendFirst.finish(), appendSecond.finish()]);
  assert.equal(appendFirstResult.status, 0);
  assert.equal(appendSecondResult.status, 0);
  assert.match(appendFirstResult.stdout, /(^|\n)1(\n|$)/);
  assert.equal(appendSecondResult.stdout.trim(), '2');
  assert.equal(sql(`
    SELECT string_agg(seq::text || ':' || client_id, ',' ORDER BY seq)
    FROM public.annotation_updates
    WHERE document_id = '00000000-0000-0000-0000-000000000003'
  `), '1:append-first,2:append-second', 'same-document appends serialize in commit order');

  const idemFirst = await hold('idemFirst', `
    SELECT seq FROM public.append_annotation_update(
      '00000000-0000-0000-0000-000000000004', 'idem-writer', 1, '\\x41'
    );
  `);
  const idemSecond = startSession('idemSecond', `
    SELECT seq FROM public.append_annotation_update(
      '00000000-0000-0000-0000-000000000004', 'idem-writer', 1, '\\x41'
    )
  `);
  await pg.blocked(idemSecond.name);
  const [idemFirstResult, idemSecondResult] = await Promise.all([idemFirst.finish(), idemSecond.finish()]);
  assert.equal(idemFirstResult.status, 0);
  assert.equal(idemSecondResult.status, 0);
  assert.match(idemFirstResult.stdout, /(^|\n)1(\n|$)/);
  assert.equal(idemSecondResult.stdout.trim(), '1');
  assert.equal(sql(`
    SELECT count(*) FROM public.annotation_updates
    WHERE document_id = '00000000-0000-0000-0000-000000000004'
  `), '1', 'same idempotency-key race stores one row');

  const appendBeforeSnapshot = await hold('appendBeforeSnapshot', `
    SELECT seq FROM public.append_annotation_update(
      '00000000-0000-0000-0000-000000000005', 'frontier-writer', 1, '\\x51'
    );
  `);
  const staleSnapshot = startSession('staleSnapshot', `
    SELECT public.store_annotation_snapshot(
      '00000000-0000-0000-0000-000000000005', 0, '\\x50', 1,
      'snapshot-writer', 1, NULL, NULL, 0
    )
  `);
  await pg.blocked(staleSnapshot.name);
  const [appendBeforeSnapshotResult, staleSnapshotResult] = await Promise.all([appendBeforeSnapshot.finish(), staleSnapshot.finish()]);
  assert.equal(appendBeforeSnapshotResult.status, 0);
  assert.equal(staleSnapshotResult.status, 0);
  assert.equal(staleSnapshotResult.stdout.trim(), 'f');
  assert.equal(sql(`
    SELECT count(*) FROM public.annotation_snapshots
    WHERE document_id = '00000000-0000-0000-0000-000000000005'
  `), '0', 'stale-frontier snapshot loses to a committed append');

  const finalizingSnapshotDoc = await hold('finalizingSnapshotDoc', `
    SELECT set_config('request.jwt.claim.sub', '${owner}', false);
    SELECT (public.kal49_lock_document(
      '00000000-0000-0000-0000-000000000006', 'final'
    )).locked_at IS NOT NULL;
  `);
  const snapshotDuringFinalization = startSession('snapshotDuringFinalization', `
    SELECT public.store_annotation_snapshot(
      '00000000-0000-0000-0000-000000000006', 0, '\\x61', 1,
      'snapshot-writer', 1, NULL, NULL, 0
    )
  `);
  await pg.blocked(snapshotDuringFinalization.name);
  const [finalizationSnapshotResult, snapshotFinalizationResult] = await Promise.all([finalizingSnapshotDoc.finish(), snapshotDuringFinalization.finish()]);
  assert.equal(finalizationSnapshotResult.status, 0);
  assert.notEqual(snapshotFinalizationResult.status, 0);
  assert.match(snapshotFinalizationResult.stderr, /annotation snapshot write is not permitted/);
  assert.equal(sql(`
    SELECT count(*) FROM public.annotation_snapshots
    WHERE document_id = '00000000-0000-0000-0000-000000000006'
  `), '0', 'snapshot cannot commit after finalization');

  const heldDocument = await hold('heldDocument', `
    SELECT seq FROM public.append_annotation_update(
      '00000000-0000-0000-0000-000000000007', 'held-writer', 1, '\\x71'
    );
  `);
  const differentDocumentStartedAt = Date.now();
  const independentSession = startSession('differentDocument', `
    SELECT seq FROM public.append_annotation_update(
      '00000000-0000-0000-0000-000000000008', 'free-writer', 1, '\\x81'
    )
  `);
  const differentDocument = await independentSession.finish();
  const differentDocumentMs = Date.now() - differentDocumentStartedAt;
  assert.equal(differentDocument.status, 0);
  assert.equal(differentDocument.stdout.trim(), '1');
  assert.ok(differentDocumentMs < 700, `different document must not block (${differentDocumentMs}ms)`);
  assert.equal((await heldDocument.finish()).status, 0);

  const receiptBeforeFinalization = await hold('receiptBeforeFinalization', `
    SELECT seq FROM public.append_annotation_update(
      '00000000-0000-0000-0000-000000000013', 'accepted-before-lock', 1, '\\xd1'
    );
    UPDATE public.documents
       SET locked_at = now(), locked_by = '${OWNER}'
     WHERE id = '00000000-0000-0000-0000-000000000013';
  `);
  const waitingExactRetry = startSession('waitingExactRetry', `
    SELECT seq FROM public.append_annotation_update(
      '00000000-0000-0000-0000-000000000013', 'accepted-before-lock', 1, '\\xd1'
    )
  `);
  await pg.blocked(waitingExactRetry.name);
  const [receiptCommit, exactAfterFinalization] = await Promise.all([receiptBeforeFinalization.finish(), waitingExactRetry.finish()]);
  assert.equal(receiptCommit.status, 0);
  assert.equal(exactAfterFinalization.status, 0);
  assert.equal(exactAfterFinalization.stdout.trim(), '1',
    'under-lock re-read recognizes the same-actor receipt accepted before finalization');

  const locking = await hold('locking', `
    SELECT set_config('request.jwt.claim.sub', '${owner}', false);
    SELECT (public.kal49_lock_document(
      '00000000-0000-0000-0000-000000000002', 'final'
    )).locked_at IS NOT NULL;
  `);
  const racedWrite = startSession('racedWrite', `
    SELECT seq FROM public.append_annotation_update(
      '00000000-0000-0000-0000-000000000002', 'late-writer', 1, '\\xdd'
    )
  `);
  await pg.blocked(racedWrite.name);
  const [lockResult, writeResult] = await Promise.all([locking.finish(), racedWrite.finish()]);
  assert.equal(lockResult.status, 0);
  assert.notEqual(writeResult.status, 0, 'write waiting behind finalization is rejected');
  assert.match(writeResult.stderr, /annotation write is not permitted/);
  assert.equal(sql(`
    SELECT count(*) FROM public.annotation_updates
    WHERE document_id = '00000000-0000-0000-0000-000000000002'
      AND client_id = 'late-writer'
  `), '0');

  const heldUnauthorizedDoc = await hold('heldUnauthorizedDoc', `
    SELECT pg_advisory_xact_lock(
      hashtextextended('00000000-0000-0000-0000-000000000010', 0)
    );
  `);
  const deniedCalls = [
    `
      SELECT seq FROM public.append_annotation_update(
        '00000000-0000-0000-0000-000000000010', 'anon', 1, '\\xa1'
      )
    `,
    `
      DO $$ BEGIN
        PERFORM set_config(
          'request.jwt.claim.sub',
          '20000000-0000-0000-0000-000000000002',
          false
        );
        PERFORM set_config('test.annotation_access', 'false', false);
      END $$;
      SELECT public.store_annotation_snapshot(
        '00000000-0000-0000-0000-000000000010', 0, '\\xa2', 1,
        'viewer', 1, NULL, NULL, 0
      )
    `,
    `
      DO $$ BEGIN
        PERFORM set_config(
          'request.jwt.claim.sub',
          '20000000-0000-0000-0000-000000000002',
          false
        );
      END $$;
      SELECT (public.kal49_lock_document(
        '00000000-0000-0000-0000-000000000010', 'not-owner'
      )).id
    `,
  ];
  for (const deniedSource of deniedCalls) {
    const startedAt = Date.now();
    const denied = pg.sql(deniedSource, false);
    const elapsed = Date.now() - startedAt;
    assert.notEqual(denied.status, 0);
    assert.match(denied.stderr, /not permitted/);
    assert.ok(elapsed < 700, `unauthorized call must fail before advisory lock (${elapsed}ms)`);
  }
  assert.equal((await heldUnauthorizedDoc.finish()).status, 0);

  console.log(JSON.stringify({
    postgres: 'pass',
    documentLocalSequences: seqs,
    rollbackNextSequence: 3,
    snapshotCas: 'pass',
    finalizationRace: 'pass',
    concurrentAppendOrder: 'pass',
    concurrentIdempotency: 'pass',
    appendVsSnapshot: 'pass',
    snapshotVsFinalization: 'pass',
    directSnapshotUpdateContention: { status: 'pass', directUpdateMs },
    differentDocumentMs,
    unauthorizedPreLock: 'pass',
    accessControl: 'stubbed-locking-proof-only',
  }));
}, { name: 'annotation-wal' });
console.log('Disposable annotation WAL PostgreSQL stopped; exact temporary cluster removed.');
