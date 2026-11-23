-- Walkthru owns this validator. A fresh Survey-only database has no Walkthru schema.
do $walkthru$
begin
  if to_regclass('walkthru.floors') is null then
    return;
  end if;
  set local lock_timeout = '5s';
  execute $migration$
-- Keep the validator's identity: other functions and table constraints
-- already call it. Save its previous definition only on the first run.
do $copy$
declare
  definition text;
begin
  if to_regprocedure('walkthru_private.annotation_stroke_point_count_before_rotation(jsonb)') is null then
    definition := pg_get_functiondef('walkthru_private.annotation_stroke_point_count(jsonb)'::regprocedure);
    execute replace(definition, 'FUNCTION walkthru_private.annotation_stroke_point_count(',
                                'FUNCTION walkthru_private.annotation_stroke_point_count_before_rotation(');
  end if;
end;
$copy$;

create or replace function walkthru_private.annotation_stroke_point_count(p_stroke jsonb)
returns integer language plpgsql immutable set search_path = '' as $fn$
begin
  if p_stroke ? 'rotationDeg' then
    if jsonb_typeof(p_stroke->'rotationDeg') <> 'number'
      or (p_stroke->>'rotationDeg')::numeric < 0
      or (p_stroke->>'rotationDeg')::numeric >= 360 then
      return -1;
    end if;
    p_stroke := p_stroke - 'rotationDeg';
  end if;
  return walkthru_private.annotation_stroke_point_count_before_rotation(p_stroke);
end;
$fn$;

revoke all on function walkthru_private.annotation_stroke_point_count_before_rotation(jsonb) from public, anon, authenticated, service_role;
grant execute on function walkthru_private.annotation_stroke_point_count_before_rotation(jsonb) to postgres;
$migration$;
end;
$walkthru$;
