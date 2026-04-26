-- 2026-04-26 — Enable REPLICA IDENTITY FULL on document_annotations.
--
-- Why:
-- Supabase realtime DELETE events only include the PRIMARY KEY of the
-- removed row by default (REPLICA IDENTITY DEFAULT). Our cross-device
-- annotation sync subscribes to DELETE events and needs `highlight_id`,
-- `annotation_type`, and `last_modified_by` from the deleted row to
-- correctly remove the matching annotation from the other device's
-- local state. Without those fields, the realtime DELETE handler can't
-- identify what to remove, and a marquee-delete on Mac never makes the
-- annotations disappear on Windows (and vice versa).
--
-- REPLICA IDENTITY FULL tells Postgres to include the entire row in
-- WAL on UPDATE/DELETE. The cost is slightly larger replication
-- traffic, which is fine for this table's volume.
ALTER TABLE document_annotations REPLICA IDENTITY FULL;

-- Same fix for document_presence and the highlights table — both
-- subscribe to realtime and may need full-row DELETE payloads in the
-- future even if they don't hit this bug today.
ALTER TABLE document_presence REPLICA IDENTITY FULL;
