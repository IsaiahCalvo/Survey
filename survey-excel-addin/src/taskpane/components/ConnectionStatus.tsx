/**
 * Connection Status Component
 * Shows the current sync connection status
 */

import React from 'react';
import { SyncStatus } from '../../types/survey';

interface ConnectionStatusProps {
  status: SyncStatus;
}

const STATUS_CONFIG: Record<SyncStatus, { label: string; className: string }> = {
  disconnected: { label: 'Disconnected', className: 'disconnected' },
  connecting: { label: 'Connecting...', className: 'connecting' },
  connected: { label: 'Connected', className: 'connected' },
  syncing: { label: 'Syncing...', className: 'syncing' },
  error: { label: 'Error', className: 'error' },
};

const ConnectionStatus: React.FC<ConnectionStatusProps> = ({ status }) => {
  const config = STATUS_CONFIG[status];

  return (
    <div className="connection-status">
      <div className={`status-indicator ${config.className}`} />
      <span className="status-text">{config.label}</span>
    </div>
  );
};

export default ConnectionStatus;
