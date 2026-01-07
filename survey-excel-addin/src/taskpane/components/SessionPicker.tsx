/**
 * Session Picker Component
 * Lists available survey sessions to join
 */

import React, { useState, useEffect } from 'react';
import { getSupabase } from '../../services/supabaseClient';
import { SurveySession } from '../../types/survey';

interface SessionPickerProps {
  userId: string;
  onSelect: (session: SurveySession) => void;
}

const SessionPicker: React.FC<SessionPickerProps> = ({ userId, onSelect }) => {
  const [sessions, setSessions] = useState<SurveySession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadSessions();
  }, [userId]);

  const loadSessions = async () => {
    setLoading(true);
    setError(null);

    try {
      const supabase = getSupabase();
      if (!supabase) {
        throw new Error('Not connected to Supabase');
      }

      // Load active sessions for this user
      // Note: We don't join templates as it may not exist in all setups
      console.log('[SessionPicker] Loading sessions for user:', userId);
      const { data, error } = await supabase
        .from('survey_sessions')
        .select('*')
        .eq('user_id', userId)
        .eq('is_active', true)
        .order('updated_at', { ascending: false });

      console.log('[SessionPicker] Loaded sessions:', data?.length || 0);

      if (error) throw error;

      setSessions(data || []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="session-picker">
        <h2>Select Survey Session</h2>
        <div className="loading">
          <div className="loading-spinner" />
          <p>Loading sessions...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="session-picker">
        <h2>Select Survey Session</h2>
        <div className="error-message">{error}</div>
        <button className="btn-secondary mt-16" onClick={loadSessions}>
          Try Again
        </button>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="session-picker">
        <h2>Select Survey Session</h2>
        <div className="empty-state">
          <p>No active survey sessions found.</p>
          <p className="text-small text-muted">
            Open a survey in the Survey App first, then enable sync to create a session.
          </p>
          <button className="btn-secondary mt-16" onClick={loadSessions}>
            Refresh
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="session-picker">
      <h2>Select Survey Session</h2>
      <p className="text-small text-muted mb-16">
        Choose a survey session to sync with this Excel file.
      </p>

      <div className="session-list">
        {sessions.map((session) => (
          <div
            key={session.id}
            className="session-item"
            onClick={() => onSelect(session)}
          >
            <div className="session-name">
              Session {session.id.slice(0, 8)}...
            </div>
            <div className="session-info">
              {session.excel_file_path ? (
                <span>Linked to: {session.excel_file_path.split('/').pop()}</span>
              ) : (
                <span>No Excel file linked</span>
              )}
              <span> • </span>
              <span>Updated {formatRelativeTime(session.updated_at)}</span>
            </div>
          </div>
        ))}
      </div>

      <button className="btn-secondary mt-16" onClick={loadSessions}>
        Refresh
      </button>
    </div>
  );
};

// Helper to format relative time
function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export default SessionPicker;
