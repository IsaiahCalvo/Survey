-- Take tables that no app listens to off the Realtime publication.
--
-- Realtime decodes every change to a table in supabase_realtime and checks it
-- against live subscriptions, so each published table costs database work on
-- every insert, update and delete. No Survey, Walkthru or Plot client
-- subscribes to these three (checked 2026-11-27: no postgres_changes listener
-- in code and no live subscriptions in realtime.subscription). Apps still read
-- and write them normally through the API.
--
-- To undo: alter publication supabase_realtime add table public.<name>;
do $publication$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;
  foreach t in array array['document_history_events', 'survey_items', 'survey_presence'] loop
    if exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime drop table public.%I', t);
    end if;
  end loop;
end
$publication$;
