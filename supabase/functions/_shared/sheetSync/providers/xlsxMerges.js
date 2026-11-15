// The merged areas of some tabs, read from the .xlsx file itself. Microsoft
// Graph's Excel API has no merged-areas call (v1.0 and beta answer 400; real
// tenant 11-15), and a merged block reads like plain cells: every cell but the
// top-left one blank. Excel keeps only the top-left value when cells are
// merged, so without this a round took the blanked cells for the PM clearing
// them and wiped the field techs' values in the app (real Excel 11-15).
//
// Only the parts needed are unzipped: the workbook (tab names), its links
// (tab name -> part) and the asked tabs. No library, so it runs in Deno and
// Node alike (DecompressionStream for deflated parts).

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

const unescapeXml = (t) => String(t)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&');

const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? unescapeXml(m[1]) : null;
};

// name -> { method, size, at } from the zip's central directory.
function zipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65_535); i -= 1) {
    if (view.getUint32(i, true) === EOCD) { end = i; break; }
  }
  if (end < 0) throw new Error('not a zip file');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const entries = new Map();
  for (let n = 0; n < count && at + 46 <= bytes.length && view.getUint32(at, true) === CENTRAL; n += 1) {
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    entries.set(decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength)), { method, size, local });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return { view, entries };
}

async function readPart(bytes, zip, name) {
  const entry = zip.entries.get(name);
  if (!entry) return null;
  const { view } = zip;
  if (view.getUint32(entry.local, true) !== LOCAL) return null;
  const start = entry.local + 30 + view.getUint16(entry.local + 26, true) + view.getUint16(entry.local + 28, true);
  const raw = bytes.subarray(start, start + entry.size);
  if (entry.method === 0) return new TextDecoder().decode(raw);
  if (entry.method !== 8) return null;
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

const colIndex = (letters) => [...letters.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/** 'H6:H7' -> { r0: 5, r1: 7, c0: 7, c1: 8 } (end exclusive, 0-based); null for one cell. */
export function mergeArea(ref) {
  const m = /^\$?([A-Z]{1,3})\$?(\d+):\$?([A-Z]{1,3})\$?(\d+)$/i.exec(String(ref || '').trim());
  if (!m) return null;
  const area = { r0: Number(m[2]) - 1, r1: Number(m[4]), c0: colIndex(m[1]), c1: colIndex(m[3]) + 1 };
  if (area.r1 - area.r0 < 1 || area.c1 - area.c0 < 1 || (area.r1 - area.r0) * (area.c1 - area.c0) < 2) return null;
  return area;
}

const colName = (index) => { let n = index + 1; let out = ''; while (n > 0) { out = String.fromCharCode(65 + ((n - 1) % 26)) + out; n = Math.floor((n - 1) / 26); } return out; };

// Whether the cell holds anything in the sheet part (a value or inline text).
function cellFilled(xml, row, col) {
  const ref = `${colName(col)}${row + 1}`;
  const m = new RegExp(`<c r="${ref}"[^>]*?(?:/>|>([\\s\\S]*?)</c>)`).exec(xml);
  if (!m || !m[1]) return false;
  return /<v>[^<]+<\/v>|<is>[\s\S]*?<t[^>]*>[^<]+<\/t>/.test(m[1]);
}

/**
 * @param {Uint8Array} bytes the .xlsx file
 * @param {Array<{sheetId:string, title:string}>} sheets the tabs wanted, by name
 * @param {Array<{sheetId:string, row:number, col:number}>} [cells] cells to look at (0-based)
 * @returns {Promise<{merges: Record<string, Array<{r0:number,r1:number,c0:number,c1:number}>>, filled: string[]}>}
 *   merges by sheetId (tabs without any left out); `filled`: the asked cells
 *   that hold a value in the file, as "sheetId|row|col"
 */
export async function mergesFromXlsx(bytes, sheets, cells = []) {
  const zip = zipEntries(bytes);
  const book = await readPart(bytes, zip, 'xl/workbook.xml');
  const rels = await readPart(bytes, zip, 'xl/_rels/workbook.xml.rels');
  const out = { merges: {}, filled: [] };
  if (!book || !rels) return out;
  const targets = new Map();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id');
    const target = attr(m[0], 'Target');
    if (id && target) targets.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target}`);
  }
  const partOf = new Map();
  for (const m of book.matchAll(/<sheet\b[^>]*>/g)) {
    const name = attr(m[0], 'name');
    const rid = /\s[A-Za-z0-9_]+:id="([^"]*)"/.exec(m[0])?.[1];
    if (name != null && rid && targets.has(rid)) partOf.set(name, targets.get(rid));
  }
  for (const { sheetId, title } of sheets || []) {
    const part = partOf.get(String(title));
    if (!part) continue;
    const xml = await readPart(bytes, zip, part);
    if (!xml) continue;
    const areas = [...xml.matchAll(/<mergeCell\b[^>]*>/g)].map((m) => mergeArea(attr(m[0], 'ref'))).filter(Boolean);
    if (areas.length) out.merges[String(sheetId)] = areas;
    for (const c of cells || []) {
      if (String(c.sheetId) === String(sheetId) && cellFilled(xml, c.row, c.col)) out.filled.push(`${sheetId}|${c.row}|${c.col}`);
    }
  }
  return out;
}
