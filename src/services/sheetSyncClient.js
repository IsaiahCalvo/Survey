// The app's side of the live sheet sync (supabase/functions/sheet-sync). The
// server does the work; the app asks it to run a round while a survey is open
// and shows what it says. Every device runs the same calls, so a phone, the
// web and the desktop app all write to the linked Google Sheet.
import { supabase } from '../supabaseClient';
import { getExportKit, DEFAULT_EXPORT_KIT_ID } from './exportFormats/registry.js';
import { answerSetFor, excelAnswerFills } from './answerSets.js';
import { isFeatureOn } from '../featureFlags.js';

const FUNCTION = 'sheet-sync';

/** What the server needs to lay the survey out as a sheet. */
export function sheetLayoutInput(template, { tracking = isFeatureOn('marker-tracking') } = {}) {
  if (!template) return null;
  return {
    template: {
      modules: template.modules || template.spaces || [],
      entities: template.entities || [],
    },
    kit: getExportKit(template.exportKitId) || getExportKit(DEFAULT_EXPORT_KIT_ID),
    answerValues: answerSetFor(template).map((a) => String(a.value)),
    // The answers' colours, so the live Excel workbook looks like Export data's.
    answerFills: excelAnswerFills(answerSetFor(template)).map((f) => ({ value: String(f.value), argb: f.argb })),
    // Item tracking on: the sheet gets Status, Assigned to and Due columns.
    ...(tracking ? { tracking: true } : {}),
  };
}

export const sheetTemplateId = (template) => (template ? String(template.supabaseId || template.id || '') : '');

const OFFLINE = 'Could not reach the sheet sync. Check your connection.';
// The server answered, but not with its own words (it ran out of time or
// memory, say): that is not the person's connection.
const SERVER_TROUBLE = 'The sheet sync hit a problem on our side. Try again in a moment.';

async function errorOf(error) {
  try {
    const body = await error?.context?.json?.();
    if (body?.error) return { error: String(body.error), ...(body.code ? { code: String(body.code) } : {}) };
  } catch { /* not JSON */ }
  // supabase-js: FunctionsFetchError = never reached the server.
  if (error?.name === 'FunctionsFetchError' || !error?.context) return { error: OFFLINE };
  return { error: SERVER_TROUBLE };
}

/**
 * Call one sheet-sync action; resolves to the server's answer, or { error, code? }.
 * code 'reconnect': the Microsoft or Google sign-in has ended (the server
 * forgot it), so the panel should fetch its status and offer Connect again.
 */
export async function sheetSyncCall(action, body = {}, client = supabase) {
  if (!client?.functions?.invoke) return { error: 'Not signed in.' };
  try {
    const { data, error } = await client.functions.invoke(FUNCTION, { body: { action, ...body } });
    if (error) return errorOf(error);
    return data || {};
  } catch {
    return { error: OFFLINE };
  }
}

export { linkSyncedAgo, syncedAgo } from './sheetSyncTime.js';
