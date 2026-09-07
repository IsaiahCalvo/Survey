-- Applied live as 20260907214518. A previous blanket grant exposed two internal SECURITY DEFINER functions
-- to every signed-in user. Neither function checks the caller's identity:
-- one purges cross-document trash history; the other accepts any user ID.
-- The client has no callers. Metrics run through postgres-owned definer
-- triggers; retention belongs to the service scheduler, not client RPCs.
REVOKE EXECUTE ON FUNCTION public.sweep_annotation_trash_events(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_usage_metric(uuid, character varying, bigint, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_annotation_trash_events(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_usage_metric(uuid, character varying, bigint, jsonb) TO service_role;
