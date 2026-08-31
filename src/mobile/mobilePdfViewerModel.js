import { getCompactSyncStatusMessage, getSyncStatusViewModel } from '../utils/syncStatusViewModel.js';

const SYNC_COLORS = {
  synced: '#2bbd7e',
  syncing: '#f5a524',
  offline: '#ef4444',
};

const initialsOf = (value) => {
  const name = String(value || 'User').trim();
  const source = name.includes('@') ? name.slice(0, name.indexOf('@')) : name;
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  if (parts.length > 1) return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
  return source.slice(0, 2).toUpperCase() || 'U';
};

export const getMobileSyncPresentation = (status, queueSize = 0, enabled = true) => {
  if (!enabled) return { state: 'unavailable', label: 'Cloud sync unavailable', color: '#687180' };
  const view = getSyncStatusViewModel(status, queueSize, false);
  return {
    ...view,
    compactMessage: getCompactSyncStatusMessage(status, queueSize),
    color: SYNC_COLORS[view.state] || '#687180',
  };
};

export const normalizeMobilePresence = ({
  presence = [],
  currentUserId = null,
  currentUserEmail = null,
  currentUserDisplayName = null,
} = {}) => {
  const unique = new Map();
  for (const row of Array.isArray(presence) ? presence : []) {
    const id = row?.user_id || row?.userId || row?.id;
    if (!id) continue;
    const previous = unique.get(id);
    const lastSeen = row?.last_seen || row?.lastSeen || '';
    const previousLastSeen = previous?.lastSeen || '';
    if (!previous || lastSeen > previousLastSeen) {
      const label = row?.display_name || row?.displayName || row?.name || row?.email || id;
      unique.set(id, {
        id,
        label,
        lastSeen,
        isCurrent: id === currentUserId,
        initials: initialsOf(label),
        role: row?.role || row?.user_role || null,
        status: row?.status || row?.activity || null,
      });
    }
  }

  let users = Array.from(unique.values());
  if (users.length === 0 && (currentUserId || currentUserEmail || currentUserDisplayName)) {
    const label = currentUserDisplayName || currentUserEmail || 'You';
    users = [{
      id: currentUserId || 'current-user',
      label,
      lastSeen: '',
      isCurrent: true,
      initials: initialsOf(label),
      role: null,
      status: null,
    }];
  }

  users.sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    return String(b.lastSeen).localeCompare(String(a.lastSeen));
  });
  return users;
};

const colorAlpha = (value) => {
  const source = String(value || '').trim();
  const rgba = source.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\s*\)$/i);
  if (rgba) return Math.max(0, Math.min(1, Number(rgba[1])));
  if (/^#[0-9a-f]{8}$/i.test(source)) return Number.parseInt(source.slice(7, 9), 16) / 255;
  return null;
};

export const getMobileTextMarkupPresentation = (api = {}) => {
  const toolbar = api || {};
  const editingSelection = toolbar.activeTool === 'select' && toolbar.contextTool === 'text-markup';
  const creatingSelection = toolbar.activeTool === 'text-select';
  const active = editingSelection || creatingSelection;
  const sharedToolbarActive = editingSelection || (creatingSelection && Boolean(toolbar.hasLiveTextSelection));
  const selectedPaint = editingSelection ? toolbar.selectedStrokeColor : null;
  const selectedAlpha = colorAlpha(selectedPaint);
  const rawOpacity = selectedAlpha == null ? Number(toolbar.strokeOpacity) : selectedAlpha * 100;

  return {
    active,
    editingSelection,
    sharedToolbarActive,
    color: selectedPaint && selectedPaint !== 'transparent'
      ? selectedPaint
      : (toolbar.strokeColor || '#f4d35e'),
    opacity: Math.max(5, Math.min(100, Number.isFinite(rawOpacity) ? rawOpacity : 30)),
    overlapMode: toolbar.textMarkupOverlapMode === 'uniform' ? 'uniform' : 'layered',
  };
};
