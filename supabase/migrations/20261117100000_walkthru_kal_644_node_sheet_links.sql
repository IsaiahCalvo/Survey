-- Walkthru (schema walkthru), KAL-644 slice 4: a live Excel workbook of a
-- walkthrough's node list. The source is the Walkthru repo (same change,
-- schemas public and private there). Adds walkthru.node_sheet_links.
-- Nothing is removed.
--
-- Production has schema walkthru (KAL-579), but this repo's migrations don't
-- build it, so a fresh local database skips this file instead of failing.
do $kal644sheets$
begin
  if to_regclass('walkthru.walkthroughs') is null
     or to_regprocedure('walkthru_private.current_user_can_write_walkthrough(uuid)') is null
     or to_regprocedure('walkthru_private.current_user_can_read_walkthrough(uuid)') is null then
    raise notice 'KAL-644 node sheet links skipped: schema walkthru is not in this database';
    return;
  end if;
  execute $kal644sheetssql$
-- KAL-644 slice 4: a live Excel workbook of a walkthrough's node list, kept
-- in step both ways by "Sync with Excel" (Nightly flag "onedrive"). One
-- workbook per walkthrough, in someone's OneDrive or SharePoint; each sync
-- runs with the Microsoft sign-in of the person who presses it. Adds one
-- table. Nothing is removed.
--
-- baseline: the values each node had in the workbook after the last sync
-- ({ nodeId: { title, location, notes } }). A cell that differs from it was
-- changed in Excel; a node value that differs from it was changed in
-- Walkthru. Both changed: Walkthru's value stays and the sync says so.
create table if not exists walkthru.node_sheet_links (
  walkthrough_id uuid primary key references walkthru.walkthroughs(id) on delete cascade,
  drive_id text not null check (char_length(drive_id) between 1 and 200),
  item_id text not null check (char_length(item_id) between 1 and 200),
  name text not null check (char_length(name) between 1 and 300),
  web_url text check (web_url is null or char_length(web_url) <= 2000),
  e_tag text check (e_tag is null or char_length(e_tag) <= 300),
  baseline jsonb not null default '{}'::jsonb
    check (jsonb_typeof(baseline) = 'object' and pg_column_size(baseline) <= 4194304),
  linked_by uuid references auth.users(id) on delete set null,
  last_synced_at timestamptz,
  last_synced_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists node_sheet_links_linked_by_idx on walkthru.node_sheet_links (linked_by);
create index if not exists node_sheet_links_last_synced_by_idx on walkthru.node_sheet_links (last_synced_by);

alter table walkthru.node_sheet_links enable row level security;

-- Anyone who can open the walkthrough sees that it has a workbook; people
-- who can edit it link, sync and unlink. A guest session cannot connect
-- Microsoft, so it never gets this far.
drop policy if exists node_sheet_links_select on walkthru.node_sheet_links;
create policy node_sheet_links_select on walkthru.node_sheet_links
  for select to authenticated
  using (walkthru_private.current_user_can_read_walkthrough(walkthrough_id));
drop policy if exists node_sheet_links_insert on walkthru.node_sheet_links;
create policy node_sheet_links_insert on walkthru.node_sheet_links
  for insert to authenticated
  with check (walkthru_private.current_user_can_write_walkthrough(walkthrough_id));
drop policy if exists node_sheet_links_update on walkthru.node_sheet_links;
create policy node_sheet_links_update on walkthru.node_sheet_links
  for update to authenticated
  using (walkthru_private.current_user_can_write_walkthrough(walkthrough_id))
  with check (walkthru_private.current_user_can_write_walkthrough(walkthrough_id));
drop policy if exists node_sheet_links_delete on walkthru.node_sheet_links;
create policy node_sheet_links_delete on walkthru.node_sheet_links
  for delete to authenticated
  using (walkthru_private.current_user_can_write_walkthrough(walkthrough_id));

revoke all on walkthru.node_sheet_links from public, anon, authenticated;
grant select, insert, update, delete on walkthru.node_sheet_links to authenticated;
grant all on walkthru.node_sheet_links to service_role;
$kal644sheetssql$;
end;
$kal644sheets$;
