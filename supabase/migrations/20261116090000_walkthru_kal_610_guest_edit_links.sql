-- Walkthru (schema walkthru), KAL-610: guest edit links. The source is the
-- Walkthru repo (same change, schemas public and private there). Adds
-- walkthru.walkthrough_guest_links and walkthru.walkthrough_guests, lets a
-- live guest read and write its one walkthrough, and files a guest's uploads
-- under that walkthrough. Nothing is removed.
--
-- The last block also lets a live Walkthru guest session (anonymous) put
-- files in the walkthrough-assets bucket: Survey's "Guests cannot ..."
-- Storage rules stay as they are for every other bucket.
--
-- Production has schema walkthru (KAL-579), but this repo's migrations don't
-- build it, so a fresh local database skips this file instead of failing.
do $kal610guests$
begin
  if to_regclass('walkthru.walkthroughs') is null
     or to_regclass('walkthru.organization_members') is null
     or to_regclass('walkthru.profiles') is null
     or to_regclass('walkthru.node_types') is null
     or to_regprocedure('walkthru_private.current_user_can_manage_walkthrough(uuid)') is null
     or to_regprocedure('walkthru_private.current_user_has_active_walkthrough_share(uuid)') is null
     or to_regprocedure('walkthru_private.user_can_access_pending_walkthrough(uuid,uuid)') is null then
    raise notice 'KAL-610 guest links skipped: schema walkthru is not in this database';
    return;
  end if;
  execute $kal610guestssql$
-- KAL-610: guest edit links, after Survey's guest links (Nightly flag
-- "guest-edit-links"). A manager of a walkthrough makes a link that lets
-- someone with no Walkthru seat open that ONE walkthrough and change
-- everything a team member can (Isaiah, 2026-11-16) until a set time. The
-- guest types a name and gets an anonymous Supabase session (is_anonymous in
-- the JWT), or uses an account they already have; redeeming the link records
-- that session as a guest of the walkthrough. Nothing is removed.
--
-- Rules:
--   * Only a hash of the link's secret is kept; the secret is shown once.
--   * A guest grant reaches one walkthrough, as an editor, never a manager,
--     and only while its link is live: every access check reads the link
--     each time, so turning a link off or letting it run out cuts the guest
--     off at once.
--   * Only a manager (not a guest session) makes, lists and turns off links.
--   * A guest session makes nothing of its own: no walkthroughs, companies,
--     invites, templates, library Categories, share links or invites.
--   * Files a guest adds count against the walkthrough's workspace, so the
--     storage ledger files them under that walkthrough, not the guest.

-- ---------------------------------------------------------------------------
-- Who is a guest session
-- ---------------------------------------------------------------------------
create or replace function walkthru_private.is_guest_session()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
$$;
revoke all on function walkthru_private.is_guest_session() from public, anon;
grant execute on function walkthru_private.is_guest_session() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists walkthru.walkthrough_guest_links (
  id uuid primary key default gen_random_uuid(),
  walkthrough_id uuid not null references walkthru.walkthroughs(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  role text not null default 'editor' check (role = 'editor'),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  use_count integer not null default 0
);
create index if not exists walkthrough_guest_links_walkthrough_idx
  on walkthru.walkthrough_guest_links (walkthrough_id);
create index if not exists walkthrough_guest_links_created_by_idx
  on walkthru.walkthrough_guest_links (created_by);

create table if not exists walkthru.walkthrough_guests (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references walkthru.walkthrough_guest_links(id) on delete cascade,
  walkthrough_id uuid not null references walkthru.walkthroughs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 60),
  joined_at timestamptz not null default now(),
  unique (link_id, user_id)
);
create index if not exists walkthrough_guests_user_walkthrough_idx
  on walkthru.walkthrough_guests (user_id, walkthrough_id);
create index if not exists walkthrough_guests_walkthrough_idx
  on walkthru.walkthrough_guests (walkthrough_id);

alter table walkthru.walkthrough_guest_links enable row level security;
alter table walkthru.walkthrough_guests enable row level security;

-- Reads only; every write goes through the functions below. The secret's
-- hash is never readable.
revoke all on table walkthru.walkthrough_guest_links from public, anon, authenticated;
revoke all on table walkthru.walkthrough_guests from public, anon, authenticated;
grant select (id, walkthrough_id, created_by, role, expires_at, revoked_at, created_at, last_used_at, use_count)
  on walkthru.walkthrough_guest_links to authenticated;
grant select on walkthru.walkthrough_guests to authenticated;
grant all on walkthru.walkthrough_guest_links, walkthru.walkthrough_guests to service_role;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- A live grant: the user came in through a link of this walkthrough that is
-- not turned off and has not run out.
create or replace function walkthru_private.user_has_live_guest_grant(
  p_user_id uuid,
  p_walkthrough_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, walkthru
as $$
  select p_user_id is not null
    and p_walkthrough_id is not null
    and exists (
      select 1
      from walkthru.walkthrough_guests g
      join walkthru.walkthrough_guest_links l on l.id = g.link_id
      where g.user_id = p_user_id
        and g.walkthrough_id = p_walkthrough_id
        and l.walkthrough_id = p_walkthrough_id
        and l.revoked_at is null
        and l.expires_at > now()
    );
$$;
revoke all on function walkthru_private.user_has_live_guest_grant(uuid, uuid) from public, anon, authenticated;
grant execute on function walkthru_private.user_has_live_guest_grant(uuid, uuid) to authenticated, service_role;

-- Any live grant at all (the Storage rules use it).
create or replace function walkthru_private.current_user_has_any_live_guest_grant()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, walkthru
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from walkthru.walkthrough_guests g
      join walkthru.walkthrough_guest_links l on l.id = g.link_id
      where g.user_id = (select auth.uid())
        and l.walkthrough_id = g.walkthrough_id
        and l.revoked_at is null
        and l.expires_at > now()
    );
$$;
revoke all on function walkthru_private.current_user_has_any_live_guest_grant() from public, anon, authenticated;
grant execute on function walkthru_private.current_user_has_any_live_guest_grant() to authenticated, service_role;

-- Ever a guest of this walkthrough (live or not): files they added stay the
-- walkthrough's after the link ends.
create or replace function walkthru_private.storage_path_owner_is_walkthrough_guest(
  p_path_owner_id uuid,
  p_walkthrough_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, walkthru
as $$
  select p_path_owner_id is not null
    and p_walkthrough_id is not null
    and exists (
      select 1 from walkthru.walkthrough_guests g
      where g.user_id = p_path_owner_id
        and g.walkthrough_id = p_walkthrough_id
    );
$$;
revoke all on function walkthru_private.storage_path_owner_is_walkthrough_guest(uuid, uuid) from public, anon, authenticated;
grant execute on function walkthru_private.storage_path_owner_is_walkthrough_guest(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Access: a live guest grant reads and writes its one walkthrough
-- ---------------------------------------------------------------------------
create or replace function walkthru_private.user_can_read_walkthrough(
  p_user_id uuid,
  p_walkthrough_id uuid
)
returns boolean
language sql
security definer
set search_path = pg_catalog, walkthru
stable
as $$
  select p_user_id is not null
    and p_walkthrough_id is not null
    and exists (
      select 1
      from walkthru.walkthroughs w
      where w.id = p_walkthrough_id
        and w.deleted_at is null
        and (
          (w.organization_id is null and w.owner_id = p_user_id)
          or (w.organization_id is not null and exists (
            select 1
            from walkthru.organization_members m
            where m.organization_id = w.organization_id
              and m.user_id = p_user_id
              and m.status = 'active'
          ))
          or (
            p_user_id = (select auth.uid())
            and walkthru_private.current_user_has_active_walkthrough_share(w.id)
          )
          or walkthru_private.user_has_live_guest_grant(p_user_id, w.id)
        )
        and walkthru_private.user_can_access_pending_walkthrough(p_user_id, w.id)
    );
$$;

create or replace function walkthru_private.user_can_write_walkthrough(
  p_user_id uuid,
  p_walkthrough_id uuid
)
returns boolean
language sql
security definer
set search_path = pg_catalog, walkthru
stable
as $$
  select p_user_id is not null
    and p_walkthrough_id is not null
    and exists (
      select 1
      from walkthru.walkthroughs w
      where w.id = p_walkthrough_id
        and w.deleted_at is null
        and (
          (w.organization_id is null and w.owner_id = p_user_id)
          or (w.organization_id is not null and exists (
            select 1
            from walkthru.organization_members m
            where m.organization_id = w.organization_id
              and m.user_id = p_user_id
              and m.status = 'active'
          ))
          or walkthru_private.user_has_live_guest_grant(p_user_id, w.id)
        )
    );
$$;

-- Recordings and AI jobs check the acting user on the server.
create or replace function walkthru_private.audio_actor_can_write_walkthrough(
  p_user_id uuid,
  p_walkthrough_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, walkthru
as $$
  select p_user_id is not null
    and p_walkthrough_id is not null
    and exists (
      select 1
      from walkthru.walkthroughs w
      where w.id = p_walkthrough_id
        and w.deleted_at is null
        and (
          (w.organization_id is null and w.owner_id = p_user_id)
          or (w.organization_id is not null and exists (
            select 1
            from walkthru.organization_members m
            where m.organization_id = w.organization_id
              and m.user_id = p_user_id
              and m.status = 'active'
          ))
          or walkthru_private.user_has_live_guest_grant(p_user_id, w.id)
        )
    );
$$;

create or replace function walkthru_private.lock_actor_walkthrough_write_access(
  p_actor_id uuid,
  p_walkthrough_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, walkthru, walkthru_private, pg_temp
as $$
declare
  v_owner_id uuid;
  v_organization_id uuid;
begin
  select w.owner_id, w.organization_id
    into v_owner_id, v_organization_id
  from walkthru.walkthroughs w
  where w.id = p_walkthrough_id and w.deleted_at is null
  for share;
  if not found then
    raise exception 'walkthrough write authorization failed'
      using errcode = '42501';
  end if;

  -- A live guest of this walkthrough writes like a member; the link row is
  -- locked so turning it off waits for this write.
  perform 1
  from walkthru.walkthrough_guests g
  join walkthru.walkthrough_guest_links l on l.id = g.link_id
  where g.user_id = p_actor_id
    and g.walkthrough_id = p_walkthrough_id
    and l.walkthrough_id = p_walkthrough_id
    and l.revoked_at is null
    and l.expires_at > now()
  for share of l;
  if found then
    return v_organization_id;
  end if;

  if v_organization_id is null then
    if v_owner_id is distinct from p_actor_id then
      raise exception 'walkthrough write authorization failed'
        using errcode = '42501';
    end if;
  else
    perform 1
    from walkthru.organization_members m
    where m.organization_id = v_organization_id
      and m.user_id = p_actor_id
      and m.status = 'active'
    for share;
    if not found then
      raise exception 'walkthrough write authorization failed'
        using errcode = '42501';
    end if;
  end if;

  return v_organization_id;
end;
$$;

-- The app asks this to show a guest's screen (no Share, no settings).
create or replace function walkthru.current_user_walkthrough_guest_role(p_walkthrough_id uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, walkthru, walkthru_private
as $$
  select case
    when walkthru_private.user_has_live_guest_grant((select auth.uid()), p_walkthrough_id)
      then 'editor'
  end;
$$;
revoke all on function walkthru.current_user_walkthrough_guest_role(uuid) from public, anon;
grant execute on function walkthru.current_user_walkthrough_guest_role(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Who sees links and guests
-- ---------------------------------------------------------------------------
drop policy if exists walkthrough_guest_links_manager_read on walkthru.walkthrough_guest_links;
create policy walkthrough_guest_links_manager_read on walkthru.walkthrough_guest_links
  for select to authenticated
  using (not walkthru_private.is_guest_session() and walkthru_private.current_user_can_manage_walkthrough(walkthrough_id));

drop policy if exists walkthrough_guests_read on walkthru.walkthrough_guests;
create policy walkthrough_guests_read on walkthru.walkthrough_guests
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (not walkthru_private.is_guest_session() and walkthru_private.current_user_can_manage_walkthrough(walkthrough_id))
  );

-- ---------------------------------------------------------------------------
-- Make, turn off and redeem links
-- ---------------------------------------------------------------------------
create or replace function walkthru.create_walkthrough_guest_link(
  p_walkthrough_id uuid,
  p_expires_in text
)
returns table (id uuid, token text, role text, expires_at timestamptz)
language plpgsql
volatile
security definer
set search_path = pg_catalog, walkthru, walkthru_private, extensions
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_interval interval;
  v_token text;
  v_row walkthru.walkthrough_guest_links;
begin
  if v_uid is null or walkthru_private.is_guest_session() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if not walkthru_private.current_user_can_manage_walkthrough(p_walkthrough_id) then
    raise exception 'Walkthrough not found' using errcode = '42501';
  end if;
  v_interval := case p_expires_in
    when '4 hours' then interval '4 hours'
    when '1 day' then interval '1 day'
    when '1 week' then interval '7 days'
    when '1 month' then interval '1 month'
    when '2 months' then interval '2 months'
    when '6 months' then interval '6 months'
  end;
  if v_interval is null then
    raise exception 'Pick how long the link works' using errcode = '22023';
  end if;
  if (select count(*) from walkthru.walkthrough_guest_links l
       where l.walkthrough_id = p_walkthrough_id
         and l.revoked_at is null and l.expires_at > now()) >= 20 then
    raise exception 'This walkthrough has 20 live guest links; turn one off first' using errcode = '22023';
  end if;
  -- 244 random bits; only its SHA-256 is kept.
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into walkthru.walkthrough_guest_links (walkthrough_id, created_by, role, token_hash, expires_at)
  values (p_walkthrough_id, v_uid, 'editor',
          encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), now() + v_interval)
  returning * into v_row;
  return query select v_row.id, v_token, v_row.role, v_row.expires_at;
end;
$$;

create or replace function walkthru.revoke_walkthrough_guest_link(p_link_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, walkthru, walkthru_private
as $$
declare
  v_walkthrough_id uuid;
begin
  if auth.uid() is null or walkthru_private.is_guest_session() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select l.walkthrough_id into v_walkthrough_id
  from walkthru.walkthrough_guest_links l where l.id = p_link_id;
  if v_walkthrough_id is null
     or not walkthru_private.current_user_can_manage_walkthrough(v_walkthrough_id) then
    raise exception 'Link not found' using errcode = '42501';
  end if;
  update walkthru.walkthrough_guest_links
     set revoked_at = now()
   where id = p_link_id and revoked_at is null;
  return found;
end;
$$;

-- The guest's side: a signed-in session (usually anonymous) hands over the
-- link's secret and a name. Same answer for an unknown, turned-off or
-- run-out link, so the call says nothing about which links exist.
create or replace function walkthru.redeem_walkthrough_guest_link(p_token text, p_name text)
returns table (walkthrough_id uuid, walkthrough_name text, role text, expires_at timestamptz)
language plpgsql
volatile
security definer
set search_path = pg_catalog, walkthru, walkthru_private, extensions
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_link walkthru.walkthrough_guest_links;
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]]', '', 'g'));
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if char_length(v_name) not between 1 and 60 then
    raise exception 'Type a name of 1 to 60 letters' using errcode = '22023';
  end if;
  select * into v_link from walkthru.walkthrough_guest_links l
   where l.token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
     and l.revoked_at is null
     and l.expires_at > now()
   for update;
  if v_link.id is null then
    raise exception 'This guest link has ended or was turned off' using errcode = '42501';
  end if;
  if (select count(*) from walkthru.walkthrough_guests g
       where g.link_id = v_link.id and g.user_id <> v_uid) >= 50 then
    raise exception 'This guest link is full' using errcode = '42501';
  end if;
  insert into walkthru.walkthrough_guests (link_id, walkthrough_id, user_id, display_name)
  values (v_link.id, v_link.walkthrough_id, v_uid, v_name)
  on conflict (link_id, user_id) do update set display_name = excluded.display_name;
  update walkthru.walkthrough_guest_links
     set use_count = use_count + 1, last_used_at = now()
   where id = v_link.id;
  -- A guest session's name is the one they typed (comments and history show it).
  if walkthru_private.is_guest_session() then
    update walkthru.profiles set display_name = v_name, updated_at = now()
     where id = v_uid;
  end if;
  return query
  select w.id, w.name::text, v_link.role, v_link.expires_at
  from walkthru.walkthroughs w where w.id = v_link.walkthrough_id;
end;
$$;

revoke all on function walkthru.create_walkthrough_guest_link(uuid, text) from public, anon;
revoke all on function walkthru.revoke_walkthrough_guest_link(uuid) from public, anon;
revoke all on function walkthru.redeem_walkthrough_guest_link(text, text) from public, anon;
grant execute on function walkthru.create_walkthrough_guest_link(uuid, text) to authenticated;
grant execute on function walkthru.revoke_walkthrough_guest_link(uuid) to authenticated;
grant execute on function walkthru.redeem_walkthrough_guest_link(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- A guest session makes nothing of its own
-- ---------------------------------------------------------------------------
-- Triggers, not row rules: several of these tables are also written by
-- SECURITY DEFINER functions (new walkthroughs from an upload, companies),
-- which skip row rules but still run triggers as the caller's session.
create or replace function walkthru_private.refuse_guest_session_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if walkthru_private.is_guest_session() then
    raise exception 'Guests cannot do that' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function walkthru_private.refuse_guest_session_write() from public, anon, authenticated;

-- Library Categories (no walkthrough) belong to the team.
create or replace function walkthru_private.refuse_guest_library_node_type_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if walkthru_private.is_guest_session()
     and (
       (tg_op <> 'DELETE' and new.walkthrough_id is null)
       or (tg_op <> 'INSERT' and old.walkthrough_id is null)
     ) then
    raise exception 'Guests cannot do that' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function walkthru_private.refuse_guest_library_node_type_write() from public, anon, authenticated;

do $$
declare
  t record;
begin
  for t in select * from (values
    ('walkthroughs', 'INSERT OR DELETE'),
    ('organizations', 'INSERT OR UPDATE OR DELETE'),
    ('organization_members', 'INSERT OR UPDATE OR DELETE'),
    ('organization_invites', 'INSERT OR UPDATE OR DELETE'),
    ('templates', 'INSERT OR UPDATE OR DELETE'),
    ('template_share_invites', 'INSERT OR UPDATE OR DELETE'),
    ('share_links', 'INSERT OR UPDATE OR DELETE'),
    ('walkthrough_shares', 'INSERT OR UPDATE OR DELETE')
  ) as v(tbl, ops)
  loop
    if to_regclass(format('walkthru.%I', t.tbl)) is null then continue; end if;
    execute format('drop trigger if exists refuse_guest_session_write on walkthru.%I', t.tbl);
    execute format(
      'create trigger refuse_guest_session_write before %s on walkthru.%I for each row execute function walkthru_private.refuse_guest_session_write()',
      t.ops, t.tbl);
  end loop;
end;
$$;

drop trigger if exists refuse_guest_library_node_type_write on walkthru.node_types;
create trigger refuse_guest_library_node_type_write
  before insert or update or delete on walkthru.node_types
  for each row execute function walkthru_private.refuse_guest_library_node_type_write();

-- ---------------------------------------------------------------------------
-- Storage ledger: a guest's files belong to the walkthrough
-- ---------------------------------------------------------------------------
-- Uploads keep the uploader's id as the first folder, so a guest's file has
-- a path owner who is not on the walkthrough's workspace. Without this the
-- ledger calls it a conflict and refuses the bytes. Only the one check that
-- ties a walkthrough-shaped path to its walkthrough's workspace changes; the
-- rest of the function is kept as it is in the database.
do $$
declare
  v_def text;
  v_head constant text := E'    if found then\n      if (\n        v_organization_id is null\n        and v_path_owner_id is distinct from v_owner_id\n      ) or (';
  v_tail constant text := E'        )\n      ) then\n        return query select v_path_owner_id, null::uuid, null::uuid,\n          v_walkthrough_id, v_recording_id, ''unclassified''::text,';
begin
  if to_regprocedure('walkthru_private.resolve_walkthrough_storage_identity(text,text,timestamp with time zone)') is null then
    raise notice 'KAL-610 guest links: no storage ledger here, left as is';
    return;
  end if;
  v_def := pg_get_functiondef('walkthru_private.resolve_walkthrough_storage_identity(text,text,timestamp with time zone)'::regprocedure);
  if position('storage_path_owner_is_walkthrough_guest' in v_def) > 0 then
    return;
  end if;
  if (length(v_def) - length(replace(v_def, v_head, ''))) / length(v_head) <> 1
     or (length(v_def) - length(replace(v_def, v_tail, ''))) / length(v_tail) <> 1 then
    raise exception 'KAL-610 guest links: storage ledger function is not the expected shape';
  end if;
  v_def := replace(v_def, v_head,
    E'    if found then\n      if not walkthru_private.storage_path_owner_is_walkthrough_guest(\n        v_path_owner_id, v_walkthrough_id\n      ) and ((\n        v_organization_id is null\n        and v_path_owner_id is distinct from v_owner_id\n      ) or (');
  v_def := replace(v_def, v_tail,
    E'        )\n      )) then\n        return query select v_path_owner_id, null::uuid, null::uuid,\n          v_walkthrough_id, v_recording_id, ''unclassified''::text,');
  execute v_def;
end;
$$;
$kal610guestssql$;
end;
$kal610guests$;

-- Storage: a live Walkthru guest may write in walkthrough-assets. Walkthru's
-- own bucket rules still decide which files (only ones its walkthrough's
-- rows point at), so this opens nothing beyond that walkthrough.
do $kal610gueststorage$
begin
  if to_regprocedure('walkthru_private.current_user_has_any_live_guest_grant()') is null
     or to_regprocedure('public.is_guest_session()') is null then
    raise notice 'KAL-610 guest storage skipped';
    return;
  end if;
  drop policy if exists "Guests cannot insert" on storage.objects;
  create policy "Guests cannot insert" on storage.objects
    as restrictive for insert to authenticated
    with check (
      not public.is_guest_session()
      or (bucket_id = 'walkthrough-assets' and walkthru_private.current_user_has_any_live_guest_grant())
    );
  drop policy if exists "Guests cannot update" on storage.objects;
  create policy "Guests cannot update" on storage.objects
    as restrictive for update to authenticated
    using (
      not public.is_guest_session()
      or (bucket_id = 'walkthrough-assets' and walkthru_private.current_user_has_any_live_guest_grant())
    )
    with check (
      not public.is_guest_session()
      or (bucket_id = 'walkthrough-assets' and walkthru_private.current_user_has_any_live_guest_grant())
    );
  drop policy if exists "Guests cannot delete" on storage.objects;
  create policy "Guests cannot delete" on storage.objects
    as restrictive for delete to authenticated
    using (
      not public.is_guest_session()
      or (bucket_id = 'walkthrough-assets' and walkthru_private.current_user_has_any_live_guest_grant())
    );
end;
$kal610gueststorage$;
