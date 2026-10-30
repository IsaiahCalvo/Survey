-- Live sheet sync hardening (2026-10-30 audit, /mnt/project-files/sheet-sync/audit.md).
--
-- 1. Lease tokens. The lease (one round at a time per link) now carries a
--    token. A round saves only while its own token is still on the link, so a
--    round that ran past its lease cannot overwrite the round that took over
--    (two overlapping rounds made duplicate items). The old token-less
--    function stays for edge function code deployed before this.
alter table public.sheet_sync_links add column if not exists lease_token uuid;

create or replace function public.sheet_sync_take_lease_token(p_link_id uuid, p_seconds integer default 120)
returns uuid
language sql
security definer
set search_path = public
as $$
  update public.sheet_sync_links
     set lease_until = now() + make_interval(secs => greatest(5, least(p_seconds, 300))),
         lease_token = gen_random_uuid()
   where id = p_link_id
     and (lease_until is null or lease_until < now())
  returning lease_token;
$$;
revoke all on function public.sheet_sync_take_lease_token(uuid, integer) from public, anon, authenticated;
grant execute on function public.sheet_sync_take_lease_token(uuid, integer) to service_role;

-- 2. The role a given person has on a document, for the server: a link keeps
--    syncing with the linker's Google or Microsoft sign-in only while the
--    linker can still edit the survey. Runs get_my_document_role as that
--    person (the claim is set for this transaction only). Service role only.
create or replace function public.sheet_sync_user_role(p_document_id uuid, p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    return null;
  end if;
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text, true);
  return public.get_my_document_role(p_document_id);
end;
$$;
revoke all on function public.sheet_sync_user_role(uuid, uuid) from public, anon, authenticated;
grant execute on function public.sheet_sync_user_role(uuid, uuid) to service_role;

-- 3. One linked sheet per survey + template, whichever provider: two "Make a
--    live sheet" presses at once (Google and Excel) made two server writers.
--    Skipped, not failed, if a database already holds such a pair.
do $$
begin
  if not exists (
    select 1 from public.sheet_sync_links group by document_id, template_id having count(*) > 1
  ) then
    create unique index if not exists sheet_sync_links_one_per_survey
      on public.sheet_sync_links (document_id, template_id);
  end if;
end;
$$;
