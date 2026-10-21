/**
 * crashReporter.js — sends each crash recorded by crashLog.js to the
 * client_errors table (supabase/migrations/20261021141000_client_errors.sql),
 * so crashes can be counted across everyone, not only seen on one device.
 *
 * No personal data leaves the device: no user id, no email, and no typed
 * text or the list of pressed buttons. Messages and stacks are scrubbed of
 * emails, file names, long ids and URL query strings before they are sent.
 * At most MAX_PER_PAGE reports go out per page load; the server caps the
 * overall rate as well.
 */
import { markCrashReportsSent, onCrashRecorded, readCrashReports } from './crashLog.js';

export const MAX_PER_PAGE = 5;
// Records written before the reporter existed, or while offline, are sent on
// the next load if they are this recent.
const BACKLOG_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Strip what could identify a person or a document from crash text. */
export function scrubCrashText(text, max) {
  if (!text) return text || null;
  let out = String(text)
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]')
    .replace(/(https?:\/\/[^\s?#'"]+)[?#][^\s'"]*/g, '$1')
    .replace(/[^\s/\\'"`()<>]+\.(?:pdf|xlsx?|csv|docx?|png|jpe?g|heic|zip)\b/gi, '[file]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[id]')
    .replace(/\b(?:eyJ[\w-]+\.){2}[\w-]+/g, '[token]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[id]')
    .replace(/\b\d{7,}\b/g, '[n]');
  if (max && out.length > max) out = `${out.slice(0, max - 1)}…`;
  return out;
}

export function platformOf(win = (typeof window !== 'undefined' ? window : null)) {
  if (!win) return 'unknown';
  const native = win.Capacitor?.getPlatform?.();
  if (native === 'ios' || native === 'android') return `${native}-app`;
  const narrow = (win.innerWidth || 0) < 768;
  return narrow ? 'web-phone' : 'web-desktop';
}

export function browserOf(userAgent = (typeof navigator !== 'undefined' ? navigator.userAgent : '')) {
  const ua = String(userAgent || '');
  const pick = [
    [/Edg\/(\d+)/, 'Edge'],
    [/Firefox\/(\d+)/, 'Firefox'],
    [/CriOS\/(\d+)/, 'Chrome iOS'],
    [/Chrome\/(\d+)/, 'Chrome'],
    [/Version\/(\d+)[\d.]* .*Safari/, 'Safari'],
  ];
  for (const [re, name] of pick) {
    const match = ua.match(re);
    if (match) return `${name} ${match[1]}`;
  }
  return 'other';
}

export function toReport(record, { win, userAgent } = {}) {
  return {
    p_kind: record.kind,
    p_message: scrubCrashText(record.message, 300) || 'Unknown error',
    p_stack: scrubCrashText(record.stack, 1500),
    p_route: scrubCrashText(record.route, 120),
    p_build: record.build ? String(record.build).slice(0, 64) : null,
    p_platform: platformOf(win),
    p_browser: browserOf(userAgent),
    p_occurred_at: record.at || null,
    p_repeats: record.count || 1,
  };
}

/**
 * Start sending. `supabase` is the app client; returns a stop function.
 * `now`, `storage`, `win` and `userAgent` are for tests.
 */
export function installCrashReporter(supabase, { now = () => Date.now(), storage, win, userAgent } = {}) {
  if (!supabase?.rpc) return () => {};
  let sent = 0;
  const send = async (record) => {
    if (!record || record.sentAt || sent >= MAX_PER_PAGE) return;
    sent += 1;
    try {
      const { error } = await supabase.rpc('report_client_error', toReport(record, { win, userAgent }));
      if (!error) markCrashReportsSent([record.id], { storage });
    } catch { /* offline: it goes out with the next load's backlog */ }
  };
  const backlog = readCrashReports(storage)
    .filter((record) => !record.sentAt && now() - Date.parse(record.at) < BACKLOG_MAX_AGE_MS);
  backlog.forEach(send);
  return onCrashRecorded((record) => { send(record); });
}
