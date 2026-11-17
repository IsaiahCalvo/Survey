-- KAL-595: a Walkthru tab in a Survey Project (Kal Voe suite, Nightly flag
-- `suite`).
--
-- "Add a Walkthru walk" (KAL-594) copies a walk's PDFs and Category nodes into
-- a Project. This remembers which walk went to which Project, so the Project
-- can show a Walkthru tab, and lets everyone in the Project read that walk
-- (nodes, notes, photos, audio, transcripts, next actions) read only, whether
-- or not they can open it in Walkthru. Only adds things; nothing is removed.

-- 1. Which walk is in which Project -------------------------------------------
create table if not exists public.project_walkthroughs (
  project_id uuid not null references public.projects(id) on delete cascade,
  walkthrough_id uuid not null references walkthru.walkthroughs(id) on delete cascade,
  added_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, walkthrough_id)
);

create index if not exists project_walkthroughs_walkthrough_idx
  on public.project_walkthroughs (walkthrough_id);

comment on table public.project_walkthroughs is
  'KAL-595: Walkthru walks added to a Survey Project. Project members read the walk through walkthru.get_project_walkthrough().';

alter table public.project_walkthroughs enable row level security;

drop policy if exists project_walkthroughs_select on public.project_walkthroughs;
create policy project_walkthroughs_select on public.project_walkthroughs
  for select to authenticated
  using (public.user_can_access_project(project_id, 'viewer'));

-- Adding a walk needs edit rights on the Project AND the walk itself: the
-- subquery runs under walkthru's own row rules, so nobody can attach a walk
-- they cannot open in Walkthru.
drop policy if exists project_walkthroughs_insert on public.project_walkthroughs;
create policy project_walkthroughs_insert on public.project_walkthroughs
  for insert to authenticated
  with check (
    public.user_can_access_project(project_id, 'editor')
    and exists (
      select 1 from walkthru.walkthroughs w
      where w.id = walkthrough_id and w.deleted_at is null
    )
  );

drop policy if exists project_walkthroughs_update on public.project_walkthroughs;
create policy project_walkthroughs_update on public.project_walkthroughs
  for update to authenticated
  using (public.user_can_access_project(project_id, 'editor'))
  with check (
    public.user_can_access_project(project_id, 'editor')
    and exists (
      select 1 from walkthru.walkthroughs w
      where w.id = walkthrough_id and w.deleted_at is null
    )
  );

drop policy if exists project_walkthroughs_delete on public.project_walkthroughs;
create policy project_walkthroughs_delete on public.project_walkthroughs
  for delete to authenticated
  using (public.user_can_access_project(project_id, 'editor'));

grant select, insert, update, delete on public.project_walkthroughs to authenticated;

-- 2. The walks of one Project, with what each holds -----------------------------
-- Security definer because a Project member may have no Walkthru access; the
-- Project check is the gate.
create or replace function public.list_project_walkthroughs(p_project_id uuid)
returns table (
  walkthrough_id uuid,
  name text,
  address text,
  updated_at timestamptz,
  added_at timestamptz,
  floors integer,
  nodes integer,
  plain_nodes integer,
  photos integer,
  videos integer,
  audio integer,
  notes integer,
  next_actions integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.user_can_access_project(p_project_id, 'viewer') then
    return;
  end if;
  return query
  select
    w.id,
    w.name,
    w.address,
    w.updated_at,
    pw.created_at,
    (select count(*)::integer from walkthru.floors f where f.walkthrough_id = w.id and f.deleted_at is null),
    (select count(*)::integer from walkthru.nodes n where n.walkthrough_id = w.id and n.deleted_at is null),
    (select count(*)::integer from walkthru.nodes n where n.walkthrough_id = w.id and n.deleted_at is null and n.node_type_id is null),
    (select count(*)::integer from walkthru.media_assets m where m.walkthrough_id = w.id and m.deleted_at is null and m.kind = 'photo'),
    (select count(*)::integer from walkthru.media_assets m where m.walkthrough_id = w.id and m.deleted_at is null and m.kind = 'video'),
    (select count(*)::integer from walkthru.audio_recordings r where r.walkthrough_id = w.id and r.deleted_at is null),
    (select count(*)::integer from walkthru.notes t where t.walkthrough_id = w.id and t.deleted_at is null),
    (select count(*)::integer from walkthru.action_items a where a.walkthrough_id = w.id and a.deleted_at is null)
  from public.project_walkthroughs pw
  join walkthru.walkthroughs w on w.id = pw.walkthrough_id and w.deleted_at is null
  where pw.project_id = p_project_id
  order by pw.created_at desc;
end;
$$;

revoke all on function public.list_project_walkthroughs(uuid) from public, anon;
grant execute on function public.list_project_walkthroughs(uuid) to authenticated;

-- 3. One walk, read only, for a Project member ----------------------------------
-- The same bundle walkthru.get_public_share_walkthrough() returns for a share
-- link, so Walkthru's read-only viewer can show it unchanged. The gate is the
-- Project, not a token: the walk must be in a Project this person can open.
-- link_created_at is when the walk was added; link_expires_at is always null.
create or replace function walkthru.get_project_walkthrough(p_project_id uuid, p_walkthrough_id uuid)
returns table (
  link_created_at timestamptz,
  link_expires_at timestamptz,
  walkthrough jsonb,
  floors jsonb,
  nodes jsonb,
  media_assets jsonb,
  notes jsonb,
  audio_recordings jsonb,
  transcripts jsonb,
  action_items jsonb,
  imported_pdf_annotation_edits jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_added_at timestamptz;
  v_walk uuid := p_walkthrough_id;
begin
  if p_project_id is null or p_walkthrough_id is null then
    return;
  end if;
  if not public.user_can_access_project(p_project_id, 'viewer') then
    return;
  end if;
  select pw.created_at into v_added_at
  from public.project_walkthroughs pw
  join walkthru.walkthroughs w on w.id = pw.walkthrough_id and w.deleted_at is null
  where pw.project_id = p_project_id and pw.walkthrough_id = p_walkthrough_id;
  if not found then
    return;
  end if;

  return query
  with public_walkthrough as (
    select w.id, w.name, w.address, w.status, w.updated_at, w.owner_id, w.page_order
    from walkthru.walkthroughs w
    where w.id = v_walk and w.deleted_at is null
  ),
  public_floors as (
    select
      floor.id,
      floor.name,
      floor.level_index,
      floor.active_asset_id,
      coalesce(
        (
          select jsonb_agg(to_jsonb(asset_row) order by asset_row.kind, asset_row.id)
          from (
            select asset.id, asset.kind, asset.format, asset.storage_path,
                   asset.original_filename, asset.width, asset.height, asset.source_asset_id
            from walkthru.floor_assets asset
            where asset.walkthrough_id = v_walk
              and asset.floor_id = floor.id
              and asset.deleted_at is null
            order by asset.kind, asset.id
          ) asset_row
        ),
        '[]'::jsonb
      ) floor_assets
    from walkthru.floors floor
    where floor.walkthrough_id = v_walk and floor.deleted_at is null
  ),
  public_nodes as (
    select node.id, node.floor_id, node.title, node.page_index, node.x_pct, node.y_pct,
           node.x, node.y, node.updated_at, node.node_type_id, node.created_during_recording_id
    from walkthru.nodes node
    where node.walkthrough_id = v_walk and node.deleted_at is null
  ),
  public_media_assets as (
    select media.id, media.kind, media.node_id, media.captured_at_ms, media.storage_path,
           media.created_during_recording_id
    from walkthru.media_assets media
    where media.walkthrough_id = v_walk and media.deleted_at is null
  ),
  public_notes as (
    select note.id, note.node_id, note.floor_id, note.walkthrough_id, note.input_kind,
           note.text, note.updated_at, note.created_during_recording_id
    from walkthru.notes note
    where note.walkthrough_id = v_walk and note.deleted_at is null
  ),
  public_audio_recordings as (
    select recording.id, recording.duration_ms, recording.storage_path, recording.started_at,
           recording.ended_at, recording.paused_at, recording.paused_duration_ms
    from walkthru.audio_recordings recording
    where recording.walkthrough_id = v_walk and recording.deleted_at is null
  ),
  public_transcripts as (
    select transcript.id, transcript.recording_id, transcript.kind, transcript.storage_path,
           transcript.created_at
    from walkthru.transcripts transcript
    where transcript.walkthrough_id = v_walk and transcript.deleted_at is null
  ),
  public_action_items as (
    select item.id, item.transcript_id, item.title, item.status, item.created_at
    from walkthru.action_items item
    where item.walkthrough_id = v_walk and item.deleted_at is null
  ),
  public_imported_pdf_annotation_edits as (
    select
      edit.walkthrough_id, edit.floor_id, edit.asset_id, edit.source_asset_id, edit.page_index,
      edit.source_annotation_id, edit.left_pct, edit.top_pct, edit.width_pct, edit.height_pct,
      edit.rotation_deg, edit.hidden, edit.style, edit.copy_source_id, edit.copy_origin,
      edit.revision, edit.updated_at
    from walkthru.imported_pdf_annotation_edits edit
    join walkthru.floors floor
      on floor.id = edit.floor_id
     and floor.walkthrough_id = edit.walkthrough_id
     and floor.active_asset_id = edit.asset_id
     and floor.deleted_at is null
    join walkthru.floor_assets asset
      on asset.id = edit.asset_id
     and asset.walkthrough_id = edit.walkthrough_id
     and asset.floor_id = edit.floor_id
     and asset.format = 'pdf'
     and asset.deleted_at is null
     and coalesce(asset.source_asset_id, asset.id) = edit.source_asset_id
    join walkthru.floor_assets source
      on source.id = edit.source_asset_id
     and source.walkthrough_id = edit.walkthrough_id
     and source.floor_id = edit.floor_id
     and source.kind = 'source'
     and source.format = 'pdf'
     and source.deleted_at is null
    where edit.walkthrough_id = v_walk
    order by edit.asset_id, edit.page_index, edit.source_annotation_id
    limit 10000
  )
  select
    v_added_at,
    null::timestamptz,
    (select to_jsonb(r) from public_walkthrough r),
    coalesce((select jsonb_agg(to_jsonb(f) order by f.level_index) from public_floors f), '[]'::jsonb),
    coalesce((select jsonb_agg(to_jsonb(n) order by n.updated_at desc) from public_nodes n), '[]'::jsonb),
    coalesce((select jsonb_agg(to_jsonb(m) order by m.captured_at_ms) from public_media_assets m), '[]'::jsonb),
    coalesce((select jsonb_agg(to_jsonb(t) order by t.updated_at desc) from public_notes t), '[]'::jsonb),
    coalesce((select jsonb_agg(to_jsonb(r) order by r.started_at desc) from public_audio_recordings r), '[]'::jsonb),
    coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at desc) from public_transcripts t), '[]'::jsonb),
    coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc) from public_action_items a), '[]'::jsonb),
    coalesce(
      (select jsonb_agg(to_jsonb(e) order by e.asset_id, e.page_index, e.source_annotation_id)
       from public_imported_pdf_annotation_edits e),
      '[]'::jsonb
    );
end;
$$;

revoke all on function walkthru.get_project_walkthrough(uuid, uuid) from public, anon;
grant execute on function walkthru.get_project_walkthrough(uuid, uuid) to authenticated;
