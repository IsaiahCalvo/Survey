
-- Fix search_path on all public functions
-- Setting search_path = '' (empty) forces fully qualified table references
-- which prevents search_path hijacking attacks

ALTER FUNCTION public.add_document_owner_collaborator() SET search_path = '';
ALTER FUNCTION public.add_project_owner_collaborator() SET search_path = '';
ALTER FUNCTION public.archive_excess_documents(p_user_id uuid, p_max_documents integer) SET search_path = '';
ALTER FUNCTION public.archive_excess_projects(p_user_id uuid, p_keep_project_id uuid) SET search_path = '';
ALTER FUNCTION public.archive_excess_projects(p_user_id uuid, p_max_projects integer) SET search_path = '';
ALTER FUNCTION public.check_collaborator_by_email(email_address text) SET search_path = '';
ALTER FUNCTION public.check_user_collaborator_eligibility(target_user_id uuid) SET search_path = '';
ALTER FUNCTION public.create_project_status() SET search_path = '';
ALTER FUNCTION public.get_active_projects(p_user_id uuid) SET search_path = '';
ALTER FUNCTION public.get_current_usage(p_user_id uuid, p_metric_name character varying) SET search_path = '';
ALTER FUNCTION public.get_document_limit(p_user_id uuid) SET search_path = '';
ALTER FUNCTION public.get_project_limit(p_user_id uuid) SET search_path = '';
ALTER FUNCTION public.get_storage_limit(p_user_id uuid) SET search_path = '';
ALTER FUNCTION public.get_user_id_by_email(email_address text) SET search_path = '';
ALTER FUNCTION public.get_user_tier(p_user_id uuid) SET search_path = '';
ALTER FUNCTION public.handle_downgrade_to_free(p_user_id uuid) SET search_path = '';
ALTER FUNCTION public.handle_new_user() SET search_path = '';
ALTER FUNCTION public.handle_new_user_subscription() SET search_path = '';
ALTER FUNCTION public.handle_user_update() SET search_path = '';
ALTER FUNCTION public.has_feature_access(p_user_id uuid, p_feature text) SET search_path = '';
ALTER FUNCTION public.is_project_accessible(p_project_id uuid, p_user_id uuid) SET search_path = '';
ALTER FUNCTION public.recalculate_all_user_storage() SET search_path = '';
ALTER FUNCTION public.recalculate_user_storage(p_user_id uuid) SET search_path = '';
ALTER FUNCTION public.record_document_metric() SET search_path = '';
ALTER FUNCTION public.record_project_metric() SET search_path = '';
ALTER FUNCTION public.record_usage_metric(p_user_id uuid, p_metric_name character varying, p_metric_value bigint, p_metadata jsonb) SET search_path = '';
ALTER FUNCTION public.set_usage_metrics_date_bucket() SET search_path = '';
ALTER FUNCTION public.swap_active_project(p_user_id uuid, p_old_project_id uuid, p_new_project_id uuid) SET search_path = '';
ALTER FUNCTION public.update_connected_services_updated_at() SET search_path = '';
ALTER FUNCTION public.update_document_tables_updated_at() SET search_path = '';
ALTER FUNCTION public.update_project_status_updated_at() SET search_path = '';
ALTER FUNCTION public.update_survey_tables_updated_at() SET search_path = '';
ALTER FUNCTION public.update_updated_at_column() SET search_path = '';
ALTER FUNCTION public.update_user_storage() SET search_path = '';
ALTER FUNCTION public.update_user_subscriptions_updated_at() SET search_path = '';
ALTER FUNCTION public.user_can_access_document(doc_id uuid, required_role text) SET search_path = '';
ALTER FUNCTION public.user_can_access_project(proj_id uuid, required_role text) SET search_path = '';
;
