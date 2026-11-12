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
// Graph answers 412 when the drive file changed since (a conflict), 404 when
// it was moved or deleted, 403 when the person can't write to it.
//
// Who may do what: browse / open with your own Microsoft sign-in; link, push,
// change settings: an editor or owner of the Survey document. Pushes use the
// sign-in of the person who linked the file, so a field tech with no
// Microsoft account still saves back. Unlink: the linker or the owner.
import { decryptToken, encryptToken } from '../sheetSync/tokenCrypto.js';
import { msgraphAuthConfigFromEnv, refreshMsgraphToken } from '../sheetSync/msgraphAuth.js';
import { folderTarget, placeToken, shareIdOf } from '../sheetSync/providers/msgraph.js';
import { fetchWithTimeout } from '../sheetSync/providers/contract.js';

export const DRIVE_SYNC_FLAG = 'drive-sync-back';
export const DRIVE_ACTIONS = Object.freeze([
  'driveBrowse', 'driveOpen', 'driveLink', 'driveStatus', 'drivePush', 'drivePushed', 'driveSettings', 'driveUnlink',
]);
export const DEFAULT_SYNC_MINUTES = 5;
const REQUEST_TIMEOUT_MS = 20_000;
const ID = /^[A-Za-z0-9!_.-]{1,200}$/;

export class DriveError extends Error {
  constructor(message, status = 400, code = 'drive') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const tokenKey = (env) => env.SHEET_SYNC_TOKEN_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
const msConfig = (env) => {
  const base = (env.SHEET_SYNC_PUBLIC_URL || `${String(env.SUPABASE_URL || '').replace(/\/$/, '')}/functions/v1/sheet-sync`).replace(/\/$/, '');
  return msgraphAuthConfigFromEnv((name) => env[name], { redirectUri: `${base}/oauth/msgraph/callback` });
};

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
  const SELECT = 'id,name,eTag,size,webUrl,file,folder,parentReference,lastModifiedDateTime,lastModifiedBy';
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
    async resolveLink(url) {
      return call('GET', `shares/${shareIdOf(url)}/driveItem?$select=${SELECT}`);
    },
    async item(driveId, itemId) {
      return call('GET', `${itemPath(driveId, itemId)}?$select=${SELECT},@microsoft.graph.downloadUrl`);
    },
    async uploadSession(driveId, itemId, { ifMatch = null } = {}) {
      return call('POST', `${itemPath(driveId, itemId)}/createUploadSession`, {
        headers: ifMatch ? { 'If-Match': ifMatch } : {},
        body: { item: { '@microsoft.graph.conflictBehavior': 'replace' } },
      });
    },
  };
}

/** A Graph client signed in as `userId` (their sheet-sync Microsoft connection). */
async function driveClientFor(ctx, userId) {
  if (ctx.driveClientFor) return ctx.driveClientFor(userId);
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
  throw new DriveError('OneDrive files that save back are in beta on Survey Nightly.', 403, 'beta');
}

async function roleOf(ctx, documentId) {
  if (!documentId) throw new DriveError('Say which document.', 400, 'missing_document');
  const { data, error } = await ctx.userDb.rpc('get_my_document_role', { doc_id: documentId });
  if (error) throw new DriveError('Could not check your access to this document.', 500, 'role');
  return data || null;
}

async function requireEditor(ctx, documentId) {
  const role = await roleOf(ctx, documentId);
  if (role !== 'owner' && role !== 'editor') throw new DriveError('Only editors of this document can save it back to OneDrive.', 403, 'not_editor');
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

function graphProblem(err, { where = 'push' } = {}) {
  if (err instanceof DriveError) return err;
  const status = Number(err?.status);
  if (err?.code === 'reconnect' || status === 401) return new DriveError('The Microsoft sign-in used for this file has ended. Connect Microsoft again.', 401, 'reconnect');
  if (status === 412) return new DriveError('Someone changed this file in OneDrive since Survey last saved it.', 409, 'conflict');
  if (status === 404 || status === 410) return new DriveError('The OneDrive file was moved or deleted.', 404, 'gone');
  if (status === 403) return new DriveError(where === 'push' ? 'You can open this OneDrive file but not change it.' : 'You do not have access to that OneDrive file.', 403, 'read_only');
  if (status === 423) return new DriveError('The file is open or checked out in OneDrive. Survey will try again.', 423, 'locked');
  if (status === 429 || status === 503) return new DriveError('Microsoft asked Survey to slow down. It will try again.', 429, 'busy');
  return new DriveError('Microsoft could not be reached. Survey will try again.', 502, 'graph');
}

async function browse(ctx) {
  await requireBeta(ctx);
  const client = await driveClientFor(ctx, ctx.user.id);
  try {
    let folder = String(ctx.body.folder || '');
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
    if (Number(err?.status) === 404) return { folder: String(ctx.body.folder || ''), folders: [], places: [], files: [] };
    throw graphProblem(err, { where: 'browse' });
  }
}

function needIds(body) {
  const driveId = String(body.driveId || '');
  const itemId = String(body.itemId || '');
  if (!ID.test(driveId) || !ID.test(itemId)) throw new DriveError('Say which OneDrive file.', 400, 'missing_file');
  return { driveId, itemId };
}

async function open(ctx) {
  await requireBeta(ctx);
  const { driveId, itemId } = needIds(ctx.body);
  const client = await driveClientFor(ctx, ctx.user.id);
  let it;
  try { it = await client.item(driveId, itemId); } catch (err) { throw graphProblem(err, { where: 'open' }); }
  if (!it?.file || !/\.pdf$/i.test(String(it.name || ''))) throw new DriveError('That OneDrive file is not a PDF.', 400, 'not_pdf');
  const downloadUrl = it['@microsoft.graph.downloadUrl'];
  if (!downloadUrl) throw new DriveError('Microsoft did not give a download link for that file.', 502, 'graph');
  return { name: String(it.name), size: Number(it.size) || 0, eTag: it.eTag || null, webUrl: it.webUrl || null, downloadUrl, driveId, itemId };
}

async function link(ctx) {
  await requireBeta(ctx);
  const documentId = ctx.body.documentId;
  await requireEditor(ctx, documentId);
  const { driveId, itemId } = needIds(ctx.body);
  const client = await driveClientFor(ctx, ctx.user.id);
  let it;
  try { it = await client.item(driveId, itemId); } catch (err) { throw graphProblem(err, { where: 'open' }); }
  // The eTag of the bytes the app downloaded: a change at the source between
  // the download and this call is the first conflict, not a silent overwrite.
  const eTag = String(ctx.body.eTag || it.eTag || '') || null;
  const now = new Date().toISOString();
  const row = {
    document_id: documentId,
    provider: 'msgraph',
    drive_id: driveId,
    item_id: itemId,
    name: String(it.name || 'file.pdf').slice(0, 300),
    web_url: it.webUrl || null,
    etag: eTag,
    linked_by: ctx.user.id,
    sync_minutes: DEFAULT_SYNC_MINUTES,
    sync_off: false,
    last_error: null,
    updated_at: now,
  };
  const { error } = await ctx.service.from('document_drive_links').upsert(row, { onConflict: 'document_id' });
  if (error) throw new DriveError('Could not save the OneDrive link.', 500, 'save');
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
    const client = await driveClientFor(ctx, row.linked_by);
    const it = await client.item(row.drive_id, row.item_id);
    out.changedAtSource = Boolean(row.etag && it?.eTag && it.eTag !== row.etag);
    out.source = { name: it?.name || row.name, modifiedAt: it?.lastModifiedDateTime || null, modifiedBy: it?.lastModifiedBy?.user?.displayName || null };
  } catch (err) {
    const problem = graphProblem(err, { where: 'status' });
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
  if (!row) throw new DriveError('This document is not linked to a OneDrive file.', 404, 'not_linked');
  if (row.sync_off && !ctx.body.force) throw new DriveError('Saving back to OneDrive is turned off for this document.', 409, 'sync_off');
  const client = await driveClientFor(ctx, row.linked_by);
  try {
    // force: the person chose "Keep Survey's version" in the conflict dialog.
    const session = await client.uploadSession(row.drive_id, row.item_id, { ifMatch: ctx.body.force ? null : row.etag });
    if (!session?.uploadUrl) throw new DriveError('Microsoft did not open an upload.', 502, 'graph');
    return { uploadUrl: session.uploadUrl, expiresAt: session.expirationDateTime || null };
  } catch (err) {
    const problem = graphProblem(err);
    await recordError(ctx, documentId, problem);
    throw problem;
  }
}

async function pushed(ctx) {
  const documentId = ctx.body.documentId;
  await requireEditor(ctx, documentId);
  const row = await linkRow(ctx, documentId);
  if (!row) throw new DriveError('This document is not linked to a OneDrive file.', 404, 'not_linked');
  const client = await driveClientFor(ctx, row.linked_by);
  let it;
  try { it = await client.item(row.drive_id, row.item_id); } catch (err) { throw graphProblem(err, { where: 'status' }); }
  const now = new Date().toISOString();
  const patch = {
    etag: it?.eTag || row.etag,
    name: String(it?.name || row.name).slice(0, 300),
    web_url: it?.webUrl || row.web_url,
    last_pushed_at: now,
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
  if (!row) throw new DriveError('This document is not linked to a OneDrive file.', 404, 'not_linked');
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
    default: throw new DriveError('Unknown drive action.', 400, 'unknown_action');
  }
}
