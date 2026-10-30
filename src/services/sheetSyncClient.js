// The app's side of the live sheet sync (supabase/functions/sheet-sync). The
// server does the work; the app asks it to run a round while a survey is open
// and shows what it says. Every device runs the same calls, so a phone, the
// web and the desktop app all write to the linked Google Sheet.
import { supabase } from '../supabaseClient';
import { getExportKit, DEFAULT_EXPORT_KIT_ID } from './exportFormats/registry.js';
import { answerSetFor } from './answerSets.js';

const FUNCTION = 'sheet-sync';

/** What the server needs to lay the survey out as a sheet. */
export function sheetLayoutInput(template) {
  if (!template) return null;
  return {
    template: {
      modules: template.modules || template.spaces || [],
      entities: template.entities || [],
    },
    kit: getExportKit(template.exportKitId) || getExportKit(DEFAULT_EXPORT_KIT_ID),
    answerValues: answerSetFor(template).map((a) => String(a.value)),
  };
}

export const sheetTemplateId = (template) => (template ? String(template.supabaseId || template.id || '') : '');

async function errorMessage(error, fallback) {
  try {
    const body = await error?.context?.json?.();
    if (body?.error) return String(body.error);
  } catch { /* not JSON */ }
  return fallback;
}

/** Call one sheet-sync action; resolves to the server's answer, or { error }. */
export async function sheetSyncCall(action, body = {}, client = supabase) {
  if (!client?.functions?.invoke) return { error: 'Not signed in.' };
  try {
    const { data, error } = await client.functions.invoke(FUNCTION, { body: { action, ...body } });
    if (error) return { error: await errorMessage(error, 'Could not reach the sheet sync. Check your connection.') };
    return data || {};
  } catch {
    return { error: 'Could not reach the sheet sync. Check your connection.' };
  }
}

/** "just now", "12 s ago", "3 min ago". */
export function syncedAgo(iso, now = Date.now()) {
  if (!iso) return '';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}
