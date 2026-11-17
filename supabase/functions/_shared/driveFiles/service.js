// OneDrive files that save back (Nightly flag 'drive-sync-back';
// /mnt/project-files/drawboard-trial/file-model/drive-sync-back-plan.md).
//
// Drawboard opens a PDF from OneDrive or SharePoint as a "linked file": it
// keeps working on its own copy (live, like any cloud file) and writes the
// marked-up PDF back to the drive on a timer or on "Sync now". Survey does the
// same with the Microsoft sign-in the live Excel sync already keeps on the
// server (sheet_sync_connections, Files.ReadWrite.All).
//
// The PDF never passes through this server, and the Graph token never reaches
// the app:
//   driveOpen   gives the app Graph's short-lived download link for one file;
//               the app uploads it the normal way, then calls driveLink.
//   drivePush   opens a Graph upload session (If-Match: the eTag Survey last
//               saw) and gives the app its one-file upload link; the app sends
//               the built PDF straight to Microsoft, then calls drivePushed.
//   driveOpen with kind 'xlsx' and driveReplace (If-Match: the eTag the app
//               read) do the same for an Excel workbook another suite app
//               keeps in step with its own list (Walkthru's node list).
// Graph answers 412 when the drive file changed since (a conflict), 404 when
// it was moved or deleted, 403 when the person can't write to it.
// The eTag also changes on a rename, a move or a SharePoint column edit, so
// Survey keeps the cTag (content only) too: a 412 whose content is unchanged
// is no conflict, and the push goes again with the fresh eTag.
//
// Who may do what: browse / open with your own Microsoft sign-in; link, push,
// change settings: an editor or owner of the Survey document. Pushes use the
// sign-in of the person who linked the file, so a field tech with no
// Microsoft account still saves back. Unlink: the linker or the owner.
import { decryptToken, encryptToken } from '../sheetSync/tokenCrypto.js';
import { msgraphAuthConfigFromEnv, refreshMsgraphToken } from '../sheetSync/msgraphAuth.js';
import { folderTarget, linkItemPath, placeToken } from '../sheetSync/providers/msgraph.js';
import { fetchWithTimeout } from '../sheetSync/providers/contract.js';
import { googleEndpoints, refreshGoogleToken } from '../sheetSync/providers/google.js';

export const DRIVE_SYNC_FLAG = 'drive-sync-back';
export const DRIVE_ACTIONS = Object.freeze([
  'driveBrowse', 'driveOpen', 'driveLink', 'driveStatus', 'drivePush', 'drivePushed', 'driveSettings', 'driveUnlink',
  'drivePickerToken', 'driveCreate', 'driveReplace',
]);
// A Google Drive file has no drive id to keep; its link row stores this.
export const GOOGLE_DRIVE_ID = 'google';
export const DEFAULT_SYNC_MINUTES = 5;
const REQUEST_TIMEOUT_MS = 20_000;
// How many PDFs the picker's Recent list shows.
const RECENT_SIZE = 8;
const ID = /^[A-Za-z0-9!_.-]{1,200}$/;
// The app's own origin, sent so Google's upload link answers its browser.
const ORIGIN = /^(https?|capacitor):\/\/[A-Za-z0-9.:-]{1,190}$/;

export class DriveError extends Error {
  constructor(message, status = 400, code = 'drive') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// One line in the function's log: an event name and plain fields, never a
// link or a token.
const note = (event, fields = {}) => {
  try { console.log(JSON.stringify({ fn: 'sheet-sync', event, ...fields })); } catch { /* never throw */ }
};

const tokenKey = (env) => env.SHEET_SYNC_TOKEN_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
const msConfig = (env) => {
  const base = (env.SHEET_SYNC_PUBLIC_URL || `${String(env.SUPABASE_URL || '').replace(/\/$/, '')}/functions/v1/sheet-sync`).replace(/\/$/, '');
  return msgraphAuthConfigFromEnv((name) => env[name], { redirectUri: `${base}/oauth/msgraph/callback` });
};

/** "Documents › Jobs" from a file's web address: where a search hit lives. */
function whereFrom(webUrl) {
  try {
    const parts = new URL(String(webUrl)).pathname.split('/').filter(Boolean).map((p) => decodeURIComponent(p));
    return parts.slice(0, -1).slice(-2).join(' › ') || null;
  } catch {
    return null;
  }
}

/** A small Graph client for drive files. `getAccessToken` gives a fresh token. */
export function createDriveClient({ getAccessToken, fetch: fetchImpl = globalThis.fetch, baseUrl }) {
  async function call(method, path, { headers = {}, body } = {}) {
    const token = await getAccessToken();
    const response = await fetchWithTimeout(fetchImpl, `${baseUrl}/${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, REQUEST_TIMEOUT_MS);
    const text = await response.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
    if (!response.ok) {
      const err = new Error(parsed?.error?.message || `Microsoft answered ${response.status}`);
      err.status = response.status;
      err.graphCode = parsed?.error?.code || null;
      if (response.status === 401) err.code = 'reconnect';
      throw err;
    }
    return parsed;
  }
  const itemPath = (driveId, itemId) => `drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}`;
  const SELECT = 'id,name,eTag,cTag,size,webUrl,file,folder,parentReference,lastModifiedDateTime,lastModifiedBy';
  return {
    async browse(folder = '') {
      const target = folderTarget(folder);
      const sub = target.sub ? `${target.base}:/${target.sub.split('/').map(encodeURIComponent).join('/')}:` : target.base;
      let next = `${sub}/children?$select=${SELECT},remoteItem&$top=200`;
      const folders = [];
      const places = [];
      const files = [];
      for (let page = 0; next && page < 5; page += 1) {
        const res = await call('GET', next);
        for (const it of res?.value || []) {
          if (it?.folder) folders.push(String(it.name));
          else if (it?.remoteItem?.folder && it.remoteItem.id && it.remoteItem.parentReference?.driveId) {
            places.push({ name: String(it.name), folder: placeToken(it.remoteItem.parentReference.driveId, it.remoteItem.id) });
          } else if (it?.file && /\.pdf$/i.test(String(it.name || ''))) {
            files.push({
              name: String(it.name),
              driveId: String(it.parentReference?.driveId || ''),
              itemId: String(it.id),
              size: Number(it.size) || 0,
              modifiedAt: it.lastModifiedDateTime || null,
            });
          }
        }
        const link = res?.['@odata.nextLink'];
        next = link ? link.replace(/^https?:\/\/[^/]+\/v1\.0\//, '') : null;
      }
      const byName = (a, b) => String(a.name ?? a).localeCompare(String(b.name ?? b));
      folders.sort(byName);
      places.sort(byName);
      files.sort(byName);
      return { folders, places, files };
    },
    // PDFs anywhere the sign-in reaches: its OneDrive, SharePoint and Teams
    // libraries, and files others shared with it. Works with
    // Files.ReadWrite.All alone (Sites.Read.All is not asked for), and for a
    // guest with no OneDrive. Personal Microsoft accounts have no search
    // service: their own OneDrive's search answers instead.
    // `recent`: the newest PDFs first (Microsoft retired drive/recent in
    // November 2026, so Search sorted by last change stands in for it).
    async search(text, { recent = false } = {}) {
      const words = String(text || '').replace(/[():"*\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
      const files = [];
      const add = (it) => {
        if (!it?.id || !/\.pdf$/i.test(String(it.name || '')) || it.folder) return;
        if (files.some((f) => f.itemId === String(it.id))) return;
        files.push({
          name: String(it.name),
          driveId: String(it.parentReference?.driveId || ''),
          itemId: String(it.id),
          size: Number(it.size) || 0,
          modifiedAt: it.lastModifiedDateTime || null,
          where: whereFrom(it.webUrl),
        });
      };
      const ask = (sorted) => call('POST', 'search/query', {
        body: { requests: [{
          entityTypes: ['driveItem'],
          query: { queryString: `${words ? `${words} ` : ''}filetype:pdf` },
          from: 0,
          size: recent ? RECENT_SIZE : 50,
          fields: ['id', 'name', 'size', 'webUrl', 'parentReference', 'lastModifiedDateTime'],
          ...(sorted ? { sortProperties: [{ name: 'lastModifiedDateTime', isDescending: true }] } : {}),
        }] },
      });
      try {
        let res;
        try { res = await ask(recent); } catch (err) {
          // A tenant whose search refuses a sort still gets the list.
          if (!recent || Number(err?.status) !== 400) throw err;
          res = await ask(false);
        }
        for (const box of res?.value?.[0]?.hitsContainers || []) for (const hit of box?.hits || []) add(hit?.resource);
        if (recent) files.sort((a, b) => String(b.modifiedAt || '').localeCompare(String(a.modifiedAt || '')));
      } catch (err) {
        if (Number(err?.status) === 401 || ![400, 403, 404, 501].includes(Number(err?.status))) throw err;
        if (!words) throw err;
        const res = await call('GET', `me/drive/root/search(q='${encodeURIComponent(words.replace(/'/g, "''"))}')?$select=${SELECT}&$top=50`);
        for (const it of res?.value || []) add(it);
      }
      return { files };
    },
    async resolveLink(url) {
      return call('GET', `${linkItemPath(url)}?$select=${SELECT}`);
    },
    async item(driveId, itemId) {
      return call('GET', `${itemPath(driveId, itemId)}?$select=${SELECT},@microsoft.graph.downloadUrl`);
    },
    // The short download link, when item() came back without one. A work
    // account's OneDrive can leave it out of a $select answer (seen live on a
    // Microsoft 365 Business tenant, 2026-11-16). Ask for the whole item, then
    // for the file itself: Graph answers that with a redirect to the same
    // kind of link. Resolves { url, by } or throws with Graph's status.
    async downloadLink(driveId, itemId) {
      let whole = null;
      try { whole = await call('GET', itemPath(driveId, itemId)); } catch (err) {
        if ([401, 403, 404, 410, 429, 503].includes(Number(err?.status))) throw err;
      }
      if (whole?.['@microsoft.graph.downloadUrl']) return { url: whole['@microsoft.graph.downloadUrl'], by: 'item' };
      const token = await getAccessToken();
      const response = await fetchWithTimeout(fetchImpl, `${baseUrl}/${itemPath(driveId, itemId)}/content`, {
        method: 'GET', headers: { Authorization: `Bearer ${token}` }, redirect: 'manual',
      }, REQUEST_TIMEOUT_MS);
      const where = response.headers?.get?.('location') || null;
      try { await response.body?.cancel?.(); } catch { /* nothing to drop */ }
      if (response.status >= 300 && response.status < 400 && /^https:\/\//i.test(String(where))) return { url: where, by: 'content' };
      const err = new Error(`Microsoft answered ${response.status} with no download link`);
      err.status = response.ok ? 502 : response.status;
      err.answered = response.status;
      if (response.status === 401) err.code = 'reconnect';
      throw err;
    },
    // A new file in `folder` ("" = the drive's top, "A/B", or a shared place
    // token): an upload link the app sends the bytes to. A same-named file is
    // kept; Microsoft adds " 1" to the new one.
    async newFileSession(folder, name) {
      const target = folderTarget(folder);
      const parts = [...String(target.sub || '').split('/').filter(Boolean), name].map(encodeURIComponent).join('/');
      return call('POST', `${target.base}:/${parts}:/createUploadSession`, {
        body: { item: { '@microsoft.graph.conflictBehavior': 'rename' } },
      });
    },
    async uploadSession(driveId, itemId, { ifMatch = null } = {}) {
      return call('POST', `${itemPath(driveId, itemId)}/createUploadSession`, {
        headers: ifMatch ? { 'If-Match': ifMatch } : {},
        body: { item: { '@microsoft.graph.conflictBehavior': 'replace' } },
      });
    },
  };
}

// ---- Google Drive -------------------------------------------------------------
//
// Same model as OneDrive, through the Google sign-in the live Sheets sync keeps
// (sheet_sync_connections, drive.file scope only). drive.file reaches only
// files the person picked with Survey, so the app shows Google's own Picker
// (drivePickerToken gives it a short-lived token of that sign-in, which can
// reach nothing the person did not pick). Google has no short download link,
// so driveOpen hands the app the file's address and that same kind of token.
// A push checks the file's head revision (Drive v3 takes no If-Match), then
// opens a resumable upload the app sends the PDF to (Origin set, so Google
// answers the app's browser with CORS).

/** A Drive v3 client. Items come back in the Graph shape the actions use. */
export function createGoogleDriveClient({ getAccessToken, fetch: fetchImpl = globalThis.fetch, baseUrl = 'https://www.googleapis.com' }) {
  const base = String(baseUrl).replace(/\/$/, '');
  const FIELDS = 'id,name,mimeType,size,headRevisionId,sha256Checksum,modifiedTime,webViewLink,trashed,capabilities(canEdit),lastModifyingUser(displayName)';
  async function call(method, url, { headers = {}, body } = {}) {
    const token = await getAccessToken();
    const response = await fetchWithTimeout(fetchImpl, url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json; charset=UTF-8' } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, REQUEST_TIMEOUT_MS);
    const text = await response.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
    if (!response.ok) {
      const reason = parsed?.error?.errors?.[0]?.reason || parsed?.error?.status || null;
      const err = new Error(parsed?.error?.message || `Google answered ${response.status}`);
      // Google says "slow down" with a 403 too.
      err.status = response.status === 403 && /rateLimit/i.test(String(reason)) ? 429 : response.status;
      err.graphCode = reason;
      if (response.status === 401) err.code = 'reconnect';
      throw err;
    }
    return { parsed, response };
  }
  const fileUrl = (fileId) => `${base}/drive/v3/files/${encodeURIComponent(fileId)}`;
  const file = async (fileId) => {
    const { parsed: f } = await call('GET', `${fileUrl(fileId)}?supportsAllDrives=true&fields=${encodeURIComponent(FIELDS)}`);
    // A file in the bin is gone, as Drawboard treats it.
    if (!f || f.trashed) throw Object.assign(new Error('Google Drive file is in the bin'), { status: 404 });
    return {
      id: String(f.id),
      name: String(f.name || ''),
      eTag: f.headRevisionId || null,
      // The content's SHA-256: lets a late confirm tell Survey's own upload
      // (the app sends the same hash) from a later change in Drive.
      sha256: typeof f.sha256Checksum === 'string' ? f.sha256Checksum.toLowerCase() : null,
      size: Number(f.size) || 0,
      webUrl: f.webViewLink || null,
      file: { mimeType: f.mimeType || '' },
      isPdf: f.mimeType === 'application/pdf' || /\.pdf$/i.test(String(f.name || '')),
      canEdit: f.capabilities?.canEdit !== false,
      lastModifiedDateTime: f.modifiedTime || null,
      lastModifiedBy: { user: { displayName: f.lastModifyingUser?.displayName || null } },
      parentReference: { driveId: GOOGLE_DRIVE_ID },
      downloadUrl: `${fileUrl(fileId)}?alt=media&supportsAllDrives=true`,
    };
  };
  return {
    provider: 'google',
    accessToken: () => getAccessToken(),
    item: (_driveId, itemId) => file(itemId),
    async uploadSession(_driveId, itemId, { ifMatch = null, origin = null } = {}) {
      const it = await file(itemId);
      if (ifMatch && it.eTag && it.eTag !== ifMatch) throw Object.assign(new Error('changed in Google Drive'), { status: 412 });
      if (!it.canEdit) throw Object.assign(new Error('read only'), { status: 403 });
      const { response } = await call('PATCH', `${base}/upload/drive/v3/files/${encodeURIComponent(itemId)}?uploadType=resumable&supportsAllDrives=true&fields=id,headRevisionId`, {
        headers: { 'X-Upload-Content-Type': 'application/pdf', ...(origin ? { Origin: origin } : {}) },
        body: {},
      });
      return { uploadUrl: response.headers.get('location') || null, expirationDateTime: null };
    },
  };
}

// The Picker's app id is the Cloud project number, the first part of an OAuth
// client id ("123456789012-abc.apps.googleusercontent.com").
export function googleProjectNumber(env = {}) {
  if (/^\d{6,20}$/.test(String(env.GOOGLE_CLOUD_PROJECT_NUMBER || ''))) return String(env.GOOGLE_CLOUD_PROJECT_NUMBER);
  const m = /^(\d{6,20})-/.exec(String(env.GOOGLE_SHEETS_CLIENT_ID || ''));
  return m ? m[1] : null;
}

async function googleClientFor(ctx, userId) {
  const env = ctx.env || {};
  const clientId = env.GOOGLE_SHEETS_CLIENT_ID;
  const clientSecret = env.GOOGLE_SHEETS_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new DriveError('Google Drive is not set up on this server yet.', 503, 'not_configured');
  const endpoints = googleEndpoints(env);
  const { data: row } = await ctx.service.from('sheet_sync_connections')
    .select('refresh_token_enc').eq('user_id', userId).eq('provider', 'google').maybeSingle();
  if (!row) throw new DriveError('Connect Google first.', 409, 'not_connected');
  const refreshToken = await decryptToken(row.refresh_token_enc, tokenKey(env));
  let access = null;
  const getAccessToken = async () => {
    if (access && access.expiresAt > Date.now() + 60_000) return access.accessToken;
    try {
      access = await refreshGoogleToken({ endpoints, clientId, clientSecret, refreshToken, fetchImpl: ctx.fetchImpl });
    } catch (err) {
      if (err?.code === 'reconnect' || Number(err?.status) === 401) throw new DriveError('The Google sign-in has ended. Connect Google again.', 401, 'reconnect');
      throw err;
    }
    return access.accessToken;
  };
  return createGoogleDriveClient({ getAccessToken, fetch: ctx.fetchImpl, baseUrl: endpoints.drive });
}

const providerOf = (value) => (value === 'google' ? 'google' : 'msgraph');
const placeName = (provider) => (provider === 'google' ? 'Google Drive' : 'OneDrive');
const companyName = (provider) => (provider === 'google' ? 'Google' : 'Microsoft');

/** A drive client signed in as `userId`: Graph (default) or Google Drive. */
async function driveClientFor(ctx, userId, provider = 'msgraph') {
  if (ctx.driveClientFor) return ctx.driveClientFor(userId, provider);
  if (provider === 'google') return googleClientFor(ctx, userId);
  const ms = msConfig(ctx.env);
  if (!ms) throw new DriveError('Microsoft 365 is not set up on this server yet.', 503, 'not_configured');
  const { data: row } = await ctx.service.from('sheet_sync_connections')
    .select('refresh_token_enc').eq('user_id', userId).eq('provider', 'msgraph').maybeSingle();
  if (!row) throw new DriveError('Connect Microsoft first.', 409, 'not_connected');
  let refreshToken = await decryptToken(row.refresh_token_enc, tokenKey(ctx.env));
  let access = null;
  const getAccessToken = async () => {
    if (access && access.expiresAt > Date.now() + 60_000) return access.accessToken;
    try {
      access = await refreshMsgraphToken(ms, refreshToken, { fetch: ctx.fetchImpl });
    } catch (err) {
      if (Number(err?.status) === 400 || Number(err?.status) === 401) throw new DriveError('The Microsoft sign-in has ended. Connect Microsoft again.', 401, 'reconnect');
      throw err;
    }
    if (access.refreshToken && access.refreshToken !== refreshToken) {
      refreshToken = access.refreshToken;
      await ctx.service.from('sheet_sync_connections')
        .update({ refresh_token_enc: await encryptToken(refreshToken, tokenKey(ctx.env)), updated_at: new Date().toISOString() })
        .eq('user_id', userId).eq('provider', 'msgraph');
    }
    return access.accessToken;
  };
  return createDriveClient({ getAccessToken, fetch: ctx.fetchImpl, baseUrl: ms.graphBase });
}

async function requireBeta(ctx) {
  const [{ data: flags }, { data: nightly }] = await Promise.all([
    ctx.userDb.rpc('get_my_feature_flags'),
    ctx.userDb.rpc('can_use_nightly'),
  ]);
  if (flags?.[DRIVE_SYNC_FLAG] === true || nightly === true) return;
  throw new DriveError('Drive files that save back are in beta on Survey Nightly.', 403, 'beta');
}

async function roleOf(ctx, documentId) {
  if (!documentId) throw new DriveError('Say which document.', 400, 'missing_document');
  const { data, error } = await ctx.userDb.rpc('get_my_document_role', { doc_id: documentId });
  if (error) throw new DriveError('Could not check your access to this document.', 500, 'role');
  return data || null;
}

async function requireEditor(ctx, documentId) {
  const role = await roleOf(ctx, documentId);
  if (role !== 'owner' && role !== 'editor') throw new DriveError('Only editors of this document can save it back to its drive.', 403, 'not_editor');
  return role;
}

async function linkRow(ctx, documentId) {
  const { data } = await ctx.service.from('document_drive_links').select('*').eq('document_id', documentId).maybeSingle();
  return data || null;
}

const publicLink = (row) => (row ? {
  provider: row.provider,
  name: row.name,
  webUrl: row.web_url,
  syncMinutes: row.sync_minutes,
  syncOff: row.sync_off,
  lastPushedAt: row.last_pushed_at,
  lastPushedSha: row.last_pushed_sha,
  lastError: row.last_error,
  linkedBy: row.linked_by,
} : null);

function graphProblem(err, { where = 'push', provider = 'msgraph' } = {}) {
  if (err instanceof DriveError) return err;
  const status = Number(err?.status);
  const place = placeName(provider);
  const company = companyName(provider);
  if (err?.code === 'reconnect' || status === 401) return new DriveError(`The ${company} sign-in used for this file has ended. Connect ${company} again.`, 401, 'reconnect');
  if (status === 412) return new DriveError(`Someone changed this file in ${place} since Survey last saved it.`, 409, 'conflict');
  if (status === 404 || status === 410) return new DriveError(`The ${place} file was moved or deleted.`, 404, 'gone');
  if (status === 403) return new DriveError(where === 'push' ? `You can open this ${place} file but not change it.` : `You do not have access to that ${place} file.`, 403, 'read_only');
  if (status === 423) return new DriveError(`The file is open or checked out in ${place}. Survey will try again.`, 423, 'locked');
  if (status === 429 || status === 503) return new DriveError(`${company} asked Survey to slow down. It will try again.`, 429, 'busy');
  return new DriveError(`${company} could not be reached. Survey will try again.`, 502, 'graph');
}

// An account with no OneDrive of its own (a guest, or no OneDrive licence):
// Graph answers 403 notAllowed (provisioningNotAllowed), 401 accessDenied or
// 404 at the top of "my drive". It can still open SharePoint or Teams links.
function noOwnDrive(err, folder) {
  if (folderTarget(folder).driveId) return false;
  const status = Number(err?.status);
  const graphCode = String(err?.graphCode || '');
  if (status === 401) return Boolean(graphCode) && !/token/i.test(graphCode);
  return status === 403 || (status === 404 && !folder);
}

async function browse(ctx) {
  await requireBeta(ctx);
  if (providerOf(ctx.body.provider) === 'google') throw new DriveError('Pick Google Drive files with Google’s picker.', 400, 'use_picker');
  const client = await driveClientFor(ctx, ctx.user.id);
  let folder = String(ctx.body.folder || '');
  if (typeof ctx.body.search === 'string') {
    const recent = ctx.body.recent === true && !ctx.body.search.trim();
    try { return { search: ctx.body.search.trim(), ...(recent ? { recent: true } : {}), ...(await client.search(ctx.body.search, { recent })) }; } catch (err) { throw graphProblem(err, { where: 'browse' }); }
  }
  try {
    let name;
    const pasted = String(ctx.body.folderLink || '').trim();
    if (pasted) {
      if (!/^https:\/\/\S+$/i.test(pasted)) throw new DriveError('Paste a link that starts with https://', 400, 'bad_link');
      let it;
      try { it = await client.resolveLink(pasted); } catch (err) {
        if ([400, 403, 404].includes(Number(err?.status))) throw new DriveError('Survey could not open that link with your Microsoft sign-in.', 400, 'bad_link');
        throw err;
      }
      if (it?.file) {
        if (!/\.pdf$/i.test(String(it.name || ''))) throw new DriveError('That link is to a file that is not a PDF.', 400, 'not_pdf');
        return { file: { name: String(it.name), driveId: String(it.parentReference?.driveId || ''), itemId: String(it.id), size: Number(it.size) || 0 } };
      }
      folder = placeToken(it.parentReference?.driveId, it.id);
      name = String(it.name || 'Folder');
    }
    const listed = await client.browse(folder);
    return { folder, ...(name ? { name } : {}), ...listed };
  } catch (err) {
    if (!(err instanceof DriveError) && noOwnDrive(err, folder)) {
      throw new DriveError('Your Microsoft account has no OneDrive. Paste a SharePoint or Teams link below.', 409, 'no_onedrive');
    }
    if (Number(err?.status) === 404) return { folder, folders: [], places: [], files: [] };
    throw graphProblem(err, { where: 'browse' });
  }
}

function needIds(body) {
  const provider = providerOf(body.provider);
  const driveId = provider === 'google' ? GOOGLE_DRIVE_ID : String(body.driveId || '');
  const itemId = String(body.itemId || '');
  if (!ID.test(driveId) || !ID.test(itemId)) throw new DriveError(`Say which ${placeName(provider)} file.`, 400, 'missing_file');
  return { driveId, itemId, provider };
}

/** Google only: a short-lived token and app id for Google's Picker in the app. */
async function pickerToken(ctx) {
  await requireBeta(ctx);
  const appId = googleProjectNumber(ctx.env || {});
  const client = await driveClientFor(ctx, ctx.user.id, 'google');
  let accessToken;
  try { accessToken = await client.accessToken(); } catch (err) { throw graphProblem(err, { where: 'open', provider: 'google' }); }
  return { accessToken, appId };
}

async function open(ctx) {
  await requireBeta(ctx);
  const { driveId, itemId, provider } = needIds(ctx.body);
  const client = await driveClientFor(ctx, ctx.user.id, provider);
  let it;
  try { it = await client.item(driveId, itemId); } catch (err) { throw graphProblem(err, { where: 'open', provider }); }
  // kind 'xlsx': a workbook another suite app keeps in step with its own
  // list (Walkthru's node list), OneDrive only.
  if (ctx.body.kind === 'xlsx') {
    if (provider === 'google') throw new DriveError('Excel workbooks work with OneDrive only.', 400, 'msgraph_only');
    if (!isWorkbook(it)) throw new DriveError('That OneDrive file is not an Excel workbook.', 400, 'not_xlsx');
  } else {
    const isPdf = provider === 'google' ? it?.isPdf : (it?.file && /\.pdf$/i.test(String(it.name || '')));
    if (!isPdf) throw new DriveError(`That ${placeName(provider)} file is not a PDF.`, 400, 'not_pdf');
  }
  let downloadUrl = provider === 'google' ? it.downloadUrl : it['@microsoft.graph.downloadUrl'];
  if (!downloadUrl && provider !== 'google') {
    try {
      const link = await client.downloadLink(driveId, itemId);
      downloadUrl = link.url;
      note('download_link_fallback', { by: link.by });
    } catch (err) {
      note('download_link_missing', { status: Number(err?.answered || err?.status) || null, graphCode: err?.graphCode || null });
      if ([401, 403, 404, 410, 423, 429, 503].includes(Number(err?.status)) || err?.code === 'reconnect') throw graphProblem(err, { where: 'open', provider });
    }
  }
  if (!downloadUrl) throw new DriveError(`${companyName(provider)} did not give a download link for that file.`, 502, 'graph');
  const out = { provider, name: String(it.name), size: Number(it.size) || 0, eTag: it.eTag || null, cTag: it.cTag || null, webUrl: it.webUrl || null, downloadUrl, driveId, itemId };
  // Google's file address needs the sign-in; the token reaches only files the
  // person picked with Survey (drive.file) and ends within the hour.
  if (provider === 'google') out.accessToken = await client.accessToken();
  return out;
}

async function link(ctx) {
  await requireBeta(ctx);
  const documentId = ctx.body.documentId;
  await requireEditor(ctx, documentId);
  const { driveId, itemId, provider } = needIds(ctx.body);
  const client = await driveClientFor(ctx, ctx.user.id, provider);
  let it;
  try { it = await client.item(driveId, itemId); } catch (err) { throw graphProblem(err, { where: 'open', provider }); }
  // The eTag of the bytes the app downloaded: a change at the source between
  // the download and this call is the first conflict, not a silent overwrite.
  const eTag = String(ctx.body.eTag || it.eTag || '') || null;
  // The content tag of those bytes: the app's, or the drive's when the
  // download is still the drive's version (else unknown: eTag rules alone).
  const cTag = typeof ctx.body.cTag === 'string' && ctx.body.cTag
    ? ctx.body.cTag
    : (!ctx.body.eTag || ctx.body.eTag === it.eTag ? it.cTag || null : null);
  const now = new Date().toISOString();
  const row = {
    document_id: documentId,
    provider,
    drive_id: driveId,
    item_id: itemId,
    name: String(it.name || 'file.pdf').slice(0, 300),
    web_url: it.webUrl || null,
    etag: eTag,
    ctag: cTag,
    linked_by: ctx.user.id,
    sync_minutes: DEFAULT_SYNC_MINUTES,
    sync_off: false,
    last_error: null,
    updated_at: now,
  };
  const { error } = await ctx.service.from('document_drive_links').upsert(row, { onConflict: 'document_id' });
  if (error) throw new DriveError(`Could not save the ${placeName(provider)} link.`, 500, 'save');
  return { link: publicLink({ ...row, last_pushed_at: null, last_pushed_sha: null }) };
}

async function status(ctx) {
  const documentId = ctx.body.documentId;
  const role = await roleOf(ctx, documentId);
  if (!role) throw new DriveError('You do not have access to this document.', 403, 'no_access');
  const row = await linkRow(ctx, documentId);
  if (!row) return { link: null };
  const out = { link: publicLink(row), canPush: role === 'owner' || role === 'editor' };
  if (!ctx.body.check) return out;
  try {
    const client = await driveClientFor(ctx, row.linked_by, row.provider);
    const it = await client.item(row.drive_id, row.item_id);
    // A rename or move changes the eTag only; the cTag says if the PDF did.
    out.changedAtSource = row.ctag && it?.cTag
      ? it.cTag !== row.ctag
      : Boolean(row.etag && it?.eTag && it.eTag !== row.etag);
    out.source = { name: it?.name || row.name, modifiedAt: it?.lastModifiedDateTime || null, modifiedBy: it?.lastModifiedBy?.user?.displayName || null };
  } catch (err) {
    const problem = graphProblem(err, { where: 'status', provider: row.provider });
    out.problem = { code: problem.code, error: problem.message };
  }
  return out;
}

async function recordError(ctx, documentId, problem) {
  await ctx.service.from('document_drive_links')
    .update({ last_error: problem ? problem.code : null, updated_at: new Date().toISOString() })
    .eq('document_id', documentId);
}

async function push(ctx) {
  const documentId = ctx.body.documentId;
  await requireEditor(ctx, documentId);
  const row = await linkRow(ctx, documentId);
  if (!row) throw new DriveError('This document is not linked to a drive file.', 404, 'not_linked');
  if (row.sync_off && !ctx.body.force) throw new DriveError(`Saving back to ${placeName(row.provider)} is turned off for this document.`, 409, 'sync_off');
  const client = await driveClientFor(ctx, row.linked_by, row.provider);
  const origin = ORIGIN.test(String(ctx.body.appOrigin || '')) ? ctx.body.appOrigin : null;
  try {
    // force: the person chose "Keep Survey's version" in the conflict dialog.
    let session;
    try {
      session = await client.uploadSession(row.drive_id, row.item_id, { ifMatch: ctx.body.force ? null : row.etag, origin });
    } catch (err) {
      // 412 after a rename, a move or a SharePoint column edit: same PDF, new
      // eTag. Take the new eTag (and name) and go again, still with If-Match.
      if (Number(err?.status) !== 412 || !row.ctag) throw err;
      const it = await client.item(row.drive_id, row.item_id);
      if (!it?.eTag || it.cTag !== row.ctag) throw err;
      const fresh = { etag: it.eTag, name: String(it.name || row.name).slice(0, 300), web_url: it.webUrl || row.web_url, updated_at: new Date().toISOString() };
      await ctx.service.from('document_drive_links').update(fresh).eq('document_id', documentId);
      session = await client.uploadSession(row.drive_id, row.item_id, { ifMatch: it.eTag, origin });
    }
    if (!session?.uploadUrl) throw new DriveError(`${companyName(row.provider)} did not open an upload.`, 502, 'graph');
    return { provider: row.provider, uploadUrl: session.uploadUrl, expiresAt: session.expirationDateTime || null };
  } catch (err) {
    const problem = graphProblem(err, { provider: row.provider });
    await recordError(ctx, documentId, problem);
    throw problem;
  }
}

async function pushed(ctx) {
  const documentId = ctx.body.documentId;
  await requireEditor(ctx, documentId);
  const row = await linkRow(ctx, documentId);
  if (!row) throw new DriveError('This document is not linked to a drive file.', 404, 'not_linked');
  const client = await driveClientFor(ctx, row.linked_by, row.provider);
  let it;
  try { it = await client.item(row.drive_id, row.item_id); } catch (err) { throw graphProblem(err, { where: 'status', provider: row.provider }); }
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  // A late confirm (the app could not reach us right after its upload): if
  // the drive no longer holds Survey's write, someone changed the file since.
  // Keep the old eTag so the next push raises the conflict dialog instead of
  // overwriting their change. Google Drive: compare the content's SHA-256
  // with the hash of the bytes Survey sent (Drive's upload answer carries no
  // revision id). OneDrive: compare the eTag the upload answered with. With
  // neither to go on, assume a change: a needless question beats a lost edit.
  let changedSince = false;
  if (ctx.body.late) {
    const sentSha = typeof ctx.body.sha === 'string' ? ctx.body.sha.toLowerCase() : null;
    const uploadedEtag = typeof ctx.body.eTag === 'string' ? ctx.body.eTag : null;
    const uploadedCtag = typeof ctx.body.cTag === 'string' ? ctx.body.cTag : null;
    if (it?.sha256 && sentSha) changedSince = it.sha256 !== sentSha;
    else if (uploadedCtag && it?.cTag) changedSince = it.cTag !== uploadedCtag;
    else if (uploadedEtag && it?.eTag) changedSince = it.eTag !== uploadedEtag;
    else changedSince = true;
  }
  // When the push started, not when we heard: other screens compare this with
  // their own unsaved change, and a late confirm must not cover later edits.
  const startedMs = Date.parse(String(ctx.body.pushedAt || ''));
  const pushedAt = Number.isFinite(startedMs) && startedMs <= nowMs + 60_000 && startedMs >= nowMs - 7 * 86_400_000
    ? new Date(Math.min(startedMs, nowMs)).toISOString()
    : now;
  const patch = {
    etag: changedSince ? row.etag : (it?.eTag || row.etag),
    ctag: changedSince ? (row.ctag ?? null) : (it?.cTag || null),
    name: String(it?.name || row.name).slice(0, 300),
    web_url: it?.webUrl || row.web_url,
    last_pushed_at: pushedAt,
    last_pushed_sha: typeof ctx.body.sha === 'string' ? ctx.body.sha.slice(0, 128) : null,
    last_error: null,
    // A forced push ("Keep Survey's version") turns syncing back on.
    ...(ctx.body.force ? { sync_off: false } : {}),
    updated_at: now,
  };
  await ctx.service.from('document_drive_links').update(patch).eq('document_id', documentId);
  return { link: publicLink({ ...row, ...patch }) };
}

async function settings(ctx) {
  const documentId = ctx.body.documentId;
  await requireEditor(ctx, documentId);
  const row = await linkRow(ctx, documentId);
  if (!row) throw new DriveError('This document is not linked to a drive file.', 404, 'not_linked');
  const patch = { updated_at: new Date().toISOString() };
  if (Number.isInteger(ctx.body.syncMinutes)) patch.sync_minutes = Math.min(1440, Math.max(1, ctx.body.syncMinutes));
  if (typeof ctx.body.syncOff === 'boolean') patch.sync_off = ctx.body.syncOff;
  await ctx.service.from('document_drive_links').update(patch).eq('document_id', documentId);
  return { link: publicLink({ ...row, ...patch }) };
}

async function unlink(ctx) {
  const documentId = ctx.body.documentId;
  const role = await roleOf(ctx, documentId);
  const row = await linkRow(ctx, documentId);
  if (!row) return { link: null };
  if (role !== 'owner' && row.linked_by !== ctx.user.id) throw new DriveError('Only the person who linked the file, or the owner, can unlink it.', 403, 'not_linker');
  await ctx.service.from('document_drive_links').delete().eq('document_id', documentId);
  return { link: null };
}

// Files another suite app saves into the person's OneDrive (Walkthru's node
// list): a spreadsheet, a CSV or a PDF, never anything that runs.
const NEW_FILE_NAME = /^[^\\/:*?"<>|\u0000-\u001f]{1,180}\.(xlsx|csv|pdf)$/i;

/** An upload link for a new file in the person's own OneDrive or a shared place. */
async function create(ctx) {
  await requireBeta(ctx);
  if (providerOf(ctx.body.provider) === 'google') throw new DriveError('Saving new files works with OneDrive only.', 400, 'msgraph_only');
  const name = String(ctx.body.title || '').trim();
  if (!NEW_FILE_NAME.test(name) || /^\.|\.$/.test(name)) throw new DriveError('Give the file a plain name ending in .xlsx, .csv or .pdf.', 400, 'bad_name');
  const folder = String(ctx.body.folder || '');
  const client = await driveClientFor(ctx, ctx.user.id);
  let session;
  try { session = await client.newFileSession(folder, name); } catch (err) {
    if (noOwnDrive(err, folder)) throw new DriveError('Your Microsoft account has no OneDrive. Pick a SharePoint or Teams folder instead.', 409, 'no_onedrive');
    throw graphProblem(err, { where: 'push' });
  }
  if (!session?.uploadUrl) throw new DriveError('Microsoft did not open an upload.', 502, 'graph');
  return { provider: 'msgraph', uploadUrl: session.uploadUrl, expiresAt: session.expirationDateTime || null };
}

const isWorkbook = (it) => Boolean(it?.file) && !it?.folder && /\.xlsx$/i.test(String(it?.name || ''));

/**
 * An upload link that replaces a workbook another suite app made (Walkthru's
 * live node list). `eTag` is the version the app read: if someone saved the
 * workbook since, Microsoft refuses (conflict) and the app reads it again.
 */
async function replace(ctx) {
  await requireBeta(ctx);
  if (providerOf(ctx.body.provider) === 'google') throw new DriveError('Excel workbooks work with OneDrive only.', 400, 'msgraph_only');
  const { driveId, itemId } = needIds(ctx.body);
  const client = await driveClientFor(ctx, ctx.user.id);
  let session;
  try {
    const it = await client.item(driveId, itemId);
    if (!isWorkbook(it)) throw new DriveError('That OneDrive file is not an Excel workbook.', 400, 'not_xlsx');
    session = await client.uploadSession(driveId, itemId, { ifMatch: ctx.body.eTag || null });
  } catch (err) {
    throw graphProblem(err);
  }
  if (!session?.uploadUrl) throw new DriveError('Microsoft did not open an upload.', 502, 'graph');
  return { provider: 'msgraph', uploadUrl: session.uploadUrl, expiresAt: session.expirationDateTime || null };
}

/** One drive action; `ctx` is the sheet-sync function's (user, userDb, service, env, body). */
export async function driveAction(ctx) {
  switch (ctx.body.action) {
    case 'driveBrowse': return browse(ctx);
    case 'driveOpen': return open(ctx);
    case 'driveLink': return link(ctx);
    case 'driveStatus': return status(ctx);
    case 'drivePush': return push(ctx);
    case 'drivePushed': return pushed(ctx);
    case 'driveSettings': return settings(ctx);
    case 'driveUnlink': return unlink(ctx);
    case 'drivePickerToken': return pickerToken(ctx);
    case 'driveCreate': return create(ctx);
    case 'driveReplace': return replace(ctx);
    default: throw new DriveError('Unknown drive action.', 400, 'unknown_action');
  }
}
