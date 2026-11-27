-- Stop PostgREST retry loops on "this changed, reload" conflicts.
--
-- These functions reported expected conflicts (a stale revision, a page that
-- changed during a copy, a stale annotation snapshot) with SQLSTATE 40001.
-- PostgREST 14 treats 40001 as a temporary serialization failure and retries
-- the whole call, so a conflict that can never succeed turns into a tight
-- retry loop: thousands of rolled-back transactions a second on one
-- connection until the client gives up. Supabase documents this as a cause of
-- high CPU and stuck connections (fixed in PostgREST 16).
--
-- PT409 tells PostgREST to answer HTTP 409 with no retry. The Walkthru and
-- Survey clients accept both PT409 and 40001 as a conflict.
--
-- The rewrite only touches `errcode = '40001'` in RAISE statements, keeps each
-- function's signature, settings, owner and grants (CREATE OR REPLACE), and
-- covers the schemas these functions live in on every database this file runs
-- against (`private` is Walkthru's local name for `walkthru_private`).
--
-- To undo, run the same block with '40001' and 'PT409' swapped.
do $migration$
declare
  fn record;
begin
  for fn in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.prokind = 'f'
      and n.nspname in ('public', 'private', 'walkthru', 'walkthru_private')
      and p.prosrc ~* $re$errcode\s*=\s*'40001'$re$
      and not exists (
        select 1 from pg_depend d
        where d.classid = 'pg_proc'::regclass
          and d.objid = p.oid
          and d.deptype = 'e'
      )
  loop
    execute regexp_replace(
      pg_get_functiondef(fn.oid),
      $re$(errcode\s*=\s*)'40001'$re$,
      $re$\1'PT409'$re$,
      'gi'
    );
  end loop;
end
$migration$;
