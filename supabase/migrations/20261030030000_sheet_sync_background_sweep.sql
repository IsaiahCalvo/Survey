-- Live sheet sync with nobody's survey open (2026-10-30). Until now a round
-- ran only while a device had the survey open, so a PM's sheet edits waited
-- for a field tech to open the survey. A minute-by-minute sweep now runs
-- rounds for linked sheets that devices are not already syncing, as the
-- person who linked the sheet (/mnt/project-files/sheet-sync/audit.md).
--
-- 1. When a round last moved something either way: the sweep checks recently
--    busy sheets often and quiet ones rarely (spares Google's quota).
alter table public.sheet_sync_links add column if not exists last_change_at timestamptz;

-- 2. The sweep's own secret and the function's address. The secret is made
--    here, in the database, so it is never in this public repo or a manual
--    step; the cron job and the function both read it from this table. The
--    function writes its address on its first request (it knows its own URL;
--    a migration does not). Service role and postgres only.
create table if not exists public.sheet_sync_settings (
  id integer primary key default 1 check (id = 1),
  sweep_secret text not null default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  function_url text,
  updated_at timestamptz not null default now()
);
insert into public.sheet_sync_settings (id) values (1) on conflict (id) do nothing;
alter table public.sheet_sync_settings enable row level security;
revoke all on public.sheet_sync_settings from anon, authenticated;
comment on table public.sheet_sync_settings is
  'Background sheet sync: the sweep secret and the sheet-sync function URL. Server only.';

-- 3. Run one of a fixed few calls as a given person, for the sweep: it writes
--    the sheet's changes into the survey as the linker, through the same
--    checks the app's own writes go through (append_annotation_update checks
--    their role and the document lock). The person's claims are set for this
--    transaction only. Service role only.
create or replace function public.sheet_sync_as_user(p_user_id uuid, p_call text, p_args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_out jsonb;
  v_hex text;
begin
  select email into v_email from auth.users where id = p_user_id;
  if v_email is null then
    raise exception 'sheet_sync_as_user: no such user';
  end if;
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated', 'email', v_email)::text, true);

  if p_call = 'get_my_feature_flags' then
    return public.get_my_feature_flags();
  elsif p_call = 'get_my_document_role' then
    return to_jsonb(public.get_my_document_role((p_args ->> 'doc_id')::uuid));
  elsif p_call = 'kal308a_get_or_create_signing_secret' then
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_out
      from public.kal308a_get_or_create_signing_secret((p_args ->> 'p_document_id')::uuid, p_args ->> 'p_signing_id_seed') t;
    return v_out;
  elsif p_call = 'append_annotation_update' then
    v_hex := p_args ->> 'p_data';
    if v_hex is null or left(v_hex, 2) <> '\x' then
      raise exception 'sheet_sync_as_user: p_data must be \x hex';
    end if;
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_out
      from public.append_annotation_update(
        (p_args ->> 'p_document_id')::uuid,
        p_args ->> 'p_client_id',
        (p_args ->> 'p_client_seq')::bigint,
        decode(substr(v_hex, 3), 'hex')
      ) t;
    return v_out;
  end if;
  raise exception 'sheet_sync_as_user: % is not allowed', p_call;
end;
$$;
revoke all on function public.sheet_sync_as_user(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.sheet_sync_as_user(uuid, text, jsonb) to service_role;

-- 4. The schedule: every minute, only once the function has written its
--    address and only while some sheet is linked and live. Where pg_cron or
--    pg_net is missing (local stacks, CI) there is no schedule; tests call
--    the sweep directly.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.schedule(
      'sheet-sync-sweep',
      '* * * * *',
      $cmd$
        select net.http_post(
          url := s.function_url || '/sweep',
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-sheet-sync-sweep', s.sweep_secret),
          body := '{}'::jsonb,
          timeout_milliseconds := 60000
        )
        from public.sheet_sync_settings s
        where s.function_url is not null
          and exists (select 1 from public.sheet_sync_links l where l.status = 'active')
      $cmd$
    );
  end if;
end;
$$;
