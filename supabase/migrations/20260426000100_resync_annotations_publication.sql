-- 2026-04-26 — Re-add document_annotations to the realtime publication.
--
-- The previous migration set REPLICA IDENTITY FULL on the table, but
-- existing realtime subscribers were still emitting DELETE events
-- with empty `payload.old` (the change to the table's replica
-- identity hadn't been picked up by Supabase realtime). Dropping and
-- re-adding the table to the supabase_realtime publication forces
-- realtime to refresh its view of the table's replica identity, so
-- subsequent DELETE events include the full row (highlight_id,
-- annotation_type, last_modified_by, etc.) needed by our cross-
-- device delete handler.
ALTER PUBLICATION supabase_realtime DROP TABLE document_annotations;
ALTER PUBLICATION supabase_realtime ADD TABLE document_annotations;

-- Belt-and-suspenders: re-confirm the replica identity in case the
-- prior migration was applied but didn't take effect on the live
-- replication slot.
ALTER TABLE document_annotations REPLICA IDENTITY FULL;
