-- w30 (2026-09-24): live previews ride a PRIVATE Realtime Broadcast channel per
-- document, topic `anno-live:<document uuid>` (src/services/annotationLiveBus.js).
-- A new mark is broadcast the moment it is drawn so other open screens show it
-- in ~100 ms; its WAL row (annotation_updates) stays the only thing that saves
-- or accepts it.
--
-- Realtime checks these policies when a screen joins the channel:
--   * receive (SELECT): anyone who can open the document;
--   * send (INSERT): its editors, while it is not locked.
-- Without them the private join is refused and the app falls back to the log
-- path (a stroke then takes ~0.5-1 s to show elsewhere).
--
-- NOT APPLIED by w30 (prod is hand-managed; apply after review).

BEGIN;

DROP POLICY IF EXISTS anno_live_receive ON realtime.messages;
CREATE POLICY anno_live_receive ON realtime.messages
  FOR SELECT TO authenticated
  USING (
    realtime.messages.extension = 'broadcast'
    AND CASE
      WHEN realtime.topic() ~ '^anno-live:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN public.user_can_access_document(substring(realtime.topic() FROM 11)::uuid, 'viewer')
      ELSE FALSE
    END
  );

DROP POLICY IF EXISTS anno_live_send ON realtime.messages;
CREATE POLICY anno_live_send ON realtime.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    realtime.messages.extension = 'broadcast'
    AND CASE
      WHEN realtime.topic() ~ '^anno-live:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN public.user_can_access_document(substring(realtime.topic() FROM 11)::uuid, 'editor')
          AND NOT public.kal49_document_is_locked(substring(realtime.topic() FROM 11)::uuid)
      ELSE FALSE
    END
  );

COMMIT;
