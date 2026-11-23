-- KAL-801: these row rules called auth.uid() once per row. Wrapping it in
-- (select auth.uid()) lets Postgres work it out once per query. Same logic,
-- same names and roles; no data change.

alter policy "Agents record their own changes" on public.agent_change
  with check ((user_id = (select auth.uid())) and is_agent_session());

alter policy "People mark their agents' changes undone" on public.agent_change
  using ((user_id = (select auth.uid())) and (not is_agent_session()))
  with check ((user_id = (select auth.uid())) and (not is_agent_session()));

alter policy "People read their agents' changes" on public.agent_change
  using ((user_id = (select auth.uid())) and (not is_agent_session()));

alter policy "Guests see only themselves" on public.document_collaborators
  using ((not is_guest_session()) or (user_id = (select auth.uid())));

alter policy document_guests_read on public.document_guests
  using ((user_id = (select auth.uid()))
    or ((not is_guest_session()) and user_can_access_document(document_id, 'owner'::text)));

alter policy document_opens_select_own on public.document_opens
  using (user_id = (select auth.uid()));

alter policy document_tags_delete_own on public.document_tags
  using (user_id = (select auth.uid()));

alter policy document_tags_insert_own on public.document_tags
  with check ((user_id = (select auth.uid())) and (not is_guest_session())
    and user_can_access_document(document_id, 'viewer'::text));

alter policy document_tags_select_own on public.document_tags
  using (user_id = (select auth.uid()));

alter policy library_entries_insert on public.library_entries
  with check ((created_by = (select auth.uid())) and (removed_at is null)
    and ((scope = 'mine'::text) or ((scope = 'company'::text) and (my_org_role(company_id) is not null))));

alter policy library_entries_select on public.library_entries
  using (((scope = 'mine'::text) and (created_by = (select auth.uid())))
    or ((scope = 'company'::text) and (my_org_role(company_id) is not null)));

alter policy project_item_comments_delete_own on public.project_item_comments
  using ((not is_guest_session()) and (not is_agent_session())
    and (author_id = (select auth.uid())) and user_can_access_project(project_id, 'editor'::text));

alter policy project_item_comments_insert on public.project_item_comments
  with check ((not is_guest_session()) and (not is_agent_session())
    and (author_id = (select auth.uid())) and user_can_access_project(project_id, 'editor'::text));

alter policy project_photos_delete on public.project_photos
  using ((not is_guest_session()) and (not is_agent_session())
    and (((uploaded_by = (select auth.uid())) and user_can_access_project(project_id, 'editor'::text))
      or user_can_access_project(project_id, 'owner'::text)));

-- Two permissive DELETE rules on project_collaborators meant Postgres ran both
-- for every row. One rule with the two cases joined by OR lets the same people
-- delete the same rows.
drop policy if exists "Members can leave a project" on public.project_collaborators;
drop policy if exists "Project owners can remove collaborators" on public.project_collaborators;
create policy "Owners remove collaborators; members leave" on public.project_collaborators
  for delete
  using (
    user_can_access_project(project_id, 'owner'::text)
    or (
      (user_id = (select auth.uid()))
      and (role <> 'owner'::text)
      and (not is_guest_session())
      and (not is_agent_session())
      and (not exists (
        select 1 from public.projects p
        where p.id = project_collaborators.project_id
          and p.user_id = (select auth.uid())
      ))
    )
  );
