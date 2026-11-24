/**
 * The words an export failure shows the user.
 *
 * Some export code is loaded only when it is first used. Offline, that load
 * fails, and the browser's message names the file's URL ("Failed to fetch
 * dynamically imported module: http://…"), which means nothing to a user.
 * Say what happened and what to do instead, and never show a URL.
 */

const MODULE_LOAD_FAILURE = /dynamically imported module|module script failed|error loading dynamically|ChunkLoadError|Loading chunk \S+ failed/i;
const URL_IN_TEXT = /\b(?:https?|file|capacitor):\/\/\S+/gi;

export function isModuleLoadFailure(err) {
  const text = String(err?.message || err || '');
  return err?.name === 'ChunkLoadError' || MODULE_LOAD_FAILURE.test(text);
}

export function exportFailureMessage(err, { offline = typeof navigator !== 'undefined' && navigator.onLine === false } = {}) {
  if (isModuleLoadFailure(err)) {
    return offline
      ? "Export failed: you're offline and this export isn't saved on this device yet. Connect and try again."
      : 'Export failed: part of Survey could not load. Reload the page and try again.';
  }
  const text = String(err?.message || err || '').replace(URL_IN_TEXT, '').replace(/[\s:]+$/, '').trim();
  return text ? `Export failed: ${text}` : 'Export failed.';
}
