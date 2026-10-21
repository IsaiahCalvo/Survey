-- Crash reports sent from browsers and the phone apps (src/utils/crashReporter.js).
--
-- Until now a crash was kept only in that person's own browser (Settings →
-- Crash reports). This keeps a copy here so crashes can be counted across
-- everyone. It holds no personal data: no user id, no email, no document
-- names or content. The browser strips those from the message before it
-- sends, and report_client_error clips every field again.
--
-- Nobody can read the table through the API: there are no select policies
-- and no table grants. Browsers can only call report_client_error, which caps
-- the total rate so a flood can't fill the table. The daily summary
-- (.github/workflows/crash-summary.yml) reads it with the owner's management
-- token and deletes rows older than 30 days.

create table if not exists public.client_errors (
  id bigint generated always as identity primary key,
  received_at timestamptz not null default now(),
  occurred_at timestamptz,
  kind text not null,
  message text not null,
  stack text,
  route text,
  build text,
  platform text,
  browser text,
  repeats integer not null default 1
);

create index if not exists client_errors_received_at_idx on public.client_errors (received_at);

alter table public.client_errors enable row level security;
revoke all on table public.client_errors from anon, authenticated;

create or replace function public.report_client_error(
  p_kind text,
  p_message text,
  p_stack text default null,
  p_route text default null,
  p_build text default null,
  p_platform text default null,
  p_browser text default null,
  p_occurred_at timestamptz default null,
  p_repeats integer default 1
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_kind is null or p_kind not in ('react', 'error', 'rejection', 'freeze', 'closed', 'shell-reload') then
    return false;
  end if;
  -- Flood guard across all senders: at most 600 reports in any 10 minutes.
  if (select count(*) from public.client_errors where received_at > now() - interval '10 minutes') >= 600 then
    return false;
  end if;
  insert into public.client_errors (occurred_at, kind, message, stack, route, build, platform, browser, repeats)
  values (
    least(coalesce(p_occurred_at, now()), now()),
    p_kind,
    left(coalesce(nullif(p_message, ''), 'Unknown error'), 300),
    left(p_stack, 1500),
    left(p_route, 120),
    left(p_build, 64),
    left(p_platform, 24),
    left(p_browser, 32),
    greatest(1, least(coalesce(p_repeats, 1), 1000))
  );
  return true;
end;
$$;

revoke all on function public.report_client_error(text, text, text, text, text, text, text, timestamptz, integer) from public;
grant execute on function public.report_client_error(text, text, text, text, text, text, text, timestamptz, integer) to anon, authenticated;
