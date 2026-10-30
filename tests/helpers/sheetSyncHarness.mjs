// The live sheet sync test rig: a linked survey whose markers live in memory
// the way the Y.Doc holds them, synced through the real Google provider
// against the fake Google (scripts/e2e-fake-google.mjs). Shared by
// tests/sheetSync.test.mjs and tests/sheetSyncBreak.test.mjs.
import { buildSyncLayout } from '../../supabase/functions/_shared/sheetSync/layout.js';
import { runSheetRound } from '../../supabase/functions/_shared/sheetSync/round.js';
import { googleSheetsProvider, googleEndpoints } from '../../supabase/functions/_shared/sheetSync/providers/google.js';
import { mergeMarkerWrites } from '../../supabase/functions/_shared/sheetSync/service.js';
import defaultKit from '../../src/services/exportFormats/kits/defaultSurvey.js';
import { fakeGoogleFetch, resetFakeGoogle } from '../../scripts/e2e-fake-google.mjs';

export { defaultKit, fakeGoogleFetch };

export const BASE = 'http://fake-google.test';
export const endpoints = googleEndpoints({
  GOOGLE_OAUTH_TOKEN_URL: `${BASE}/token`, GOOGLE_SHEETS_API_BASE: BASE, GOOGLE_DRIVE_API_BASE: BASE,
});

export const template = (extraLine = false) => ({
  modules: [{ id: 'm1', name: 'Level 1', categories: [
    { id: 'doors', name: 'Doors', checklist: [
      { id: 'c1', text: 'Locked?' },
      { id: 'c2', text: 'Height', kind: 'number' },
      ...(extraLine ? [{ id: 'c3', text: 'Signed off?' }] : []),
    ] },
    { id: 'cams', name: 'Cameras', checklist: [{ id: 'k1', text: 'Online?' }] },
  ] }],
  entities: [{ id: 'e1', name: 'Installed', color: '#0a0' }, { id: 'e2', name: 'Missing', color: '#a00' }],
});

// A made-up signing key (built here so secret scanners see no key-shaped literal).
export const signing = { keyId: 'k1', secret: btoa('test-only-'.repeat(4)), signingDocId: 'doc-1:sheet-sync' };

export const fakeApi = async (path, body) => {
  const res = await fakeGoogleFetch(`${BASE}/__fake${path}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  return res.json();
};

// One linked survey: markers held in memory the way the Y.Doc holds them.
export async function setup({ markers = {}, layout = buildSyncLayout({ template: template(), kit: defaultKit }) } = {}) {
  resetFakeGoogle();
  let provider = googleSheetsProvider({ endpoints, getAccessToken: async () => 'fake-access-1', fetchImpl: fakeGoogleFetch });
  const made = await provider.createFile({ title: 'Survey A', layout });
  const ctx = {
    markers: structuredClone(markers),
    link: { file_id: made.fileId, layout, baseline: {}, state: { sheetIds: made.sheetIds }, remote_version: null, app_hash: null },
    fileId: made.fileId,
    get provider() { return provider; },
    set provider(p) { provider = p; },
  };
  let n = 0; // new marker ids stay unique across rounds
  ctx.round = async (opts = {}) => {
    const result = await runSheetRound({
      link: ctx.link,
      provider: opts.provider || provider,
      loadMarkers: async () => structuredClone(ctx.markers),
      saveMarkers: async (writes) => { Object.assign(ctx.markers, mergeMarkerWrites(ctx.markers, ctx.markers, writes)); },
      signing,
      newMarkerId: () => `new-${++n}`,
      force: opts.force,
    });
    if (result.patch) Object.assign(ctx.link, result.patch);
    return result;
  };
  ctx.sheet = async (title = 'Doors - Level 1') => {
    const f = await fakeApi(`/files/${ctx.fileId}`);
    return f.sheets.find((s) => s.title === title);
  };
  ctx.edit = (edits, title = 'Doors - Level 1') => fakeApi(`/files/${ctx.fileId}/edit`, { title, edits });
  ctx.rowOf = async (markerId, title = 'Doors - Level 1') => {
    const sheet = await ctx.sheet(title);
    const nameCol = sheet.rows[0].indexOf('Item');
    return sheet.rows.findIndex((r, i) => i > 0 && r[nameCol] === ctx.markers[markerId]?.name);
  };
  ctx.col = async (header, title = 'Doors - Level 1') => (await ctx.sheet(title)).rows[0].indexOf(header);
  return ctx;
}

export const door = (id, name, extra = {}) => ({
  id, name, moduleId: 'm1', categoryId: 'doors', pageNumber: 1, bounds: { x: 1, y: 1, width: 5, height: 5 },
  checklistResponses: {}, note: { text: '' }, changedBy: 'IC', changedDate: '2026-10-28T12:00:00.000Z', ...extra,
});


/** The fake's own copy of a linked file, to change a sheet the way Google would. */
export const fakeFile = (ctx) => globalThis.__fakeGoogle.files.get(ctx.fileId);
