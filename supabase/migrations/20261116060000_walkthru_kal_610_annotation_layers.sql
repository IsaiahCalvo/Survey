-- Walkthru (schema walkthru), KAL-610: Survey's Layers panel reaches
-- Walkthru. The source is the Walkthru repo (same change, schemas public and
-- private there). Adds walkthroughs.annotation_layers (+ revision), the
-- save_walkthrough_annotation_layers RPC and the stroke.layerId check.
-- Nothing is removed.
--
-- Production has schema walkthru (KAL-579), but this repo's migrations don't
-- build it, so a fresh local database skips this file instead of failing.
do $kal610layers$
begin
  if to_regclass('walkthru.walkthroughs') is null
     or to_regnamespace('walkthru_private') is null
     or to_regprocedure('walkthru_private.annotation_stroke_point_count(jsonb)') is null then
    raise notice 'KAL-610 layers skipped: schema walkthru is not in this database';
    return;
  end if;
  execute $kal610layerssql$
alter table walkthru.walkthroughs
  add column if not exists annotation_layers jsonb not null default '{}'::jsonb
    check (jsonb_typeof(annotation_layers) = 'object' and pg_column_size(annotation_layers) <= 65536),
  add column if not exists annotation_layers_revision integer not null default 0
    check (annotation_layers_revision >= 0);

-- Survey's Layers panel: { layers: [{ id, name, visible }], pdfOpacity }.
-- A mark names its layer in stroke.layerId; a missing or unknown id is the
-- default layer, so deleting a layer never rewrites marks.
create or replace function walkthru.save_walkthrough_annotation_layers(
  p_walkthrough_id uuid,
  p_expected_revision integer,
  p_layers jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_walkthrough walkthru.walkthroughs%rowtype;
  v_layer jsonb;
  v_seen text[] := '{}';
begin
  if auth.uid() is null or not walkthru_private.current_user_can_write_walkthrough(p_walkthrough_id) then
    raise exception using errcode = '42501', message = 'Layers are not writable.';
  end if;
  if p_expected_revision is null or p_expected_revision < 0
     or p_layers is null or jsonb_typeof(p_layers) <> 'object'
     or pg_column_size(p_layers) > 65536
     or exists (select 1 from jsonb_object_keys(p_layers) k where k not in ('layers', 'pdfOpacity'))
     or jsonb_typeof(p_layers -> 'layers') <> 'array'
     or jsonb_array_length(p_layers -> 'layers') not between 1 and 100
     or jsonb_typeof(p_layers -> 'pdfOpacity') <> 'number'
     or (p_layers ->> 'pdfOpacity')::numeric not between 0 and 1 then
    raise exception using errcode = '22023', message = 'Invalid layers.';
  end if;
  for v_layer in select value from jsonb_array_elements(p_layers -> 'layers') loop
    if jsonb_typeof(v_layer) <> 'object'
       or exists (select 1 from jsonb_object_keys(v_layer) k where k not in ('id', 'name', 'visible'))
       or jsonb_typeof(v_layer -> 'id') <> 'string'
       or (v_layer ->> 'id') !~ '^[A-Za-z0-9_-]{1,64}$'
       or jsonb_typeof(v_layer -> 'name') <> 'string'
       or char_length(v_layer ->> 'name') not between 1 and 80
       or jsonb_typeof(v_layer -> 'visible') <> 'boolean'
       or (v_layer ->> 'id') = any(v_seen) then
      raise exception using errcode = '22023', message = 'Invalid layer.';
    end if;
    v_seen := array_append(v_seen, v_layer ->> 'id');
  end loop;
  if not ('default' = any(v_seen)) then
    raise exception using errcode = '22023', message = 'The default layer is missing.';
  end if;

  select * into v_walkthrough from walkthru.walkthroughs
  where id = p_walkthrough_id and deleted_at is null
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'Layers are not writable.';
  end if;
  if v_walkthrough.annotation_layers = p_layers then
    return jsonb_build_object('status', 'saved', 'revision', v_walkthrough.annotation_layers_revision, 'layers', v_walkthrough.annotation_layers);
  end if;
  if v_walkthrough.annotation_layers_revision <> p_expected_revision then
    return jsonb_build_object('status', 'conflict', 'revision', v_walkthrough.annotation_layers_revision, 'layers', v_walkthrough.annotation_layers);
  end if;
  update walkthru.walkthroughs
  set annotation_layers = p_layers, annotation_layers_revision = annotation_layers_revision + 1
  where id = p_walkthrough_id
  returning * into v_walkthrough;
  return jsonb_build_object('status', 'saved', 'revision', v_walkthrough.annotation_layers_revision, 'layers', v_walkthrough.annotation_layers);
end;
$fn$;

revoke all on function walkthru.save_walkthrough_annotation_layers(uuid, integer, jsonb) from public, anon, authenticated, service_role;
grant execute on function walkthru.save_walkthrough_annotation_layers(uuid, integer, jsonb) to authenticated;

-- A mark may name its layer: stroke.layerId, checked and stripped here.
alter function walkthru_private.annotation_stroke_point_count(jsonb) rename to annotation_stroke_point_count_base_20261116_layers;
create function walkthru_private.annotation_stroke_point_count(p_stroke jsonb)
returns integer language plpgsql immutable set search_path = '' as $fn2$
begin
 if jsonb_typeof(p_stroke) = 'object' and p_stroke ? 'layerId' then
  if jsonb_typeof(p_stroke -> 'layerId') <> 'string' or (p_stroke ->> 'layerId') !~ '^[A-Za-z0-9_-]{1,64}$' then
   return -1;
  end if;
  return walkthru_private.annotation_stroke_point_count_base_20261116_layers(p_stroke - 'layerId');
 end if;
 return walkthru_private.annotation_stroke_point_count_base_20261116_layers(p_stroke);
exception when others then return -1;
end;
$fn2$;
revoke all on function walkthru_private.annotation_stroke_point_count_base_20261116_layers(jsonb), walkthru_private.annotation_stroke_point_count(jsonb) from public, anon, authenticated, service_role;
grant execute on function walkthru_private.annotation_stroke_point_count_base_20261116_layers(jsonb), walkthru_private.annotation_stroke_point_count(jsonb) to postgres;
  $kal610layerssql$;
end;
$kal610layers$;
