
-- Recreate views with security_invoker = true

CREATE OR REPLACE VIEW public.daily_usage_summary
WITH (security_invoker = true)
AS SELECT user_id, metric_name, date_bucket,
    count(*) AS event_count,
    sum(metric_value) AS total_value,
    avg(metric_value) AS avg_value,
    max(metric_value) AS max_value,
    min(metric_value) AS min_value
FROM usage_metrics
GROUP BY user_id, metric_name, date_bucket
ORDER BY date_bucket DESC, user_id;

CREATE OR REPLACE VIEW public.archived_projects_summary
WITH (security_invoker = true)
AS SELECT p.user_id,
    count(*) AS archived_count,
    array_agg(p.id) AS archived_project_ids,
    array_agg(p.name) AS archived_project_names,
    min(ps.archived_at) AS first_archived_at,
    max(ps.archived_at) AS last_archived_at
FROM projects p
JOIN project_status ps ON p.id = ps.project_id
WHERE ps.is_active = false
GROUP BY p.user_id;

CREATE OR REPLACE VIEW public.user_quota_status
WITH (security_invoker = true)
AS SELECT u.id AS user_id, u.email, s.tier, s.status,
    s.storage_used_bytes,
    get_storage_limit(u.id) AS storage_limit,
    get_current_usage(u.id, 'projects_count'::varchar) AS projects_count,
    get_project_limit(u.id) AS project_limit,
    get_current_usage(u.id, 'documents_count'::varchar) AS documents_count,
    get_document_limit(u.id) AS document_limit,
    round(((s.storage_used_bytes::numeric / get_storage_limit(u.id)::numeric) * 100::numeric), 2) AS storage_percentage
FROM auth.users u
LEFT JOIN user_subscriptions s ON u.id = s.user_id;
;
