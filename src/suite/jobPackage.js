// A Kal Voe job file (.kvjob) -> a Survey Project (KAL-617, Nightly 'suite').
//
// The job file is the suite's offline hand-off (spec KAL-584, format on
// KAL-558): a zip holding
//   package.json   format "kalvoe.job", version 1: job, pages[], items[],
//                  annotations[], media[], plot { schedules, riser }
//   pages/*.pdf    the drawings
//   media/*        photos, audio, video
//   library.json   the Categories and Category Types the items use
//
// Plot writes one before it joins the shared database; any app may. Survey
// reads it into the same shape a Walkthru walk has (walkthruHandoffRun.js),
// so the Template and Module pick, the side-by-side Category screen and the
// arrival rule are the same code for both:
//   - each item with a Category becomes a node with that Category;
//   - an item or annotation with no Category stays out, counted;
//   - each Category is keyed by its library id, else by its exact name.
//
// Spots: `position` is a 0-1 fraction of the page, top-left origin, the same
// as Walkthru's x_pct / y_pct (the page as drawn, before any page rotation).
// Survey turns it into page points with the same rule (pageToPoint).
//
// Pure apart from jszip, so the Node tests run it as it is.

import JSZip from 'jszip';

export const JOB_FORMAT = 'kalvoe.job';
export const JOB_VERSION = 1;

const clean = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);
const list = (value) => (Array.isArray(value) ? value : []);
const fraction = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

function parseJson(text, what) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`This job file's ${what} can't be read.`);
  }
}

/**
 * Open a job file. Accepts a File, Blob, ArrayBuffer or Uint8Array.
 * @returns {Promise<{manifest:object, library:Array<object>, zip:JSZip}>}
 */
export async function openJobFile(input) {
  let zip;
  try {
    zip = await JSZip.loadAsync(input);
  } catch {
    throw new Error('This is not a job file. Pick a .kvjob file made by Plot, Walkthru or Survey.');
  }
  const manifestFile = zip.file('package.json');
  if (!manifestFile) throw new Error('This is not a job file: it has no package.json.');
  const manifest = parseJson(await manifestFile.async('string'), 'package.json');
  if (manifest?.format !== JOB_FORMAT) throw new Error('This is not a Kal Voe job file.');
  if (Number(manifest.version) > JOB_VERSION) {
    throw new Error('This job file was made by a newer app. Update Survey, then open it again.');
  }
  const libraryFile = zip.file('library.json');
  const libraryJson = libraryFile ? parseJson(await libraryFile.async('string'), 'library.json') : [];
  const library = list(Array.isArray(libraryJson) ? libraryJson : libraryJson?.entries);
  return { manifest, library, zip };
}

/** The key a job Category travels under: its library id, else its exact name. */
export function jobCategoryKey(item) {
  const entryId = clean(item?.library?.categoryEntryId);
  if (entryId) return `entry:${entryId}`;
  const name = clean(item?.library?.categoryName);
  return name ? `name:${name}` : null;
}

function appName(app) {
  const known = { plot: 'Plot', walkthru: 'Walkthru', survey: 'Survey' };
  return known[String(app || '').toLowerCase()] || clean(app) || null;
}

/**
 * The job as a walk (the shape sendWalkToProject takes), plus what it left
 * out. Each PDF file is one "floor"; an item finds its file through its page.
 *
 * @returns {{
 *   walk: {id:string|null, name:string},
 *   nodeTypes: Array<{id:string,name:string,library_entry_id:string|null}>,
 *   floors: Array<{id:string,name:string,asset:{storage_path:string,format:string}|null,nodes:Array<object>}>,
 *   source: string|null,
 *   extras: {media:number, schedules:number, riser:boolean, noPage:number}
 * }}
 */
export function jobToWalk(manifest, library = []) {
  const job = manifest?.job || {};
  const entries = new Map(list(library).filter((e) => clean(e?.entryId)).map((e) => [clean(e.entryId), e]));
  const pages = list(manifest?.pages).filter((p) => clean(p?.pageId));
  const pageById = new Map(pages.map((p) => [clean(p.pageId), p]));

  const floors = [];
  const floorByFile = new Map();
  const floorFor = (page) => {
    const file = clean(page.file) || `pages/${clean(page.pageId)}.pdf`;
    let floor = floorByFile.get(file);
    if (!floor) {
      floor = {
        id: file,
        name: clean(page.title) || clean(page.floor) || file.replace(/^.*\//, '').replace(/\.pdf$/i, ''),
        asset: /\.pdf$/i.test(file) ? { storage_path: file, format: 'pdf' } : { storage_path: file, format: 'image' },
        nodes: [],
      };
      floorByFile.set(file, floor);
      floors.push(floor);
    }
    return floor;
  };
  // Every page gets its floor, in the file's order, even with nothing on it.
  for (const page of pages) floorFor(page);

  const nodeTypes = new Map();
  let noPage = 0;
  const addNode = (raw, { tracked }) => {
    const page = pageById.get(clean(raw?.pageId));
    if (!page) { noPage += 1; return; }
    const key = tracked ? jobCategoryKey(raw) : null;
    if (key && !nodeTypes.has(key)) {
      const entryId = clean(raw.library?.categoryEntryId);
      nodeTypes.set(key, {
        id: key,
        name: clean(entries.get(entryId)?.name) || clean(raw.library?.categoryName) || '',
        library_entry_id: entryId,
      });
    }
    const suiteId = tracked ? clean(raw.suiteId) : null;
    floorFor(page).nodes.push({
      id: clean(raw.source?.nativeId) || suiteId || null,
      page_index: Number.isInteger(page.pageIndex) ? page.pageIndex : 0,
      x_pct: fraction(raw.position?.x),
      y_pct: fraction(raw.position?.y),
      node_type_id: key,
      library_type_entry_id: tracked ? clean(raw.library?.typeEntryId) : null,
      library_type_name: tracked ? clean(raw.library?.typeName) : null,
      title: tracked ? clean(raw.tag) : null,
      suite_device_id: suiteId,
      // The item's own place wins; the page gives the rest.
      building: clean(raw.building) || clean(page.building),
      wing: clean(raw.wing) || clean(page.wing),
      floor_label: clean(raw.floor) || clean(page.floor),
      location: clean(raw.location),
    });
  };
  for (const item of list(manifest?.items)) addNode(item, { tracked: true });
  // Default nodes and Blocks with no Category: counted, never sent.
  for (const mark of list(manifest?.annotations)) addNode(mark, { tracked: false });

  const schedules = list(manifest?.plot?.schedules).length;
  return {
    walk: { id: clean(job.suiteJobId), name: clean(job.name) || 'Job file' },
    nodeTypes: [...nodeTypes.values()],
    floors,
    source: appName(manifest?.sourceApp || job.source),
    extras: {
      media: list(manifest?.media).length,
      schedules,
      riser: Boolean(manifest?.plot?.riser),
      noPage,
    },
  };
}

/** download(path) for sendWalkToProject, reading from the job file. */
export function jobFileDownload(zip) {
  return async (path) => {
    const file = zip.file(path);
    if (!file) return { data: null, error: { message: `${path} is missing from the job file` } };
    const bytes = await file.async('uint8array');
    const data = typeof Blob === 'function' ? new Blob([bytes], { type: 'application/pdf' }) : bytes;
    return { data, error: null };
  };
}

/** What the job file held that Survey doesn't bring in yet, as one line. */
export function jobLeftOut(extras) {
  if (!extras) return '';
  const parts = [];
  if (extras.media) parts.push(`${extras.media} ${extras.media === 1 ? 'media file' : 'media files'}`);
  if (extras.schedules) parts.push(extras.schedules === 1 ? 'the Schedule' : `${extras.schedules} Schedules`);
  if (extras.riser) parts.push('the Riser');
  if (extras.noPage) parts.push(`${extras.noPage} ${extras.noPage === 1 ? 'item' : 'items'} with no page`);
  return parts.join(', ');
}
