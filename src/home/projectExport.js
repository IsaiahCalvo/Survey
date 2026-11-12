// Export project (Nightly flag 'project-export'; Drawboard Projects parity
// EX-10 / EX-12 / EX-17). Drawboard's "Export Project" emails a zip of the
// whole project: every drawing with its marks (each revision when asked),
// the comments as CSV, the issues as CSV. Survey builds the same zip on the
// device and downloads it straight away, as its other exports do.
//
// Zip layout (plain folder names, not Drawboard's dwg/ doc/ timelines/):
//   Drawings/   files with a sheet number: "A-101 - Ground floor - B.pdf"
//   Documents/  every other file
//   Comments/   "<file> comments.csv", one per file that has comments
//   Issues/     the Issues and Tasks registers (projectItems.js's CSV)
// Pure: no React, no Supabase, no pdf-lib, so node tests import it.

import { sheetInfo } from '../sheets/sheetRegister.js';

export const EXPORT_FOLDERS = Object.freeze({
  drawings: 'Drawings',
  documents: 'Documents',
  comments: 'Comments',
  issues: 'Issues',
});

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const squash = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]/g, '');

/** A name Windows, macOS and zip readers all accept ("/" would make a folder). */
export function safeZipName(value, fallback = 'File') {
  const cleaned = clean(String(value ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' '));
  return cleaned.slice(0, 120).trim() || fallback;
}

const stripPdf = (name) => String(name || '').replace(/\.pdf$/i, '').trim();

/**
 * "Number - Name - Revision" (Drawboard's export name pattern). The number is
 * left out when the name already starts with it, the revision when there is
 * none. An older copy with no revision of its own gets "v2" etc.
 */
export function exportFileBase(doc, { versionNumber = null, isCurrent = true } = {}) {
  const info = sheetInfo(doc);
  const name = stripPdf(doc?.name) || 'Untitled';
  const parts = [];
  if (info.number && !squash(name).startsWith(squash(info.number))) parts.push(info.number);
  parts.push(name);
  if (info.revision) parts.push(info.revision);
  else if (!isCurrent && versionNumber) parts.push(`v${versionNumber}`);
  return safeZipName(parts.join(' - '), 'Untitled');
}

/** A path not used yet: "x.pdf", then "x (2).pdf", "x (3).pdf". */
export function uniqueZipPath(taken, path) {
  if (!taken.has(path)) {
    taken.add(path);
    return path;
  }
  const dot = path.lastIndexOf('.');
  const slash = path.lastIndexOf('/');
  const [stem, ext] = dot > slash ? [path.slice(0, dot), path.slice(dot)] : [path, ''];
  for (let n = 2; ; n += 1) {
    const next = `${stem} (${n})${ext}`;
    if (!taken.has(next)) {
      taken.add(next);
      return next;
    }
  }
}

/**
 * What goes in the zip, in order: one entry per file (and per older copy when
 * `allRevisions`), then one comments CSV per file. Files with no stored copy
 * (on this device only) are skipped and listed in `skipped`.
 *
 * documents: the project's current files (documents rows).
 * versions: { [currentId]: [{ id, name, file_path, sheet_number,
 *   sheet_revision, versionNumber, isCurrent }] } (older copies; the current
 *   one may be in the list too and is ignored).
 * -> { files: [{ documentId, filePath, path, isCurrent, doc }], skipped: [name] }
 */
export function projectExportPlan({ documents = [], versions = {}, allRevisions = false } = {}) {
  const taken = new Set();
  const files = [];
  const skipped = [];
  const add = (doc, opts) => {
    if (!doc?.file_path) { skipped.push(stripPdf(doc?.name) || 'Untitled'); return; }
    const folder = sheetInfo(doc).number ? EXPORT_FOLDERS.drawings : EXPORT_FOLDERS.documents;
    const path = uniqueZipPath(taken, `${folder}/${exportFileBase(doc, opts)}.pdf`);
    files.push({ documentId: doc.id, filePath: doc.file_path, path, isCurrent: opts.isCurrent, doc });
  };
  const sorted = [...(documents || [])].filter(Boolean).sort((a, b) => {
    const an = sheetInfo(a).number;
    const bn = sheetInfo(b).number;
    if (an && !bn) return -1;
    if (bn && !an) return 1;
    return (an || stripPdf(a.name)).localeCompare(bn || stripPdf(b.name), undefined, { numeric: true, sensitivity: 'base' });
  });
  for (const doc of sorted) {
    add(doc, { isCurrent: true });
    if (!allRevisions) continue;
    const older = (versions?.[doc.id] || [])
      .filter((v) => v && v.id !== doc.id && !v.isCurrent)
      .sort((a, b) => (Number(b.versionNumber) || 0) - (Number(a.versionNumber) || 0));
    for (const version of older) add(version, { isCurrent: false, versionNumber: version.versionNumber });
  }
  return { files, skipped };
}

/** "Comments/<file> comments.csv" beside a file's zip path. */
export function commentsPathFor(taken, filePath) {
  const base = filePath.slice(filePath.indexOf('/') + 1).replace(/\.pdf$/i, '');
  return uniqueZipPath(taken, `${EXPORT_FOLDERS.comments}/${base} comments.csv`);
}

/** "<project> (5 items).zip": Drawboard names its zip "(5-items)". */
export function projectZipName(projectName, count) {
  const n = Math.max(0, Number(count) || 0);
  return `${safeZipName(projectName, 'Project')} (${n} ${n === 1 ? 'item' : 'items'}).zip`;
}

/** The short line under the progress bar. */
export function exportProgressText({ done = 0, total = 0, phase = 'files' } = {}) {
  if (phase === 'zip') return 'Packing the zip…';
  if (phase === 'lists') return 'Adding comments and issues…';
  return total ? `Adding file ${Math.min(done + 1, total)} of ${total}…` : 'Getting ready…';
}
