-- Change only the lineStyle allowlist, preserving the other imported shape checks.
do $walkthru$
declare
  definition text;
  old_styles constant text := $styles$value->>'lineStyle' in ('solid','dashed','dotted','cloud')$styles$;
  new_styles constant text := $styles$value->>'lineStyle' in ('solid','dashed','dotted','longDash','dashDot','cloud')$styles$;
begin
  if to_regclass('walkthru.floors') is null then
    return;
  end if;
  set local lock_timeout = '5s';
  definition := pg_get_functiondef('walkthru_private.valid_imported_annotation_style(jsonb)'::regprocedure);
  if strpos(definition, new_styles) > 0 then
    return;
  end if;
  if strpos(definition, old_styles) = 0 then
    raise exception 'Unexpected Walkthru imported annotation style validator';
  end if;
  execute replace(definition, old_styles, new_styles);
end
$walkthru$;
