-- Walkthru (schema walkthru), KAL-797: a new Node's name never repeats one
-- already on the walkthrough. The name was "Node " + (live Nodes + 1), so
-- after deleting Node 2 of Node 1..3 the next one was a second "Node 3".
-- Now it is one past the larger of the live count and the highest
-- "Node N" still in use. Same function, same inputs and outputs. Nothing
-- is removed. The source is the Walkthru repo (same change, schema public).
--
-- Production has schema walkthru (KAL-579), but this repo's migrations don't
-- build it, so a fresh local database skips this file instead of failing.
do $kal797name$
begin
  if to_regclass('walkthru.nodes') is null
     or to_regprocedure('walkthru.create_node_with_auto_name(uuid,uuid,uuid,text,integer,numeric,numeric,uuid)') is null then
    raise notice 'KAL-797 node auto name skipped: schema walkthru is not in this database';
    return;
  end if;
  execute $kal797namesql$
create or replace function walkthru.create_node_with_auto_name(
  p_walkthrough_id uuid,
  p_floor_id uuid,
  p_owner_id uuid,
  p_client_id text,
  p_page_index integer,
  p_x_pct numeric,
  p_y_pct numeric,
  p_node_type_id uuid default null::uuid
)
returns table(
  id uuid, title text, page_index integer, x_pct numeric, y_pct numeric,
  floor_id uuid, walkthrough_id uuid, node_type_id uuid,
  updated_at timestamp with time zone
)
language plpgsql
set search_path to 'walkthru', 'pg_temp'
as $function$
declare
  v_count integer;
  v_title text;
  v_inserted walkthru.nodes%rowtype;
  v_organization_id uuid;
begin
  select w.organization_id into v_organization_id
  from walkthru.walkthroughs w
  where w.id = p_walkthrough_id
    and w.deleted_at is null;

  if p_node_type_id is not null and not exists (
    select 1
    from walkthru.node_types nt
    where nt.id = p_node_type_id
      and (
        nt.owner_id = p_owner_id
        or (v_organization_id is not null and nt.organization_id = v_organization_id)
      )
      and nt.deleted_at is null
      and (nt.walkthrough_id is null or nt.walkthrough_id = p_walkthrough_id)
  ) then
    raise exception 'Node type not found';
  end if;

  select greatest(
           count(*),
           coalesce(max((substring(n.title from '^Node ([0-9]{1,9})$'))::integer), 0)
         ) + 1
    into v_count
    from walkthru.nodes n
    where n.walkthrough_id = p_walkthrough_id
      and n.deleted_at is null;
  v_title := 'Node ' || v_count::text;

  insert into walkthru.nodes as n (
    owner_id, organization_id, walkthrough_id, floor_id, node_type_id, client_id,
    title, page_index, x_pct, y_pct
  ) values (
    p_owner_id, v_organization_id, p_walkthrough_id, p_floor_id, p_node_type_id,
    p_client_id, v_title, p_page_index, p_x_pct, p_y_pct
  )
  returning n.* into v_inserted;

  return query select
    v_inserted.id, v_inserted.title, v_inserted.page_index,
    v_inserted.x_pct, v_inserted.y_pct, v_inserted.floor_id,
    v_inserted.walkthrough_id, v_inserted.node_type_id, v_inserted.updated_at;
end;
$function$
  $kal797namesql$;
end
$kal797name$;
