-- Make annotation WAL ordering and snapshot replacement explicit.
--
-- WAL sequence numbers are document-local and allocated under the document
-- advisory lock. New writes are contiguous per document across rollback and
-- unrelated-document traffic. Pre-migration identity gaps are preserved; all
-- readers use ordered rows/frontiers and do not require historical +1 spacing.

BEGIN;

ALTER TABLE public.annotation_snapshots
  ADD COLUMN IF NOT EXISTS writer_id TEXT,
  ADD COLUMN IF NOT EXISTS writer_epoch BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS base_at_seq BIGINT,
  ADD COLUMN IF NOT EXISTS base_writer_id TEXT,
  ADD COLUMN IF NOT EXISTS base_writer_epoch BIGINT NOT NULL DEFAULT 0;

ALTER TABLE public.annotation_updates
  ADD COLUMN IF NOT EXISTS actor_user_id UUID;

-- Identity defaults run before BEFORE INSERT triggers and consume a value even
-- when the trigger replaces it. Remove identity entirely: the trigger assigns
-- max(document seq)+1 while holding the same document lock used by finalization.
ALTER TABLE public.annotation_updates
  ALTER COLUMN seq DROP IDENTITY IF EXISTS,
  ALTER COLUMN seq DROP DEFAULT;
ALTER TABLE public.annotation_updates
  DROP CONSTRAINT IF EXISTS annotation_updates_pkey;
ALTER TABLE public.annotation_updates
  ADD CONSTRAINT annotation_updates_pkey PRIMARY KEY (document_id, seq);

CREATE OR REPLACE FUNCTION public.serialize_annotation_update_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller UUID := auth.uid();
BEGIN
  -- Fail uniformly before lock/WAL/lock-state inspection so this definer
  -- trigger cannot expose document state to viewers or strangers.
  IF caller IS NULL
     OR NOT public.user_can_access_document(NEW.document_id, 'editor')
     OR public.kal49_document_is_locked(NEW.document_id) THEN
    RAISE EXCEPTION 'annotation write is not permitted'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.document_id::text, 0));
  IF NOT public.user_can_access_document(NEW.document_id, 'editor')
     OR public.kal49_document_is_locked(NEW.document_id) THEN
    RAISE EXCEPTION 'annotation write is not permitted'
      USING ERRCODE = '42501';
  END IF;
  NEW.actor_user_id := caller;
  SELECT COALESCE(MAX(au.seq), 0) + 1
    INTO NEW.seq
    FROM public.annotation_updates AS au
   WHERE au.document_id = NEW.document_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS annotation_updates_serialize_insert
  ON public.annotation_updates;
CREATE TRIGGER annotation_updates_serialize_insert
  BEFORE INSERT ON public.annotation_updates
  FOR EACH ROW EXECUTE FUNCTION public.serialize_annotation_update_insert();

-- Guard legacy direct snapshot upserts with the same rules as the RPC. Every
-- non-idempotent replacement consumes a strictly newer document-wide snapshot
-- generation; an old client therefore fails visibly instead of reusing an ABA
-- token or claiming that a risky fallback snapshot was saved.
CREATE OR REPLACE FUNCTION public.guard_annotation_snapshot_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  wal_head BIGINT;
  existing_snapshot public.annotation_snapshots%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.document_id IS DISTINCT FROM NEW.document_id THEN
    RAISE EXCEPTION 'annotation snapshot document identity cannot change'
      USING ERRCODE = '40001';
  END IF;

  IF auth.uid() IS NULL
     OR NOT public.user_can_access_document(NEW.document_id, 'editor')
     OR public.kal49_document_is_locked(NEW.document_id) THEN
    RAISE EXCEPTION 'annotation snapshot write is not permitted'
      USING ERRCODE = '42501';
  END IF;

  -- UPDATE row locks are taken before a BEFORE UPDATE trigger runs. Never wait
  -- on the advisory lock from that state: an RPC may already hold the advisory
  -- lock while waiting for this row, which would invert the lock order. A
  -- serialization failure is retryable and releases the tuple lock immediately.
  IF TG_OP = 'UPDATE' THEN
    IF NOT pg_try_advisory_xact_lock(hashtextextended(NEW.document_id::text, 0)) THEN
      RAISE EXCEPTION 'annotation snapshot write contention'
        USING ERRCODE = '40001';
    END IF;
  ELSE
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.document_id::text, 0));
  END IF;
  IF NOT public.user_can_access_document(NEW.document_id, 'editor')
     OR public.kal49_document_is_locked(NEW.document_id) THEN
    RAISE EXCEPTION 'annotation snapshot write is not permitted'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT *
      INTO existing_snapshot
      FROM public.annotation_snapshots
     WHERE document_id = NEW.document_id;
    IF FOUND
       AND existing_snapshot.at_seq = NEW.at_seq
       AND existing_snapshot.snapshot = NEW.snapshot
       AND existing_snapshot.encoding_version = NEW.encoding_version
       AND existing_snapshot.writer_id IS NOT DISTINCT FROM NEW.writer_id
       AND existing_snapshot.writer_epoch = NEW.writer_epoch THEN
      -- INSERT ... ON CONFLICT retries pass through the INSERT trigger before
      -- PostgreSQL invokes the UPDATE trigger. Recognize the exact immutable
      -- version here so a later WAL row cannot make a lost-response retry fail.
      RETURN NEW;
    END IF;
    IF NOT FOUND
       AND (
         NEW.base_at_seq IS NOT NULL
         OR NEW.base_writer_id IS NOT NULL
         OR NEW.base_writer_epoch <> 0
         OR NEW.writer_epoch <= 0
       ) THEN
      RAISE EXCEPTION 'stale annotation snapshot absent base'
        USING ERRCODE = '40001';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- A lost RPC response may retry the exact already-stored version.
    IF OLD.at_seq = NEW.at_seq
       AND OLD.snapshot = NEW.snapshot
       AND OLD.encoding_version = NEW.encoding_version
       AND OLD.writer_id IS NOT DISTINCT FROM NEW.writer_id
       AND OLD.writer_epoch = NEW.writer_epoch THEN
      -- Exact lost-response retries are full-row no-ops. In particular, do not
      -- allow base-version metadata or updated_at to drift under an unchanged
      -- immutable snapshot identity.
      RETURN OLD;
    END IF;
  END IF;

  SELECT COALESCE(MAX(au.seq), 0)
    INTO wal_head
    FROM public.annotation_updates AS au
   WHERE au.document_id = NEW.document_id;

  IF wal_head <> NEW.at_seq THEN
    RAISE EXCEPTION 'stale annotation snapshot frontier'
      USING ERRCODE = '40001';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Every replacement, including one that advances the WAL frontier, must
    -- compare the full snapshot version the caller actually loaded.
    IF OLD.at_seq IS DISTINCT FROM NEW.base_at_seq
       OR OLD.writer_id IS DISTINCT FROM NEW.base_writer_id
       OR OLD.writer_epoch IS DISTINCT FROM NEW.base_writer_epoch
       OR OLD.at_seq > NEW.at_seq
       OR OLD.writer_epoch >= NEW.writer_epoch THEN
      RAISE EXCEPTION 'stale annotation snapshot replacement'
        USING ERRCODE = '40001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Finalization participates in the same lock order as WAL and snapshots:
-- unauthenticated rejection first, then advisory lock and current ownership.
CREATE OR REPLACE FUNCTION public.kal49_lock_document(
  doc_id UUID,
  label TEXT DEFAULT NULL
)
RETURNS public.documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller UUID := auth.uid();
  owner_id UUID;
  updated public.documents;
BEGIN
  SELECT user_id INTO owner_id FROM public.documents WHERE id = doc_id;
  IF caller IS NULL OR owner_id IS DISTINCT FROM caller THEN
    RAISE EXCEPTION 'kal49_lock_document: operation is not permitted'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(doc_id::text, 0));

  SELECT user_id INTO owner_id FROM public.documents WHERE id = doc_id;
  IF owner_id IS DISTINCT FROM caller THEN
    RAISE EXCEPTION 'kal49_lock_document: operation is not permitted'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.documents
     SET locked_at = COALESCE(locked_at, NOW()),
         locked_by = COALESCE(locked_by, caller),
         locked_label = CASE WHEN label IS NULL THEN locked_label ELSE label END
   WHERE id = doc_id
   RETURNING * INTO updated;

  RETURN updated;
END;
$$;

DROP TRIGGER IF EXISTS annotation_snapshots_guard_write
  ON public.annotation_snapshots;
CREATE TRIGGER annotation_snapshots_guard_write
  BEFORE INSERT OR UPDATE ON public.annotation_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.guard_annotation_snapshot_write();

CREATE OR REPLACE FUNCTION public.append_annotation_update(
  p_document_id UUID,
  p_client_id TEXT,
  p_client_seq BIGINT,
  p_data BYTEA
)
RETURNS TABLE(seq BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_seq BIGINT;
  existing_data BYTEA;
  existing_actor UUID;
  caller UUID := auth.uid();
  receipt_found BOOLEAN := FALSE;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'annotation write is not permitted'
      USING ERRCODE = '42501';
  END IF;

  -- Immutable actor-bound receipts can disambiguate a lost response without
  -- contending the document lock, even after current editor access is revoked.
  SELECT au.seq, au.data, au.actor_user_id
    INTO existing_seq, existing_data, existing_actor
    FROM public.annotation_updates AS au
   WHERE au.document_id = p_document_id
     AND au.client_id = p_client_id
     AND au.client_seq = p_client_seq;
  receipt_found := FOUND;

  IF receipt_found AND existing_actor IS NOT NULL THEN
    IF existing_actor IS DISTINCT FROM caller THEN
      RAISE EXCEPTION 'annotation write is not permitted'
        USING ERRCODE = '42501';
    END IF;
    IF existing_data IS DISTINCT FROM p_data THEN
      RAISE EXCEPTION 'client sequence collision with different annotation payload'
        USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT existing_seq;
    RETURN;
  END IF;

  -- Missing and legacy actorless receipts require current editor access and an
  -- unlocked document before they may contend the per-document lock.
  IF NOT public.user_can_access_document(p_document_id, 'editor')
     OR public.kal49_document_is_locked(p_document_id) THEN
    RAISE EXCEPTION 'annotation write is not permitted'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_document_id::text, 0));

  -- Re-read under the lock: another first attempt may have committed between
  -- the pre-read and lock acquisition.
  SELECT au.seq, au.data, au.actor_user_id
    INTO existing_seq, existing_data, existing_actor
    FROM public.annotation_updates AS au
   WHERE au.document_id = p_document_id
     AND au.client_id = p_client_id
     AND au.client_seq = p_client_seq;

  IF FOUND THEN
    IF existing_actor IS NOT NULL THEN
      IF existing_actor IS DISTINCT FROM caller THEN
        RAISE EXCEPTION 'annotation write is not permitted'
          USING ERRCODE = '42501';
      END IF;
      IF existing_data IS DISTINCT FROM p_data THEN
        RAISE EXCEPTION 'client sequence collision with different annotation payload'
          USING ERRCODE = '23505';
      END IF;
      -- A same-actor receipt may have committed while this caller waited for
      -- the lock. It is immutable proof of the exact lost response, so a
      -- concurrent role revocation cannot make that accepted write ambiguous.
      RETURN QUERY SELECT existing_seq;
      RETURN;
    END IF;

    -- Actorless pre-migration receipts have no ownership proof. They remain
    -- confirmable only by a current editor on an unlocked document and are
    -- deliberately never claimed by the caller.
    IF NOT public.user_can_access_document(p_document_id, 'editor')
       OR public.kal49_document_is_locked(p_document_id) THEN
      RAISE EXCEPTION 'annotation write is not permitted'
        USING ERRCODE = '42501';
    END IF;
    IF existing_data IS DISTINCT FROM p_data THEN
      RAISE EXCEPTION 'client sequence collision with different annotation payload'
        USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT existing_seq;
    RETURN;
  END IF;

  IF NOT public.user_can_access_document(p_document_id, 'editor')
     OR public.kal49_document_is_locked(p_document_id) THEN
    RAISE EXCEPTION 'annotation write is not permitted'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    INSERT INTO public.annotation_updates (
      document_id,
      client_id,
      client_seq,
      actor_user_id,
      data
    )
    VALUES (
      p_document_id,
      p_client_id,
      p_client_seq,
      caller,
      p_data
    )
    RETURNING annotation_updates.seq;
END;
$$;

DROP FUNCTION IF EXISTS public.store_annotation_snapshot(
  UUID, BIGINT, BYTEA, INT, TEXT, BIGINT
);
DROP FUNCTION IF EXISTS public.store_annotation_snapshot(
  UUID, BIGINT, BYTEA, INT, TEXT, BIGINT, TEXT, BIGINT
);
CREATE OR REPLACE FUNCTION public.store_annotation_snapshot(
  p_document_id UUID,
  p_at_seq BIGINT,
  p_snapshot BYTEA,
  p_encoding_version INT,
  p_writer_id TEXT,
  p_writer_epoch BIGINT,
  p_expected_at_seq BIGINT,
  p_expected_writer_id TEXT,
  p_expected_writer_epoch BIGINT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  wal_head BIGINT;
  current_snapshot public.annotation_snapshots%ROWTYPE;
  caller UUID := auth.uid();
  snapshot_found BOOLEAN := FALSE;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'annotation snapshot write is not permitted'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.user_can_access_document(p_document_id, 'editor')
     OR public.kal49_document_is_locked(p_document_id) THEN
    RAISE EXCEPTION 'annotation snapshot write is not permitted'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_document_id::text, 0));

  IF NOT public.user_can_access_document(p_document_id, 'editor')
     OR public.kal49_document_is_locked(p_document_id) THEN
    RAISE EXCEPTION 'annotation snapshot write is not permitted'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO current_snapshot
    FROM public.annotation_snapshots
   WHERE document_id = p_document_id
   FOR UPDATE;
  snapshot_found := FOUND;

  IF snapshot_found THEN
    -- Exact retry after a lost response is idempotent, not a replacement. It
    -- remains recognizable after later WAL rows advance the head, while the
    -- caller is still authorized and the document remains unlocked.
    IF current_snapshot.at_seq = p_at_seq
       AND current_snapshot.snapshot = p_snapshot
       AND current_snapshot.encoding_version = p_encoding_version
       AND current_snapshot.writer_id IS NOT DISTINCT FROM p_writer_id
       AND current_snapshot.writer_epoch = p_writer_epoch THEN
      RETURN TRUE;
    END IF;
  END IF;

  SELECT COALESCE(MAX(au.seq), 0)
    INTO wal_head
    FROM public.annotation_updates AS au
   WHERE au.document_id = p_document_id;

  -- New bytes cannot claim a frontier behind a committed WAL row they may not
  -- contain. The caller catches up and retries with a fresh checkpoint.
  IF wal_head <> p_at_seq THEN
    RETURN FALSE;
  END IF;

  IF snapshot_found THEN
    IF current_snapshot.at_seq IS DISTINCT FROM p_expected_at_seq
       OR current_snapshot.writer_id IS DISTINCT FROM p_expected_writer_id
       OR current_snapshot.writer_epoch IS DISTINCT FROM p_expected_writer_epoch
       OR current_snapshot.at_seq > p_at_seq
       OR current_snapshot.writer_epoch >= p_writer_epoch THEN
      RETURN FALSE;
    END IF;

    UPDATE public.annotation_snapshots
       SET at_seq = p_at_seq,
           snapshot = p_snapshot,
           encoding_version = p_encoding_version,
           writer_id = p_writer_id,
           writer_epoch = p_writer_epoch,
           base_at_seq = p_expected_at_seq,
           base_writer_id = p_expected_writer_id,
           base_writer_epoch = p_expected_writer_epoch,
           updated_at = now()
     WHERE document_id = p_document_id;
  ELSE
    IF p_expected_at_seq IS NOT NULL
       OR p_expected_writer_id IS NOT NULL
       OR p_expected_writer_epoch <> 0
       OR p_writer_epoch <= 0 THEN
      RETURN FALSE;
    END IF;

    INSERT INTO public.annotation_snapshots (
      document_id,
      at_seq,
      snapshot,
      encoding_version,
      writer_id,
      writer_epoch,
      base_at_seq,
      base_writer_id,
      base_writer_epoch,
      updated_at
    )
    VALUES (
      p_document_id,
      p_at_seq,
      p_snapshot,
      p_encoding_version,
      p_writer_id,
      p_writer_epoch,
      p_expected_at_seq,
      p_expected_writer_id,
      p_expected_writer_epoch,
      now()
    );
  END IF;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.append_annotation_update(UUID, TEXT, BIGINT, BYTEA)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.store_annotation_snapshot(UUID, BIGINT, BYTEA, INT, TEXT, BIGINT, BIGINT, TEXT, BIGINT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.serialize_annotation_update_insert()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_annotation_snapshot_write()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.kal49_lock_document(UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
-- The WAL is append-only. Explicit table revokes make immutable actor-bound
-- receipts trustworthy even if a platform-wide table grant changes later.
-- Document deletion still cleans rows through the owner-run FK cascade.
REVOKE UPDATE, DELETE ON TABLE public.annotation_updates
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.append_annotation_update(UUID, TEXT, BIGINT, BYTEA)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.store_annotation_snapshot(UUID, BIGINT, BYTEA, INT, TEXT, BIGINT, BIGINT, TEXT, BIGINT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.kal49_lock_document(UUID, TEXT)
  TO authenticated, service_role;

COMMIT;
