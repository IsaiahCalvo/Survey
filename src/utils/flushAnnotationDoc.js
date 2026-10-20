// A failed manual save must leave the busy state, while preserving the queue.
// Re-throw so the caller can retry; do not report a failed snapshot as saved.
export async function flushAnnotationDoc(handle, { onStatus, onQueueSize, isCurrent = () => true }) {
  onStatus({ stage: 'syncing' });
  try {
    await handle.drain();
    const saved = await handle.flushSnapshot();
    if (!isCurrent()) return;
    const next = handle.getSyncStatus?.() || {};
    onStatus({
      stage: saved && next.healthy !== false ? 'idle' : 'error',
      healthy: saved && next.healthy !== false,
      error: saved ? next.error || null : (next.error || 'sync failed'),
    });
    onQueueSize(Math.max(0, Number(next.queueSize) || 0));
  } catch (error) {
    if (isCurrent()) {
      const next = handle.getSyncStatus?.() || {};
      onStatus({ stage: 'error', healthy: false, error: error?.message || String(error) });
      onQueueSize(Math.max(0, Number(next.queueSize) || 0));
    }
    throw error;
  }
}
