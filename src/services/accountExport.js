// "Download my data" (Account settings): the export-account function returns
// every row the person owns plus one-hour links to their stored files; this
// zips both on the device, so file bytes never pass through the function.
import JSZip from 'jszip';
import { deliverGeneratedFile } from '../utils/xfdfExport/deliverFile.js';

export const ACCOUNT_EXPORT_ERROR_TEXT = {
  401: 'You were signed out. Sign in again, then download your data.',
  403: "Your data can't be downloaded from a connected agent. Sign in yourself to download it.",
  500: "Your data couldn't be gathered. Try again in a minute.",
};
export const ACCOUNT_EXPORT_NETWORK_ERROR_TEXT = "We couldn't reach the server. Check your connection and try again.";

// The function signs links with the host it sees Supabase at, which on a
// local stack is the internal one; the app fetches them from its own.
export function rebaseStorageLink(url, base) {
  if (!url || !base) return url;
  try {
    const link = new URL(url);
    return new URL(`${link.pathname}${link.search}`, base).href;
  } catch {
    return url;
  }
}

export async function requestAccountExport(functionsClient) {
  const { data, error } = await functionsClient.invoke('export-account', { body: {} });
  if (error) {
    const status = error?.context?.status;
    if (typeof status === 'number') {
      const mapped = new Error(ACCOUNT_EXPORT_ERROR_TEXT[status] || ACCOUNT_EXPORT_ERROR_TEXT[500]);
      mapped.status = status;
      throw mapped;
    }
    console.warn('[accountExport] request failed', error);
    throw new Error(ACCOUNT_EXPORT_NETWORK_ERROR_TEXT);
  }
  if (!data || data.format !== 1 || !Array.isArray(data.files)) throw new Error(ACCOUNT_EXPORT_ERROR_TEXT[500]);
  const base = String(functionsClient.url || '').replace(/\/functions\/v1\/?$/, '');
  return { ...data, files: data.files.map((file) => ({ ...file, url: rebaseStorageLink(file.url, base) })) };
}

// Windows and macOS refuse some characters in file names; zips keep "/" as a folder.
const safeName = (value, fallback) => {
  const cleaned = String(value || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  return cleaned.slice(0, 120) || fallback;
};

function uniquePath(taken, path) {
  if (!taken.has(path)) {
    taken.add(path);
    return path;
  }
  const dot = path.lastIndexOf('.');
  const [stem, ext] = dot > path.lastIndexOf('/') ? [path.slice(0, dot), path.slice(dot)] : [path, ''];
  for (let n = 2; ; n += 1) {
    const candidate = `${stem} (${n})${ext}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}

/** Where each stored file goes in the zip: PDFs by project and name, media by document. */
export function planExportPaths(manifest) {
  const documents = manifest.tables?.documents || [];
  const projects = new Map((manifest.tables?.projects || []).map((p) => [p.id, p]));
  const docByPath = new Map(documents.filter((d) => d.file_path).map((d) => [d.file_path, d]));
  const docById = new Map(documents.map((d) => [String(d.id), d]));
  const taken = new Set();

  return manifest.files.map((file) => {
    const doc = file.bucket === 'documents' ? docByPath.get(file.path) : null;
    if (doc) {
      const folder = projects.get(doc.project_id)?.name;
      const name = safeName(doc.name, doc.id).replace(/(\.pdf)?$/i, '.pdf');
      const where = folder ? `Documents/${safeName(folder, 'Project')}/${name}` : `Documents/${name}`;
      return { ...file, zipPath: uniquePath(taken, where) };
    }
    if (file.bucket === 'survey-media') {
      const [docId, marker, leaf] = file.path.split('/');
      const docName = safeName(docById.get(docId)?.name?.replace(/\.pdf$/i, ''), docId);
      return { ...file, zipPath: uniquePath(taken, `Survey media/${docName}/${safeName(marker, 'marker')}/${safeName(leaf, 'file')}`) };
    }
    return { ...file, zipPath: uniquePath(taken, `Other files/${file.bucket}/${file.path}`) };
  });
}

const README = (manifest) => `Your Survey data, exported ${manifest.exported_at}.

data.json      Every record of yours: account, plan, projects, templates,
               documents, markups (document_annotations), spaces, survey
               sessions and items, sharing, connected services, agents and
               usage. Sign-in tokens are left out.
Documents/     Your PDFs, in folders by project.
Survey media/  Photos, video and audio from survey markers, by document.
Other files/   Anything else stored for your account.
`;

// Each zip is built in memory before it is saved, so big accounts are split
// into parts a phone can hold (the native download shim reads a whole file).
export const EXPORT_PART_BYTES = 250 * 1024 * 1024;

const newZip = () => new JSZip();
const finish = (zip) => zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });

/**
 * Build the export as one or more zips, handing each to `onPart(bytes, index)`
 * as soon as it is full. Part 1 holds README.txt and data.json; files that
 * fail to download are listed in errors.txt in the last part rather than
 * stopping the export.
 */
export async function buildAccountExportZips(manifest, {
  fetchImpl = fetch, onProgress, onPart, partBytes = EXPORT_PART_BYTES,
} = {}) {
  let zip = newZip();
  zip.file('README.txt', README(manifest));
  zip.file('data.json', JSON.stringify({
    exported_at: manifest.exported_at,
    account: manifest.account,
    ...manifest.tables,
    files: manifest.files.map(({ bucket, path }) => ({ bucket, path })),
  }, null, 2));
  let held = 0;
  let parts = 0;

  const planned = planExportPaths(manifest);
  const failures = [];
  for (const [index, file] of planned.entries()) {
    onProgress?.({ done: index, total: planned.length });
    try {
      if (!file.url) throw new Error('no download link');
      const res = await fetchImpl(file.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (held > 0 && held + bytes.length > partBytes) {
        await onPart(await finish(zip), parts);
        parts += 1;
        zip = newZip();
        held = 0;
      }
      zip.file(file.zipPath, bytes);
      held += bytes.length;
    } catch (err) {
      failures.push(`${file.bucket}/${file.path}: ${err?.message || err}`);
    }
  }
  onProgress?.({ done: planned.length, total: planned.length });
  if (failures.length) {
    zip.file('errors.txt', `These files could not be downloaded. Try the export again.\n\n${failures.join('\n')}\n`);
  }
  await onPart(await finish(zip), parts);
  return { parts: parts + 1, failures };
}

/** The whole export as one zip (tests, small accounts). */
export async function buildAccountExportZip(manifest, options = {}) {
  const parts = [];
  const result = await buildAccountExportZips(manifest, {
    ...options, partBytes: Infinity, onPart: (bytes) => { parts.push(bytes); },
  });
  return { bytes: parts[0], failures: result.failures };
}

export function accountExportFileName(now = new Date(), part = 0) {
  const day = now.toISOString().slice(0, 10);
  return part ? `Survey data ${day} part ${part + 1}.zip` : `Survey data ${day}.zip`;
}

/** Account settings entry point. */
export async function downloadMyData({ functionsClient, onProgress, deliver = deliverGeneratedFile }) {
  const manifest = await requestAccountExport(functionsClient);
  const now = new Date();
  let result = { canceled: false };
  const { parts, failures } = await buildAccountExportZips(manifest, {
    onProgress,
    onPart: async (bytes, index) => {
      if (result.canceled) return;
      result = await deliver({
        data: bytes,
        fileName: accountExportFileName(now, index),
        mimeType: 'application/zip',
        title: 'Save your Survey data',
        filterName: 'ZIP archive',
        extensions: ['zip'],
      });
    },
  });
  return { ...result, parts, fileCount: manifest.files.length, failures };
}
