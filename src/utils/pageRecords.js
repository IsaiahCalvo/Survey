// Pages as records (Nightly flag 'page-records';
// /mnt/project-files/drawboard-trial/file-model/page-records-plan.md).
//
// Drawboard never rewrites the PDF when pages change: each page is a record
// and the PDF is built only when it leaves the app. With this flag Survey
// does the same. A move, delete, turn, duplicate, paste or blank page writes
// the page list into the shared document (meta key PAGE_RECORDS_META_KEY) in
// the same step as the marks' page remap. The stored PDF (the "base") never
// changes, so other windows follow live, nothing waits on an upload, and a
// page change made offline rides the device copy like any mark.
//
// A record is the page view entry of utils/pageViewDocument.js:
//   { src, rot, blank }  src: page number in the base PDF (null for a blank),
//                        rot: extra turn on top of that page's own rotation,
//                        blank: { width, height, paper? } for an added
//                        blank page; `paper` is its paper template id
//                        (Nightly 'page-templates'), drawn on screen and in
//                        the built PDF by utils/blankPagePaper.js.
// The list is only used over the bytes it was made for: `base.sha` must be
// the loaded file's content hash.

export const PAGE_RECORDS_FLAG = 'page-records';
export const PAGE_RECORDS_META_KEY = 'pageRecords';

const normRotation = (value) => ((Number(value) % 360) + 360) % 360;
// A paper template id; an unknown one is kept and simply draws no lines.
const paperId = (value) => (typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(value) ? value : null);

function normalizeRecord(record) {
  if (!record || typeof record !== 'object') return null;
  const rot = normRotation(record.rot || 0);
  if (rot % 90 !== 0) return null;
  if (record.blank) {
    const width = Number(record.blank.width);
    const height = Number(record.blank.height);
    if (!(width > 0) || !(height > 0)) return null;
    const paper = paperId(record.blank.paper);
    return { src: null, rot, blank: paper ? { width, height, paper } : { width, height } };
  }
  const src = Number(record.src);
  if (!Number.isInteger(src) || src < 1) return null;
  return { src, rot, blank: null };
}

/** The records a value holds, or null when it is not a usable list. */
export function normalizePageRecords(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.pages) || value.pages.length === 0) return null;
  const sha = typeof value.base?.sha === 'string' && value.base.sha ? value.base.sha : null;
  if (!sha) return null;
  const pages = [];
  for (const record of value.pages) {
    const next = normalizeRecord(record);
    if (!next) return null;
    pages.push(next);
  }
  return {
    writer: value.writer ? String(value.writer) : null,
    base: { sha, path: typeof value.base?.path === 'string' ? value.base.path : null },
    pages,
    at: Number.isFinite(Number(value.at)) && value.at != null ? Number(value.at) : null,
  };
}

export function pageRecordsValue({ writer, sha, path = null, pages, at = Date.now() }) {
  return {
    writer: String(writer),
    base: { sha: String(sha), path: path || null },
    pages: (pages || []).map((record) => normalizeRecord(record)).filter(Boolean),
    at,
  };
}

/** The content hash the records are kept against for this file, or null. */
export function pageRecordsBaseSha(file) {
  const sha = file?.contentSha256 || file?.content_sha256 || null;
  return typeof sha === 'string' && sha ? sha : null;
}

/** True when `value` is a list made for these bytes (`sha`) and fits a PDF of `baseCount` pages. */
export function pageRecordsFitBase(value, sha, baseCount = Infinity) {
  const records = normalizePageRecords(value);
  if (!records || !sha || records.base.sha !== sha) return false;
  return records.pages.every((record) => record.blank || record.src <= baseCount);
}

/** True when the list shows the base PDF exactly as stored (n pages, in order, unturned). */
export function isIdentityPageRecords(pages, baseCount) {
  if (!Array.isArray(pages) || pages.length !== baseCount) return false;
  return pages.every((record, index) => !record.blank && record.src === index + 1 && !normRotation(record.rot || 0));
}

/**
 * The page operations (utils/pdfPageMutation.js) that turn the base PDF of
 * `baseCount` pages into `pages`: run them with mutatePdfPagesBatch on the
 * base bytes to build the PDF that leaves the app (download, export, print).
 * Pages that stay keep their own page object (links, form fields and
 * bookmarks into them still work); a page shown twice and an added blank
 * page are 'restore' steps, which copy from `baseBytes` (the caller adds it
 * when `needsBaseBytes`).
 */
export function pageRecordsToOperations(pages, baseCount) {
  const target = (pages || []).map(normalizeRecord);
  if (target.length === 0 || target.some((record) => !record)) throw new Error('The page list is not valid.');
  const count = Number(baseCount);
  if (!Number.isInteger(count) || count < 1) throw new Error('The base PDF has no pages.');
  if (target.some((record) => !record.blank && record.src > count)) throw new Error('The page list names a page the PDF does not have.');
  const operations = [];
  const current = Array.from({ length: count }, (_, index) => ({ src: index + 1, rot: 0, blank: null }));
  // 1. Pages the list no longer shows go first (last to first), keeping one
  // page so the PDF is never empty; it is trimmed at the end.
  const used = new Set(target.filter((record) => !record.blank).map((record) => record.src));
  for (let index = current.length - 1; index >= 0; index -= 1) {
    if (used.has(current[index].src) || current.length === 1) continue;
    operations.push({ type: 'delete', page: index + 1 });
    current.splice(index, 1);
  }
  // 2. Each slot in order: move the page there (or add a copy / a blank),
  // then turn it to the list's turn.
  const placed = new Set();
  target.forEach((record, index) => {
    if (record.blank) {
      operations.push({ type: 'restore', afterPage: index, entry: { src: null, rot: record.rot, blank: { ...record.blank } } });
      current.splice(index, 0, { src: null, rot: record.rot, blank: record.blank });
      return;
    }
    let from = -1;
    if (!placed.has(record.src)) {
      for (let j = index; j < current.length; j += 1) {
        if (!current[j].blank && current[j].src === record.src && !current[j].placed) { from = j; break; }
      }
    }
    if (from < 0) {
      operations.push({ type: 'restore', afterPage: index, entry: { src: record.src, rot: record.rot, blank: null } });
      current.splice(index, 0, { src: record.src, rot: record.rot, blank: null, placed: true });
      return;
    }
    if (from !== index) {
      operations.push({ type: 'move', from: from + 1, to: index + 1 });
      const [moved] = current.splice(from, 1);
      current.splice(index, 0, moved);
    }
    current[index].placed = true;
    placed.add(record.src);
    const delta = normRotation(record.rot - current[index].rot);
    if (delta) {
      operations.push({ type: 'rotate', page: index + 1, delta });
      current[index].rot = record.rot;
    }
  });
  // 3. Anything left after the list (the page kept so the PDF was never empty).
  for (let index = current.length - 1; index >= target.length; index -= 1) {
    operations.push({ type: 'delete', page: index + 1 });
  }
  return {
    operations,
    needsBaseBytes: operations.some((operation) => operation.type === 'restore' && !operation.entry.blank),
  };
}
