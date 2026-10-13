/**
 * "A document's thumbnail just changed" — pushed, never polled.
 *
 * UX (owner 2026-09-23): "The thumbnail should always be updated, but it needs
 * to be lightweight. It shouldn't be constantly fetching." So nothing in the
 * list ever asks "is there a newer thumbnail?" on a timer. Instead, whoever
 * writes a new thumbnail (the open viewer after edits settle, or the idle
 * backfill) announces it here, and only the rows showing that document re-read
 * their one image from the local cache.
 *
 * Two audiences:
 *   - this window: plain in-memory listeners (the Documents list and the
 *     viewer live in the same page);
 *   - other windows/tabs of the same app on this device: a BroadcastChannel.
 *     It is supported in Chromium (web + Electron) and WebKit 15.4+
 *     (Safari + the Capacitor iOS WebView). Where it is missing the other tab
 *     simply shows the new image on its next list visit, which is the old
 *     behaviour, so this degrades to "no worse than before", never an error.
 */

const CHANNEL_NAME = 'survey-thumbnails-v1';
const listeners = new Set();
let channel;

function getChannel() {
  if (channel !== undefined) return channel;
  channel = null;
  try {
    if (typeof BroadcastChannel === 'function') {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = (event) => deliver(event?.data, true);
      // Node (the test runner) also has BroadcastChannel; never let this
      // decoration keep a process alive.
      channel.unref?.();
    }
  } catch {
    channel = null;
  }
  return channel;
}

function deliver(message, remote) {
  if (!message || typeof message.docId !== 'string') return;
  for (const listener of [...listeners]) {
    try { listener({ ...message, remote }); } catch { /* one bad row must not stop the rest */ }
  }
}

/** Announce that `docId`'s cached thumbnail (under `key`) was replaced. */
export function publishThumbnailUpdate({ docId, key = null, source = null }) {
  if (!docId) return;
  const message = { docId: String(docId), key, source, at: Date.now() };
  deliver(message, false);
  try { getChannel()?.postMessage(message); } catch { /* closed channel: local listeners already ran */ }
}

/** Listen for thumbnail changes (this tab and sibling tabs). Returns unsubscribe. */
export function subscribeThumbnailUpdates(listener) {
  if (typeof listener !== 'function') return () => {};
  getChannel();
  listeners.add(listener);
  return () => listeners.delete(listener);
}
