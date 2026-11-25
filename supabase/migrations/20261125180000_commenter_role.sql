-- Owner, 2026-11-24 (decision card on audit round 5, #6): bring back a
-- "Commenter" role between Viewer and Editor, shown in Nightly only (flag
-- commenter-role). A Commenter reads everything a Viewer reads and may post,
-- reply to, edit and delete their own comments and comment pins, and mark a
-- thread resolved. They never draw, answer Survey items or change the file.
--
-- KAL-31 (20260521000000) took the role out in May; this adds it back and
-- changes no rows. Stable builds offer only Viewer, Editor and Owner, and read
-- a Commenter as a Viewer.

-- 1. The role is allowed on document and project grants and their invites.
ALTER TABLE public.document_collaborators DROP CONSTRAINT IF EXISTS document_collaborators_role_check;
ALTER TABLE public.document_collaborators ADD CONSTRAINT document_collaborators_role_check
  CHECK (role IN ('viewer', 'commenter', 'editor', 'owner'));
ALTER TABLE public.project_collaborators DROP CONSTRAINT IF EXISTS project_collaborators_role_check;
ALTER TABLE public.project_collaborators ADD CONSTRAINT project_collaborators_role_check
  CHECK (role IN ('viewer', 'commenter', 'editor', 'owner'));

ALTER TABLE public.document_invites DROP CONSTRAINT IF EXISTS document_invites_role_check;
ALTER TABLE public.document_invites ADD CONSTRAINT document_invites_role_check
  CHECK (role IN ('viewer', 'commenter', 'editor', 'owner'));
ALTER TABLE public.document_invites DROP CONSTRAINT IF EXISTS document_invites_intended_role_check;
ALTER TABLE public.document_invites ADD CONSTRAINT document_invites_intended_role_check
  CHECK (intended_role IN ('viewer', 'commenter', 'editor', 'owner'));
ALTER TABLE public.document_invites DROP CONSTRAINT IF EXISTS document_invites_accepted_role_check;
ALTER TABLE public.document_invites ADD CONSTRAINT document_invites_accepted_role_check
  CHECK (accepted_role IN ('viewer', 'commenter', 'editor', 'owner'));

ALTER TABLE public.project_invites DROP CONSTRAINT IF EXISTS project_invites_role_check;
ALTER TABLE public.project_invites ADD CONSTRAINT project_invites_role_check
  CHECK (role IN ('viewer', 'commenter', 'editor', 'owner'));
ALTER TABLE public.project_invites DROP CONSTRAINT IF EXISTS project_invites_intended_role_check;
ALTER TABLE public.project_invites ADD CONSTRAINT project_invites_intended_role_check
  CHECK (intended_role IN ('viewer', 'commenter', 'editor', 'owner'));
ALTER TABLE public.project_invites DROP CONSTRAINT IF EXISTS project_invites_accepted_role_check;
ALTER TABLE public.project_invites ADD CONSTRAINT project_invites_accepted_role_check
  CHECK (accepted_role IN ('viewer', 'commenter', 'editor', 'owner'));

-- 2. Rewrite the live functions in place, one exact phrase at a time, so each
-- keeps the body it has today. A phrase that is not found stops the
-- migration: the function changed since this was written and needs a look.
CREATE OR REPLACE FUNCTION pg_temp.kal_rewrite_function(p_name text, p_from text, p_to text)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_oid oid;
  v_count int;
  v_def text;
BEGIN
  SELECT count(*), min(p.oid) INTO v_count, v_oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = p_name;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'commenter role: expected one public.%, found %', p_name, v_count;
  END IF;
  v_def := pg_get_functiondef(v_oid);
  IF position(p_from IN v_def) = 0 THEN
    RAISE EXCEPTION 'commenter role: public.% no longer contains %', p_name, p_from;
  END IF;
  EXECUTE replace(v_def, p_from, p_to);
END;
$fn$;

-- Access ranks: a Commenter passes every Viewer check, and a new 'commenter'
-- check passes Commenters, Editors and Owners.
SELECT pg_temp.kal_rewrite_function(f,
  $q$WHEN 'viewer' THEN user_role IN ('viewer', 'editor', 'owner')$q$,
  $q$WHEN 'viewer' THEN user_role IN ('viewer', 'commenter', 'editor', 'owner')
        WHEN 'commenter' THEN user_role IN ('commenter', 'editor', 'owner')$q$)
  FROM unnest(ARRAY['user_can_access_document', 'user_can_access_project']) AS f;

-- An emailed document invite for a Commenter grants Commenter, not Viewer.
SELECT pg_temp.kal_rewrite_function('grant_document_invite_to_account',
  $q$WHEN v_invite.role IN ('viewer', 'editor', 'owner') THEN v_invite.role$q$,
  $q$WHEN v_invite.role IN ('viewer', 'commenter', 'editor', 'owner') THEN v_invite.role$q$);

-- Comments and comment pins need 'commenter' instead of 'editor'.
SELECT pg_temp.kal_rewrite_function('add_mark_comment',
  $q$user_can_access_document(p_document_id, 'editor')$q$,
  $q$user_can_access_document(p_document_id, 'commenter')$q$);
SELECT pg_temp.kal_rewrite_function('add_page_pin',
  $q$user_can_access_document(p_document_id, 'editor')$q$,
  $q$user_can_access_document(p_document_id, 'commenter')$q$);
SELECT pg_temp.kal_rewrite_function(f,
  $q$user_can_access_document(v_row.document_id, 'editor')$q$,
  $q$user_can_access_document(v_row.document_id, 'commenter')$q$)
  FROM unnest(ARRAY['edit_mark_comment', 'delete_mark_comment', 'set_mark_comment_resolved', 'update_page_pin']) AS f;
