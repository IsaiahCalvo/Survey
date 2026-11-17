// "Open in Survey" from OneDrive and SharePoint on the web (KAL-703, Nightly
// flag onedrive-file-handler).
//
// Survey's Microsoft app has a file handler for .pdf (docs/microsoft-file-
// handler.md). When someone picks "Open in Survey" on a PDF in OneDrive or
// SharePoint, Microsoft opens a new tab that POSTs here with a form field
// `items`: a JSON list of Graph addresses of the picked files, such as
//   https://graph.microsoft.com/v1.0/drives/{drive-id}/items/{item-id}
// The app is static pages, which can't take a POST, so this turns the first
// file into a plain address the app opens, the same way "Open from
// OneDrive" opens a picked file (linked, so marks save back to it).
//
// Nothing secret passes through here: the drive and item ids are only
// addresses; the app opens the file with the person's own Microsoft sign-in.

const GRAPH_HOSTS = new Set(['graph.microsoft.com', 'graph.microsoft.us', 'dod-graph.microsoft.us', 'microsoftgraph.chinacloudapi.cn']);
const ID = /^[A-Za-z0-9!._-]{1,200}$/;

/** The first file's drive and item ids from what Microsoft sent, or null. */
export function fileFromHandlerItems(items) {
  let list = items;
  if (typeof list === 'string') {
    try { list = JSON.parse(list); } catch { list = [list]; }
  }
  if (!Array.isArray(list)) list = [list];
  for (const entry of list) {
    const raw = typeof entry === 'string' ? entry : entry?.url || entry?.id || null;
    if (typeof raw !== 'string') continue;
    let url;
    try { url = new URL(raw); } catch { continue; }
    if (url.protocol !== 'https:' || !GRAPH_HOSTS.has(url.hostname.toLowerCase())) continue;
    const match = url.pathname.match(/\/drives\/([^/]+)\/items\/([^/]+)\/?$/);
    if (!match) continue;
    const driveId = decodeURIComponent(match[1]);
    const itemId = decodeURIComponent(match[2]);
    if (ID.test(driveId) && ID.test(itemId)) return { driveId, itemId };
  }
  return null;
}

function readItems(request) {
  const body = request.body;
  if (body && typeof body === 'object' && !Buffer.isBuffer?.(body)) return body.items ?? null;
  if (typeof body === 'string') {
    try { return JSON.parse(body).items ?? null; } catch { /* a form body */ }
    return new URLSearchParams(body).get('items');
  }
  try {
    return new URL(request.url || '/', 'https://surveytool.app').searchParams.get('items');
  } catch {
    return null;
  }
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Referrer-Policy', 'no-referrer');
  if (request.method !== 'POST' && request.method !== 'GET') {
    return response.status(405).json({ error: 'method_not_allowed' });
  }
  const file = fileFromHandlerItems(readItems(request));
  const to = file
    ? `/?open-onedrive=${encodeURIComponent(file.driveId)}&item=${encodeURIComponent(file.itemId)}`
    : '/?open-onedrive-error=1';
  // 303: the browser follows with a GET, as a new page.
  response.setHeader('Location', to);
  return response.status(303).end();
}
