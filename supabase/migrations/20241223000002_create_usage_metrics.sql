-- Create usage_metrics table for tracking user resource usage
-- Used for analytics, quota enforcement, and billing insights

CREATE TABLE usage_metrics (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Metric type and value
    metric_name VARCHAR(50) NOT NULL,
    metric_value BIGINT NOT NULL DEFAULT 0,

    -- Additional context
    metadata JSONB DEFAULT '{}',

    -- Timestamp
    measured_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- For time-series tracking
    date_bucket DATE
);

-- Create indexes for faster queries
CREATE INDEX idx_usage_metrics_user_id ON usage_metrics(user_id);
CREATE INDEX idx_usage_metrics_metric_name ON usage_metrics(metric_name);
CREATE INDEX idx_usage_metrics_measured_at ON usage_metrics(measured_at DESC);
CREATE INDEX idx_usage_metrics_date_bucket ON usage_metrics(date_bucket);
CREATE INDEX idx_usage_metrics_user_metric_date ON usage_metrics(user_id, metric_name, date_bucket);

-- Enable RLS
ALTER TABLE usage_metrics ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own usage metrics"
    ON usage_metrics FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "System can insert usage metrics"
    ON usage_metrics FOR INSERT
    WITH CHECK (true); -- Allow inserts from triggers/functions

-- Trigger to auto-populate date_bucket
CREATE OR REPLACE FUNCTION set_usage_metrics_date_bucket()
RETURNS TRIGGER AS $$
BEGIN
    NEW.date_bucket := DATE(NEW.measured_at);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_set_usage_metrics_date_bucket
    BEFORE INSERT ON usage_metrics
    FOR EACH ROW
    EXECUTE FUNCTION set_usage_metrics_date_bucket();

-- Function to record a usage metric
CREATE OR REPLACE FUNCTION record_usage_metric(
    p_user_id UUID,
    p_metric_name VARCHAR(50),
    p_metric_value BIGINT,
    p_metadata JSONB DEFAULT '{}'
)
RETURNS UUID AS $$
DECLARE
    metric_id UUID;
BEGIN
    INSERT INTO usage_metrics (user_id, metric_name, metric_value, metadata)
    VALUES (p_user_id, p_metric_name, p_metric_value, p_metadata)
    RETURNING id INTO metric_id;

    RETURN metric_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get current usage count (projects, documents, etc.)
CREATE OR REPLACE FUNCTION get_current_usage(
    p_user_id UUID,
    p_metric_name VARCHAR(50)
)
RETURNS BIGINT AS $$
DECLARE
    usage_count BIGINT;
BEGIN
    -- Get the count based on metric name
    CASE p_metric_name
        WHEN 'projects_count' THEN
            SELECT COUNT(*) INTO usage_count
            FROM projects
            WHERE user_id = p_user_id;

        WHEN 'documents_count' THEN
            SELECT COUNT(*) INTO usage_count
            FROM documents
            WHERE user_id = p_user_id;

        WHEN 'storage_bytes' THEN
            SELECT COALESCE(SUM(file_size), 0) INTO usage_count
            FROM documents
            WHERE user_id = p_user_id;

        WHEN 'templates_count' THEN
            SELECT COUNT(*) INTO usage_count
            FROM templates
            WHERE user_id = p_user_id;

        WHEN 'spaces_count' THEN
            SELECT COUNT(DISTINCT s.id) INTO usage_count
            FROM spaces s
            JOIN documents d ON s.document_id = d.id
            WHERE d.user_id = p_user_id;

        ELSE
            usage_count := 0;
    END CASE;

    RETURN usage_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update storage used in user_subscriptions
CREATE OR REPLACE FUNCTION update_user_storage()
RETURNS TRIGGER AS $$
DECLARE
    total_storage BIGINT;
    affected_user_id UUID;
BEGIN
    -- Determine which user_id to update
    IF TG_OP = 'DELETE' THEN
        affected_user_id := OLD.user_id;
    ELSE
        affected_user_id := NEW.user_id;
    END IF;

    -- Calculate total storage for user
    SELECT COALESCE(SUM(file_size), 0) INTO total_storage
    FROM documents
    WHERE user_id = affected_user_id;

    -- Update user_subscriptions
    UPDATE user_subscriptions
    SET storage_used_bytes = total_storage
    WHERE user_id = affected_user_id;

    -- Record metric
    PERFORM record_usage_metric(
        affected_user_id,
        'storage_bytes',
        total_storage,
        jsonb_build_object('event', TG_OP, 'table', TG_TABLE_NAME)
    );

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to update storage when documents are added/removed
CREATE TRIGGER trigger_update_storage_on_document_change
    AFTER INSERT OR UPDATE OR DELETE ON documents
    FOR EACH ROW
    EXECUTE FUNCTION update_user_storage();

-- Function to record project creation
CREATE OR REPLACE FUNCTION record_project_metric()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM record_usage_metric(
            NEW.user_id,
            'project_created',
            1,
            jsonb_build_object('project_id', NEW.id)
        );
    ELSIF TG_OP = 'DELETE' THEN
        PERFORM record_usage_metric(
            OLD.user_id,
            'project_deleted',
            1,
            jsonb_build_object('project_id', OLD.id)
        );
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to track project creation/deletion
CREATE TRIGGER trigger_record_project_metric
    AFTER INSERT OR DELETE ON projects
    FOR EACH ROW
    EXECUTE FUNCTION record_project_metric();

-- Function to record document uploads
CREATE OR REPLACE FUNCTION record_document_metric()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM record_usage_metric(
            NEW.user_id,
            'document_uploaded',
            NEW.file_size,
            jsonb_build_object('document_id', NEW.id, 'file_name', NEW.name)
        );
    ELSIF TG_OP = 'DELETE' THEN
        PERFORM record_usage_metric(
            OLD.user_id,
            'document_deleted',
            OLD.file_size,
            jsonb_build_object('document_id', OLD.id, 'file_name', OLD.name)
        );
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to track document uploads/deletions
CREATE TRIGGER trigger_record_document_metric
    AFTER INSERT OR DELETE ON documents
    FOR EACH ROW
    EXECUTE FUNCTION record_document_metric();

-- View for daily usage summary
CREATE OR REPLACE VIEW daily_usage_summary AS
SELECT
    user_id,
    metric_name,
    date_bucket,
    COUNT(*) as event_count,
    SUM(metric_value) as total_value,
    AVG(metric_value) as avg_value,
    MAX(metric_value) as max_value,
    MIN(metric_value) as min_value
FROM usage_metrics
GROUP BY user_id, metric_name, date_bucket
ORDER BY date_bucket DESC, user_id;

-- View for current user quotas and usage
CREATE OR REPLACE VIEW user_quota_status AS
SELECT
    u.id as user_id,
    u.email,
    s.tier,
    s.status,
    s.storage_used_bytes,
    get_storage_limit(u.id) as storage_limit,
    get_current_usage(u.id, 'projects_count') as projects_count,
    get_project_limit(u.id) as project_limit,
    get_current_usage(u.id, 'documents_count') as documents_count,
    get_document_limit(u.id) as document_limit,
    ROUND((s.storage_used_bytes::NUMERIC / get_storage_limit(u.id)::NUMERIC) * 100, 2) as storage_percentage
FROM auth.users u
LEFT JOIN user_subscriptions s ON u.id = s.user_id;

COMMENT ON TABLE usage_metrics IS 'Tracks user resource usage over time for analytics and quota enforcement';
COMMENT ON FUNCTION record_usage_metric IS 'Record a usage metric event for a user';
COMMENT ON FUNCTION get_current_usage IS 'Get current usage count for a specific metric';
COMMENT ON FUNCTION update_user_storage IS 'Automatically update storage_used_bytes when documents change';
COMMENT ON VIEW daily_usage_summary IS 'Aggregated daily usage statistics per user and metric';
COMMENT ON VIEW user_quota_status IS 'Current quota status for all users showing usage vs limits';
