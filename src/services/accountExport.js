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
  return data;
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

/**
 * Build the zip. Files that fail to download are listed in errors.txt rather
 * than stopping the export.
 */
export async function buildAccountExportZip(manifest, { fetchImpl = fetch, onProgress } = {}) {
  const zip = new JSZip();
  zip.file('README.txt', README(manifest));
  zip.file('data.json', JSON.stringify({
    exported_at: manifest.exported_at,
    account: manifest.account,
    ...manifest.tables,
    files: manifest.files.map(({ bucket, path }) => ({ bucket, path })),
  }, null, 2));

  const planned = planExportPaths(manifest);
  const failures = [];
  for (const [index, file] of planned.entries()) {
    onProgress?.({ done: index, total: planned.length });
    try {
      if (!file.url) throw new Error('no download link');
      const res = await fetchImpl(file.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      zip.file(file.zipPath, new Uint8Array(await res.arrayBuffer()));
    } catch (err) {
      failures.push(`${file.bucket}/${file.path}: ${err?.message || err}`);
    }
  }
  onProgress?.({ done: planned.length, total: planned.length });
  if (failures.length) {
    zip.file('errors.txt', `These files could not be downloaded. Try the export again.\n\n${failures.join('\n')}\n`);
  }
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return { bytes, failures };
}

export function accountExportFileName(now = new Date()) {
  return `Survey data ${now.toISOString().slice(0, 10)}.zip`;
}

/** Account settings entry point. */
export async function downloadMyData({ functionsClient, onProgress, deliver = deliverGeneratedFile }) {
  const manifest = await requestAccountExport(functionsClient);
  const { bytes, failures } = await buildAccountExportZip(manifest, { onProgress });
  const result = await deliver({
    data: bytes,
    fileName: accountExportFileName(),
    mimeType: 'application/zip',
    title: 'Save your Survey data',
    filterName: 'ZIP archive',
    extensions: ['zip'],
  });
  return { ...result, fileCount: manifest.files.length, failures };
}
