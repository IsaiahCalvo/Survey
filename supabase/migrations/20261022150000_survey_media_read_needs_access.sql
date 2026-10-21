-- survey-media let an uploader keep reading their photos after the owner
-- removed them from the document, because the read rule also trusted
-- owner_id alone. The tables behind those photos already hide them from a
-- removed collaborator, so the files now follow: reading needs viewer access
-- to the document. Uploaders still have editor access while they upload.
drop policy if exists survey_media_read on storage.objects;
create policy survey_media_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'survey-media'
    and public.user_can_access_document(public.survey_media_object_document_id(name), 'viewer')
  );
