-- Walkthru runs in its own schema on the shared database.
do $walkthrucomments$
begin
  if to_regclass('walkthru.annotation_comments') is null then
    return;
  end if;
  execute $migration$
-- A PDF object is identified within its source document and displayed page.
-- Native marks and sheet comments keep their existing anchors.
alter table walkthru.annotation_comments add column imported_mark jsonb,
  add constraint annotation_comments_imported_mark_root check (
    imported_mark is null or (thread_id is null and annotation_id is null
      and jsonb_typeof(imported_mark) = 'object'
      and imported_mark ?& array['assetId', 'sourceAssetId', 'sourceId', 'subtype'])
  );

create index annotation_comments_imported_object_idx on walkthru.annotation_comments
  (walkthrough_id, floor_id, page_index, (imported_mark->>'assetId'), (imported_mark->>'sourceId'))
  where imported_mark is not null;

create function walkthru.add_imported_shape_comment(
  p_walkthrough_id uuid, p_floor_id uuid, p_page_index integer, p_body text,
  p_imported_mark jsonb, p_mentions uuid[] default '{}', p_id uuid default null
) returns walkthru.annotation_comments
language plpgsql security definer set search_path = '' as $fn$
declare
  v_asset uuid := (p_imported_mark->>'assetId')::uuid;
  v_source uuid := (p_imported_mark->>'sourceAssetId')::uuid;
  v_object text := p_imported_mark->>'sourceId';
  v_type text := p_imported_mark->>'subtype';
  v_anchor jsonb;
  v_root uuid;
  v_row walkthru.annotation_comments;
begin
  if auth.uid() is null or not coalesce(walkthru_private.current_user_can_write_walkthrough(p_walkthrough_id), false) then
    raise exception 'Walkthrough not found' using errcode = '42501';
  end if;
  if v_object is null or length(v_object) not between 1 and 256
     or v_type is null or v_type not in ('Square','Circle')
     or p_page_index is null or p_page_index < 0 then
    raise exception 'Invalid imported shape' using errcode = '22023';
  end if;
  perform 1 from walkthru.floors f join walkthru.floor_assets a on a.id = f.active_asset_id
  where f.id = p_floor_id and f.walkthrough_id = p_walkthrough_id and f.deleted_at is null
    and a.id = v_asset and a.floor_id = f.id and a.walkthrough_id = p_walkthrough_id
    and a.format = 'pdf' and a.deleted_at is null and coalesce(a.source_asset_id, a.id) = v_source
  for share of f, a;
  if not found then
    raise exception 'PDF not found on this sheet' using errcode = '22023';
  end if;
  v_anchor := jsonb_build_object('assetId', v_asset, 'sourceAssetId', v_source, 'sourceId', v_object, 'subtype', v_type);
  -- Two people can open an empty thread before either presses Post.
  perform pg_advisory_xact_lock(hashtextextended(v_asset::text || ':' || p_page_index::text || ':' || v_object, 0));
  if p_id is not null then
    select * into v_row from walkthru.annotation_comments where id = p_id;
    if found then
      if v_row.walkthrough_id <> p_walkthrough_id or v_row.author_id is distinct from auth.uid()
        or v_row.floor_id <> p_floor_id or v_row.page_index <> p_page_index
        or not exists (select 1 from walkthru.annotation_comments r
                       where r.id = coalesce(v_row.thread_id, v_row.id) and r.imported_mark = v_anchor) then
        raise exception 'Comment not found' using errcode = '42501';
      end if;
      return v_row;
    end if;
  end if;
  select r.id into v_root from walkthru.annotation_comments r
  where r.walkthrough_id = p_walkthrough_id and r.floor_id = p_floor_id and r.page_index = p_page_index
    and r.imported_mark->>'assetId' = v_asset::text and r.imported_mark->>'sourceId' = v_object
    and r.imported_mark->>'sourceAssetId' = v_source::text
    and (r.deleted_at is null or exists (select 1 from walkthru.annotation_comments c where c.thread_id = r.id and c.deleted_at is null))
  order by r.created_at desc limit 1;
  if v_root is not null then
    return walkthru.add_annotation_comment(p_walkthrough_id, p_floor_id, p_page_index, p_body, null, v_root, p_mentions, p_id);
  end if;
  -- Insert the root with its final anchor so realtime never exposes a page-only comment.
  if length(btrim(coalesce(p_body, ''))) not between 1 and 4000 or coalesce(cardinality(p_mentions), 0) > 20 then
    raise exception 'Invalid comment' using errcode = '22023';
  end if;
  insert into walkthru.annotation_comments
    (id, walkthrough_id, floor_id, page_index, author_id, body, mentions, imported_mark)
  values (coalesce(p_id, gen_random_uuid()), p_walkthrough_id, p_floor_id, p_page_index, auth.uid(), btrim(p_body),
    walkthru_private.annotation_comment_clean_mentions(p_walkthrough_id, p_mentions), v_anchor)
  returning * into v_row;
  return v_row;
end;
$fn$;
revoke all on function walkthru.add_imported_shape_comment(uuid,uuid,integer,text,jsonb,uuid[],uuid) from public, anon;
grant execute on function walkthru.add_imported_shape_comment(uuid,uuid,integer,text,jsonb,uuid[],uuid) to authenticated;
$migration$;
end;
$walkthrucomments$;
