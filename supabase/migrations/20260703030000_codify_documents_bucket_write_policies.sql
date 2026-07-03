-- SECURITY / change-control (2026-07-03) — codify the documents-bucket storage
-- write policies that previously existed only in the Supabase dashboard
-- (untracked in git). Verified live on production 2026-07-03: uploads/updates/
-- deletes are already correctly scoped to each user's OWN folder
-- (the first path segment must equal auth.uid()). This migration reproduces
-- those exact policies under clean, tracked names so they are reviewable and
-- reproducible across environments. It is idempotent and safe to apply to any
-- environment (drops the old dashboard-named policies first to avoid duplicates).
--
-- NOTE: production already enforces these correctly, so re-applying here is a
-- no-op behaviourally — the value is having them in migration history.

-- Drop the dashboard-generated equivalents if present (name suffix from the UI).
DROP POLICY IF EXISTS "Users can upload their own files flreew_0" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own files flreew_0" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own files flreew_0" ON storage.objects;
DROP POLICY IF EXISTS "Users can view their own files flreew_0" ON storage.objects;

DROP POLICY IF EXISTS documents_owner_insert ON storage.objects;
CREATE POLICY documents_owner_insert ON storage.objects
    FOR INSERT TO public
    WITH CHECK (bucket_id = 'documents' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS documents_owner_update ON storage.objects;
CREATE POLICY documents_owner_update ON storage.objects
    FOR UPDATE TO public
    USING (bucket_id = 'documents' AND (storage.foldername(name))[1] = auth.uid()::text)
    WITH CHECK (bucket_id = 'documents' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS documents_owner_delete ON storage.objects;
CREATE POLICY documents_owner_delete ON storage.objects
    FOR DELETE TO public
    USING (bucket_id = 'documents' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS documents_owner_select ON storage.objects;
CREATE POLICY documents_owner_select ON storage.objects
    FOR SELECT TO public
    USING (bucket_id = 'documents' AND (storage.foldername(name))[1] = auth.uid()::text);

-- The collaborator-read SELECT policy ("Document collaborators can read
-- accessible document files", migration 20260513003000) remains as-is; the
-- documents.file_path immutability trigger (20260703020000) closes the IDOR
-- that policy previously enabled.
