-- Rebuild: Yjs Y.Doc as the single source of truth for annotations.
-- Google-Docs/Figma persistence shape — an append-only op log (the durable WAL,
-- written before broadcast) plus a periodic compacted snapshot for fast open.
-- Plus content-addressed document identity so the same bytes never spawn a
-- duplicate/blank document.
--
-- This is a clean cutover (pre-launch app, no data migration required): the old
-- per-row document_annotations table and the doc_yjs_state gzip cache stay in
-- place for now and are removed in a later step once the new path is proven.

-- ---------------------------------------------------------------------------
-- 1. annotation_updates — append-only Yjs op log (the durable WAL).
--    Every Y.Doc mutation is inserted here as a binary delta BEFORE broadcast.
--    UNIQUE(document_id, client_id, client_seq) makes reconnect re-sends no-ops
--    (at-least-once delivery becomes effectively-once).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.annotation_updates (
  seq          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id  UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  client_id    TEXT NOT NULL,
  client_seq   BIGINT NOT NULL,
  data         BYTEA NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, client_id, client_seq)
);

-- Open path replays ops in seq order after the snapshot; this index serves it.
CREATE INDEX IF NOT EXISTS annotation_updates_doc_seq_idx
  ON public.annotation_updates (document_id, seq);

-- ---------------------------------------------------------------------------
-- 2. annotation_snapshots — one latest compacted Yjs snapshot per document.
--    Y.encodeStateAsUpdate(doc) so open = applyUpdate(snapshot) + tail ops.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.annotation_snapshots (
  document_id      UUID PRIMARY KEY REFERENCES public.documents(id) ON DELETE CASCADE,
  at_seq           BIGINT NOT NULL DEFAULT 0,
  snapshot         BYTEA NOT NULL,
  encoding_version INT NOT NULL DEFAULT 1,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 3. Content-addressed document identity + durable embedded-import marker.
--    content_sha256 = SHA-256 of the PDF bytes. Dedup is enforced by the DB,
--    not the client. embedded_import_completed_at makes "import embedded marks
--    exactly once" a durable per-document fact, not a per-mount React ref.
-- ---------------------------------------------------------------------------
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS content_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS embedded_import_completed_at TIMESTAMPTZ;

-- Same bytes in the same (user, project) = one document. project_id is nullable,
-- so coalesce to a fixed nil uuid to keep project-less docs deduped too.
CREATE UNIQUE INDEX IF NOT EXISTS documents_user_project_sha_uidx
  ON public.documents (
    user_id,
    COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid),
    content_sha256
  )
  WHERE content_sha256 IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. RLS — mirror document_annotations: viewer can read, editor can write.
--    annotation_updates is append-only (select + insert, no update/delete;
--    cleanup happens via ON DELETE CASCADE from documents).
-- ---------------------------------------------------------------------------
ALTER TABLE public.annotation_updates  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.annotation_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS annotation_updates_select ON public.annotation_updates;
DROP POLICY IF EXISTS annotation_updates_insert ON public.annotation_updates;
CREATE POLICY annotation_updates_select ON public.annotation_updates
  FOR SELECT USING (public.user_can_access_document(document_id, 'viewer'));
CREATE POLICY annotation_updates_insert ON public.annotation_updates
  FOR INSERT WITH CHECK (public.user_can_access_document(document_id, 'editor'));

DROP POLICY IF EXISTS annotation_snapshots_select ON public.annotation_snapshots;
DROP POLICY IF EXISTS annotation_snapshots_insert ON public.annotation_snapshots;
DROP POLICY IF EXISTS annotation_snapshots_update ON public.annotation_snapshots;
CREATE POLICY annotation_snapshots_select ON public.annotation_snapshots
  FOR SELECT USING (public.user_can_access_document(document_id, 'viewer'));
CREATE POLICY annotation_snapshots_insert ON public.annotation_snapshots
  FOR INSERT WITH CHECK (public.user_can_access_document(document_id, 'editor'));
CREATE POLICY annotation_snapshots_update ON public.annotation_snapshots
  FOR UPDATE USING (public.user_can_access_document(document_id, 'editor'))
  WITH CHECK (public.user_can_access_document(document_id, 'editor'));

-- ---------------------------------------------------------------------------
-- 5. Live multi-device: broadcast op-log inserts over Supabase Realtime so a
--    second device/tab catches up without a dedicated sync server (Pass 1.5).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.annotation_updates;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END IF;
END $$;
