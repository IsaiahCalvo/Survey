-- KAL-853: take the mark library off the Realtime publication.
--
-- Survey's mark library no longer holds a live channel (it read the library
-- and subscribed on every document open, which held half of all live
-- subscriptions on 2026-11-27 while the database stalled in the mornings).
-- The panel now reads the library when it opens and when the tab comes back,
-- so no client needs changes from this table pushed to it. Apps still read
-- and write it normally through the API.
--
-- To undo: alter publication supabase_realtime add table public.mark_library_items;
do $publication$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'mark_library_items'
  ) then
    alter publication supabase_realtime drop table public.mark_library_items;
  end if;
end
$publication$;
