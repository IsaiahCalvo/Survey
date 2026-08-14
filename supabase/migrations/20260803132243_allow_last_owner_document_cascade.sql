-- Allow document_collaborators rows to follow their parent document's
-- ON DELETE CASCADE while preserving the direct last-owner guard.

BEGIN;

CREATE OR REPLACE FUNCTION public.kal31_guard_last_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    remaining_owners INT;
    target_doc UUID;
    affected_old_role TEXT;
BEGIN
    -- We only block when an existing owner is being demoted or removed.
    IF (TG_OP = 'UPDATE') THEN
        affected_old_role := OLD.role;
        target_doc := OLD.document_id;
        IF affected_old_role = 'owner' AND NEW.role <> 'owner' THEN
            SELECT COUNT(*) INTO remaining_owners
              FROM public.document_collaborators
             WHERE document_id = target_doc
               AND role = 'owner'
               AND status = 'active'
               AND user_id <> OLD.user_id;
            IF remaining_owners < 1 THEN
                RAISE EXCEPTION 'kal31_guard_last_owner: at least one owner must remain on document %', target_doc
                    USING ERRCODE = 'check_violation';
            END IF;
        END IF;
    ELSIF (TG_OP = 'DELETE') THEN
        affected_old_role := OLD.role;
        target_doc := OLD.document_id;

        -- The parent is already absent when its FK action cascades this delete.
        -- No ownership invariant remains to protect once the document is gone.
        IF NOT EXISTS (
            SELECT 1
              FROM public.documents
             WHERE id = target_doc
        ) THEN
            RETURN OLD;
        END IF;

        IF affected_old_role = 'owner' THEN
            SELECT COUNT(*) INTO remaining_owners
              FROM public.document_collaborators
             WHERE document_id = target_doc
               AND role = 'owner'
               AND status = 'active'
               AND user_id <> OLD.user_id;
            IF remaining_owners < 1 THEN
                RAISE EXCEPTION 'kal31_guard_last_owner: cannot remove last owner of document %', target_doc
                    USING ERRCODE = 'check_violation';
            END IF;
        END IF;
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION public.kal31_guard_last_owner() IS
  'KAL-31 — Enforces at least one owner while a document exists; permits parent-delete cascades.';

REVOKE ALL ON FUNCTION public.kal31_guard_last_owner() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kal31_guard_last_owner() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.kal31_guard_last_owner() FROM anon;

COMMIT;
;
