-- Walkthru (schema walkthru), KAL-730: the OneDrive file a floor's plan PDF
-- was opened from, for "Save back to OneDrive". The source is the Walkthru
-- repo (same change, schemas public and private there). Adds
-- walkthru.floor_drive_links. Nothing is removed.
--
-- Production has schema walkthru (KAL-579), but this repo's migrations don't
-- build it, so a fresh local database skips this file instead of failing.
do $kal730links$
begin
  if to_regclass('walkthru.walkthroughs') is null
     or to_regclass('walkthru.floors') is null
     or to_regprocedure('walkthru_private.current_user_can_write_walkthrough(uuid)') is null
     or to_regprocedure('walkthru_private.current_user_can_read_walkthrough(uuid)') is null then
    raise notice 'KAL-730 floor drive links skipped: schema walkthru is not in this database';
    return;
  end if;
  execute $kal730linkssql$
-- KAL-730: the OneDrive file a floor's plan PDF was opened from, so "Save
-- back to OneDrive" (Nightly flag "onedrive") can write the marked-up PDF
-- over that same file. One link per floor. Each save runs with the
-- Microsoft sign-in of the person who presses it. Adds one table. Nothing
-- is removed.
--
-- e_tag: the file's version Walkthru last read or wrote. Microsoft refuses
-- a save over a newer version, and Walkthru asks first.
-- c_tag: the content version. A rename or move changes the eTag but not the
-- cTag, so it is no conflict.
create table if not exists walkthru.floor_drive_links (
  floor_id uuid primary key references walkthru.floors(id) on delete cascade,
  walkthrough_id uuid not null references walkthru.walkthroughs(id) on delete cascade,
  drive_id text not null check (char_length(drive_id) between 1 and 200),
  item_id text not null check (char_length(item_id) between 1 and 200),
  name text not null check (char_length(name) between 1 and 300),
  web_url text check (web_url is null or char_length(web_url) <= 2000),
  e_tag text check (e_tag is null or char_length(e_tag) <= 300),
  c_tag text check (c_tag is null or char_length(c_tag) <= 300),
  linked_by uuid references auth.users(id) on delete set null,
  last_saved_at timestamptz,
  last_saved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists floor_drive_links_walkthrough_idx on walkthru.floor_drive_links (walkthrough_id);
create index if not exists floor_drive_links_linked_by_idx on walkthru.floor_drive_links (linked_by);
create index if not exists floor_drive_links_last_saved_by_idx on walkthru.floor_drive_links (last_saved_by);

alter table walkthru.floor_drive_links enable row level security;

-- Anyone who can open the walkthrough sees that a floor has a OneDrive
-- file; people who can edit it link, save back and unlink. The floor must
-- belong to the walkthrough named on the row.
drop policy if exists floor_drive_links_select on walkthru.floor_drive_links;
create policy floor_drive_links_select on walkthru.floor_drive_links
  for select to authenticated
  using (walkthru_private.current_user_can_read_walkthrough(walkthrough_id));
drop policy if exists floor_drive_links_insert on walkthru.floor_drive_links;
create policy floor_drive_links_insert on walkthru.floor_drive_links
  for insert to authenticated
  with check (
    walkthru_private.current_user_can_write_walkthrough(walkthrough_id)
    and exists (select 1 from walkthru.floors f where f.id = floor_drive_links.floor_id and f.walkthrough_id = floor_drive_links.walkthrough_id)
  );
drop policy if exists floor_drive_links_update on walkthru.floor_drive_links;
create policy floor_drive_links_update on walkthru.floor_drive_links
  for update to authenticated
  using (walkthru_private.current_user_can_write_walkthrough(walkthrough_id))
  with check (
    walkthru_private.current_user_can_write_walkthrough(walkthrough_id)
    and exists (select 1 from walkthru.floors f where f.id = floor_drive_links.floor_id and f.walkthrough_id = floor_drive_links.walkthrough_id)
  );
drop policy if exists floor_drive_links_delete on walkthru.floor_drive_links;
create policy floor_drive_links_delete on walkthru.floor_drive_links
  for delete to authenticated
  using (walkthru_private.current_user_can_write_walkthrough(walkthrough_id));

revoke all on walkthru.floor_drive_links from public, anon, authenticated;
grant select, insert, update, delete on walkthru.floor_drive_links to authenticated;
grant all on walkthru.floor_drive_links to service_role;
$kal730linkssql$;
end;
$kal730links$;
