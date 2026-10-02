import { getCompactSyncStatusMessage, getSyncStatusViewModel } from '../utils/syncStatusViewModel.js';
import {
  PRESENCE_STATE_LABEL,
  assignPresenceTints,
  presenceInitials,
  presenceLabel,
  presenceRowForUser,
  presenceSelfRow,
  presenceState,
} from '../components/presenceIdentity.js';

// UX 2026-09-17 (revision-2 palette, owner amendment b): the sync status dot
// keeps green / yellow / red. Everything else green in the chrome went gold,
// but a person has to tell "saved" from "broken" at a glance and gold already
// means "selected". These are the palette's --success / --warning / --danger.
const SYNC_COLORS = {
  synced: 'var(--success)',
  syncing: 'var(--warning)',
  offline: 'var(--danger)',
};

export const getMobileSyncPresentation = (status, queueSize = 0, enabled = true) => {
  if (!enabled) return { state: 'unavailable', label: 'Cloud sync unavailable', color: 'var(--text-disabled)' };
  const view = getSyncStatusViewModel(status, queueSize, false);
  return {
    ...view,
    compactMessage: getCompactSyncStatusMessage(status, queueSize),
    color: SYNC_COLORS[view.state] || 'var(--text-disabled)',
  };
};

export const normalizeMobilePresence = ({
  presence = [],
  currentUserId = null,
  currentUserEmail = null,
  currentUserDisplayName = null,
  now = Date.now(),
} = {}) => {
  const unique = new Map();
  for (const row of Array.isArray(presence) ? presence : []) {
    const id = row?.user_id || row?.userId || row?.id;
    if (!id) continue;
    const previous = unique.get(id);
    const lastSeen = row?.last_seen || row?.lastSeen || '';
    const previousLastSeen = previous?.lastSeen || '';
    if (!previous || lastSeen > previousLastSeen) {
      // The shared rule (presenceIdentity.js): name, else email - the same
      // label and initials the desktop footer draws for this person.
      const label = presenceLabel(presenceRowForUser({ ...row, user_id: id }, { currentUserId, currentUserDisplayName }));
      unique.set(id, {
        id,
        label,
        lastSeen,
        isCurrent: id === currentUserId,
        initials: presenceInitials(label),
        role: row?.role || row?.user_role || null,
        status: row?.status || row?.activity || null,
      });
    }
  }

  let users = Array.from(unique.values());
  if (users.length === 0 && (currentUserId || currentUserEmail || currentUserDisplayName)) {
    const label = presenceLabel(presenceSelfRow({ currentUserId, currentUserEmail, currentUserDisplayName }));
    users = [{
      id: currentUserId || 'current-user',
      label,
      lastSeen: '',
      isCurrent: true,
      initials: presenceInitials(label),
      role: null,
      status: null,
    }];
  }

  users.sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    return String(b.lastSeen).localeCompare(String(a.lastSeen));
  });
  // Same face as the desktop footer (components/presenceIdentity.js): your
  // calm grey, a muted tint per other person, and here-now / idle from
  // last_seen — no gold, which means "selected".
  const selfId = users.find((user) => user.isCurrent)?.id || currentUserId;
  const tints = assignPresenceTints(users.map((user) => user.id), selfId);
  return users.map((user) => {
    const state = presenceState({ last_seen: user.lastSeen }, { now, isCurrent: user.isCurrent });
    return { ...user, tint: tints.get(user.id), state, stateLabel: PRESENCE_STATE_LABEL[state] };
  });
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
