/**
 * useSurveySync Hook
 * React hook for real-time multi-user survey collaboration.
 * Manages Supabase subscriptions, local state sync, and conflict resolution.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { isSupabaseAvailable } from '../supabaseClient';
import {
  getOrCreateSession,
  updateSurveySession,
  closeSurveySession,
  getSurveyItems,
  upsertSurveyItem,
  batchUpsertSurveyItems,
  deleteSurveyItem,
  updatePresence,
  removePresence,
  getSessionPresence,
  subscribeToSurveyItems,
  subscribeToPresence,
  unsubscribe,
  flattenHighlightAnnotations,
  unflattenToHighlightAnnotations,
  convertItemFromDb,
  logSyncChange,
  saveExcelSchemaMapping,
  getExcelSchemaMappings,
} from '../services/surveyRealtimeService';

// Sync status enum
export const SyncStatus = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  SYNCING: 'syncing',
  ERROR: 'error',
};

/**
 * Hook for real-time survey synchronization
 * @param {Object} options - Configuration options
 * @param {string} options.templateId - Supabase template ID (required)
 * @param {string} options.documentId - Supabase document ID (optional)
 * @param {boolean} options.enabled - Whether sync is enabled (default: false)
 * @param {Function} options.onRemoteChange - Callback when remote changes arrive
 * @param {Function} options.onPresenceChange - Callback when user presence changes
 * @param {Function} options.onConflict - Callback when a conflict is detected
 */
export function useSurveySync(options = {}) {
  const {
    templateId,
    documentId,
    enabled = false,
    onRemoteChange,
    onPresenceChange,
    onConflict,
  } = options;

  const { user } = useAuth();

  // State
  const [session, setSession] = useState(null);
  const [syncStatus, setSyncStatus] = useState(SyncStatus.DISCONNECTED);
  const [syncError, setSyncError] = useState(null);
  const [remoteItems, setRemoteItems] = useState([]);
  const [activeUsers, setActiveUsers] = useState([]);
  const [lastSyncTime, setLastSyncTime] = useState(null);

  // Refs for subscriptions and timers
  const itemsChannelRef = useRef(null);
  const presenceChannelRef = useRef(null);
  const presenceIntervalRef = useRef(null);
  const pendingUpdatesRef = useRef(new Map());
  const isSyncingRef = useRef(false);

  // Track local changes that haven't been synced yet
  const localVersionsRef = useRef(new Map());

  // ============================================
  // SESSION MANAGEMENT
  // ============================================

  /**
   * Initialize or join a sync session
   */
  const initSession = useCallback(async () => {
    if (!isSupabaseAvailable() || !templateId || !user?.id || !enabled) {
      return null;
    }

    try {
      setSyncStatus(SyncStatus.CONNECTING);
      setSyncError(null);

      const sessionData = await getOrCreateSession(templateId, user.id, documentId);
      setSession(sessionData);

      return sessionData;
    } catch (error) {
      console.error('[useSurveySync] Failed to initialize session:', error);
      setSyncError(error.message);
      setSyncStatus(SyncStatus.ERROR);
      return null;
    }
  }, [templateId, user?.id, documentId, enabled]);

  /**
   * Start real-time subscriptions
   */
  const startSubscriptions = useCallback(async (sessionId) => {
    if (!sessionId) return;

    // Subscribe to item changes
    itemsChannelRef.current = subscribeToSurveyItems(sessionId, {
      onInsert: (item) => handleRemoteInsert(item),
      onUpdate: (newItem, oldItem) => handleRemoteUpdate(newItem, oldItem),
      onDelete: (item) => handleRemoteDelete(item),
      onStatus: (status) => {
        if (status === 'SUBSCRIBED') {
          setSyncStatus(SyncStatus.CONNECTED);
          setLastSyncTime(new Date());
        } else if (status === 'CHANNEL_ERROR') {
          setSyncStatus(SyncStatus.ERROR);
        }
      },
    });

    // Subscribe to presence changes
    presenceChannelRef.current = subscribeToPresence(sessionId, {
      onPresenceChange: async () => {
        const users = await getSessionPresence(sessionId);
        setActiveUsers(users);
        onPresenceChange?.(users);
      },
    });

    // Start presence heartbeat
    presenceIntervalRef.current = setInterval(() => {
      updatePresence(sessionId, user.id, 'app', {
        displayName: user.email || user.user_metadata?.full_name || 'Anonymous',
      });
    }, 30000); // Update every 30 seconds

    // Initial presence update
    await updatePresence(sessionId, user.id, 'app', {
      displayName: user.email || user.user_metadata?.full_name || 'Anonymous',
    });

    // Load initial items
    const items = await getSurveyItems(sessionId);
    setRemoteItems(items.map(convertItemFromDb));

  }, [user?.id, user?.email, user?.user_metadata?.full_name, onPresenceChange]);

  /**
   * Stop subscriptions and clean up
   */
  const stopSubscriptions = useCallback(async () => {
    if (itemsChannelRef.current) {
      await unsubscribe(itemsChannelRef.current);
      itemsChannelRef.current = null;
    }

    if (presenceChannelRef.current) {
      await unsubscribe(presenceChannelRef.current);
      presenceChannelRef.current = null;
    }

    if (presenceIntervalRef.current) {
      clearInterval(presenceIntervalRef.current);
      presenceIntervalRef.current = null;
    }

    if (session?.id && user?.id) {
      await removePresence(session.id, user.id, 'app');
    }

    setSyncStatus(SyncStatus.DISCONNECTED);
  }, [session?.id, user?.id]);

  // ============================================
  // REMOTE CHANGE HANDLERS
  // ============================================

  const handleRemoteInsert = useCallback((item) => {
    // Skip if this is our own change
    if (pendingUpdatesRef.current.has(item.highlightId)) {
      pendingUpdatesRef.current.delete(item.highlightId);
      return;
    }

    setRemoteItems((prev) => {
      // Check if item already exists
      const exists = prev.some((i) => i.highlightId === item.highlightId);
      if (exists) {
        return prev.map((i) => (i.highlightId === item.highlightId ? item : i));
      }
      return [...prev, item];
    });

    onRemoteChange?.({
      type: 'insert',
      item,
    });
  }, [onRemoteChange]);

  const handleRemoteUpdate = useCallback((newItem, oldItem) => {
    // Skip if this is our own change
    if (pendingUpdatesRef.current.has(newItem.highlightId)) {
      pendingUpdatesRef.current.delete(newItem.highlightId);
      return;
    }

    // Check for conflicts (we have a local change that hasn't been synced)
    const localVersion = localVersionsRef.current.get(newItem.highlightId);
    if (localVersion && localVersion > oldItem?.version) {
      // Conflict detected - remote change came in while we had local changes
      onConflict?.({
        item: newItem,
        localVersion,
        remoteVersion: newItem.version,
      });
      return;
    }

    setRemoteItems((prev) =>
      prev.map((i) => (i.highlightId === newItem.highlightId ? newItem : i))
    );

    onRemoteChange?.({
      type: 'update',
      item: newItem,
      oldItem,
    });
  }, [onRemoteChange, onConflict]);

  const handleRemoteDelete = useCallback((item) => {
    setRemoteItems((prev) =>
      prev.filter((i) => i.highlightId !== item.highlightId)
    );

    onRemoteChange?.({
      type: 'delete',
      item,
    });
  }, [onRemoteChange]);

  // ============================================
  // LOCAL CHANGE HANDLERS
  // ============================================

  /**
   * Sync a single local item change to the server
   */
  const syncItem = useCallback(async (item) => {
    if (!session?.id || !enabled) return;

    try {
      isSyncingRef.current = true;
      setSyncStatus(SyncStatus.SYNCING);

      // Mark as pending to ignore our own real-time update
      pendingUpdatesRef.current.set(item.highlightId || item.id, true);

      // Track local version for conflict detection
      const newVersion = (item.version || 0) + 1;
      localVersionsRef.current.set(item.highlightId || item.id, newVersion);

      await upsertSurveyItem(session.id, {
        ...item,
        version: newVersion,
      });

      await logSyncChange(session.id, {
        changeType: 'update',
        source: 'app',
        userId: user?.id,
        newValues: item,
      });

      setLastSyncTime(new Date());
      setSyncStatus(SyncStatus.CONNECTED);
    } catch (error) {
      console.error('[useSurveySync] Failed to sync item:', error);
      setSyncError(error.message);
      pendingUpdatesRef.current.delete(item.highlightId || item.id);
    } finally {
      isSyncingRef.current = false;
    }
  }, [session?.id, enabled, user?.id]);

  /**
   * Sync all highlight annotations to the server
   */
  const syncAllItems = useCallback(async (highlightAnnotations) => {
    if (!session?.id || !enabled) return;

    try {
      isSyncingRef.current = true;
      setSyncStatus(SyncStatus.SYNCING);

      const items = flattenHighlightAnnotations(highlightAnnotations);

      // Mark all as pending
      items.forEach((item) => {
        const id = item.highlightId || item.id;
        pendingUpdatesRef.current.set(id, true);
        localVersionsRef.current.set(id, (item.version || 0) + 1);
      });

      await batchUpsertSurveyItems(session.id, items);

      setLastSyncTime(new Date());
      setSyncStatus(SyncStatus.CONNECTED);

      console.log('[useSurveySync] Synced', items.length, 'items');
    } catch (error) {
      console.error('[useSurveySync] Failed to sync all items:', error);
      setSyncError(error.message);
    } finally {
      isSyncingRef.current = false;
    }
  }, [session?.id, enabled]);

  /**
   * Delete an item from sync
   */
  const deleteItem = useCallback(async (highlightId) => {
    if (!session?.id || !enabled) return;

    try {
      await deleteSurveyItem(session.id, highlightId);
      localVersionsRef.current.delete(highlightId);

      await logSyncChange(session.id, {
        changeType: 'delete',
        source: 'app',
        userId: user?.id,
        oldValues: { highlightId },
      });
    } catch (error) {
      console.error('[useSurveySync] Failed to delete item:', error);
    }
  }, [session?.id, enabled, user?.id]);

  // ============================================
  // EXCEL SCHEMA MAPPING
  // ============================================

  /**
   * Save Excel schema mapping
   */
  const saveSchemaMapping = useCallback(async (mapping) => {
    if (!session?.id) return;
    return saveExcelSchemaMapping(session.id, mapping);
  }, [session?.id]);

  /**
   * Get Excel schema mappings
   */
  const getSchemaMappings = useCallback(async () => {
    if (!session?.id) return [];
    return getExcelSchemaMappings(session.id);
  }, [session?.id]);

  // ============================================
  // SESSION CONFIGURATION
  // ============================================

  /**
   * Update session with Excel file info
   */
  const linkExcelFile = useCallback(async (excelFilePath, excelFileId) => {
    if (!session?.id) return;

    const updated = await updateSurveySession(session.id, {
      excel_file_path: excelFilePath,
      excel_file_id: excelFileId,
    });

    setSession(updated);
    return updated;
  }, [session?.id]);

  // ============================================
  // UTILITY FUNCTIONS
  // ============================================

  /**
   * Get highlight annotations structure from remote items
   */
  const getHighlightAnnotationsFromRemote = useCallback(() => {
    return unflattenToHighlightAnnotations(remoteItems);
  }, [remoteItems]);

  /**
   * Check if we're currently syncing
   */
  const isSyncing = useCallback(() => {
    return isSyncingRef.current || syncStatus === SyncStatus.SYNCING;
  }, [syncStatus]);

  // ============================================
  // LIFECYCLE EFFECTS
  // ============================================

  // Initialize session when enabled
  useEffect(() => {
    if (enabled && templateId && user?.id) {
      initSession().then((sessionData) => {
        if (sessionData) {
          startSubscriptions(sessionData.id);
        }
      });
    }

    return () => {
      stopSubscriptions();
    };
  }, [enabled, templateId, user?.id]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      stopSubscriptions();
      if (session?.id) {
        closeSurveySession(session.id);
      }
    };
  }, []);

  return {
    // State
    session,
    syncStatus,
    syncError,
    remoteItems,
    activeUsers,
    lastSyncTime,

    // Session management
    initSession,
    linkExcelFile,

    // Sync operations
    syncItem,
    syncAllItems,
    deleteItem,
    isSyncing,

    // Schema mapping
    saveSchemaMapping,
    getSchemaMappings,

    // Utilities
    getHighlightAnnotationsFromRemote,

    // Manual control
    startSync: () => session && startSubscriptions(session.id),
    stopSync: stopSubscriptions,
  };
}

export default useSurveySync;
