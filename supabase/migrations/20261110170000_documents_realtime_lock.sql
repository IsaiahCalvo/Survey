-- Send document row changes live, so a lock reaches everyone who has the
-- document open at once (deep test 2026-11-10: when the owner locked a
-- document, an editor's next mark vanished with no word and the "Document
-- locked" banner only showed after a reload).
--
-- documentLockService.subscribeDocumentLockState has listened for these
-- UPDATE events since KAL-49, but public.documents was never in the
-- supabase_realtime publication, so nothing ever arrived. Realtime checks
-- the documents SELECT policy for each listener, so a person only gets rows
-- they can already read. Its only listener filters to one document id.
do $$
begin
  if not exists (
       select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'documents'
     ) then
    alter publication supabase_realtime add table public.documents;
  end if;
end;
$$;
