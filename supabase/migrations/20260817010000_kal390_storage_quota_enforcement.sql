-- KAL-390 — close the storage-quota bypass (server-side plan enforcement).
--
-- Verified gaps this migration closes:
--   (a) The documents INSERT policy trusted the client-supplied file_size and
--       the trigger-maintained user_subscriptions.storage_used_bytes counter —
--       both derived from client-reported numbers, so `file_size: 0` (or null)
--       passed the check regardless of how many bytes actually live in storage.
--   (b) The quota-enforcing storage bucket policy sketched in migration
--       20241223000004 was never created (it was left as a commented-out
--       "for reference" block), so direct storage-API uploads to a user's own
--       folder were unmetered apart from the 50MiB/file limit in config.toml.
--
-- Design:
--   * public.get_actual_storage_usage(uid) computes usage LIVE from
--     storage.objects (sum of metadata->>'size' under the user's folder in the
--     'documents' bucket). Ground truth — client-reported sizes are irrelevant.
--   * The storage.objects INSERT policy (documents_owner_insert) becomes the
--     authoritative quota gate: bytes cannot land once the user is at their
--     tier limit. When the storage API provides the object size at INSERT time
--     the check is exact; when it does not, the object is counted as 1 byte so
--     a user at/over the limit is still blocked (worst-case overshoot is one
--     file, bounded by the 50MiB per-file limit in config.toml).
--   * The documents-table INSERT policy keeps its early client-feedback role
--     but now reads actual usage instead of the spoofable counter. The app
--     inserts the row BEFORE uploading bytes, so `actual + COALESCE(file_size)`
--     does not double-count the incoming file.
--   * user_subscriptions.storage_used_bytes and its documents-table triggers
--     are left as-is: they are DISPLAY-ONLY now (useSubscriptionLimits reads
--     them for the usage meter). Enforcement no longer consults the counter.
--     We deliberately do NOT install triggers on storage.objects — hosted
--     Supabase restricts DDL on the storage schema and enforcement does not
--     need them (both policies compute live usage).
--   * The storage UPDATE policy (documents_owner_update) is intentionally NOT
--     quota-gated: the save flow overwrites the SAME object path
--     (upsert: true in replaceDocument/uploadDataFile), and blocking that at
--     quota would lock users out of saving existing work. Growth via overwrite
--     is bounded by the 50MiB per-file limit.
--
-- COUNT caps (projects/documents) are untouched — they were already solid.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Live storage usage, computed from storage.objects (ground truth).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_actual_storage_usage(p_user_id UUID)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(SUM((o.metadata->>'size')::bigint), 0)
  FROM storage.objects o
  WHERE o.bucket_id = 'documents'
    AND o.name LIKE p_user_id::text || '/%';
$$;

COMMENT ON FUNCTION public.get_actual_storage_usage(UUID) IS
  'KAL-390: live storage usage for quota enforcement, summed from storage.objects sizes under the user''s folder in the documents bucket. Spoof-proof — ignores client-reported documents.file_size and the display-only storage_used_bytes counter.';

REVOKE ALL ON FUNCTION public.get_actual_storage_usage(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_actual_storage_usage(UUID) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_actual_storage_usage(UUID) FROM anon;

-- ---------------------------------------------------------------------------
-- 2. Authoritative quota gate: storage.objects INSERT policy.
--    (Replaces the owner-folder-only policy from 20260703030000; the
--    owner-folder scoping is preserved verbatim.)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS documents_owner_insert ON storage.objects;
CREATE POLICY documents_owner_insert ON storage.objects
    FOR INSERT TO public
    WITH CHECK (
        bucket_id = 'documents'
        AND (storage.foldername(name))[1] = auth.uid()::text
        AND (
            public.get_actual_storage_usage(auth.uid())
            + COALESCE((metadata->>'size')::bigint, 1)
        ) <= public.get_storage_limit(auth.uid())
    );

COMMENT ON POLICY documents_owner_insert ON storage.objects IS
  'KAL-390: owner-folder uploads only, and only while live storage usage stays within the tier limit. Unknown incoming size counts as 1 byte so an at-limit user is still blocked.';

-- ---------------------------------------------------------------------------
-- 3. documents INSERT policy: same shape as Fix 26 (20260513010000) — count
--    cap unchanged — but the storage clause now reads actual usage from
--    storage.objects instead of the client-influenced counter.
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
    AND (
      public.get_actual_storage_usage(auth.uid())
      + COALESCE(file_size, 0)
    ) <= public.get_storage_limit(auth.uid())
  );

COMMENT ON POLICY "Users can upload documents within limits" ON public.documents IS
  'KAL-390: document count cap unchanged (Fix 26 shape); storage clause now sums live storage.objects usage, so a spoofed/absent file_size cannot dodge the quota once real bytes are in storage. The storage bucket INSERT policy remains the authoritative byte gate.';

COMMIT;
