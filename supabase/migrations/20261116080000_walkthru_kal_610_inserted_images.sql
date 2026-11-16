-- Walkthru (schema walkthru), KAL-610: Survey's Images on a page reaches
-- Walkthru. The source is the Walkthru repo (same change, schemas public and
-- private there). A rect mark may carry stroke.image = { src, width, height },
-- a PNG or JPEG data URL of at most 360,000 characters and its pixel size.
-- Checked here, then stripped before the existing rules run. Nothing is removed.
--
-- Production has schema walkthru (KAL-579), but this repo's migrations don't
-- build it, so a fresh local database skips this file instead of failing.
do $kal610images$
begin
  if to_regnamespace('walkthru_private') is null
     or to_regprocedure('walkthru_private.annotation_stroke_point_count(jsonb)') is null then
    raise notice 'KAL-610 images skipped: schema walkthru is not in this database';
    return;
  end if;
  execute $kal610imagessql$
alter function walkthru_private.annotation_stroke_point_count(jsonb) rename to annotation_stroke_point_count_base_20261116_images;
create function walkthru_private.annotation_stroke_point_count(p_stroke jsonb)
returns integer language plpgsql immutable set search_path = '' as $fn$
declare
 img jsonb;
begin
 if jsonb_typeof(p_stroke) = 'object' and p_stroke ? 'image' then
  img := p_stroke->'image';
  if jsonb_typeof(img) <> 'object'
     or exists (select 1 from jsonb_object_keys(img) k where k not in ('src','width','height'))
     or jsonb_typeof(img->'src') <> 'string'
     or char_length(img->>'src') > 360000
     or (img->>'src') !~ '^data:image/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$'
     or jsonb_typeof(img->'width') <> 'number'
     or jsonb_typeof(img->'height') <> 'number'
     or (img->>'width') !~ '^[0-9]+$'
     or (img->>'height') !~ '^[0-9]+$'
     or (img->>'width')::integer not between 1 and 1600
     or (img->>'height')::integer not between 1 and 1600
     or coalesce(p_stroke->'shape'->>'kind', '') <> 'rect'
     or jsonb_typeof(p_stroke->'points') <> 'array'
     or jsonb_array_length(p_stroke->'points') <> 5
     or p_stroke ? 'text' or p_stroke ? 'measure' or p_stroke ? 'textMarkup' then
   return -1;
  end if;
  return walkthru_private.annotation_stroke_point_count_base_20261116_images(p_stroke - 'image');
 end if;
 return walkthru_private.annotation_stroke_point_count_base_20261116_images(p_stroke);
exception when others then return -1;
end;
$fn$;
revoke all on function walkthru_private.annotation_stroke_point_count_base_20261116_images(jsonb), walkthru_private.annotation_stroke_point_count(jsonb) from public, anon, authenticated, service_role;
grant execute on function walkthru_private.annotation_stroke_point_count_base_20261116_images(jsonb), walkthru_private.annotation_stroke_point_count(jsonb) to postgres;
  $kal610imagessql$;
end;
$kal610images$;
