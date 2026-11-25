-- Walkthru tester report #347: a walk's Audio total on the home page showed
-- "—" for audio clips added to a Node. The total summed only whole-walk
-- recordings (walkthru.audio_recordings); Node clips live in
-- walkthru.media_assets (kind 'audio') and are now counted too. Walkthru
-- writes each new clip's duration_ms from the browser (Walkthu PR for #347);
-- older clips have none and still count as 0.
-- Same signature, same result columns, same caller rights: only audio_totals changes.

-- Walkthru runs in its own schema on the shared database; a fresh local stack
-- (E2E) has no walkthru schema, so this is skipped there.
do $walkthruhomeaudio$
begin
  if to_regprocedure('walkthru.get_walkthrough_home_summary(integer,timestamp with time zone,uuid)') is null then
    return;
  end if;
  execute $migration$
create or replace function walkthru.get_walkthrough_home_summary(
  p_limit integer default 51,
  p_before_updated_at timestamp with time zone default null::timestamp with time zone,
  p_before_id uuid default null::uuid
)
returns table(
  id uuid, name text, address text, status text, updated_at timestamp with time zone, owner_id uuid,
  floors_count integer, nodes_count integer, notes_count integer, photos_count integer, audio_ms bigint,
  file_format text, thumbnail_asset_id uuid, thumbnail_asset_kind text, thumbnail_asset_format text,
  thumbnail_asset_storage_path text, thumbnail_asset_original_filename text,
  thumbnail_asset_width integer, thumbnail_asset_height integer
)
language sql
stable
set search_path to 'walkthru', 'pg_temp'
as $function$
  with page_bounds as (
    select least(greatest(coalesce(p_limit, 51), 1), 101) as row_limit
  ),
  visible_walkthroughs as (
    select w.id, w.name, w.address, w.status, w.updated_at, w.owner_id
    from walkthru.walkthroughs w
    where w.deleted_at is null
      and (
        (p_before_updated_at is null and p_before_id is null)
        or (
          p_before_updated_at is not null
          and p_before_id is not null
          and (
            w.updated_at < p_before_updated_at
            or (
              w.updated_at = p_before_updated_at
              and w.id < p_before_id
            )
          )
        )
      )
    order by w.updated_at desc, w.id desc
    limit (select row_limit from page_bounds)
  ),
  floor_counts as (
    select f.walkthrough_id, count(*)::integer as floors_count
    from walkthru.floors f
    join visible_walkthroughs vw on vw.id = f.walkthrough_id
    where f.deleted_at is null
    group by f.walkthrough_id
  ),
  node_counts as (
    select n.walkthrough_id, count(*)::integer as nodes_count
    from walkthru.nodes n
    join visible_walkthroughs vw on vw.id = n.walkthrough_id
    where n.deleted_at is null
    group by n.walkthrough_id
  ),
  note_counts as (
    select n.walkthrough_id, count(*)::integer as notes_count
    from walkthru.notes n
    join visible_walkthroughs vw on vw.id = n.walkthrough_id
    where n.deleted_at is null
    group by n.walkthrough_id
  ),
  photo_counts as (
    select m.walkthrough_id, count(*)::integer as photos_count
    from walkthru.media_assets m
    join visible_walkthroughs vw on vw.id = m.walkthrough_id
    where m.deleted_at is null
      and m.kind = 'photo'
    group by m.walkthrough_id
  ),
  audio_parts as (
    select a.walkthrough_id, a.duration_ms::bigint as ms
    from walkthru.audio_recordings a
    join visible_walkthroughs vw on vw.id = a.walkthrough_id
    where a.deleted_at is null
      and a.ended_at is not null
    union all
    select m.walkthrough_id, m.duration_ms::bigint as ms
    from walkthru.media_assets m
    join visible_walkthroughs vw on vw.id = m.walkthrough_id
    where m.deleted_at is null
      and m.kind = 'audio'
  ),
  audio_totals as (
    select ap.walkthrough_id, coalesce(sum(ap.ms), 0)::bigint as audio_ms
    from audio_parts ap
    group by ap.walkthrough_id
  ),
  thumbnail_candidates as (
    select
      f.walkthrough_id,
      fa.id,
      fa.kind,
      fa.format,
      fa.storage_path,
      fa.original_filename,
      fa.width,
      fa.height,
      row_number() over (
        partition by f.walkthrough_id
        order by
          f.level_index asc,
          f.created_at asc,
          f.id asc,
          case when fa.id = f.active_asset_id then 0 else 1 end,
          fa.created_at asc,
          fa.id asc
      ) as asset_rank
    from walkthru.floors f
    join visible_walkthroughs vw on vw.id = f.walkthrough_id
    join walkthru.floor_assets fa on fa.floor_id = f.id
    where f.deleted_at is null
      and fa.deleted_at is null
  )
  select
    vw.id,
    vw.name,
    vw.address,
    vw.status,
    vw.updated_at,
    vw.owner_id,
    coalesce(fc.floors_count, 0) as floors_count,
    coalesce(nc.nodes_count, 0) as nodes_count,
    coalesce(ntc.notes_count, 0) as notes_count,
    coalesce(pc.photos_count, 0) as photos_count,
    coalesce(aud.audio_ms, 0) as audio_ms,
    tc.format as file_format,
    tc.id as thumbnail_asset_id,
    tc.kind as thumbnail_asset_kind,
    tc.format as thumbnail_asset_format,
    tc.storage_path as thumbnail_asset_storage_path,
    tc.original_filename as thumbnail_asset_original_filename,
    tc.width as thumbnail_asset_width,
    tc.height as thumbnail_asset_height
  from visible_walkthroughs vw
  left join floor_counts fc on fc.walkthrough_id = vw.id
  left join node_counts nc on nc.walkthrough_id = vw.id
  left join note_counts ntc on ntc.walkthrough_id = vw.id
  left join photo_counts pc on pc.walkthrough_id = vw.id
  left join audio_totals aud on aud.walkthrough_id = vw.id
  left join thumbnail_candidates tc
    on tc.walkthrough_id = vw.id
   and tc.asset_rank = 1
  order by vw.updated_at desc, vw.id desc;
$function$;
$migration$;
end
$walkthruhomeaudio$;
