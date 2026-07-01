-- KAL-274 slice: honor the document lock on the NEW op-log path.
--
-- document_annotations INSERT already forbids writes to a finalized/locked
-- document (kal49_document_is_locked). The rebuilt Yjs op-log table
-- annotation_updates never got the same guard, so an edit to a locked document
-- could still be appended through the new persistence path — the lock was
-- bypassable. Mirror the existing guard exactly.

BEGIN;

DROP POLICY IF EXISTS annotation_updates_insert ON public.annotation_updates;
CREATE POLICY annotation_updates_insert
    ON public.annotation_updates FOR INSERT
    WITH CHECK (
        public.user_can_access_document(document_id, 'editor')
        AND NOT public.kal49_document_is_locked(document_id)
    );

COMMIT;
