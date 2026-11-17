// useTemplatesNeedPro — templates are Pro in the database (has_feature_access
// 'templates'), so every template save is turned down on Free. Returns a
// check for actions that would save templates (New template, Duplicate, the
// library's "Add them"): on a signed-in Free account it shows the Pro note
// and returns true, so the caller stops before making something that can't
// be kept (KAL-755). Signed out, templates live on this device, and while
// the plan is still loading it lets the action through; the save then says
// the same (templateSaveErrorText).
//
// Not tied to 'pro-lock' (off while paid plans are off): the database
// refuses either way. With pro-lock on it is the usual Pro prompt.
import { useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useProLock } from '../hooks/useProLock.js';
import { isFeatureOn } from '../featureFlags.js';
import { PAID_TIERS, PRO_LOCK_FLAG } from '../utils/proLock.js';
import { showToast } from '../utils/toast.js';
import { TEMPLATES_PRO_NOTE } from './templatePersistence.js';

export function useTemplatesNeedPro() {
  const auth = useAuth();
  const proLocked = useProLock();
  return useCallback(() => {
    const authUser = auth?.user;
    if (!authUser || auth.loadingTier || auth.tierUserId !== authUser.id) return false;
    if (PAID_TIERS.includes(auth.tier)) return false;
    if (isFeatureOn(PRO_LOCK_FLAG)) return proLocked('templates');
    showToast(TEMPLATES_PRO_NOTE, 'warn', { id: 'templates-need-pro' });
    return true;
  }, [auth, proLocked]);
}
