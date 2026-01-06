/**
 * User Presence Component
 * Shows active users in the current session
 */

import React, { useState, useEffect } from 'react';
import { getSupabase } from '../../services/supabaseClient';
import { SurveyPresence } from '../../types/survey';

interface UserPresenceProps {
  sessionId: string;
}

const UserPresence: React.FC<UserPresenceProps> = ({ sessionId }) => {
  const [users, setUsers] = useState<SurveyPresence[]>([]);

  useEffect(() => {
    loadPresence();

    // Set up polling for presence updates
    const interval = setInterval(loadPresence, 30000);

    // Subscribe to real-time presence changes
    const supabase = getSupabase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let channel: any = null;

    if (supabase) {
      channel = supabase
        .channel(`presence:${sessionId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'survey_presence',
            filter: `session_id=eq.${sessionId}`,
          },
          () => loadPresence()
        )
        .subscribe();
    }

    return () => {
      clearInterval(interval);
      if (channel && supabase) {
        supabase.removeChannel(channel);
      }
    };
  }, [sessionId]);

  const loadPresence = async () => {
    try {
      const supabase = getSupabase();
      if (!supabase) return;

      // Get presence records from last 2 minutes
      const cutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();

      const { data, error } = await supabase
        .from('survey_presence')
        .select('*')
        .eq('session_id', sessionId)
        .gte('last_seen', cutoff);

      if (error) throw error;

      setUsers(data || []);
    } catch (e) {
      console.error('Failed to load presence:', e);
    }
  };

  // Get initials from display name or email
  const getInitials = (name: string | null): string => {
    if (!name) return '?';

    const parts = name.split(/[\s@]+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  // Get client type label
  const getClientLabel = (clientType: string): string => {
    switch (clientType) {
      case 'app': return 'Survey App';
      case 'excel': return 'Excel';
      case 'web': return 'Web';
      default: return clientType;
    }
  };

  return (
    <div className="user-presence">
      <h3>
        Active Users
        <span className="user-count">{users.length}</span>
      </h3>

      {users.length === 0 ? (
        <p className="text-small text-muted">No other users are currently active.</p>
      ) : (
        <div className="user-list">
          {users.map((user) => (
            <div key={user.id} className="user-item">
              <div className={`user-avatar ${user.client_type}`}>
                {getInitials(user.display_name)}
              </div>
              <div className="user-details">
                <div className="user-name">
                  {user.display_name || 'Anonymous'}
                </div>
                <div className="user-client">
                  {getClientLabel(user.client_type)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default UserPresence;
