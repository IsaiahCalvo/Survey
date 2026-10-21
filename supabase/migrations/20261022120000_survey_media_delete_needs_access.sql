-- Survey photos and recordings: the uploader could delete their file even
-- after the owner removed them from the document, because the delete rule
-- trusted owner_id alone. Table rules drop a removed person's access at once;
-- the file rule now does too: the uploader needs editor access to the
-- document still, and the document's owner can always delete.
--
-- Reading is unchanged on purpose: the uploader may still read their own
-- upload (the row and the document are out of their reach anyway).
drop policy if exists survey_media_delete on storage.objects;
create policy survey_media_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'survey-media'
    and (
      (owner_id = (select auth.uid())::text
        and public.user_can_access_document(public.survey_media_object_document_id(name), 'editor'))
      or public.user_can_access_document(public.survey_media_object_document_id(name), 'owner')
    )
  );
