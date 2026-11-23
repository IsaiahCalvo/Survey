-- Walkthru owns this validator. A fresh Survey-only database has no Walkthru schema.
do $walkthru$
begin
  if to_regclass('walkthru.floors') is null then
    return;
  end if;
  set local lock_timeout = '5s';
  execute $migration$
-- A perimeter uses the same closed polygon and scale checks as an area.
-- Retain the function identity used by the newer annotation validators.
do $$
declare
  definition text := pg_get_functiondef(
    'walkthru_private.annotation_stroke_point_count_before_shared_stack(jsonb)'::regprocedure
  );
  shape_check constant text := $s$(m->>'kind'='area' and kind='polygon')$s$;
  kind_check constant text := $s$m->>'kind' not in ('length','area')$s$;
begin
  if strpos(definition, $s$m->>'kind' not in ('length','area','perimeter')$s$) > 0 then
    return;
  end if;
  if strpos(definition, shape_check) = 0 or strpos(definition, kind_check) = 0 then
    raise exception 'Unexpected Walkthru measurement validator';
  end if;
  definition := replace(definition, shape_check,
    $s$(m->>'kind' in ('area','perimeter') and kind='polygon')$s$);
  execute replace(definition, kind_check,
    $s$m->>'kind' not in ('length','area','perimeter')$s$);
end
$$;
$migration$;
end;
$walkthru$;
