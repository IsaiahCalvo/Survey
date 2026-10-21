-- RLS sweep: a project or template editor could give the item away.
--
-- The UPDATE policies on projects and templates let a collaborator with the
-- editor role update the row, with no WITH CHECK on user_id. So any project
-- editor could set projects.user_id to any account (the owner lost the
-- project), and a Pro editor could take a project or template for
-- themselves. No app path changes these owners, so signed-in callers may no
-- longer change user_id at all. The service role and database jobs (no
-- signed-in user) still can.
BEGIN;

CREATE OR REPLACE FUNCTION public.keep_owner_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id
       AND (SELECT auth.role()) IN ('authenticated', 'anon') THEN
        RAISE EXCEPTION 'owner_cannot_change'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.keep_owner_column() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS projects_keep_owner ON public.projects;
CREATE TRIGGER projects_keep_owner
  BEFORE UPDATE OF user_id ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.keep_owner_column();

DROP TRIGGER IF EXISTS templates_keep_owner ON public.templates;
CREATE TRIGGER templates_keep_owner
  BEFORE UPDATE OF user_id ON public.templates
  FOR EACH ROW EXECUTE FUNCTION public.keep_owner_column();

COMMIT;
