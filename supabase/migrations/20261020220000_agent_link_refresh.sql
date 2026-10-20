-- Agent links: a 30-day refresh key so a linked agent doesn't need a new code
-- every hour. Each use swaps it for a new one (the old one stops working), and
-- removing the agent clears it. Only hashes are stored, as with the other keys.
alter table public.agent_links
  add column refresh_token_hash text unique,
  add column refresh_expires_at timestamptz;

create or replace function public.revoke_agent_link(p_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  with done as (
    update public.agent_links
       set status = 'revoked', token_hash = null, refresh_token_hash = null
     where id = p_id and user_id = auth.uid() and status <> 'revoked'
    returning 1
  )
  select exists (select 1 from done);
$$;

revoke all on function public.revoke_agent_link(uuid) from public, anon;
grant execute on function public.revoke_agent_link(uuid) to authenticated;
