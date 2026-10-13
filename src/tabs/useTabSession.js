/**
 * useTabSession — keeps the desktop tab strip across reloads (Drawboard shell
 * audit, Chunk C, 2026-10-13).
 *
 * Saves which documents are open, their order and the active one, per signed-in
 * user, in localStorage. On the next start, once the user's library has loaded,
 * it hands AppShell the documents to reopen (rules in ./tabStrip.js). Every
 * storage call is wrapped: a private window or a full disk just means nothing
 * is restored, and start-up never waits on it.
 *
 * Nothing is written before the restore has had its turn, so the empty strip
 * of a fresh start never overwrites the saved list. `documentsUserId` names
 * whose library `documents` is: after an account switch without a reload the
 * old library is still there until the new one loads, and restore waits for
 * the new one (createTabSessionController).
 */
import { useEffect, useRef } from 'react';
import { createTabSessionController } from './tabStrip.js';

const browserStorage = () => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
};

export function useTabSession({ userId, documents, documentsUserId, tabs, activeTabId, onRestore, enabled = true }) {
  const controllerRef = useRef(null);
  if (!controllerRef.current) controllerRef.current = createTabSessionController(browserStorage);
  const onRestoreRef = useRef(onRestore);
  onRestoreRef.current = onRestore;
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  // Restore once per signed-in user, when that user's library is in.
  useEffect(() => {
    controllerRef.current.restore({
      enabled,
      userId,
      documents,
      documentsUserId,
      tabs: tabsRef.current,
      onRestore: (plan) => onRestoreRef.current?.(plan),
    });
  }, [enabled, userId, documents, documentsUserId]);

  // Save on every real change of the open documents / order / active tab.
  useEffect(() => {
    controllerRef.current.save({ enabled, userId, tabs, activeTabId });
  }, [enabled, userId, tabs, activeTabId]);
}
