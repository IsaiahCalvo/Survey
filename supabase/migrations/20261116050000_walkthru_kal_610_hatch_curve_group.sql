-- Walkthru (schema walkthru), KAL-610: Survey's Hatch fill, Curved polyline
-- and Group reach Walkthru marks. The source is the Walkthru repo (same
-- change, schema private there). Walkthru marks may now carry shape.hatch,
-- shape.spline = { step } and a groupId: checked here, then stripped before
-- the existing rules run. Adds only; nothing is removed.
--
-- Production has schema walkthru (KAL-579), but this repo's migrations don't
-- build it, so a fresh local database skips this file instead of failing.
do $kal610$
begin
  if to_regclass('walkthru.floors') is null
     or to_regnamespace('walkthru_private') is null
     or to_regprocedure('walkthru_private.annotation_stroke_point_count(jsonb)') is null then
    raise notice 'KAL-610 skipped: schema walkthru is not in this database';
    return;
  end if;
  execute $kal610sql$
alter function walkthru_private.annotation_stroke_point_count(jsonb) rename to annotation_stroke_point_count_base_20261116_kal610;
create function walkthru_private.annotation_stroke_point_count(p_stroke jsonb)
returns integer language plpgsql immutable set search_path = '' as $fn$
declare
 v jsonb := p_stroke;
 s jsonb := p_stroke->'shape';
 spline jsonb;
 n integer;
begin
 if jsonb_typeof(v) <> 'object' then
  return walkthru_private.annotation_stroke_point_count_base_20261116_kal610(v);
 end if;
 -- Group: marks that pick and move together carry one shared uuid.
 if v ? 'groupId' then
  if jsonb_typeof(v->'groupId') <> 'string'
     or (v->>'groupId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
   return -1;
  end if;
  v := v - 'groupId';
 end if;
 if jsonb_typeof(s) = 'object' then
  -- Hatch fill: a line pattern inside a rect, ellipse or polygon.
  if s ? 'hatch' then
   if jsonb_typeof(s->'hatch') <> 'string'
      or (s->>'hatch') not in ('diagonal','back-diagonal','crosshatch','horizontal','vertical','grid')
      or coalesce(s->>'kind', '') not in ('rect','ellipse','polygon')
      or v ? 'measure' then
    return -1;
   end if;
   s := s - 'hatch';
  end if;
  -- Curved polyline: dense points, clicked corner j at points[j * step].
  if s ? 'spline' then
   spline := s->'spline';
   if jsonb_typeof(spline) <> 'object'
      or exists (select 1 from jsonb_object_keys(spline) k where k <> 'step')
      or jsonb_typeof(spline->'step') <> 'number'
      or (spline->>'step') !~ '^[0-9]+$'
      or (spline->>'step')::integer not between 2 and 32
      or coalesce(s->>'kind', '') <> 'polyline'
      or jsonb_typeof(v->'points') <> 'array' then
    return -1;
   end if;
   n := jsonb_array_length(v->'points');
   if n < (spline->>'step')::integer + 1 or (n - 1) % (spline->>'step')::integer <> 0 then
    return -1;
   end if;
   s := s - 'spline';
  end if;
  v := jsonb_set(v, '{shape}', s);
 end if;
 return walkthru_private.annotation_stroke_point_count_base_20261116_kal610(v);
exception when others then return -1;
end;
$fn$;
revoke all on function walkthru_private.annotation_stroke_point_count_base_20261116_kal610(jsonb), walkthru_private.annotation_stroke_point_count(jsonb) from public, anon, authenticated, service_role;
grant execute on function walkthru_private.annotation_stroke_point_count_base_20261116_kal610(jsonb), walkthru_private.annotation_stroke_point_count(jsonb) to postgres;
  $kal610sql$;
end;
$kal610$;
