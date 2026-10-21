-- Account deletion removes everything the person owns, and nothing that
-- belongs to the people they shared with.
--
-- 1. account_deletion_storage_objects(uid) names every stored file to remove:
--    anything under <uid>/ in any bucket (PDFs, avatars), anything keyed by one
--    of the person's document ids (survey-media photos/video/audio, thumbnails)
--    and any legacy PDF path a document row of theirs points at. The brand
--    bucket is site art, never a person's. Media the person added to someone
--    else's document is keyed by that document, so it stays with its owner.
--    The edge function calls this BEFORE the rows go, because media is keyed by
--    document id; if storage removal then fails, archive-purge-sweep removes
--    the orphaned media and a retry still finds every <uid>/ object. It also
--    names the survey JSON sidecars (documents/<project_id>/<doc_id>_data.json)
--    of the person's documents and anything else under their projects.
-- 2. delete_account_owned_rows(uid) now also:
--    - hands the person's markup on other people's documents to each
--      document's owner (document_annotations.user_id cascades, so it would
--      otherwise vanish from a shared file);
--    - moves other people's documents out of the person's projects before the
--      projects go (documents.project_id cascades, so they would otherwise be
--      deleted with the project) into a new project of the same name owned by
--      the uploader, one per old project, so documents_user_project_sha_uidx
--      (one copy of a PDF per user per project) still holds, and makes each
--      such document's uploader its
--      owner: filing a document in a project made the project owner its
--      'owner' collaborator (add_document_owner_collaborator), and
--      kal31_guard_last_owner refuses to drop the last owner, which would
--      otherwise block the auth user's delete;
--    - deletes the person's email send log, which has no foreign key.
--    Collaborator rows on the person's own documents, projects and templates
--    cascade, so those shares end. Agent links, identities, OAuth grants and
--    sessions cascade from auth.users when the edge function deletes the user.

create or replace function public.account_deletion_storage_objects(target_user_id uuid)
returns table (bucket_id text, name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required';
  end if;

  return query
  with owned_docs as (
    select d.id::text as doc_id, d.file_path
    from public.documents d
    where d.user_id = target_user_id
  ),
  owned_projects as (
    select p.id::text as project_id
    from public.projects p
    where p.user_id = target_user_id
  ),
  others_filed as (
    select d.id::text as doc_id
    from public.documents d
    join public.projects p on p.id = d.project_id
    where p.user_id = target_user_id
      and d.user_id <> target_user_id
  )
  select o.bucket_id, o.name
  from storage.objects o
  where o.bucket_id <> 'brand'
    and (
      split_part(o.name, '/', 1) = target_user_id::text
      or split_part(o.name, '/', 1) in (select doc_id from owned_docs)
      -- Survey JSON sidecars: documents/<project_id>/<document_id>_data.json.
      or (
        o.bucket_id = 'documents'
        and split_part(o.name, '/', 2) in (select doc_id || '_data.json' from owned_docs)
      )
      -- Anything else under the person's projects, except the sidecars of
      -- other people's documents, which account_deletion_sidecar_moves keeps.
      or (
        o.bucket_id = 'documents'
        and split_part(o.name, '/', 1) in (select project_id from owned_projects)
        and split_part(o.name, '/', 2) not in (select doc_id || '_data.json' from others_filed)
      )
      or (
        o.bucket_id = 'documents'
        and o.name in (select file_path from owned_docs where file_path is not null)
        and not exists (
          select 1 from public.documents other
          where other.file_path = o.name and other.user_id <> target_user_id
        )
      )
    )
  order by o.bucket_id, o.name;
end;
$$;

revoke all on function public.account_deletion_storage_objects(uuid) from public, anon, authenticated;
grant execute on function public.account_deletion_storage_objects(uuid) to service_role;

-- Sidecars of other people's documents filed in the person's projects. Those
-- documents move to a new project (below), and the app reads the sidecar at
-- <project_id>/<document_id>_data.json, so the edge function moves each one to
-- the document's new project once the rows have changed. Called before them.
create or replace function public.account_deletion_sidecar_moves(target_user_id uuid)
returns table (name text, document_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required';
  end if;

  return query
  select o.name, d.id
  from public.documents d
  join public.projects p on p.id = d.project_id
  join storage.objects o
    on o.bucket_id = 'documents'
   and o.name = d.project_id::text || '/' || d.id::text || '_data.json'
  where p.user_id = target_user_id
    and d.user_id <> target_user_id
  order by o.name;
end;
$$;

revoke all on function public.account_deletion_sidecar_moves(uuid) from public, anon, authenticated;
grant execute on function public.account_deletion_sidecar_moves(uuid) to service_role;

create or replace function public.delete_account_owned_rows(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  moved record;
  new_project_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required';
  end if;

  update public.document_annotations a
     set user_id = d.user_id
    from public.documents d
   where d.id = a.document_id
     and a.user_id = target_user_id
     and d.user_id <> target_user_id;

  for moved in
    select distinct d.user_id as owner_id, p.id as old_project_id, p.name
      from public.documents d
      join public.projects p on p.id = d.project_id
     where p.user_id = target_user_id
       and d.user_id <> target_user_id
  loop
    insert into public.projects (user_id, name)
    values (moved.owner_id, moved.name)
    returning id into new_project_id;

    update public.documents
       set project_id = new_project_id
     where project_id = moved.old_project_id
       and user_id = moved.owner_id;
  end loop;

  insert into public.document_collaborators (document_id, user_id, role, status)
  select c.document_id, d.user_id, 'owner', 'active'
    from public.document_collaborators c
    join public.documents d on d.id = c.document_id
   where c.user_id = target_user_id
     and c.role = 'owner'
     and d.user_id <> target_user_id
  on conflict (document_id, user_id) do update set role = 'owner', status = 'active';

  delete from public.document_collaborators
   where user_id = target_user_id
     and document_id in (select id from public.documents where user_id <> target_user_id);

  delete from public.email_send_events where user_id = target_user_id;

  delete from public.documents where user_id = target_user_id;
  delete from public.projects where user_id = target_user_id;
  delete from public.templates where user_id = target_user_id;
end;
$$;

revoke all on function public.delete_account_owned_rows(uuid) from public, anon, authenticated;
grant execute on function public.delete_account_owned_rows(uuid) to service_role;
