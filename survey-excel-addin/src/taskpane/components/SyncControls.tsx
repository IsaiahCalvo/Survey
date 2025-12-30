/**
 * Sync Controls Component
 * Controls for managing the sync connection
 */

import React, { useState, useEffect } from 'react';
import { getSupabase } from '../../services/supabaseClient';
import { SurveySession, SyncStatus } from '../../types/survey';
import { parseSurveyStructure } from '../../services/excelService';

interface SyncControlsProps {
  session: SurveySession;
  status: SyncStatus;
  onDisconnect: () => void;
}

interface WorksheetInfo {
  sheetName: string;
  moduleName: string | null;
  categoryName: string | null;
  rowCount: number;
}

const SyncControls: React.FC<SyncControlsProps> = ({
  session,
  status,
  onDisconnect,
}) => {
  const [worksheets, setWorksheets] = useState<WorksheetInfo[]>([]);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [itemCount, setItemCount] = useState(0);

  useEffect(() => {
    loadInfo();
  }, [session.id]);

  const loadInfo = async () => {
    try {
      // Get Excel structure
      const structure = await parseSurveyStructure();
      setWorksheets(structure);

      // Get item count from Supabase
      const supabase = getSupabase();
      if (supabase) {
        const { count } = await supabase
          .from('survey_items')
          .select('*', { count: 'exact', head: true })
          .eq('session_id', session.id);

        setItemCount(count || 0);
      }
    } catch (e) {
      console.error('Failed to load sync info:', e);
    }
  };

  const handleRefresh = async () => {
    await loadInfo();
    setLastSync(new Date());
  };

  return (
    <div className="sync-controls">
      <h3>Sync Status</h3>

      <div className="sync-info">
        <div className="sync-info-row">
          <span className="sync-info-label">Session ID</span>
          <span className="sync-info-value">{session.id.slice(0, 8)}...</span>
        </div>

        <div className="sync-info-row">
          <span className="sync-info-label">Excel File</span>
          <span className="sync-info-value">
            {session.excel_file_path?.split('/').pop() || 'Not linked'}
          </span>
        </div>

        <div className="sync-info-row">
          <span className="sync-info-label">Worksheets</span>
          <span className="sync-info-value">{worksheets.length}</span>
        </div>

        <div className="sync-info-row">
          <span className="sync-info-label">Items Synced</span>
          <span className="sync-info-value">{itemCount}</span>
        </div>

        {lastSync && (
          <div className="sync-info-row">
            <span className="sync-info-label">Last Refreshed</span>
            <span className="sync-info-value">
              {lastSync.toLocaleTimeString()}
            </span>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          className="btn-secondary"
          onClick={handleRefresh}
          disabled={status === 'syncing'}
        >
          Refresh
        </button>

        <button className="btn-danger" onClick={onDisconnect}>
          Disconnect
        </button>
      </div>

      {worksheets.length > 0 && (
        <div className="mt-16">
          <h4 className="text-small mb-8">Detected Worksheets</h4>
          <div className="text-small text-muted">
            {worksheets.map((ws) => (
              <div key={ws.sheetName} style={{ marginBottom: '4px' }}>
                • {ws.sheetName}
                {ws.moduleName && ` (${ws.categoryName} - ${ws.moduleName})`}
                <span className="text-muted"> ({ws.rowCount - 1} items)</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default SyncControls;
