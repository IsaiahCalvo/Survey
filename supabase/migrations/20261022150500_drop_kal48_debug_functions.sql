-- Two debug helpers from the KAL-48 revisions work were left callable by any
-- signed-in user. kal48_debug_probe told anyone the revision and markup counts
-- of any document id, with no access check; kal48_dump_access_fn printed the
-- access function's source. Nothing calls either.
drop function if exists public.kal48_debug_probe(uuid, integer);
drop function if exists public.kal48_dump_access_fn();
