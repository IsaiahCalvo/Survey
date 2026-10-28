-- 2026-10-28: a rename shows on every screen at once.
--
-- When a document's name changes, the database posts { id, name, updated_at }
-- on a PRIVATE Realtime Broadcast topic per person, `doc-names:<user uuid>`,
-- to everyone who can open the document: its owner, its active collaborators,
-- the active collaborators of its project and the project's owner (the same
-- people user_can_access_document lets in). The app listens on its own topic
-- (src/services/documentNameRealtime.js) and renames every open tab and list.
--
-- Only name changes send (WHEN OLD.name IS DISTINCT FROM NEW.name), so the
-- frequent marker bumps on documents (annotations_changed_at, thumbnails,
-- last_opened_at) cost nothing here. A failed send never fails the rename.

CREATE OR REPLACE FUNCTION public.broadcast_document_rename()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  payload jsonb;
  recipient uuid;
BEGIN
  payload := jsonb_build_object(
    'id', NEW.id,
    'name', NEW.name,
    'updated_at', NEW.updated_at
  );
  FOR recipient IN
    SELECT NEW.user_id
    UNION
    SELECT dc.user_id FROM public.document_collaborators dc
     WHERE dc.document_id = NEW.id AND dc.status = 'active'
    UNION
    SELECT pc.user_id FROM public.project_collaborators pc
     WHERE NEW.project_id IS NOT NULL AND pc.project_id = NEW.project_id AND pc.status = 'active'
    UNION
    SELECT p.user_id FROM public.projects p
     WHERE NEW.project_id IS NOT NULL AND p.id = NEW.project_id
  LOOP
    CONTINUE WHEN recipient IS NULL;
    PERFORM realtime.send(payload, 'document_renamed', 'doc-names:' || recipient::text, true);
  END LOOP;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- The rename is what matters; other screens still catch up on their next read.
  RAISE WARNING 'broadcast_document_rename failed: %', SQLERRM;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.broadcast_document_rename() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_documents_broadcast_rename ON public.documents;
CREATE TRIGGER trg_documents_broadcast_rename
  AFTER UPDATE OF name ON public.documents
  FOR EACH ROW
  WHEN (OLD.name IS DISTINCT FROM NEW.name)
  EXECUTE FUNCTION public.broadcast_document_rename();

-- Receive only: a person may join their own topic. Nobody sends from the app.
DROP POLICY IF EXISTS doc_names_receive ON realtime.messages;
CREATE POLICY doc_names_receive ON realtime.messages
  FOR SELECT TO authenticated
  USING (
    realtime.messages.extension = 'broadcast'
    AND realtime.topic() = 'doc-names:' || (SELECT auth.uid())::text
  );
