-- KAL-284 (c)+(d) — document_invites hygiene.
--
-- (c) created_by carried ON DELETE CASCADE from the original KAL-31 DDL
--     (20260521000100): deleting the INVITER's account silently destroyed
--     invite rows other people's access flows may still depend on (pending
--     acceptances, and the KAL-439 recipient-binding audit trail). Same
--     attribution-only treatment as 20260811120000: keep the row, NULL the
--     attribution. created_by must become nullable for SET NULL to work.
--
-- (d) Nothing prevented duplicate email invites for the same document. Add a
--     partial UNIQUE(document_id, target_email) index. The predicate is
--     deliberately narrower than "target_email IS NOT NULL" alone: revoked
--     and accepted rows are kept out of the uniqueness scope because the
--     product flows re-invite the same address after a revoke (handleRevoke →
--     new invite) and after a collaborator removal (accepted row persists as
--     history). Uniqueness therefore applies to LIVE PENDING invites — the
--     actual duplicate-send hazard.

BEGIN;

-- (c) inviter attribution survives account deletion; rows stay.
ALTER TABLE public.document_invites
  ALTER COLUMN created_by DROP NOT NULL;

ALTER TABLE public.document_invites
  DROP CONSTRAINT IF EXISTS document_invites_created_by_fkey,
  ADD CONSTRAINT document_invites_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- (d) collapse existing duplicate pending email invites before the index can
-- be created: keep the newest pending invite per (document_id, target_email),
-- revoke the older ones (revoking preserves history and beats deleting —
-- their tokens die, nothing else changes).
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY document_id, target_email
           ORDER BY created_at DESC, id DESC
         ) AS rn
  FROM public.document_invites
  WHERE target_email IS NOT NULL
    AND revoked_at IS NULL
    AND accepted_at IS NULL
)
UPDATE public.document_invites di
SET revoked_at = now()
FROM ranked
WHERE di.id = ranked.id
  AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_document_invites_pending_email
  ON public.document_invites (document_id, target_email)
  WHERE target_email IS NOT NULL
    AND revoked_at IS NULL
    AND accepted_at IS NULL;

COMMENT ON INDEX public.uniq_document_invites_pending_email IS
  'KAL-284(d): at most one live pending email invite per (document, address). Revoked/accepted rows stay out of scope so re-inviting after a revoke or removal keeps working.';

COMMIT;
