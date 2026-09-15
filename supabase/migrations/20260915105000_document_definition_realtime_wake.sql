BEGIN;

-- Documents are already the app's Realtime wake surface. Keep the private
-- definition tables private and touch only the exact document whose accepted
-- head changed. All current head writers lock public.documents first, so this
-- nested update keeps the existing document-before-definition lock order.
CREATE OR REPLACE FUNCTION survey_private.wake_document_definition_head_change()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET TimeZone = 'UTC'
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.current_revision IS NOT DISTINCT FROM OLD.current_revision
     AND NEW.current_digest IS NOT DISTINCT FROM OLD.current_digest THEN
    RETURN NULL;
  END IF;

  UPDATE public.documents
    SET updated_at = clock_timestamp()
    WHERE id = NEW.document_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Document definition wake target is missing'
      USING ERRCODE = '23503';
  END IF;
  RETURN NULL;
END;
$$;

ALTER FUNCTION survey_private.wake_document_definition_head_change() OWNER TO postgres;
REVOKE ALL ON FUNCTION survey_private.wake_document_definition_head_change()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER document_definition_head_realtime_wake
AFTER INSERT OR UPDATE OF current_revision, current_digest
ON survey_private.document_definition_revision_heads
FOR EACH ROW
EXECUTE FUNCTION survey_private.wake_document_definition_head_change();

COMMIT;
