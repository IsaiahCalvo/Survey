import { useCallback, useEffect, useRef, useState } from 'react';
import { createLocalDraftWriter } from '../services/localDocumentDraftStore.js';
import { isManagedLocalDocument } from '../services/localDocumentState.js';

const lifecycleTargets = new WeakMap();
const sameSnapshot = (left, right) => !!left && !!right && left.pdfId === right.pdfId
  && Object.keys(left.entries).length === Object.keys(right.entries).length
  && Object.keys(left.entries).every(key => left.entries[key] === right.entries[key]);

// Only six string payloads are retained; do not stringify a second full copy on
// every render. The store validates and copies the snapshot at its write seam.
const retainSnapshot = state => ({ version: state.version, pdfId: state.pdfId, entries: { ...state.entries } });

function registerLifecycle(window, flush) {
  if (!window?.addEventListener) return () => {};
  let target = lifecycleTargets.get(window);
  if (!target) {
    const callbacks = new Set();
    const pagehide = () => { for (const callback of callbacks) callback(); };
    const hidden = () => { if (window.document.visibilityState === 'hidden') pagehide(); };
    target = { callbacks, pagehide, hidden };
    lifecycleTargets.set(window, target);
    window.addEventListener('pagehide', pagehide);
    window.document.addEventListener('visibilitychange', hidden);
  }
  target.callbacks.add(flush);
  return () => {
    target.callbacks.delete(flush);
    if (!target.callbacks.size) {
      window.removeEventListener('pagehide', target.pagehide);
      window.document.removeEventListener('visibilitychange', target.hidden);
      lifecycleTargets.delete(window);
    }
  };
}

// A receipt is only a recovery snapshot, never an acknowledgement of canonical
// Save or cloud sync. Pending UI changes coalesce under a fixed 150ms deadline.
export function useManagedLocalDraftTracking({ file, snapshot, ready, dirty,
  createWriter = createLocalDraftWriter, onError }) {
  const currentRef = useRef(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const [failure, setFailure] = useState(null);

  useEffect(() => {
    if (!isManagedLocalDocument(file)) return;
    const session = { file, writer: null, pending: null, seen: null, receipt: null,
      running: null, timer: null, started: false, retired: false, error: null };
    currentRef.current = session;
    const report = error => {
      const message = error?.message || 'Device recovery storage is unavailable.';
      if (session.error === message) return;
      session.error = message;
      if (currentRef.current === session && !session.retired) setFailure({ file, message });
      try { onErrorRef.current?.(error, file); } catch { /* Reporting cannot discard a draft. */ }
    };
    const drain = () => {
      clearTimeout(session.timer); session.timer = null;
      if (session.running) return session.running.then(() => session.pending ? drain() : session.receipt);
      if (!session.pending) return Promise.resolve(session.receipt);
      const state = session.pending; session.pending = null;
      let accepted;
      try {
        session.writer ||= createWriter(file);
        accepted = session.writer.capture(state);
      } catch (error) { accepted = Promise.reject(error); }
      session.running = Promise.resolve(accepted).then(receipt => {
        session.receipt = receipt; session.error = null;
        if (currentRef.current === session && !session.retired) setFailure(null);
        return receipt;
      }, error => {
        // Preserve the newest pending snapshot for an explicit retry or the
        // next edit. Do not spin on a full disk or replace it with an older one.
        session.pending ||= state;
        // Discard is permanent for that stored session. A later edit or an
        // explicit retry may start a fresh session, but never revive its row.
        if (error?.code === 'discarded') session.writer = null;
        report(error);
        throw error;
      }).finally(() => { session.running = null; });
      return session.running.then(() => session.pending ? drain() : session.receipt);
    };
    session.flush = drain;
    session.queue = state => {
      if (session.retired || sameSnapshot(session.seen, state)) return;
      session.seen = retainSnapshot(state);
      session.pending = session.seen;
      session.started = true;
      if (!session.timer && !session.running) {
        session.timer = setTimeout(() => { void drain().catch(() => {}); }, 150);
      }
    };
    const unregister = registerLifecycle(typeof window === 'undefined' ? null : window,
      () => { void drain().catch(() => {}); });
    return () => {
      session.retired = true;
      unregister();
      // The last committed editor state still belongs to this immutable File,
      // even when another tab/document has become current. Never drop its timer.
      void drain().catch(() => {}).finally(() => session.writer?.seal().catch(report));
      if (currentRef.current === session) currentRef.current = null;
    };
  }, [file, createWriter]);

  useEffect(() => {
    const session = currentRef.current;
    if (!session || session.file !== file || !ready || !snapshot || snapshot.pdfId !== file.localId) return;
    // After the first edit, capture deletion/undo-to-clean too. Otherwise an old
    // mark could be offered for recovery after the user deliberately removed it.
    if (dirty || session.started) session.queue(snapshot);
  }, [file, snapshot, ready, dirty]);

  const flush = useCallback(() => currentRef.current?.flush() || Promise.resolve(null), []);
  return { flush, retry: flush, error: failure?.file === file ? failure.message : null };
}
