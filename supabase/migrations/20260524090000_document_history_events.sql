-- Document Version History activity events
--
-- Lightweight append-only edit timeline. Full restoreable snapshots stay in
-- document_revisions; this table stores compact, human-readable activity rows
-- for every undoable logical edit.

CREATE TABLE IF NOT EXISTS public.document_history_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    client_event_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    source TEXT,
    page_number INTEGER,
    annotation_id TEXT,
    summary TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_undoable BOOLEAN NOT NULL DEFAULT TRUE,
    is_checkpoint BOOLEAN NOT NULL DEFAULT FALSE,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (document_id, client_event_id)
);

CREATE INDEX IF NOT EXISTS idx_document_history_events_document_time
    ON public.document_history_events(document_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_document_history_events_document_page_time
    ON public.document_history_events(document_id, page_number, occurred_at DESC)
    WHERE page_number IS NOT NULL;

ALTER TABLE public.document_history_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Collaborators can view document history events"
    ON public.document_history_events;
CREATE POLICY "Collaborators can view document history events"
    ON public.document_history_events FOR SELECT
    USING (public.user_can_access_document(document_id, 'viewer'));

DROP POLICY IF EXISTS "Editors can create own document history events"
    ON public.document_history_events;
CREATE POLICY "Editors can create own document history events"
    ON public.document_history_events FOR INSERT
    WITH CHECK (
        public.user_can_access_document(document_id, 'editor')
        AND (auth.uid() = user_id OR user_id IS NULL)
    );

DROP POLICY IF EXISTS "Document owners can delete document history events"
    ON public.document_history_events;
CREATE POLICY "Document owners can delete document history events"
    ON public.document_history_events FOR DELETE
    USING (public.user_can_access_document(document_id, 'owner'));

DO $publication$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'document_history_events'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.document_history_events;
    END IF;
  END IF;
END
$publication$;

COMMENT ON TABLE public.document_history_events IS
  'Append-only lightweight activity timeline for Version History. Full restore snapshots live in document_revisions.';
