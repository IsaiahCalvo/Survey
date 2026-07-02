-- Security-advisor hardening (2026-07-02) — the recurring 'Action required:
-- security vulnerabilities detected' emails. Two fix classes:
--
-- 1. Pin search_path=public on the 11 functions flagged 'mutable search_path'
--    (bodies use unqualified public-table refs, so pinning to public is the
--    behavior-preserving hardening; qualified auth.* calls are unaffected).
-- 2. Lock down EXECUTE on every SECURITY DEFINER function in public:
--    revoke the default PUBLIC grant and anon, grant explicitly to
--    authenticated + service_role. Functions referenced inside RLS policy
--    expressions ALSO keep an anon grant — policy expressions run with the
--    querying role's privileges, and an anon table query must fail closed
--    (empty result via RLS), not error on function ACLs.
BEGIN;

ALTER FUNCTION public.doc_yjs_updates_validate_origin() SET search_path = public;
ALTER FUNCTION public.get_document_limit(p_user_id uuid) SET search_path = public;
ALTER FUNCTION public.get_project_limit(p_user_id uuid) SET search_path = public;
ALTER FUNCTION public.get_storage_limit(p_user_id uuid) SET search_path = public;
ALTER FUNCTION public.get_user_tier(p_user_id uuid) SET search_path = public;
ALTER FUNCTION public.has_feature_access(p_user_id uuid, p_feature text) SET search_path = public;
ALTER FUNCTION public.is_project_accessible(p_project_id uuid, p_user_id uuid) SET search_path = public;
ALTER FUNCTION public.kal309_audit_immutable() SET search_path = public;
ALTER FUNCTION public.prevent_delete_annotation_trash_events() SET search_path = public;
ALTER FUNCTION public.swap_active_project(p_user_id uuid, p_old_project_id uuid, p_new_project_id uuid) SET search_path = public;
ALTER FUNCTION public.sweep_annotation_trash_events(p_days integer) SET search_path = public;

REVOKE ALL ON FUNCTION public._kal48_can_access(doc_id uuid, required_role text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._kal48_can_access(doc_id uuid, required_role text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._kal48_can_access(doc_id uuid, required_role text) TO anon; -- used inside RLS policy expressions
REVOKE ALL ON FUNCTION public.archive_excess_documents(p_user_id uuid, p_max_documents integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.archive_excess_documents(p_user_id uuid, p_max_documents integer) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.archive_excess_documents(p_user_id uuid, p_max_documents integer) FROM anon;
REVOKE ALL ON FUNCTION public.archive_excess_projects(p_user_id uuid, p_keep_project_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.archive_excess_projects(p_user_id uuid, p_keep_project_id uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.archive_excess_projects(p_user_id uuid, p_keep_project_id uuid) FROM anon;
REVOKE ALL ON FUNCTION public.archive_excess_projects(p_user_id uuid, p_max_projects integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.archive_excess_projects(p_user_id uuid, p_max_projects integer) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.archive_excess_projects(p_user_id uuid, p_max_projects integer) FROM anon;
REVOKE ALL ON FUNCTION public.bump_doc_annotations_changed_at() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bump_doc_annotations_changed_at() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.bump_doc_annotations_changed_at() FROM anon;
REVOKE ALL ON FUNCTION public.check_collaborator_by_email(email_address text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_collaborator_by_email(email_address text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.check_collaborator_by_email(email_address text) FROM anon;
REVOKE ALL ON FUNCTION public.check_user_collaborator_eligibility(target_user_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_user_collaborator_eligibility(target_user_id uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.check_user_collaborator_eligibility(target_user_id uuid) FROM anon;
REVOKE ALL ON FUNCTION public.create_project_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_project_status() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.create_project_status() FROM anon;
REVOKE ALL ON FUNCTION public.get_active_projects(p_user_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_active_projects(p_user_id uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_active_projects(p_user_id uuid) FROM anon;
REVOKE ALL ON FUNCTION public.get_current_usage(p_user_id uuid, p_metric_name character varying) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_current_usage(p_user_id uuid, p_metric_name character varying) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_current_usage(p_user_id uuid, p_metric_name character varying) FROM anon;
REVOKE ALL ON FUNCTION public.get_document_limit(p_user_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_document_limit(p_user_id uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_document_limit(p_user_id uuid) TO anon; -- used inside RLS policy expressions
REVOKE ALL ON FUNCTION public.get_my_document_role(doc_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_document_role(doc_id uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_my_document_role(doc_id uuid) FROM anon;
REVOKE ALL ON FUNCTION public.get_project_limit(p_user_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_project_limit(p_user_id uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_project_limit(p_user_id uuid) TO anon; -- used inside RLS policy expressions
REVOKE ALL ON FUNCTION public.get_storage_limit(p_user_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_storage_limit(p_user_id uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_storage_limit(p_user_id uuid) TO anon; -- used inside RLS policy expressions
REVOKE ALL ON FUNCTION public.get_user_id_by_email(email_address text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_id_by_email(email_address text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_user_id_by_email(email_address text) FROM anon;
REVOKE ALL ON FUNCTION public.get_user_tier(p_user_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_tier(p_user_id uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_tier(p_user_id uuid) TO anon; -- used inside RLS policy expressions
REVOKE ALL ON FUNCTION public.handle_downgrade_to_free(p_user_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_downgrade_to_free(p_user_id uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.handle_downgrade_to_free(p_user_id uuid) FROM anon;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon;
REVOKE ALL ON FUNCTION public.handle_new_user_subscription() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_new_user_subscription() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.handle_new_user_subscription() FROM anon;
REVOKE ALL ON FUNCTION public.handle_user_update() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_user_update() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.handle_user_update() FROM anon;
REVOKE ALL ON FUNCTION public.has_feature_access(p_user_id uuid, p_feature text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_feature_access(p_user_id uuid, p_feature text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_feature_access(p_user_id uuid, p_feature text) TO anon; -- used inside RLS policy expressions
REVOKE ALL ON FUNCTION public.is_project_accessible(p_project_id uuid, p_user_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_project_accessible(p_project_id uuid, p_user_id uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_project_accessible(p_project_id uuid, p_user_id uuid) TO anon; -- used inside RLS policy expressions
REVOKE ALL ON FUNCTION public.kal307_register_workbook(p_document_id uuid, p_template_id text, p_graph_drive_id text, p_graph_item_id text, p_capability_tier text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kal307_register_workbook(p_document_id uuid, p_template_id text, p_graph_drive_id text, p_graph_item_id text, p_capability_tier text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.kal307_register_workbook(p_document_id uuid, p_template_id text, p_graph_drive_id text, p_graph_item_id text, p_capability_tier text) FROM anon;
REVOKE ALL ON FUNCTION public.kal308_apply_changeset(p_actor_id uuid, p_document_id uuid, p_template_id text, p_workbook_id text, p_capability_tier text, p_client_change_set_id text, p_request_hash text, p_device_hint text, p_template_config jsonb, p_rows jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kal308_apply_changeset(p_actor_id uuid, p_document_id uuid, p_template_id text, p_workbook_id text, p_capability_tier text, p_client_change_set_id text, p_request_hash text, p_device_hint text, p_template_config jsonb, p_rows jsonb) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.kal308_apply_changeset(p_actor_id uuid, p_document_id uuid, p_template_id text, p_workbook_id text, p_capability_tier text, p_client_change_set_id text, p_request_hash text, p_device_hint text, p_template_config jsonb, p_rows jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.kal308a_get_or_create_signing_secret(p_document_id uuid, p_signing_id_seed text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kal308a_get_or_create_signing_secret(p_document_id uuid, p_signing_id_seed text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.kal308a_get_or_create_signing_secret(p_document_id uuid, p_signing_id_seed text) FROM anon;
REVOKE ALL ON FUNCTION public.kal308a_get_signing_secret(p_document_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kal308a_get_signing_secret(p_document_id uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.kal308a_get_signing_secret(p_document_id uuid) FROM anon;
REVOKE ALL ON FUNCTION public.kal308a_has_server_key(p_document_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kal308a_has_server_key(p_document_id uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.kal308a_has_server_key(p_document_id uuid) FROM anon;
REVOKE ALL ON FUNCTION public.kal309_ack_materialization(p_document_id uuid, p_template_id text, p_op_uuid uuid, p_status text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kal309_ack_materialization(p_document_id uuid, p_template_id text, p_op_uuid uuid, p_status text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.kal309_ack_materialization(p_document_id uuid, p_template_id text, p_op_uuid uuid, p_status text) FROM anon;
REVOKE ALL ON FUNCTION public.kal309_fetch_since(p_document_id uuid, p_template_id text, p_since_revision bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kal309_fetch_since(p_document_id uuid, p_template_id text, p_since_revision bigint) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.kal309_fetch_since(p_document_id uuid, p_template_id text, p_since_revision bigint) FROM anon;
REVOKE ALL ON FUNCTION public.kal309_persist_created_token(p_document_id uuid, p_template_id text, p_scope_id text, p_marker_annotation_id text, p_client_change_set_id text, p_assigned_token text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kal309_persist_created_token(p_document_id uuid, p_template_id text, p_scope_id text, p_marker_annotation_id text, p_client_change_set_id text, p_assigned_token text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.kal309_persist_created_token(p_document_id uuid, p_template_id text, p_scope_id text, p_marker_annotation_id text, p_client_change_set_id text, p_assigned_token text) FROM anon;
REVOKE ALL ON FUNCTION public.kal309_resolve_materialization_conflict(p_document_id uuid, p_template_id text, p_op_uuid uuid, p_resolution text, p_resolved_fingerprints jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kal309_resolve_materialization_conflict(p_document_id uuid, p_template_id text, p_op_uuid uuid, p_resolution text, p_resolved_fingerprints jsonb) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.kal309_resolve_materialization_conflict(p_document_id uuid, p_template_id text, p_op_uuid uuid, p_resolution text, p_resolved_fingerprints jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.kal309_seed_sync_state(p_document_id uuid, p_template_id text, p_workbook_id text, p_markers jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kal309_seed_sync_state(p_document_id uuid, p_template_id text, p_workbook_id text, p_markers jsonb) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.kal309_seed_sync_state(p_document_id uuid, p_template_id text, p_workbook_id text, p_markers jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.kal309_set_registration_signing_id(p_document_id uuid, p_template_id text, p_workbook_id text, p_signing_doc_id text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kal309_set_registration_signing_id(p_document_id uuid, p_template_id text, p_workbook_id text, p_signing_doc_id text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.kal309_set_registration_signing_id(p_document_id uuid, p_template_id text, p_workbook_id text, p_signing_doc_id text) FROM anon;
REVOKE ALL ON FUNCTION public.kal31_accept_document_invite(invite_token text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kal31_accept_document_invite(invite_token text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.kal31_accept_document_invite(invite_token text) FROM anon;
REVOKE ALL ON FUNCTION public.kal31_accept_project_invite(invite_token text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kal31_accept_project_invite(invite_token text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.kal31_accept_project_invite(invite_token text) FROM anon;
REVOKE ALL ON FUNCTION public.kal31_accept_template_invite(invite_token text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kal31_accept_template_invite(invite_token text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.kal31_accept_template_invite(invite_token text) FROM anon;
REVOKE ALL ON FUNCTION public.kal31_guard_last_owner() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kal31_guard_last_owner() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.kal31_guard_last_owner() FROM anon;
REVOKE ALL ON FUNCTION public.kal31_resend_document_invite(invite_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kal31_resend_document_invite(invite_id uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.kal31_resend_document_invite(invite_id uuid) FROM anon;
REVOKE ALL ON FUNCTION public.kal31_resend_project_invite(invite_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kal31_resend_project_invite(invite_id uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.kal31_resend_project_invite(invite_id uuid) FROM anon;
REVOKE ALL ON FUNCTION public.kal31_resend_template_invite(invite_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kal31_resend_template_invite(invite_id uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.kal31_resend_template_invite(invite_id uuid) FROM anon;
REVOKE ALL ON FUNCTION public.kal31_revoke_document_invite(invite_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kal31_revoke_document_invite(invite_id uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.kal31_revoke_document_invite(invite_id uuid) FROM anon;
REVOKE ALL ON FUNCTION public.kal31_revoke_project_invite(invite_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kal31_revoke_project_invite(invite_id uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.kal31_revoke_project_invite(invite_id uuid) FROM anon;
REVOKE ALL ON FUNCTION public.kal31_revoke_template_invite(invite_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kal31_revoke_template_invite(invite_id uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.kal31_revoke_template_invite(invite_id uuid) FROM anon;
REVOKE ALL ON FUNCTION public.kal48_create_revision(p_document_id uuid, p_label text, p_origin text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kal48_create_revision(p_document_id uuid, p_label text, p_origin text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.kal48_create_revision(p_document_id uuid, p_label text, p_origin text) FROM anon;
REVOKE ALL ON FUNCTION public.kal48_debug_probe(p_document_id uuid, p_step integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kal48_debug_probe(p_document_id uuid, p_step integer) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.kal48_debug_probe(p_document_id uuid, p_step integer) FROM anon;
REVOKE ALL ON FUNCTION public.kal48_dump_access_fn() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kal48_dump_access_fn() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.kal48_dump_access_fn() FROM anon;
REVOKE ALL ON FUNCTION public.kal48_get_revision(p_revision_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kal48_get_revision(p_revision_id uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.kal48_get_revision(p_revision_id uuid) FROM anon;
REVOKE ALL ON FUNCTION public.kal48_list_revisions(p_document_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kal48_list_revisions(p_document_id uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.kal48_list_revisions(p_document_id uuid) FROM anon;
REVOKE ALL ON FUNCTION public.kal48_restore_revision(p_revision_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kal48_restore_revision(p_revision_id uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.kal48_restore_revision(p_revision_id uuid) FROM anon;
REVOKE ALL ON FUNCTION public.kal49_document_is_locked(doc_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kal49_document_is_locked(doc_id uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.kal49_document_is_locked(doc_id uuid) TO anon; -- used inside RLS policy expressions
REVOKE ALL ON FUNCTION public.kal49_lock_document(doc_id uuid, label text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kal49_lock_document(doc_id uuid, label text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.kal49_lock_document(doc_id uuid, label text) FROM anon;
REVOKE ALL ON FUNCTION public.kal49_unlock_document(doc_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kal49_unlock_document(doc_id uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.kal49_unlock_document(doc_id uuid) FROM anon;
REVOKE ALL ON FUNCTION public.prevent_delete_annotation_trash_events() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prevent_delete_annotation_trash_events() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.prevent_delete_annotation_trash_events() FROM anon;
REVOKE ALL ON FUNCTION public.recalculate_all_user_storage() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recalculate_all_user_storage() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.recalculate_all_user_storage() FROM anon;
REVOKE ALL ON FUNCTION public.recalculate_user_storage(p_user_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recalculate_user_storage(p_user_id uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.recalculate_user_storage(p_user_id uuid) FROM anon;
REVOKE ALL ON FUNCTION public.record_document_metric() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_document_metric() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.record_document_metric() FROM anon;
REVOKE ALL ON FUNCTION public.record_project_metric() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_project_metric() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.record_project_metric() FROM anon;
REVOKE ALL ON FUNCTION public.record_usage_metric(p_user_id uuid, p_metric_name character varying, p_metric_value bigint, p_metadata jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_usage_metric(p_user_id uuid, p_metric_name character varying, p_metric_value bigint, p_metadata jsonb) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.record_usage_metric(p_user_id uuid, p_metric_name character varying, p_metric_value bigint, p_metadata jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.swap_active_project(p_user_id uuid, p_old_project_id uuid, p_new_project_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.swap_active_project(p_user_id uuid, p_old_project_id uuid, p_new_project_id uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.swap_active_project(p_user_id uuid, p_old_project_id uuid, p_new_project_id uuid) FROM anon;
REVOKE ALL ON FUNCTION public.sweep_annotation_trash_events(p_days integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sweep_annotation_trash_events(p_days integer) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.sweep_annotation_trash_events(p_days integer) FROM anon;
REVOKE ALL ON FUNCTION public.update_user_storage() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_user_storage() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.update_user_storage() FROM anon;
REVOKE ALL ON FUNCTION public.user_can_access_document(doc_id uuid, required_role text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_can_access_document(doc_id uuid, required_role text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_can_access_document(doc_id uuid, required_role text) TO anon; -- used inside RLS policy expressions
REVOKE ALL ON FUNCTION public.user_can_access_project(proj_id uuid, required_role text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_can_access_project(proj_id uuid, required_role text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_can_access_project(proj_id uuid, required_role text) TO anon; -- used inside RLS policy expressions
REVOKE ALL ON FUNCTION public.user_can_access_template(tpl_id uuid, required_role text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_can_access_template(tpl_id uuid, required_role text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_can_access_template(tpl_id uuid, required_role text) TO anon; -- used inside RLS policy expressions

COMMIT;
