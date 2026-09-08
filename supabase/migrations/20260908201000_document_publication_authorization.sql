-- Enforce publication rights at the database boundary, including old clients.
-- Keep existing RLS, quota checks and collaborator read/edit behavior intact.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

CREATE OR REPLACE FUNCTION survey_private.enforce_document_publication()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path='' SET lock_timeout='2s'
AS $$
DECLARE
  caller_name text;
  trusted boolean;
  actor uuid := auth.uid();
  project_owner uuid;
  project_archived boolean;
  project_user_archived timestamptz;
  member_role text;
  path_parts text[];
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.user_id IS NOT DISTINCT FROM OLD.user_id
       AND NEW.file_path IS NOT DISTINCT FROM OLD.file_path
       AND NEW.project_id IS NOT DISTINCT FROM OLD.project_id THEN RETURN NEW; END IF;
  END IF;
  caller_name := COALESCE(NULLIF(NULLIF(current_setting('role',true),'none'),''),session_user);
  SELECT r.rolsuper OR r.rolbypassrls INTO trusted FROM pg_catalog.pg_roles r WHERE r.rolname=caller_name;
  -- Administrative imports/repairs keep their existing authority. JWT role
  -- strings are never a bypass. Retired document IDs remain forbidden to ALL
  -- callers by the separate identity trigger.
  IF COALESCE(trusted,false) THEN RETURN NEW; END IF;
  IF actor IS NULL THEN RAISE EXCEPTION 'Document publication requires a signed-in user' USING ERRCODE='42501'; END IF;

  IF TG_OP='UPDATE' THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'Permanent document ownership cannot be reassigned by a client' USING ERRCODE='42501';
    END IF;
    IF NEW.file_path IS DISTINCT FROM OLD.file_path THEN
      RAISE EXCEPTION 'documents.file_path is immutable (set once at upload)' USING ERRCODE='42501';
    END IF;
    -- Routine saves/archive/revive neither relock projects nor rewrite guards.
    IF NEW.project_id IS NOT DISTINCT FROM OLD.project_id THEN RETURN NEW; END IF;
  ELSE
    IF NEW.user_id IS DISTINCT FROM actor THEN
      RAISE EXCEPTION 'Document owner does not match signed-in user' USING ERRCODE='42501';
    END IF;
    -- Storage's collaborator-read policy trusts published document references.
    -- An own row must therefore never name another account's object. Keep
    -- legacy own-account paths as well as project/hash and document/hash paths.
    path_parts := string_to_array(NEW.file_path,'/');
    IF NEW.file_path IS NULL OR length(NEW.file_path)>2048 OR cardinality(path_parts)<2
       OR path_parts[1] IS DISTINCT FROM NEW.user_id::text
       OR NEW.file_path ~ '[[:cntrl:]%?#]' OR position(chr(92) in NEW.file_path)>0
       OR EXISTS (SELECT 1 FROM unnest(path_parts) part WHERE part IN ('','.','..')) THEN
      RAISE EXCEPTION 'Document storage path must belong to its permanent owner' USING ERRCODE='42501';
    END IF;
  END IF;

  -- A project purge detaches surviving foreign-owned documents to NULL from a
  -- checked SECURITY DEFINER RPC. No destination permission is needed for that
  -- detach; existing UPDATE RLS/that RPC still controls who can request it.
  IF NEW.project_id IS NULL THEN RETURN NEW; END IF;
  SELECT p.user_id,p.archived,p.user_archived_at INTO project_owner,project_archived,project_user_archived
    FROM public.projects p WHERE p.id=NEW.project_id FOR SHARE NOWAIT;
  IF NOT FOUND OR project_archived IS DISTINCT FROM false OR project_user_archived IS NOT NULL THEN
    RAISE EXCEPTION 'Destination project is not active' USING ERRCODE='42501';
  END IF;
  IF project_owner=actor THEN RETURN NEW; END IF;

  -- SHARE (not KEY SHARE) also blocks a role/status change. If a revoke/delete
  -- already owns the membership tuple, abort this whole write without waiting
  -- in the reverse document/project lock order. A fresh retry rechecks access.
  SELECT c.role INTO member_role FROM public.project_collaborators c
    WHERE c.project_id=NEW.project_id AND c.user_id=actor AND c.status='active'
      AND c.role IN ('editor','owner') FOR SHARE NOWAIT;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Destination project requires an active editor role' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION survey_private.enforce_document_publication() OWNER TO postgres;
REVOKE ALL ON FUNCTION survey_private.enforce_document_publication() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS b_document_publication_authorization ON public.documents;
CREATE TRIGGER b_document_publication_authorization
  BEFORE INSERT OR UPDATE OF user_id,project_id,file_path ON public.documents
  FOR EACH ROW EXECUTE FUNCTION survey_private.enforce_document_publication();

-- Preserve the existing path-immutability trigger while removing its JWT-claim
-- bypass. It also protects callers whose UPDATE does not use the new route.
CREATE OR REPLACE FUNCTION public.enforce_documents_file_path_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE caller_name text; trusted boolean;
BEGIN
  IF NEW.file_path IS NOT DISTINCT FROM OLD.file_path THEN RETURN NEW; END IF;
  caller_name := COALESCE(NULLIF(NULLIF(current_setting('role',true),'none'),''),session_user);
  SELECT r.rolsuper OR r.rolbypassrls INTO trusted FROM pg_catalog.pg_roles r WHERE r.rolname=caller_name;
  IF NOT COALESCE(trusted,false) THEN
    RAISE EXCEPTION 'documents.file_path is immutable (set once at upload)' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.enforce_documents_file_path_immutable() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enforce_documents_file_path_immutable() FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
