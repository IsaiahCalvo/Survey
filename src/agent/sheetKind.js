// What kind of drawing a plan sheet is, from its own words: a floor plan, a
// schedule, a riser, a detail sheet, a legend or a cover. The Survey agent
// uses it to put a device where it sits (the floor plan) and not on the
// schedule row or riser box that names it too, for any customer's drawings:
// nothing here knows one customer's sheets. Plain rules, no guessing model:
// the sheet title (big text counts more) and whether the tags stand in table
// columns or lie scattered across a drawing.

export const SHEET_KINDS = Object.freeze(['floor plan', 'schedule', 'riser', 'detail', 'legend', 'cover']);
// Where a device goes when the project has no rule of its own.
export const DEFAULT_PLACEMENT = Object.freeze(['floor plan']);

const lower = (value) => String(value || '').toLowerCase();
const bare = (value) => lower(value).replace(/[^a-z0-9]/g, '');

// Words in a sheet title, each with the kind it points to and how strongly.
// Two-word phrases are read across neighbouring words.
const SINGLE = new Map([
  ['schedule', ['schedule', 3]], ['schedules', ['schedule', 3]], ['matrix', ['schedule', 2]],
  ['riser', ['riser', 3]], ['risers', ['riser', 3]], ['topology', ['riser', 2]], ['oneline', ['riser', 3]],
  ['details', ['detail', 3]], ['detail', ['detail', 2]], ['elevations', ['detail', 2]], ['elevation', ['detail', 1]], ['sections', ['detail', 2]],
  ['legend', ['legend', 3]], ['symbols', ['legend', 2]], ['abbreviations', ['legend', 2]],
  ['cover', ['cover', 1]],
  ['layout', ['floor plan', 1]],
]);
const PAIRS = new Map([
  ['floorplan', ['floor plan', 4]], ['siteplan', ['floor plan', 4]], ['ceilingplan', ['floor plan', 4]], ['roofplan', ['floor plan', 3]],
  ['levelplan', ['floor plan', 3]], ['partialplan', ['floor plan', 3]], ['enlargedplan', ['floor plan', 3]], ['overallplan', ['floor plan', 3]],
  ['devicelist', ['schedule', 3]], ['equipmentlist', ['schedule', 3]], ['cablelist', ['schedule', 3]], ['doorhardware', ['schedule', 2]],
  ['singleline', ['riser', 3]], ['oneline', ['riser', 3]], ['blockdiagram', ['riser', 3]], ['wiringdiagram', ['riser', 2]], ['systemdiagram', ['riser', 3]],
  ['mountingdetail', ['detail', 3]], ['typicaldetail', ['detail', 3]], ['installationdetail', ['detail', 3]],
  ['symbollegend', ['legend', 3]], ['generalnotes', ['legend', 1]],
  ['coversheet', ['cover', 3]], ['titlesheet', ['cover', 3]], ['drawingindex', ['cover', 3]], ['sheetindex', ['cover', 3]], ['drawinglist', ['cover', 2]],
]);
// "FIRST FLOOR PLAN", "LEVEL 3 PLAN", "4TH FLOOR": a plan word after a floor word.
const FLOOR_WORD = /^(floor|level|lvl|basement|cellar|mezzanine|ground|roof|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d{1,2}(st|nd|rd|th)?)$/;

// A tag: short, with a digit, and letters or a dash ("C-4-06", "CAM80", "D117A").
const isTag = (text) => {
  const t = String(text || '').trim();
  return t.length >= 2 && t.length <= 14 && /\d/.test(t) && /[a-z]/i.test(t) && !/^\d+(st|nd|rd|th|'|"|mm|in|ft)$/i.test(t);
};

const median = (values) => {
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 1;
};

// How far apart two left edges (or centres) may be and still be one column.
const COLUMN_SLACK = 2;
// A column needs this many tags stacked in it to be a table.
const COLUMN_MIN = 5;

const leftOf = (box) => box.x;
const middleOf = (box) => box.x + box.width / 2;

/**
 * The tags among words that stand in a table column: at least COLUMN_MIN
 * tags whose left edges (or centres) line up. Returns a Set of the words.
 */
export function tableTagWords(words) {
  const tags = (words || []).filter((w) => w?.box && isTag(w.text));
  const inTable = new Set();
  for (const edge of [leftOf, middleOf]) {
    const sorted = [...tags].sort((a, b) => edge(a.box) - edge(b.box));
    let start = 0;
    for (let i = 1; i <= sorted.length; i += 1) {
      if (i < sorted.length && edge(sorted[i].box) - edge(sorted[i - 1].box) <= COLUMN_SLACK) continue;
      const run = sorted.slice(start, i);
      // Stacked, not side by side on one line.
      if (run.length >= COLUMN_MIN && new Set(run.map((w) => Math.round(w.box.y))).size >= COLUMN_MIN) run.forEach((w) => inTable.add(w));
      start = i;
    }
  }
  return inTable;
}

/** 'table' when a found tag's box lies on a table tag (a schedule row), else 'drawing'. */
export function spotOf(box, tableWords) {
  if (!box || !tableWords?.size) return 'drawing';
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  for (const w of tableWords) {
    const b = w.box;
    if (cx >= b.x - 1 && cx <= b.x + b.width + 1 && cy >= b.y - 1 && cy <= b.y + b.height + 1) return 'table';
  }
  return 'drawing';
}

/**
 * The sheet's kind from its words ({ text, box } in page points): one of
 * SHEET_KINDS, or null when the words don't say clearly. Also how many tags
 * stand in table columns, for a floor plan that carries its own schedule.
 */
export function sheetKindOf(words) {
  const list = (words || []).filter((w) => String(w?.text || '').trim());
  if (!list.length) return { kind: null, tableTags: 0, tags: 0 };
  const mid = median(list.map((w) => Number(w.box?.height) || 0));
  const scores = new Map(SHEET_KINDS.map((k) => [k, 0]));
  const add = (kind, n) => scores.set(kind, scores.get(kind) + n);
  for (let i = 0; i < list.length; i += 1) {
    const h = Number(list[i].box?.height) || mid;
    // Title text is big: a word twice the usual size counts four times.
    const weight = Math.min(16, Math.max(1, (h / mid) ** 2));
    const a = bare(list[i].text);
    const b = bare(list[i + 1]?.text);
    const single = SINGLE.get(a);
    if (single) add(single[0], single[1] * weight);
    const pair = PAIRS.get(a + b);
    if (pair) add(pair[0], pair[1] * weight);
    if (b === 'plan' && FLOOR_WORD.test(a)) add('floor plan', 3 * weight);
  }
  const tags = list.filter((w) => isTag(w.text)).length;
  const tableTags = tableTagWords(list).size;
  // Tags in columns are a table; tags scattered over the sheet are a drawing.
  if (tags >= 8 && tableTags >= tags * 0.5) add('schedule', 6);
  else if (tags >= 5 && tableTags <= tags * 0.25) add('floor plan', 3);
  const ranked = [...scores.entries()].sort((x, y) => y[1] - x[1]);
  const [[best, top], [, next]] = ranked;
  const kind = top >= 3 && top >= next * 1.5 ? best : null;
  return { kind, tableTags, tags };
}

const sheetCache = new WeakMap();
/** sheetKindOf, once per words array (a page's words are read once per document). */
export function cachedSheetKind(words) {
  if (!words || typeof words !== 'object') return sheetKindOf(words);
  let hit = sheetCache.get(words);
  if (!hit) {
    hit = { ...sheetKindOf(words), table: tableTagWords(words) };
    sheetCache.set(words, hit);
  }
  return hit;
}

/**
 * The sheet kinds a project's placement rule names, from free words
 * ("floor plan, schedule and riser", "everywhere", "plans only"). Unknown
 * words are left out; an empty result means the words named no kind.
 */
export function placementFromWords(text) {
  const t = lower(text);
  if (/\b(every ?where|all (of them|sheets|drawings|pages))\b/.test(t)) return ['floor plan', 'schedule', 'riser'];
  const found = [];
  const has = (re, kind) => { if (re.test(t) && !found.includes(kind)) found.push(kind); };
  has(/\b(floor ?plans?|plans?|layouts?|drawings?)\b/, 'floor plan');
  has(/\bschedules?|device lists?|equipment lists?\b/, 'schedule');
  has(/\brisers?|one.?lines?|single.?lines?|diagrams?\b/, 'riser');
  has(/\bdetails?\b/, 'detail');
  has(/\blegends?\b/, 'legend');
  return SHEET_KINDS.filter((k) => found.includes(k));
}

/** A placement rule as said back: "the floor plan, schedule and riser". */
export function placementWords(kinds) {
  const list = (kinds || []).filter(Boolean);
  if (!list.length) return 'the floor plan';
  if (list.length === 1) return `the ${list[0]}`;
  return `the ${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}
