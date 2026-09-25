-- w32 (2026-09-25): Realtime Presence on the private live channel
-- `anno-live:<document uuid>` (src/services/annotationLiveBus.js).
--
-- Each open screen of a document tracks ONE presence entry on the channel it
-- already joins for live previews. A screen then knows whether anyone else
-- has the document open; when nobody does it sends NO live messages at all
-- (no new-mark previews, no edit overlays, no in-progress pen points), so a
-- person working alone costs zero Realtime messages. Presence traffic is
-- only a join and a leave per screen (no periodic messages).
--
-- Who: anyone who can open the document (viewers too: a viewer watching is
-- exactly who the live messages are for). Same topic check and document
-- access function as the w30 broadcast policies.
--
-- Without these policies the presence `track` is refused, the channel join
-- itself still succeeds (verified 2026-09-25 against prod: track answers
-- "error", broadcast keeps working) and every screen sends live messages as
-- it did before w32. Safe to apply at any time; safe to roll back (DROP the
-- two policies).
--
-- NOT APPLIED by w32 (prod is hand-managed; apply after review).

BEGIN;

DROP POLICY IF EXISTS anno_live_presence_receive ON realtime.messages;
CREATE POLICY anno_live_presence_receive ON realtime.messages
  FOR SELECT TO authenticated
  USING (
    realtime.messages.extension = 'presence'
    AND CASE
      WHEN realtime.topic() ~ '^anno-live:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN public.user_can_access_document(substring(realtime.topic() FROM 11)::uuid, 'viewer')
      ELSE FALSE
    END
  );

DROP POLICY IF EXISTS anno_live_presence_track ON realtime.messages;
CREATE POLICY anno_live_presence_track ON realtime.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    realtime.messages.extension = 'presence'
    AND CASE
      WHEN realtime.topic() ~ '^anno-live:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN public.user_can_access_document(substring(realtime.topic() FROM 11)::uuid, 'viewer')
      ELSE FALSE
    END
  );

COMMIT;
