-- KAL-390 (final) — make the two REMAINING client-trusting surfaces derive
-- from ground truth (storage.objects), not from client-reported numbers.
--
-- 20260817010000 moved quota reads onto public.get_actual_storage_usage().
-- 20260818010000 proved the byte gate cannot live in an RLS policy on
-- storage.objects and moved it to the enforce_documents_storage_quota trigger,
-- which is the only place in the database that ever sees a written object's
-- true size. Two soft spots survived both. This migration closes them.
--
--
-- (a) THE public.documents INSERT POLICY'S STORAGE CLAUSE
-- -------------------------------------------------------
-- Deployed shape (20260817010000, live on production today):
--
--     public.get_actual_storage_usage(auth.uid())
--       + COALESCE(file_size, 0) <= public.get_storage_limit(auth.uid())
--
-- `file_size` is whatever the client put in the INSERT. Two problems, and the
-- second one is not merely cosmetic:
--
--   1. It is not a gate. A client sending `file_size: 0` (or NULL) reduces the
--      clause to `usage <= limit` regardless of how large the file really is.
--      It looks like enforcement and is not. Bytes are metered by the trigger
--      in 20260818010000; this clause never metered anything a caller could
--      not choose.
--
--   2. It DOUBLE-COUNTS on the upload-first paths, and can falsely block a
--      legitimate save. The app has two orderings:
--
--        * row first, then bytes  — src/Dashboard.jsx single-file upload
--          (createSupabaseDocument, then uploadToStorage).
--        * BYTES FIRST, then row  — src/Dashboard.jsx new-project bulk upload
--          (`const filePath = await uploadPromise;` then
--          createSupabaseDocument) and the document-copy path
--          (uploadToStorage(copyFile, ...) then createSupabaseDocument).
--
--      On the bytes-first paths the object is already in storage.objects when
--      the policy runs, so `get_actual_storage_usage()` ALREADY includes the
--      incoming file and adding `file_size` counts it twice. Worked example on
--      the free tier (100 MiB): a user holding 30 MiB copies a 40 MiB document.
--      The bytes land (the trigger sees 0 + 40 <= 100). The documents INSERT
--      then evaluates 70 + 40 = 110 > 100 and is REJECTED — leaving the bytes
--      stored with no row, for a user who is only at 70% of their allowance.
--      The clause the header of 20260817010000 justified with "the app inserts
--      the row BEFORE uploading bytes" is wrong for half the write paths.
--
-- New shape — no client-supplied term at all:
--
--     public.get_actual_storage_usage(auth.uid())
--       <= public.get_storage_limit(auth.uid())
--
--   * Unspoofable: every input comes from storage.objects and the tier table.
--     `file_size: 0` no longer buys anything; an over-allowance account is
--     refused new document rows on ground truth alone, which the old clause
--     could not do.
--   * `<=`, not `<`, ON PURPOSE. It must never reject a row whose bytes the
--     trigger just accepted — the trigger's own condition is
--     `other_total + new_size <= limit`, so an exactly-filling upload leaves
--     usage == limit, and `<` would orphan those bytes on the bytes-first
--     paths.
--   * The count cap is copied through VERBATIM. It was already solid.
--
-- WHY REMOVING THE `file_size` TERM LOSES NO ENFORCEMENT. What the term could
-- do, and where each part now lives:
--
--   * Stop total stored bytes exceeding the tier limit — it never did this
--     (client-chosen input, and it guards a documents ROW, not the bytes).
--     Done by public.enforce_documents_storage_quota() on storage.objects:
--     real sizes, fires for the storage service's privileged write, serialized
--     per owner with an advisory lock. Bytes cannot exceed the limit whatever
--     the documents row claims — including when no documents row exists at all,
--     which the old clause could never cover.
--   * Refuse a document row for an over-allowance account — kept, and made
--     unspoofable, by the ground-truth clause above.
--   * Tell an honest client "this specific file will not fit" before it
--     uploads — this is the only thing that moves, and it moves to two places
--     that are also ground-truth-derived:
--       - src/hooks/useSubscriptionLimits.js `canUploadDocument(fileSize)`,
--         which as of this change reads live usage (see (b) below) instead of
--         the drifting counter, so its warning is now accurate rather than
--         merely early;
--       - the documents_owner_insert / documents_owner_update RLS policies'
--         advisory `contentLength` check from 20260818010000, which fails a
--         doomed upload fast, before 50 MiB is streamed.
--     A client that ignores both still gets a clear, correct refusal from the
--     trigger: "Storage quota exceeded: this save needs N bytes of the M bytes
--     allowed on your plan."
--
--
-- (b) user_subscriptions.storage_used_bytes
-- -----------------------------------------
-- 20260817010000 demoted this column to DISPLAY-ONLY. It is maintained by
-- AFTER INSERT/DELETE triggers on public.documents that add and subtract the
-- same client-supplied `file_size`, so it is a running total of what clients
-- claimed, never of what is stored. src/hooks/useSubscriptionLimits.js read it
-- for the usage meter, which meant the number the user saw was the one number
-- in the system with no connection to their actual bytes.
--
-- Measured on production (read-only Management API query, 2026-08-19), for the
-- account with real usage:
--
--     storage_used_bytes (what the meter showed)   329,468,006   (~314 MiB)
--     live sum over storage.objects (truth)        536,536,186   (~512 MiB)
--     SUM(documents.file_size)                     164,734,003   (~157 MiB)
--
-- The meter under-reported by 207 MiB — 38.6% low. (The counter is also
-- exactly 2x the documents sum, i.e. the triggers have been double-adding on
-- re-insert paths, while true storage is 3.26x the documents sum. Both errors
-- are inherent to counting client-declared sizes on documents-row events.)
-- Another account shows counter 0 against 961 live bytes: objects with no
-- documents row are invisible to the counter by construction.
--
-- The column CANNOT be made continuously accurate from the documents table:
-- the events do not correspond to byte writes at all (on the row-first path
-- the bytes do not exist yet at INSERT time; overwrites, orphaned objects and
-- failed uploads produce no documents event whatsoever). So this migration
-- does not pretend to repair it. Instead:
--
--   * The client stops reading it. useSubscriptionLimits now calls
--     public.get_actual_storage_usage() (already live on production, already
--     EXECUTE-granted to `authenticated`, already self-scoping to auth.uid()).
--     That is the user-visible half of this fix.
--   * The column is documented here as non-authoritative so the next reader
--     does not re-adopt it.
--   * The one supported reconciliation path — recalculate_user_storage() /
--     recalculate_all_user_storage() — is repointed at storage.objects, so an
--     operator who does reconcile writes truth instead of a client-reported
--     sum. Those functions are not called by any trigger or by app code; the
--     documents triggers call update_user_storage(), which is left alone.
--
-- While repointing them, two pre-existing defects in those two functions are
-- also fixed (both are SECURITY DEFINER, both were introduced in
-- 20241226000001):
--   * neither had `SET search_path`, the classic SECURITY DEFINER hijack shape;
--   * both were EXECUTE-granted to `authenticated` with no self-scoping, so any
--     signed-in user could rewrite ANOTHER user's counter, or every user's
--     counter at once via recalculate_all_user_storage(). Display-only data, so
--     low impact, but there is no reason for it to be reachable.
--
-- NOT CHANGED, DELIBERATELY:
--   * The public.user_usage_summary view still selects storage_used_bytes and
--     derives storage_percentage from it. Nothing in the app reads the view
--     (verified by grep across src/, supabase/functions/, scripts/ and both
--     test roots). It must NOT be repointed at get_actual_storage_usage():
--     the view is security_invoker and lists a row per user, while
--     get_actual_storage_usage() self-scopes to auth.uid() for authenticated
--     callers — every row would report the CALLER's usage. Fixing the view
--     needs a non-self-scoping helper, which is a different change with a
--     different threat model, and no consumer is asking for it.
--   * update_user_storage() and its two documents-table triggers. They keep
--     the legacy column populated for anything that still reads it; nothing
--     user-facing does any more.
--   * The count caps (projects/documents) everywhere. Untouched.
--   * No backfill of storage_used_bytes. The documents triggers would re-drift
--     it immediately, so a one-shot write would buy a cosmetic fix and a
--     production data write for no lasting benefit. `SELECT
--     public.recalculate_all_user_storage();` is available to an operator who
--     wants it, and now computes from storage.objects.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. documents INSERT policy — count cap verbatim, storage clause on ground
--    truth only.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can upload documents within limits" ON public.documents;
CREATE POLICY "Users can upload documents within limits"
  ON public.documents
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND (
      SELECT COUNT(*)
      FROM public.documents
      WHERE user_id = auth.uid()
        AND archived = FALSE
    ) < public.get_document_limit(auth.uid())
    AND public.get_actual_storage_usage(auth.uid())
        <= public.get_storage_limit(auth.uid())
  );

COMMENT ON POLICY "Users can upload documents within limits" ON public.documents IS
  'KAL-390: document count cap unchanged (Fix 26 shape). The storage clause is now ground truth only — live storage.objects usage against the tier limit, with no client-supplied file_size term. The dropped term was not a gate (file_size: 0 defeated it) and double-counted on the bytes-first upload paths (bulk new-project upload and document copy), which could falsely reject a legitimate save. enforce_documents_storage_quota on storage.objects is the authoritative byte gate; `<=` here so a row is never refused for bytes that trigger just accepted.';

-- ---------------------------------------------------------------------------
-- 2. Reconciliation helpers: compute the legacy display counter from
--    storage.objects instead of SUM(documents.file_size).
-- ---------------------------------------------------------------------------
-- Self-scoping in the same idiom as get_actual_storage_usage(): an
-- authenticated caller always reconciles their OWN row, whatever they pass.
-- Only a JWT-less caller (service_role / postgres maintenance) can target
-- another user.
CREATE OR REPLACE FUNCTION public.recalculate_user_storage(p_user_id UUID)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := COALESCE(auth.uid(), p_user_id);
  v_total   BIGINT;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(SUM((o.metadata->>'size')::bigint), 0)
  INTO v_total
  FROM storage.objects o
  WHERE o.bucket_id = 'documents'
    AND o.name LIKE v_user_id::text || '/%';

  UPDATE public.user_subscriptions
  SET storage_used_bytes = v_total
  WHERE user_id = v_user_id;

  RETURN v_total;
END;
$$;

COMMENT ON FUNCTION public.recalculate_user_storage(UUID) IS
  'KAL-390: reconciles the legacy display counter user_subscriptions.storage_used_bytes against GROUND TRUTH (live storage.objects bytes under the user''s folder), replacing the previous SUM(documents.file_size) which summed client-reported sizes. Self-scoping: an authenticated caller always reconciles their own row. Not authoritative for quota — enforcement reads get_actual_storage_usage() and the enforce_documents_storage_quota trigger.';

REVOKE ALL ON FUNCTION public.recalculate_user_storage(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recalculate_user_storage(UUID) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.recalculate_user_storage(UUID) FROM anon;

-- Whole-table maintenance. Not something an end user should ever be able to
-- run, so `authenticated` loses EXECUTE here (it had it, with no scoping).
CREATE OR REPLACE FUNCTION public.recalculate_all_user_storage()
RETURNS TABLE(user_id UUID, storage_bytes BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.user_subscriptions us
  SET storage_used_bytes = COALESCE((
        SELECT SUM((o.metadata->>'size')::bigint)
        FROM storage.objects o
        WHERE o.bucket_id = 'documents'
          AND o.name LIKE us.user_id::text || '/%'
      ), 0)
  RETURNING us.user_id, us.storage_used_bytes;
END;
$$;

COMMENT ON FUNCTION public.recalculate_all_user_storage() IS
  'KAL-390: maintenance reconciliation of the legacy display counter for every user, computed from live storage.objects bytes instead of SUM(documents.file_size). Covers users whose objects have no documents row, which the old version could not see. Service-role/postgres only.';

REVOKE ALL ON FUNCTION public.recalculate_all_user_storage() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recalculate_all_user_storage() TO service_role;
REVOKE EXECUTE ON FUNCTION public.recalculate_all_user_storage() FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Mark the legacy counter as non-authoritative at the schema level.
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN public.user_subscriptions.storage_used_bytes IS
  'LEGACY / NON-AUTHORITATIVE (KAL-390). A running total of client-supplied documents.file_size values, maintained by AFTER INSERT/DELETE triggers on public.documents. It does not track storage.objects and cannot be made to: overwrites, orphaned objects and failed uploads produce no documents event, and on the row-first upload path the bytes do not exist yet when the trigger fires. Measured 38.6% low against real storage on production (2026-08-19). Never show this to a user and never gate on it — call public.get_actual_storage_usage(uid) instead. recalculate_user_storage() / recalculate_all_user_storage() reconcile it from storage.objects on demand.';

COMMIT;
