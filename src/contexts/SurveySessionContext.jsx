/**
 * Survey Session Context
 * Provides real-time survey collaboration state to the entire app.
 * Wraps useSurveySync hook and manages the connection between local and remote state.
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { useSurveySync, SyncStatus } from '../hooks/useSurveySync';
import { useAuth } from './AuthContext';

const SurveySessionContext = createContext(null);

/**
 * Survey Session Provider
 * Manages real-time sync for the active survey/template
 */
export function SurveySessionProvider({ children }) {
  const { user } = useAuth();

  // Configuration state
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [activeTemplateId, setActiveTemplateId] = useState(null);
  const [activeDocumentId, setActiveDocumentId] = useState(null);

  // Conflict resolution state
  const [conflicts, setConflicts] = useState([]);
  const [pendingRemoteChanges, setPendingRemoteChanges] = useState([]);

  // Debounce timer for batching local changes
  const syncDebounceRef = useRef(null);
  const pendingLocalChangesRef = useRef(new Map());

  // Handle remote changes
  const handleRemoteChange = useCallback((change) => {
    setPendingRemoteChanges((prev) => [...prev, change]);
  }, []);

  // Handle presence changes
  const handlePresenceChange = useCallback((users) => {
  }, []);

  // Handle conflicts
  const handleConflict = useCallback((conflict) => {
    setConflicts((prev) => [...prev, conflict]);
  }, []);

  // Initialize sync hook
  const {
    session,
    syncStatus,
    syncError,
    remoteItems,
    activeUsers,
    lastSyncTime,
    initSession,
    linkExcelFile,
    syncItem,
    syncAllItems,
    deleteItem,
    isSyncing,
    saveSchemaMapping,
    getSchemaMappings,
    getHighlightAnnotationsFromRemote,
    startSync,
    stopSync,
  } = useSurveySync({
    templateId: activeTemplateId,
    documentId: activeDocumentId,
    enabled: syncEnabled && !!activeTemplateId,
    onRemoteChange: handleRemoteChange,
    onPresenceChange: handlePresenceChange,
    onConflict: handleConflict,
  });

  // ============================================
  // PUBLIC API
  // ============================================

  /**
   * Enable sync for a specific template
   */
  const enableSync = useCallback((templateId, documentId = null) => {
    setActiveTemplateId(templateId);
    setActiveDocumentId(documentId);
    setSyncEnabled(true);
  }, []);

  /**
   * Disable sync
   */
  const disableSync = useCallback(() => {
    setSyncEnabled(false);
    setActiveTemplateId(null);
    setActiveDocumentId(null);
    setPendingRemoteChanges([]);
    setConflicts([]);
  }, []);

  /**
   * Queue a local item change for sync (debounced)
   */
  const queueItemSync = useCallback((item) => {
    if (!syncEnabled || !session) return;

    const itemId = item.highlightId || item.id;
    pendingLocalChangesRef.current.set(itemId, item);

    // Debounce sync to batch rapid changes
    if (syncDebounceRef.current) {
      clearTimeout(syncDebounceRef.current);
    }

    syncDebounceRef.current = setTimeout(() => {
      const changes = Array.from(pendingLocalChangesRef.current.values());
      pendingLocalChangesRef.current.clear();

      if (changes.length === 1) {
        syncItem(changes[0]);
      } else if (changes.length > 1) {
        // For multiple changes, build annotations structure and sync all
        // This is a simplified approach - in production you might want to batch upsert
        changes.forEach((change) => syncItem(change));
      }
    }, 500);
  }, [syncEnabled, session, syncItem]);

  /**
   * Sync all highlight annotations immediately
   */
  const syncAllNow = useCallback((highlightAnnotations) => {
    if (!syncEnabled || !session) return;

    // Clear any pending debounced sync
    if (syncDebounceRef.current) {
      clearTimeout(syncDebounceRef.current);
    }
    pendingLocalChangesRef.current.clear();

    syncAllItems(highlightAnnotations);
  }, [syncEnabled, session, syncAllItems]);

  /**
   * Delete an item and sync the deletion
   */
  const deleteAndSync = useCallback((highlightId) => {
    if (!syncEnabled || !session) return;

    // Remove from pending changes if present
    pendingLocalChangesRef.current.delete(highlightId);

    deleteItem(highlightId);
  }, [syncEnabled, session, deleteItem]);

  /**
   * Consume pending remote changes (call this from the component that manages local state)
   */
  const consumePendingChanges = useCallback(() => {
    const changes = [...pendingRemoteChanges];
    setPendingRemoteChanges([]);
    return changes;
  }, [pendingRemoteChanges]);

  /**
   * Resolve a conflict (accept remote or keep local)
   */
  const resolveConflict = useCallback((conflictId, resolution) => {
    setConflicts((prev) => prev.filter((c) => c.item?.highlightId !== conflictId));

    if (resolution === 'keepLocal') {
      // Re-sync the local version
      const localItem = pendingLocalChangesRef.current.get(conflictId);
      if (localItem) {
        syncItem(localItem);
      }
    }
    // If resolution === 'acceptRemote', the remote change is already applied
  }, [syncItem]);

  /**
   * Get sync status info for UI
   */
  const getSyncStatusInfo = useCallback(() => {
    return {
      isEnabled: syncEnabled,
      isConnected: syncStatus === SyncStatus.CONNECTED,
      isSyncing: syncStatus === SyncStatus.SYNCING || isSyncing(),
      hasError: syncStatus === SyncStatus.ERROR,
      errorMessage: syncError,
      activeUserCount: activeUsers.length,
      lastSyncTime,
      hasConflicts: conflicts.length > 0,
      hasPendingChanges: pendingRemoteChanges.length > 0,
    };
  }, [syncEnabled, syncStatus, isSyncing, syncError, activeUsers.length, lastSyncTime, conflicts.length, pendingRemoteChanges.length]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (syncDebounceRef.current) {
        clearTimeout(syncDebounceRef.current);
      }
    };
  }, []);

  const value = {
    // State
    session,
    syncStatus,
    syncError,
    syncEnabled,
    remoteItems,
    activeUsers,
    lastSyncTime,
    conflicts,
    pendingRemoteChanges,

    // Configuration
    enableSync,
    disableSync,
    activeTemplateId,
    activeDocumentId,

    // Sync operations
    queueItemSync,
    syncAllNow,
    deleteAndSync,
    linkExcelFile,

    // Schema mapping
    saveSchemaMapping,
    getSchemaMappings,

    // Remote changes
    consumePendingChanges,
    getHighlightAnnotationsFromRemote,

    // Conflict resolution
    resolveConflict,

    // Status
    getSyncStatusInfo,
    isSyncing,

    // Manual control
    startSync,
    stopSync,
  };

  return (
    <SurveySessionContext.Provider value={value}>
      {children}
    </SurveySessionContext.Provider>
  );
}

/**
 * Hook to access survey session context
 */
export function useSurveySession() {
  const context = useContext(SurveySessionContext);
  if (!context) {
    throw new Error('useSurveySession must be used within a SurveySessionProvider');
  }
  return context;
}

/**
 * Hook that gracefully returns null if used outside provider
 * Useful for optional sync features
 */
export function useSurveySessionOptional() {
  return useContext(SurveySessionContext);
}

export { SyncStatus };
export default SurveySessionContext;
