-- Walkthru (schema walkthru), KAL-600: drawing revisions. The source is the
-- Walkthru repo (PR 181, same file name). Adds only: one private table and
-- three server-only functions; nothing is removed or changed.
--
-- Production has schema walkthru (Walkthru's tables moved here, KAL-579), but
-- this repo's migrations don't build it, so a fresh local database skips this
-- file instead of failing.
do $kal600$
begin
  if to_regclass('walkthru.floors') is null
     or to_regnamespace('walkthru_private') is null then
    raise notice 'KAL-600 skipped: schema walkthru is not in this database';
    return;
  end if;
  execute $kal600sql$

create table walkthru_private.drawing_revision_uploads (
  asset_id uuid primary key,
  preview_asset_id uuid unique,
  walkthrough_id uuid not null references walkthru.walkthroughs(id) on delete cascade,
  floor_id uuid not null references walkthru.floors(id) on delete cascade,
  actor_id uuid not null,
  previous_asset_id uuid not null,
  storage_path text not null,
  preview_storage_path text,
  status text not null default 'pending'
    check (status in ('pending', 'finalized', 'canceled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index drawing_revision_uploads_floor_idx
  on walkthru_private.drawing_revision_uploads(floor_id, status);
alter table walkthru_private.drawing_revision_uploads enable row level security;
revoke all on walkthru_private.drawing_revision_uploads
  from public, anon, authenticated, service_role;

create or replace function walkthru.create_drawing_revision_upload(
  p_walkthrough_id uuid,
  p_floor_id uuid,
  p_asset_id uuid,
  p_actor_id uuid,
  p_format text,
  p_storage_path text,
  p_original_filename text,
  p_preview_asset_id uuid default null,
  p_preview_storage_path text default null,
  p_preview_width integer default null,
  p_preview_height integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_floor walkthru.floors%rowtype;
  v_version integer;
  v_stale record;
  v_removed text[] := '{}';
  v_prefix text := p_actor_id::text || '/' || p_walkthrough_id::text || '/';
begin
  if not walkthru_private.is_trusted_audio_server_request() then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_walkthrough_id is null or p_floor_id is null or p_asset_id is null
     or p_actor_id is null or p_asset_id = p_preview_asset_id
     or nullif(trim(coalesce(p_original_filename, '')), '') is null
     or length(p_original_filename) > 255
     or p_storage_path is null or left(p_storage_path, length(v_prefix)) <> v_prefix
     or position('..' in p_storage_path) > 0 then
    raise exception 'drawing revision input is invalid' using errcode = '22023';
  end if;
  if p_format = 'pdf' then
    if p_preview_asset_id is null
       or p_preview_storage_path is null
       or p_preview_storage_path = p_storage_path
       or left(p_preview_storage_path, length(v_prefix)) <> v_prefix
       or position('..' in p_preview_storage_path) > 0
       or p_preview_width is null or p_preview_width <= 0
       or p_preview_height is null or p_preview_height <= 0
       or greatest(p_preview_width, p_preview_height) > 1280 then
      raise exception 'drawing revision preview is invalid' using errcode = '22023';
    end if;
  elsif p_format not in ('png', 'jpeg', 'webp')
        or p_preview_asset_id is not null
        or p_preview_storage_path is not null then
    raise exception 'drawing revision format is invalid' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('walkthrough-upload:' || p_walkthrough_id::text, 0)
  );
  v_org := walkthru_private.lock_actor_walkthrough_write_access(
    p_actor_id, p_walkthrough_id
  );

  select * into v_floor from walkthru.floors floor
  where floor.id = p_floor_id
    and floor.walkthrough_id = p_walkthrough_id
    and floor.deleted_at is null
    and floor.active_asset_id is not null
  for update;
  if not found then
    raise exception 'drawing is unavailable' using errcode = '42501';
  end if;

  -- One upload at a time per floor. An abandoned one gives way after 30
  -- minutes; its rows go and its files are handed back for removal.
  for v_stale in
    select upload.* from walkthru_private.drawing_revision_uploads upload
    where upload.floor_id = p_floor_id and upload.status = 'pending'
    for update
  loop
    if v_stale.created_at > now() - interval '30 minutes' then
      raise exception 'another new version of this drawing is uploading'
        using errcode = '55000';
    end if;
    update walkthru_private.drawing_revision_uploads
    set status = 'canceled', updated_at = now()
    where asset_id = v_stale.asset_id;
    delete from walkthru.floor_assets where id = v_stale.preview_asset_id;
    delete from walkthru.floor_assets where id = v_stale.asset_id;
    v_removed := v_removed || array_remove(
      array[v_stale.storage_path, v_stale.preview_storage_path], null
    );
  end loop;

  select coalesce(max(asset.version), 0) + 1 into v_version
  from walkthru.floor_assets asset
  where asset.floor_id = p_floor_id;

  insert into walkthru.floor_assets(
    id, owner_id, organization_id, walkthrough_id, floor_id, client_id,
    version, kind, format, storage_path, original_filename
  ) values (
    p_asset_id, p_actor_id, v_org, p_walkthrough_id, p_floor_id,
    gen_random_uuid()::text, v_version, 'source', p_format, p_storage_path,
    p_original_filename
  );
  if p_preview_asset_id is not null then
    insert into walkthru.floor_assets(
      id, owner_id, organization_id, walkthrough_id, floor_id, client_id,
      version, kind, format, storage_path, original_filename, width, height,
      source_asset_id
    ) values (
      p_preview_asset_id, p_actor_id, v_org, p_walkthrough_id, p_floor_id,
      gen_random_uuid()::text, v_version, 'raster', 'jpeg',
      p_preview_storage_path, 'first-page.jpg', p_preview_width,
      p_preview_height, p_asset_id
    );
  end if;

  insert into walkthru_private.drawing_revision_uploads(
    asset_id, preview_asset_id, walkthrough_id, floor_id, actor_id,
    previous_asset_id, storage_path, preview_storage_path
  ) values (
    p_asset_id, p_preview_asset_id, p_walkthrough_id, p_floor_id, p_actor_id,
    v_floor.active_asset_id, p_storage_path, p_preview_storage_path
  );

  return jsonb_build_object('version', v_version, 'removed', to_jsonb(v_removed));
end;
$$;

create or replace function walkthru.finalize_drawing_revision(
  p_walkthrough_id uuid,
  p_floor_id uuid,
  p_asset_id uuid,
  p_actor_id uuid,
  p_page_count integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_upload walkthru_private.drawing_revision_uploads%rowtype;
  v_version integer;
  v_order jsonb;
  v_new_order jsonb;
  v_used integer[];
begin
  if not walkthru_private.is_trusted_audio_server_request() then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_page_count is null or p_page_count < 1 or p_page_count > 1000000 then
    raise exception 'drawing revision page count is invalid' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('walkthrough-upload:' || p_walkthrough_id::text, 0)
  );
  perform walkthru_private.lock_actor_walkthrough_write_access(
    p_actor_id, p_walkthrough_id
  );

  select * into v_upload from walkthru_private.drawing_revision_uploads upload
  where upload.asset_id = p_asset_id
    and upload.walkthrough_id = p_walkthrough_id
    and upload.floor_id = p_floor_id
    and upload.actor_id = p_actor_id
  for update;
  if not found or v_upload.status = 'canceled' then
    raise exception 'drawing revision upload changed' using errcode = '55000';
  end if;

  select asset.version into v_version from walkthru.floor_assets asset
  where asset.id = p_asset_id;

  if v_upload.status = 'finalized' then
    if exists (
      select 1 from walkthru.floors floor
      where floor.id = p_floor_id and floor.active_asset_id = p_asset_id
    ) then
      return jsonb_build_object('status', 'finalized', 'version', v_version);
    end if;
    raise exception 'drawing revision upload changed' using errcode = '55000';
  end if;

  perform 1 from walkthru.floors floor
  where floor.id = p_floor_id
    and floor.walkthrough_id = p_walkthrough_id
    and floor.deleted_at is null
    and floor.active_asset_id = v_upload.previous_asset_id
  for update;
  if not found then
    raise exception 'drawing changed while uploading' using errcode = '40001';
  end if;

  perform 1 from walkthru.floor_assets source
  where source.id = p_asset_id
    and source.floor_id = p_floor_id
    and source.walkthrough_id = p_walkthrough_id
    and source.kind = 'source'
    and source.storage_path = v_upload.storage_path
    and source.deleted_at is null
  for update;
  if not found then
    raise exception 'drawing revision upload changed' using errcode = '55000';
  end if;

  if not exists (
    select 1 from storage.objects object
    where object.bucket_id = 'walkthrough-assets'
      and object.name = v_upload.storage_path
  ) or (
    v_upload.preview_storage_path is not null
    and not exists (
      select 1 from storage.objects object
      where object.bucket_id = 'walkthrough-assets'
        and object.name = v_upload.preview_storage_path
    )
  ) then
    raise exception 'drawing revision files are missing' using errcode = '55000';
  end if;
  if v_upload.preview_asset_id is not null
     and not walkthru_private.pdf_first_page_preview_is_attested(
       v_upload.preview_asset_id, v_upload.preview_storage_path
     ) then
    raise exception 'PDF preview requires a validated byte attestation'
      using errcode = '55000';
  end if;

  -- Pages of the file are 0..count-1; pages added in Walkthru sit above
  -- 1,000,000 and point at a file page with sourcePageIndex.
  select array_agg(distinct page order by page) into v_used
  from (
    select node.page_index page from walkthru.nodes node
    where node.floor_id = p_floor_id and node.deleted_at is null
      and node.page_index >= p_page_count and node.page_index <= 1000000
    union
    select annotation.page_index from walkthru.annotations annotation
    where annotation.floor_id = p_floor_id and annotation.deleted_at is null
      and annotation.page_index >= p_page_count and annotation.page_index <= 1000000
  ) used;

  select walkthrough.page_order into v_order from walkthru.walkthroughs walkthrough
  where walkthrough.id = p_walkthrough_id and walkthrough.deleted_at is null
  for update;

  select array_agg(distinct page order by page) into v_used
  from (
    select unnest(coalesce(v_used, '{}')) page
    union
    select (entry ->> 'sourcePageIndex')::integer
    from jsonb_array_elements(v_order) entry
    where entry ->> 'floorId' = p_floor_id::text
      and entry ? 'sourcePageIndex'
      and (entry ->> 'sourcePageIndex')::integer >= p_page_count
  ) used;
  if coalesce(array_length(v_used, 1), 0) > 0 then
    return jsonb_build_object('status', 'pages_in_use', 'pages', to_jsonb(v_used));
  end if;

  select coalesce(jsonb_agg(
    case when entry ->> 'floorId' = p_floor_id::text
      then jsonb_set(entry, '{assetId}', to_jsonb(p_asset_id::text))
      else entry end
    order by position
  ), '[]'::jsonb) into v_new_order
  from jsonb_array_elements(v_order) with ordinality item(entry, position)
  where not (
    entry ->> 'floorId' = p_floor_id::text
    and (entry ->> 'pageIndex')::bigint >= p_page_count
    and (entry ->> 'pageIndex')::bigint <= 1000000
  );
  -- Dropping the floor's extra pages must still leave one page to show.
  if jsonb_array_length(v_new_order) > 0 and not exists (
    select 1 from jsonb_array_elements(v_new_order) entry
    where coalesce(entry -> 'hidden', 'false'::jsonb) <> 'true'::jsonb
  ) then
    v_new_order := '[]'::jsonb;
  end if;

  if v_new_order is distinct from v_order then
    update walkthru.walkthroughs
    set page_order = v_new_order, page_order_revision = page_order_revision + 1
    where id = p_walkthrough_id;
  end if;

  update walkthru.floors
  set active_asset_id = p_asset_id, updated_at = now()
  where id = p_floor_id;

  update walkthru_private.drawing_revision_uploads
  set status = 'finalized', updated_at = now()
  where asset_id = p_asset_id;

  return jsonb_build_object('status', 'finalized', 'version', v_version);
end;
$$;

create or replace function walkthru.cancel_drawing_revision_upload(
  p_walkthrough_id uuid,
  p_floor_id uuid,
  p_asset_id uuid,
  p_actor_id uuid
)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_upload walkthru_private.drawing_revision_uploads%rowtype;
begin
  if not walkthru_private.is_trusted_audio_server_request() then
    raise exception 'service role required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('walkthrough-upload:' || p_walkthrough_id::text, 0)
  );
  select * into v_upload from walkthru_private.drawing_revision_uploads upload
  where upload.asset_id = p_asset_id
    and upload.walkthrough_id = p_walkthrough_id
    and upload.floor_id = p_floor_id
    and upload.actor_id = p_actor_id
  for update;
  -- A finished version is kept for good; only an unfinished upload goes.
  if not found or v_upload.status = 'finalized' then
    return null;
  end if;
  if v_upload.status = 'pending' then
    update walkthru_private.drawing_revision_uploads
    set status = 'canceled', updated_at = now()
    where asset_id = p_asset_id;
    delete from walkthru.floor_assets
    where id = v_upload.preview_asset_id and floor_id = p_floor_id;
    delete from walkthru.floor_assets
    where id = p_asset_id and floor_id = p_floor_id;
  end if;
  return array_remove(
    array[v_upload.storage_path, v_upload.preview_storage_path], null
  );
end;
$$;

revoke all on function walkthru.create_drawing_revision_upload(
  uuid, uuid, uuid, uuid, text, text, text, uuid, text, integer, integer
) from public, anon, authenticated;
revoke all on function walkthru.finalize_drawing_revision(uuid, uuid, uuid, uuid, integer)
  from public, anon, authenticated;
revoke all on function walkthru.cancel_drawing_revision_upload(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function walkthru.create_drawing_revision_upload(
  uuid, uuid, uuid, uuid, text, text, text, uuid, text, integer, integer
) to service_role;
grant execute on function walkthru.finalize_drawing_revision(uuid, uuid, uuid, uuid, integer)
  to service_role;
grant execute on function walkthru.cancel_drawing_revision_upload(uuid, uuid, uuid, uuid)
  to service_role;

  $kal600sql$;
  notify pgrst, 'reload schema';
end
$kal600$;
