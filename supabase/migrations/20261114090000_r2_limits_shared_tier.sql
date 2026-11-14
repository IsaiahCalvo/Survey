-- Survey, Walkthru and Plot share one Cloudflare account, and R2's free tier
-- (10 GB stored, 1M Class A, 10M Class B a month) is per account. Each app
-- used to cap itself at 80% of the whole tier, so together they could pass it
-- and bill the card. Split the 80% instead: Survey 5 GB / 500,000 / 5,000,000;
-- Walkthru and Plot 1.5 GB / 150,000 / 1,500,000 each (set in their own repos).
create or replace function public.r2_limits()
returns table (max_bytes bigint, max_class_a bigint, max_class_b bigint)
language sql
immutable
set search_path = ''
as $$
  -- Survey's share of 80% of the account-wide R2 free tier (10 GB decimal,
  -- 1M Class A, 10M Class B), shared with Walkthru and Plot.
  select 5000000000::bigint, 500000::bigint, 5000000::bigint;
$$;

revoke all on function public.r2_limits() from public, anon, authenticated;
grant execute on function public.r2_limits() to service_role;

comment on function public.r2_limits() is
  'Survey''s share of 80% of the account-wide Cloudflare R2 free tier, shared with Walkthru and Plot: 5 GB stored, 500,000 Class A, 5,000,000 Class B.';

comment on function public.r2_reserve(bigint, bigint, text, bigint) is
  'Reserves Cloudflare R2 operations (and a copy''s bytes) under Survey''s share of the free tier (public.r2_limits()) over a rolling 31 days; false = refused, nothing recorded. service_role only (pdf-file-url, scripts/r2-copy-pdfs.mjs).';
