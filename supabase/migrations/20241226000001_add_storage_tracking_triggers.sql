-- Add triggers to automatically update storage_used_bytes in user_subscriptions
-- when documents are inserted or deleted

-- ============================================================================
-- FUNCTION: Update storage_used_bytes after document insert/delete
-- ============================================================================

CREATE OR REPLACE FUNCTION update_user_storage()
RETURNS TRIGGER AS $$
BEGIN
    -- Calculate total storage for the user
    IF TG_OP = 'INSERT' THEN
        -- Add file size to user's storage
        UPDATE user_subscriptions
        SET storage_used_bytes = COALESCE(storage_used_bytes, 0) + COALESCE(NEW.file_size, 0)
        WHERE user_id = NEW.user_id;

        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        -- Subtract file size from user's storage
        UPDATE user_subscriptions
        SET storage_used_bytes = GREATEST(0, COALESCE(storage_used_bytes, 0) - COALESCE(OLD.file_size, 0))
        WHERE user_id = OLD.user_id;

        RETURN OLD;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- TRIGGERS: Auto-update storage when documents change
-- ============================================================================

DROP TRIGGER IF EXISTS update_storage_on_insert ON documents;
CREATE TRIGGER update_storage_on_insert
    AFTER INSERT ON documents
    FOR EACH ROW
    EXECUTE FUNCTION update_user_storage();

DROP TRIGGER IF EXISTS update_storage_on_delete ON documents;
CREATE TRIGGER update_storage_on_delete
    AFTER DELETE ON documents
    FOR EACH ROW
    EXECUTE FUNCTION update_user_storage();

-- ============================================================================
-- FUNCTION: Recalculate storage for a specific user (for fixing inconsistencies)
-- ============================================================================

CREATE OR REPLACE FUNCTION recalculate_user_storage(p_user_id UUID)
RETURNS BIGINT AS $$
DECLARE
    v_total_storage BIGINT;
BEGIN
    -- Calculate total storage from all documents
    SELECT COALESCE(SUM(file_size), 0)
    INTO v_total_storage
    FROM documents
    WHERE user_id = p_user_id;

    -- Update user_subscriptions
    UPDATE user_subscriptions
    SET storage_used_bytes = v_total_storage
    WHERE user_id = p_user_id;

    RETURN v_total_storage;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- FUNCTION: Recalculate storage for all users (maintenance)
-- ============================================================================

CREATE OR REPLACE FUNCTION recalculate_all_user_storage()
RETURNS TABLE(user_id UUID, storage_bytes BIGINT) AS $$
BEGIN
    RETURN QUERY
    UPDATE user_subscriptions us
    SET storage_used_bytes = COALESCE(doc_storage.total, 0)
    FROM (
        SELECT d.user_id, SUM(d.file_size) as total
        FROM documents d
        GROUP BY d.user_id
    ) doc_storage
    WHERE us.user_id = doc_storage.user_id
    RETURNING us.user_id, us.storage_used_bytes;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- Initial population of storage_used_bytes for existing users
-- ============================================================================

-- Recalculate storage for all existing users
DO $$
DECLARE
    v_user RECORD;
BEGIN
    FOR v_user IN SELECT DISTINCT user_id FROM documents
    LOOP
        PERFORM recalculate_user_storage(v_user.user_id);
    END LOOP;
END $$;

COMMENT ON FUNCTION update_user_storage() IS 'Automatically updates storage_used_bytes when documents are inserted or deleted';
COMMENT ON FUNCTION recalculate_user_storage(UUID) IS 'Recalculates total storage for a specific user by summing all document file sizes';
COMMENT ON FUNCTION recalculate_all_user_storage() IS 'Recalculates storage for all users (for maintenance/fixing inconsistencies)';
