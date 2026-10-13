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
 * of a fresh start never overwrites the saved list.
 */
import { useEffect, useRef } from 'react';
import {
  libraryHasLoaded,
  planTabRestore,
  readTabSession,
  serializeTabSession,
  writeTabSession,
} from './tabStrip.js';

const browserStorage = () => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
};

export function useTabSession({ userId, documents, tabs, activeTabId, onRestore, enabled = true }) {
  const restoredForRef = useRef(null);
  const lastWrittenRef = useRef(null);
  // The commit that restores still holds the old strip; its write would
  // replace the saved list with it, so that one write is skipped.
  const skipWriteRef = useRef(false);
  const onRestoreRef = useRef(onRestore);
  onRestoreRef.current = onRestore;
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  // Restore once per signed-in user, when the library is in.
  useEffect(() => {
    if (!enabled || !userId || restoredForRef.current === userId) return;
    if (!libraryHasLoaded(documents)) return;
    restoredForRef.current = userId;
    lastWrittenRef.current = null;
    const session = readTabSession(browserStorage(), userId);
    const plan = planTabRestore(session, documents, tabsRef.current);
    if (plan.skipped.length) {
      console.info('[TabSession] skipped documents that are no longer available:', plan.skipped.length);
    }
    if (plan.rows.length) {
      skipWriteRef.current = true;
      try {
        onRestoreRef.current?.(plan);
      } catch (error) {
        console.warn('[TabSession] restore failed', error);
      }
    }
  }, [enabled, userId, documents]);

  // Save on every real change of the open documents / order / active tab.
  useEffect(() => {
    if (!enabled || !userId || restoredForRef.current !== userId) return;
    if (skipWriteRef.current) { skipWriteRef.current = false; return; }
    const session = serializeTabSession(tabs, activeTabId);
    const text = JSON.stringify(session);
    if (text === lastWrittenRef.current) return;
    if (writeTabSession(browserStorage(), userId, session)) lastWrittenRef.current = text;
  }, [enabled, userId, tabs, activeTabId]);
}
