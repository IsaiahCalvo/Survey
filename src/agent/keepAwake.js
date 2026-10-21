// Keeps the screen on while hands-free is listening: a locked phone stops
// the web mic, and someone walking a site should not have to keep tapping
// the screen. The browser drops the lock when the page is hidden, so it is
// taken again when the page comes back. Where there is no Wake Lock, this
// does nothing.
export function keepScreenAwake({ nav = typeof navigator !== 'undefined' ? navigator : null, doc = typeof document !== 'undefined' ? document : null } = {}) {
  if (!nav?.wakeLock?.request) return { release() {}, supported: false };
  let lock = null;
  let wanted = true;
  const take = async () => {
    if (!wanted || lock || doc?.visibilityState === 'hidden') return;
    try {
      lock = await nav.wakeLock.request('screen');
      if (!wanted) { lock.release().catch(() => {}); lock = null; return; }
      lock.addEventListener?.('release', () => { lock = null; });
    } catch { lock = null; /* low battery or not allowed: the screen may sleep */ }
  };
  const onVisible = () => { if (doc?.visibilityState === 'visible') take(); };
  doc?.addEventListener?.('visibilitychange', onVisible);
  take();
  return {
    supported: true,
    release() {
      wanted = false;
      doc?.removeEventListener?.('visibilitychange', onVisible);
      lock?.release?.().catch(() => {});
      lock = null;
    },
  };
}
