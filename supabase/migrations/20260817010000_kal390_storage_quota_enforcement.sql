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
--   * The storage.objects INSERT policy (documents_owner_insert) gates NEW
--     objects: bytes cannot land once the user is at their tier limit. When
--     the storage API provides the object size at INSERT time the check is
--     exact; when it does not, the object is counted as 1 byte so a user
--     at/over the limit is still blocked (worst-case overshoot is one file,
--     bounded by the 50MiB per-file limit in config.toml). The UPDATE policy
--     below closes the overwrite path — the two together are the byte gate.
--   * The documents-table INSERT policy keeps its early client-feedback role
--     but now reads actual usage instead of the spoofable counter. The app
--     inserts the row BEFORE uploading bytes, so `actual + COALESCE(file_size)`
--     does not double-count the incoming file.
--   * user_subscriptions.storage_used_bytes and its documents-table triggers
--     are left as-is: they are DISPLAY-ONLY now (useSubscriptionLimits reads
--     them for the usage meter). Enforcement no longer consults the counter.
--     We deliberately do NOT install triggers on storage.objects — hosted
--     Supabase restricts DDL on the storage schema and enforcement does not
--     need them (all policies compute live usage).
--   * The storage UPDATE policy (documents_owner_update) is DELTA-gated:
--     new usage = old usage − old object size + new object size must stay
--     within the limit. Without this, a user could INSERT N tiny objects while
--     under quota and then grow each to 50MiB through the storage API's upsert
--     path (INSERT ... ON CONFLICT DO UPDATE checks only UPDATE policies) —
--     an unbounded aggregate bypass. Same-size saves and shrinking overwrites
--     always pass at/under the limit, so the save flow (upsert: true in
--     replaceDocument/uploadDataFile onto the SAME object path) keeps working;
--     only growth past the tier limit is blocked. When the new size is unknown
--     (metadata not yet set), the object is treated as unchanged.
--
-- COUNT caps (projects/documents) are untouched — they were already solid.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Live storage usage, computed from storage.objects (ground truth).
-- ---------------------------------------------------------------------------
-- Self-scoping: when a JWT is present (authenticated callers), the folder is
-- ALWAYS auth.uid()'s — p_user_id is ignored, so no signed-in user can read
-- another user's storage total through the EXECUTE grant. Only JWT-less
-- callers (service_role / postgres maintenance) can target an arbitrary user.
-- Policies pass auth.uid() anyway, so their behavior is identical.
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
    AND o.name LIKE COALESCE(auth.uid(), p_user_id)::text || '/%';
$$;

COMMENT ON FUNCTION public.get_actual_storage_usage(UUID) IS
  'KAL-390: live storage usage for quota enforcement, summed from storage.objects sizes under the user''s folder in the documents bucket. Spoof-proof — ignores client-reported documents.file_size and the display-only storage_used_bytes counter. Self-scoping: authenticated callers always get auth.uid()''s own total regardless of p_user_id; only JWT-less service callers can target another user.';

REVOKE ALL ON FUNCTION public.get_actual_storage_usage(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_actual_storage_usage(UUID) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_actual_storage_usage(UUID) FROM anon;

-- Current stored size of one object (0 when absent). Used by the UPDATE
-- policy's delta arithmetic. Inside the UPDATE statement this reads the
-- statement snapshot, i.e. the PRE-update row version (command-id visibility),
-- which is exactly the "old size" the delta needs. Self-scoping like the
-- usage function: authenticated callers can only read sizes under their own
-- folder, so the EXECUTE grant leaks nothing cross-user.
CREATE OR REPLACE FUNCTION public.get_stored_object_size(p_bucket_id TEXT, p_name TEXT)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE((
    SELECT (o.metadata->>'size')::bigint
    FROM storage.objects o
    WHERE o.bucket_id = p_bucket_id
      AND o.name = p_name
      AND (auth.uid() IS NULL OR o.name LIKE auth.uid()::text || '/%')
  ), 0);
$$;

COMMENT ON FUNCTION public.get_stored_object_size(TEXT, TEXT) IS
  'KAL-390: pre-update stored size of one object for the UPDATE policy''s delta check (old usage − old size + new size ≤ limit). Authenticated callers are folder-scoped to their own objects.';

REVOKE ALL ON FUNCTION public.get_stored_object_size(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_stored_object_size(TEXT, TEXT) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_stored_object_size(TEXT, TEXT) FROM anon;

-- ---------------------------------------------------------------------------
-- 2. Byte gates on storage.objects: INSERT (new objects) + UPDATE (overwrite
--    growth). Together these bound the user's aggregate at the tier limit;
--    neither alone is sufficient (upsert overwrites bypass INSERT policies).
--    (Replace the owner-folder-only policies from 20260703030000; the
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

-- Overwrite growth gate. The storage API's upsert path lands on this policy
-- (ON CONFLICT DO UPDATE checks only UPDATE policies), so without it a user
-- could mint tiny objects and grow each to the 50MiB per-file cap afterwards.
-- Delta arithmetic: old usage (statement snapshot, includes this object's old
-- size) − old size + new size. COALESCE(new size, old size) treats an
-- unknown-size intermediate write as "unchanged", so same-size saves at the
-- limit keep working; shrinks always pass; only growth past the limit blocks.
DROP POLICY IF EXISTS documents_owner_update ON storage.objects;
CREATE POLICY documents_owner_update ON storage.objects
    FOR UPDATE TO public
    USING (bucket_id = 'documents' AND (storage.foldername(name))[1] = auth.uid()::text)
    WITH CHECK (
        bucket_id = 'documents'
        AND (storage.foldername(name))[1] = auth.uid()::text
        AND (
            public.get_actual_storage_usage(auth.uid())
            - public.get_stored_object_size(bucket_id, name)
            + COALESCE(
                (metadata->>'size')::bigint,
                public.get_stored_object_size(bucket_id, name)
              )
        ) <= public.get_storage_limit(auth.uid())
    );

COMMENT ON POLICY documents_owner_update ON storage.objects IS
  'KAL-390: owner-folder overwrites only, delta-gated so an overwrite cannot grow aggregate usage past the tier limit (closes the tiny-insert-then-grow bypass). Same-size and shrinking saves always pass at/under the limit.';

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
  'KAL-390: document count cap unchanged (Fix 26 shape); storage clause now sums live storage.objects usage, so a spoofed/absent file_size cannot dodge the quota once real bytes are in storage. The storage bucket INSERT+UPDATE policies are the byte gates.';

COMMIT;
