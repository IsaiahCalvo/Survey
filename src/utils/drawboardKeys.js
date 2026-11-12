// Drawboard's extra keys (Nightly flag 'drawboard-keys'), from the Drawboard
// Projects keyboard sheet: Shift+Up / Down go to the previous / next page,
// Alt+O / Alt+U open the next / previous version of the document. Pure rules;
// PdfjsViewerContainer (pages) and AppShell (versions) listen.

const plainShift = (e) => Boolean(e?.shiftKey) && !e.altKey && !e.ctrlKey && !e.metaKey;

/** Shift+Up -> -1, Shift+Down -> +1, anything else 0. */
export function pageStepForKey(event) {
  if (!plainShift(event)) return 0;
  if (event.key === 'ArrowUp') return -1;
  if (event.key === 'ArrowDown') return 1;
  return 0;
}

/**
 * Alt+O -> +1 (next, newer version), Alt+U -> -1 (previous, older). Read from
 * the key's place (`code`), since Alt+O types "ø" on a Mac.
 */
export function versionStepForKey(event) {
  if (!event?.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return 0;
  const code = event.code || '';
  const key = String(event.key || '').toLowerCase();
  if (code === 'KeyO' || (!code && key === 'o')) return 1;
  if (code === 'KeyU' || (!code && key === 'u')) return -1;
  return 0;
}

/** The page a step lands on, kept inside 1..count; null when it would not move. */
export function steppedPage(current, step, count) {
  const n = Number(current) || 1;
  const last = Math.max(1, Number(count) || 1);
  const next = Math.min(last, Math.max(1, n + (step > 0 ? 1 : step < 0 ? -1 : 0)));
  return next === n ? null : next;
}

/** The version one step from the open one (by version number), or null at the ends. */
export function steppedVersion(versions, openId, step) {
  const list = [...(versions || [])].sort((a, b) => (a.versionNumber || 0) - (b.versionNumber || 0));
  const index = list.findIndex((v) => String(v.id) === String(openId));
  if (index < 0 || !step) return null;
  const next = index + (step > 0 ? 1 : -1);
  return next >= 0 && next < list.length ? list[next] : null;
}
