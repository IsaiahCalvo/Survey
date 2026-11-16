-- Walkthru (schema walkthru), KAL-610: Survey's Comments on marks reach
-- Walkthru. The source is the Walkthru repo (same change, schemas public and
-- private there). Adds walkthru.annotation_comments and its functions.
-- Nothing is removed.
--
-- Production has schema walkthru (KAL-579), but this repo's migrations don't
-- build it, so a fresh local database skips this file instead of failing.
do $kal610comments$
begin
  if to_regclass('walkthru.walkthroughs') is null
     or to_regclass('walkthru.floors') is null
     or to_regclass('walkthru.walkthrough_shares') is null
     or to_regclass('walkthru.organization_members') is null
     or to_regclass('walkthru.profiles') is null
     or to_regprocedure('walkthru_private.current_user_can_write_walkthrough(uuid)') is null
     or to_regprocedure('walkthru_private.current_user_can_read_walkthrough(uuid)') is null
     or to_regprocedure('walkthru_private.current_user_can_manage_walkthrough(uuid)') is null then
    raise notice 'KAL-610 comments skipped: schema walkthru is not in this database';
    return;
  end if;
  execute $kal610commentssql$
-- KAL-610: Survey's Comments on marks in Walkthru. A thread hangs off one
-- annotation (annotation_id) or a whole page (annotation_id null); replies
-- point at the thread's first comment. Adds one table and its functions.
-- Nothing is removed.
--
-- Rows are read by anyone who can open the walkthrough and written ONLY
-- through the functions below, which check access:
--   add_annotation_comment            people who can edit the walkthrough post;
--                                     @mentions keep only people on the walkthrough.
--   edit_annotation_comment           the author changes their own words.
--   delete_annotation_comment         the author or a manager; the row stays as a
--                                     "deleted" stub so replies keep their place.
--   set_annotation_comment_resolved   an editor resolves or reopens a thread.
--   annotation_comment_people         who can be @mentioned.
-- annotation_id has no foreign key: a thread outlives an erased mark.

create table if not exists walkthru.annotation_comments (
  id uuid primary key default gen_random_uuid(),
  walkthrough_id uuid not null references walkthru.walkthroughs(id) on delete cascade,
  thread_id uuid references walkthru.annotation_comments(id) on delete cascade,
  annotation_id uuid,
  floor_id uuid not null references walkthru.floors(id) on delete cascade,
  page_index integer not null check (page_index >= 0),
  author_id uuid references auth.users(id) on delete set null,
  body text not null default '' check (char_length(body) <= 4000),
  mentions uuid[] not null default '{}' check (cardinality(mentions) <= 20),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  check (deleted_at is not null or char_length(btrim(body)) >= 1),
  check (resolved_at is null or thread_id is null)
);

create index if not exists annotation_comments_walkthrough_idx
  on walkthru.annotation_comments (walkthrough_id, created_at);
create index if not exists annotation_comments_thread_idx
  on walkthru.annotation_comments (thread_id) where thread_id is not null;
create index if not exists annotation_comments_author_idx
  on walkthru.annotation_comments (author_id);
create index if not exists annotation_comments_floor_idx
  on walkthru.annotation_comments (floor_id);
create index if not exists annotation_comments_resolved_by_idx
  on walkthru.annotation_comments (resolved_by) where resolved_by is not null;

alter table walkthru.annotation_comments enable row level security;

drop policy if exists annotation_comments_select on walkthru.annotation_comments;
create policy annotation_comments_select on walkthru.annotation_comments
  for select to authenticated
  using (walkthru_private.current_user_can_read_walkthrough(walkthrough_id));

revoke all on walkthru.annotation_comments from public, anon, authenticated;
grant select on walkthru.annotation_comments to authenticated;
grant all on walkthru.annotation_comments to service_role;

-- Whether p_user_id is on the walkthrough: its owner, an active member of its
-- company, or someone it is shared with.
create or replace function walkthru_private.annotation_comment_member(p_walkthrough_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select p_user_id is not null and exists (
    select 1 from walkthru.walkthroughs w
    where w.id = p_walkthrough_id
      and w.deleted_at is null
      and (
        (w.organization_id is null and w.owner_id = p_user_id)
        or (w.organization_id is not null and exists (
          select 1 from walkthru.organization_members m
          where m.organization_id = w.organization_id and m.user_id = p_user_id and m.status = 'active'))
        or exists (
          select 1 from walkthru.walkthrough_shares s
          where s.walkthrough_id = w.id and s.invitee_user_id = p_user_id and s.revoked_at is null)
      )
  );
$fn$;

create or replace function walkthru_private.annotation_comment_clean_mentions(p_walkthrough_id uuid, p_mentions uuid[])
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(array_agg(distinct m), '{}')
  from unnest(coalesce(p_mentions, '{}')) as m
  where m is not null and walkthru_private.annotation_comment_member(p_walkthrough_id, m);
$fn$;

-- People on the walkthrough, for the @mention list and author names.
create or replace function walkthru.annotation_comment_people(p_walkthrough_id uuid)
returns table (user_id uuid, name text, email text)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
#variable_conflict use_column
begin
  if auth.uid() is null or not walkthru_private.current_user_can_read_walkthrough(p_walkthrough_id) then
    return;
  end if;
  return query
  with w as (select id, owner_id, organization_id from walkthru.walkthroughs where id = p_walkthrough_id),
  people as (
    select w.owner_id as uid from w
    union select m.user_id from walkthru.organization_members m, w
      where w.organization_id is not null and m.organization_id = w.organization_id
        and m.status = 'active' and m.user_id is not null
    union select s.invitee_user_id from walkthru.walkthrough_shares s, w
      where s.walkthrough_id = w.id and s.revoked_at is null and s.invitee_user_id is not null
  )
  select u.id,
         nullif(coalesce(p.display_name, u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name'), '')::text,
         u.email::text
  from people
  join auth.users u on u.id = people.uid
  left join walkthru.profiles p on p.id = u.id
  order by 2 nulls last, 3;
end;
$fn$;

create or replace function walkthru.add_annotation_comment(
  p_walkthrough_id uuid,
  p_floor_id uuid,
  p_page_index integer,
  p_body text,
  p_annotation_id uuid default null,
  p_thread_id uuid default null,
  p_mentions uuid[] default '{}',
  p_id uuid default null
)
returns walkthru.annotation_comments
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_root walkthru.annotation_comments;
  v_row walkthru.annotation_comments;
  v_body text := btrim(coalesce(p_body, ''));
begin
  if v_uid is null or not coalesce(walkthru_private.current_user_can_write_walkthrough(p_walkthrough_id), false) then
    raise exception 'Walkthrough not found' using errcode = '42501';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 4000 then
    raise exception 'A comment needs 1 to 4000 characters' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_mentions), 0) > 20 then
    raise exception 'Too many mentions' using errcode = '22023';
  end if;
  -- A comment sent again after a dropped connection is the same comment.
  if p_id is not null then
    select * into v_row from walkthru.annotation_comments where id = p_id;
    if v_row.id is not null then
      if v_row.walkthrough_id <> p_walkthrough_id or v_row.author_id is distinct from v_uid then
        raise exception 'Comment not found' using errcode = '42501';
      end if;
      return v_row;
    end if;
  end if;

  if p_thread_id is not null then
    select * into v_root from walkthru.annotation_comments where id = p_thread_id;
    if v_root.id is null or v_root.walkthrough_id <> p_walkthrough_id or v_root.thread_id is not null then
      raise exception 'Thread not found' using errcode = '22023';
    end if;
    insert into walkthru.annotation_comments
      (id, walkthrough_id, thread_id, annotation_id, floor_id, page_index, author_id, body, mentions)
    values (coalesce(p_id, gen_random_uuid()), p_walkthrough_id, v_root.id, v_root.annotation_id,
            v_root.floor_id, v_root.page_index, v_uid, v_body,
            walkthru_private.annotation_comment_clean_mentions(p_walkthrough_id, p_mentions))
    returning * into v_row;
  else
    if p_page_index is null or p_page_index < 0 or p_floor_id is null
       or not exists (select 1 from walkthru.floors f where f.id = p_floor_id and f.walkthrough_id = p_walkthrough_id) then
      raise exception 'A page is needed' using errcode = '22023';
    end if;
    insert into walkthru.annotation_comments
      (id, walkthrough_id, annotation_id, floor_id, page_index, author_id, body, mentions)
    values (coalesce(p_id, gen_random_uuid()), p_walkthrough_id, p_annotation_id, p_floor_id,
            p_page_index, v_uid, v_body,
            walkthru_private.annotation_comment_clean_mentions(p_walkthrough_id, p_mentions))
    returning * into v_row;
  end if;
  return v_row;
end;
$fn$;

create or replace function walkthru.edit_annotation_comment(p_comment_id uuid, p_body text, p_mentions uuid[] default '{}')
returns walkthru.annotation_comments
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_row walkthru.annotation_comments;
  v_body text := btrim(coalesce(p_body, ''));
begin
  select * into v_row from walkthru.annotation_comments where id = p_comment_id for update;
  if v_uid is null or v_row.id is null or v_row.author_id is distinct from v_uid
     or v_row.deleted_at is not null
     or not coalesce(walkthru_private.current_user_can_write_walkthrough(v_row.walkthrough_id), false) then
    raise exception 'Comment not found' using errcode = '42501';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 4000 then
    raise exception 'A comment needs 1 to 4000 characters' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_mentions), 0) > 20 then
    raise exception 'Too many mentions' using errcode = '22023';
  end if;
  update walkthru.annotation_comments
  set body = v_body,
      mentions = walkthru_private.annotation_comment_clean_mentions(v_row.walkthrough_id, p_mentions),
      edited_at = now()
  where id = v_row.id
  returning * into v_row;
  return v_row;
end;
$fn$;

create or replace function walkthru.delete_annotation_comment(p_comment_id uuid)
returns walkthru.annotation_comments
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_row walkthru.annotation_comments;
begin
  select * into v_row from walkthru.annotation_comments where id = p_comment_id for update;
  if v_uid is null or v_row.id is null
     or not (
       (v_row.author_id is not distinct from v_uid
        and coalesce(walkthru_private.current_user_can_write_walkthrough(v_row.walkthrough_id), false))
       or coalesce(walkthru_private.current_user_can_manage_walkthrough(v_row.walkthrough_id), false)
     ) then
    raise exception 'Comment not found' using errcode = '42501';
  end if;
  if v_row.deleted_at is not null then
    return v_row;
  end if;
  update walkthru.annotation_comments
  set body = '', mentions = '{}', deleted_at = now()
  where id = v_row.id
  returning * into v_row;
  return v_row;
end;
$fn$;

create or replace function walkthru.set_annotation_comment_resolved(p_comment_id uuid, p_resolved boolean)
returns walkthru.annotation_comments
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_row walkthru.annotation_comments;
begin
  select * into v_row from walkthru.annotation_comments where id = p_comment_id for update;
  if v_uid is null or v_row.id is null
     or not coalesce(walkthru_private.current_user_can_write_walkthrough(v_row.walkthrough_id), false) then
    raise exception 'Comment not found' using errcode = '42501';
  end if;
  if v_row.thread_id is not null then
    raise exception 'Only a whole thread can be resolved' using errcode = '22023';
  end if;
  -- Resolving twice keeps the first time and person.
  if coalesce(p_resolved, false) then
    if v_row.resolved_at is not null then
      return v_row;
    end if;
    update walkthru.annotation_comments set resolved_at = now(), resolved_by = v_uid
    where id = v_row.id returning * into v_row;
  else
    update walkthru.annotation_comments set resolved_at = null, resolved_by = null
    where id = v_row.id returning * into v_row;
  end if;
  return v_row;
end;
$fn$;

revoke all on function walkthru_private.annotation_comment_member(uuid, uuid) from public, anon, authenticated;
revoke all on function walkthru_private.annotation_comment_clean_mentions(uuid, uuid[]) from public, anon, authenticated;
grant execute on function walkthru_private.annotation_comment_member(uuid, uuid) to service_role;
grant execute on function walkthru_private.annotation_comment_clean_mentions(uuid, uuid[]) to service_role;
revoke all on function walkthru.annotation_comment_people(uuid) from public, anon;
grant execute on function walkthru.annotation_comment_people(uuid) to authenticated, service_role;
revoke all on function walkthru.add_annotation_comment(uuid, uuid, integer, text, uuid, uuid, uuid[], uuid) from public, anon;
grant execute on function walkthru.add_annotation_comment(uuid, uuid, integer, text, uuid, uuid, uuid[], uuid) to authenticated;
revoke all on function walkthru.edit_annotation_comment(uuid, text, uuid[]) from public, anon;
grant execute on function walkthru.edit_annotation_comment(uuid, text, uuid[]) to authenticated;
revoke all on function walkthru.delete_annotation_comment(uuid) from public, anon;
grant execute on function walkthru.delete_annotation_comment(uuid) to authenticated;
revoke all on function walkthru.set_annotation_comment_resolved(uuid, boolean) from public, anon;
grant execute on function walkthru.set_annotation_comment_resolved(uuid, boolean) to authenticated;

-- Live: other screens see a new comment at once (Realtime applies the select
-- policy above).
do $pub$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'walkthru' and tablename = 'annotation_comments'
     ) then
    alter publication supabase_realtime add table walkthru.annotation_comments;
  end if;
end;
$pub$;
$kal610commentssql$;
end;
$kal610comments$;
