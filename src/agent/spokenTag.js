// Finding a device from how a person on site says it: "camera 6 on the 4th
// floor" means a tag like C-4-06, 4W-CAM-06 or CAM-406, or an item named
// "Camera 6" on a fourth floor sheet. The person never says the whole tag
// or the wing; the floor can be in the tag or only in the sheet's title.
// Plain functions, so tests and the Survey agent's find_described share them.

const NUMBER_WORDS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
};
const ORDINAL_WORDS = {
  ground: 1, first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8,
  ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15,
  sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20,
};
const WINGS = { west: 'w', east: 'e', north: 'n', south: 's' };

// Kinds of device and the letters their tags start with. A kind not listed
// still works through its own word and first letter ("speaker 3" finds
// S-3 and SPK-3 only through "s"; listed kinds know their usual codes).
const KIND_CODES = {
  camera: ['c', 'cam', 'cams', 'cctv', 'cm', 'vc', 'ipc'],
  door: ['d', 'dr', 'door'],
  reader: ['cr', 'rdr', 'r', 'reader'],
  speaker: ['s', 'spk', 'sp', 'speaker'],
  'access point': ['ap', 'wap'],
  'data drop': ['dd', 'dt', 'data'],
  intercom: ['ic', 'int', 'icm'],
  panel: ['p', 'pnl', 'cp'],
  sensor: ['ms', 'sen', 'pir'],
  strobe: ['st', 'hs', 'h'],
  outlet: ['rec', 'r', 'o'],
};
const KIND_ALIASES = {
  cam: 'camera', cams: 'camera', cameras: 'camera', cctv: 'camera',
  doors: 'door', readers: 'reader', 'card reader': 'reader', speakers: 'speaker',
  ap: 'access point', wap: 'access point', 'access points': 'access point',
  panels: 'panel', sensors: 'sensor', strobes: 'strobe', outlets: 'outlet', receptacle: 'outlet',
};
const KIND_WORDS = [...new Set([...Object.keys(KIND_CODES), ...Object.keys(KIND_ALIASES)])]
  .sort((a, b) => b.length - a.length);

const FILLER = new Set([
  'find', 'show', 'me', 'go', 'to', 'the', 'a', 'an', 'on', 'in', 'at', 'of', 'for', 'is', 'where', 'whereabouts',
  'number', 'no', 'num', 'please', 'locate', 'look', 'up', 'get', 'that', 'this', 'one', 'it', 'its', 'wing', 'side',
  'floor', 'level', 'lvl', 'fl', 'story', 'storey', 'and', 'with', 'can', 'you', 'pull', 'open',
]);

const lower = (v) => String(v || '').toLowerCase();

/** "camera" from "Cameras", "CCTV", "camera" ... or the word itself. */
export function kindOf(word) {
  const base = lower(word).trim();
  if (KIND_ALIASES[base]) return KIND_ALIASES[base];
  if (KIND_CODES[base]) return base;
  const single = base.replace(/s$/, '');
  return KIND_ALIASES[single] || (KIND_CODES[single] ? single : null);
}

const escapeRe = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Lower case, letters and digits only, hyphens as spaces: how a sentence
// and a category name are compared.
export const spokenForm = (text) => lower(text).replace(/[^a-z0-9#\s-]/g, ' ').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();

const toNumber = (word) => {
  if (/^\d+$/.test(word)) return Number(word);
  const ordinal = /^(\d+)(st|nd|rd|th)$/.exec(word);
  if (ordinal) return Number(ordinal[1]);
  if (word in NUMBER_WORDS) return NUMBER_WORDS[word];
  if (word in ORDINAL_WORDS) return ORDINAL_WORDS[word];
  return null;
};

const FLOOR_PATTERNS = [
  /\b(\d+)(?:st|nd|rd|th)?\s+(?:floor|level|fl|story|storey)\b/,
  /\b(ground|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth)\s+(?:floor|level|story|storey)\b/,
  /\b(?:floor|level|lvl|fl)\s*(?:number\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/,
  /\bl(\d{1,2})\b/,
];

/** The floor said in a spoken-form string, and the string without it. */
export function takeFloor(s) {
  for (const re of FLOOR_PATTERNS) {
    const m = re.exec(s);
    if (m) return { floor: toNumber(m[1]), s: `${s.slice(0, m.index)} ${s.slice(m.index + m[0].length)}` };
  }
  return { floor: null, s };
}

/**
 * The kind of device said in a spoken-form string, and the string without
 * it: the project's own categories first (any trade: "smoke detector",
 * "pull station", "VAV box"), longest words first; then the usual kinds.
 */
export function takeKind(s, kinds = []) {
  const own = (kinds || []).flatMap((k) => k.words.map((word) => ({ word, k })))
    .sort((a, b) => b.word.length - a.word.length);
  for (const { word, k } of own) {
    const m = new RegExp(`\\b${escapeRe(word)}\\b`).exec(s);
    if (m) return { kind: k.kind, kindWord: word, codes: k.codes, at: m.index, end: m.index + m[0].length, s: `${s.slice(0, m.index)} ${s.slice(m.index + m[0].length)}` };
  }
  for (const word of KIND_WORDS) {
    const m = new RegExp(`\\b${word}\\b`).exec(s);
    if (m) return { kind: KIND_ALIASES[word] || word, kindWord: word, codes: null, at: m.index, end: m.index + m[0].length, s: `${s.slice(0, m.index)} ${s.slice(m.index + m[0].length)}` };
  }
  return { kind: null, kindWord: null, codes: null, at: -1, end: -1, s };
}

/**
 * What a person asked for: { kind, kindWord, number, floor, wing, code }.
 * "find camera 6 on the 4th floor" -> { kind: 'camera', number: 6, floor: 4 }.
 * "C six, fourth floor west" -> { code: 'c', number: 6, floor: 4, wing: 'w' }.
 * Null when there is no number to look for.
 */
export function parseDescribedTarget(text, { kinds = [] } = {}) {
  let s = ` ${spokenForm(text)} `;
  s = s.replace(/\b(twenty|thirty|forty|fifty)\s+(one|two|three|four|five|six|seven|eight|nine)\b/g,
    (_, t, o) => ` ${NUMBER_WORDS[t] + NUMBER_WORDS[o]} `);
  const took = takeFloor(s);
  s = took.s;
  let { floor } = took;
  let wing = null;
  const wingMatch = /\b(west|east|north|south)\b/.exec(s);
  if (wingMatch) {
    wing = WINGS[wingMatch[1]];
    s = `${s.slice(0, wingMatch.index)} ${s.slice(wingMatch.index + wingMatch[0].length)}`;
  }
  const said = takeKind(s, kinds);
  s = said.s;
  const { kindWord } = said;
  let { kind, codes } = said;
  const words = s.split(/\s+/).filter(Boolean);
  // Numbers in a row: typed digit groups ("C-4-06") are a floor then a
  // number; spoken ones run together ("one seventeen" is 117, "four oh six" 406).
  const runs = [];
  // Words that are none of kind, number, floor, wing, code or filler: a
  // caller that must account for every word (the offline helper) checks it.
  const leftover = [];
  let code = null;
  let run = null;
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i];
    // "that one", "the one": not a number.
    if (w === 'one' && /^(that|this|the|which|same)$/.test(words[i - 1] || '')) { run = null; continue; }
    if (FILLER.has(w) && w !== 'one' && !(w === 'no' && run)) { run = null; continue; }
    const glued = /^([a-z]{1,4})(\d+)$/.exec(w);
    if (glued) {
      code = code || glued[1];
      run = { typed: true, groups: [glued[2]] };
      runs.push(run);
      continue;
    }
    const bare = w.replace(/^#/, '');
    const n = bare === 'oh' && run ? 0 : toNumber(bare);
    if (n != null) {
      const typed = /^\d+$/.test(bare);
      if (!run || run.typed !== typed) { run = { typed, groups: [] }; runs.push(run); }
      run.groups.push(String(n));
      continue;
    }
    run = null;
    if (/^[a-z]{1,4}$/.test(w) && !code && !runs.length && !(w in ORDINAL_WORDS)) code = w;
    else leftover.push(w);
  }
  const first = runs[0];
  if (!first) return null;
  let number;
  if (first.typed && first.groups.length >= 2) {
    if (floor == null) floor = Number(first.groups[first.groups.length - 2]);
    number = Number(first.groups[first.groups.length - 1]);
  } else {
    number = Number(first.groups.join(''));
  }
  if (!Number.isFinite(number)) return null;
  // A bare letter code one kind knows ("cam 6", "SD 4") is that kind: the
  // project's own kinds first, and only when one kind alone has it.
  if (!kind && code && code.length > 1) {
    const mine = (kinds || []).filter((k) => k.codes.includes(code));
    if (mine.length === 1) { kind = mine[0].kind; codes = mine[0].codes; }
    else if (!mine.length) {
      const known = Object.entries(KIND_CODES).find(([, list]) => list.includes(code));
      if (known) kind = known[0];
    }
  }
  const target = { kind, kindWord, number, floor, wing, code, ...(codes ? { codes } : {}) };
  // Not shown to the model or compared in tests: only for callers that check.
  Object.defineProperty(target, 'leftover', { value: leftover, enumerable: false });
  return target;
}

/** Letter and digit groups of a tag: "4W-CAM-06" -> letters [w, cam], digits ["4", "06"]. */
export function tagParts(text) {
  const parts = lower(text).match(/[a-z]+|\d+/g) || [];
  return {
    letters: parts.filter((p) => /^[a-z]/.test(p)),
    digits: parts.filter((p) => /^\d/.test(p)),
  };
}

const initials = (words) => (words.includes(' ') ? words.split(' ').map((w) => w[0]).join('') : null);
const kindCodes = (kind, kindWord) => {
  const codes = new Set(KIND_CODES[kind] || []);
  // "pull station" is PS, "data drop" DD: the initials of the words said.
  for (const w of [kind, kindWord]) {
    if (!w) continue;
    codes.add(w.replace(/\s+/g, ''));
    codes.add(w[0]);
    const i = initials(w);
    if (i) codes.add(i);
  }
  return codes;
};

const sameKindName = (name, kind) => {
  if (!name || !kind) return false;
  const n = lower(name).trim();
  return n === kind || kindOf(n) === kind || n.replace(/s$/, '') === kind || n.includes(kind);
};

const isWingLetter = (l) => l.length === 1 && 'nsew'.includes(l);

/**
 * How well a tag (or an item name) fits what was asked, 0 to 1. 0 means
 * it cannot be it (wrong number, wrong floor, another kind of device).
 * ctx: { category, pageFloor, pageWing } where known.
 */
export function scoreDescribedTag(target, text, { category = null, pageFloor = null, pageWing = null } = {}) {
  if (!target || target.number == null) return 0;
  const { letters, digits } = tagParts(text);
  if (!digits.length) return 0;
  const n = target.number;
  const floor = target.floor;
  let numberAt = -1;
  let embeddedFloor = false;
  // The device number is the last group; groups before it are the floor
  // ("C-4-06" is camera 6 on floor 4, never camera 4).
  if (Number(digits[digits.length - 1]) === n) numberAt = digits.length - 1;
  // CAM-406: floor 4, camera 06.
  if (numberAt < 0 && floor != null) {
    const f = String(floor);
    numberAt = digits.findIndex((d) => d.length >= f.length + 2 && d.startsWith(f) && Number(d.slice(f.length)) === n);
    embeddedFloor = numberAt >= 0;
  }
  // "four oh six" for C-4-06: the groups read together.
  let joinedGroups = false;
  if (numberAt < 0 && digits.length >= 2 && String(n).length >= 3) {
    const tail = digits.slice(-2);
    if (tail.join('') === String(n) || `${Number(tail[0])}${tail[1]}` === String(n)) {
      numberAt = digits.length - 1;
      joinedGroups = true;
    }
  }
  if (numberAt < 0) return 0;
  // Kind and floor bring it to 0.95; the wing said decides between twins.
  let score = 0.45;
  if (joinedGroups) { score += 0.3; digits.splice(digits.length - 2, 1); numberAt = digits.length - 1; }
  const others = digits.filter((_, i) => i !== numberAt).map(Number);
  // The wing letter glued to a floor ("4W") is not a device code.
  const codeLetters = letters.filter((l) => !isWingLetter(l) || letters.length === 1);
  if (floor != null) {
    if (embeddedFloor || others.includes(floor)) score += 0.3;
    // A floor written in the tag wins over the sheet's title: a fourth-floor
    // sheet can show a third-floor device.
    else if (others.length) return 0;
    else if (pageFloor === floor) score += 0.25;
    else if (pageFloor != null) return 0;
  } else if (others.length || pageFloor != null) {
    // No floor said: any floor may be it, but fewer leftover numbers fit better.
    score -= 0.05;
  }
  if (target.kind || target.code) {
    const codes = kindCodes(target.kind, target.kindWord);
    for (const c of target.codes || []) codes.add(c);
    if (target.code) codes.add(target.code);
    if (codeLetters.some((l) => codes.has(l))) score += 0.2;
    else if (sameKindName(category, target.kind)) score += 0.2;
    else if (codeLetters.length) return 0;
    else if (category && target.kind && !sameKindName(category, target.kind)) return 0;
  } else if (codeLetters.length > 0) {
    score -= 0.05;
  }
  if (target.wing) {
    // A wing written in the tag ("4E-CAM-06") wins over the sheet it sits on.
    const tagWing = letters.length > 1 ? letters.find(isWingLetter) : null;
    if (tagWing) {
      if (tagWing !== target.wing) return 0;
      score += 0.05;
    } else if (pageWing === target.wing) score += 0.05;
    else if (pageWing) score -= 0.25;
  }
  return Math.max(0, Math.min(1, Math.round(score * 100) / 100));
}

const FLOOR_WORD_RE = /^(ground|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|\d+(?:st|nd|rd|th)?)$/;

/**
 * Which floor (and wing) a sheet shows, from its words: "FOURTH FLOOR PLAN -
 * WEST", "LEVEL 4", "4TH FLOOR". Bigger text (the title block) counts more.
 * { floor, wing }, each null when the sheet does not say one clearly.
 */
export function sheetFloorOf(words) {
  const list = (words || []).filter((w) => String(w?.text || '').trim());
  const floors = new Map();
  const wings = new Map();
  const add = (map, key, weight) => map.set(key, (map.get(key) || 0) + weight);
  for (let i = 0; i < list.length; i += 1) {
    const a = lower(list[i].text).replace(/[^a-z0-9]/g, '');
    const b = lower(list[i + 1]?.text).replace(/[^a-z0-9]/g, '');
    const weight = Math.max(1, Number(list[i].box?.height) || 1);
    if (/^(floor|level|lvl)$/.test(a) && b) {
      const n = toNumber(b);
      if (n != null && n < 100) add(floors, n, weight);
    }
    if (/^(floor|level|flr)$/.test(b) && FLOOR_WORD_RE.test(a)) {
      const n = toNumber(a);
      if (n != null && n < 100) add(floors, n, weight);
    }
    const glued = /^(\d{1,2})(?:st|nd|rd|th)?(floor|level)$/.exec(a) || /^(?:level|floor)(\d{1,2})$/.exec(a);
    if (glued) add(floors, Number(glued[1]), weight);
    if (a in WINGS && /^(wing|side|area|plan|floor)?$/.test(b)) add(wings, WINGS[a], weight);
  }
  const pick = (map) => {
    const total = [...map.values()].reduce((s, v) => s + v, 0);
    const [best] = [...map.entries()].sort((x, y) => y[1] - x[1]);
    return best && best[1] >= total * 0.6 ? best[0] : null;
  };
  return { floor: pick(floors), wing: pick(wings) };
}

const plural = (word) => (/(s|x|ch|sh)$/.test(word) ? `${word}es` : /[^aeiou]y$/.test(word) ? `${word.slice(0, -1)}ies` : `${word}s`);
const singular = (word) => (/ies$/.test(word) ? `${word.slice(0, -3)}y` : /(xes|ches|shes|sses)$/.test(word) ? word.slice(0, -2) : /[^s]s$/.test(word) ? word.slice(0, -1) : word);

/**
 * Kinds from a project's own categories, so any trade's words work: with a
 * "Smoke Detector" category, "smoke detector 4 on the third floor" finds
 * SD-3-04. Nothing is hard-coded per trade: each category's name gives the
 * words, and the tags of items already in it give the letters.
 *
 * categories: [{ name, tags: [item names in it] }]. Returns
 * [{ kind, words, codes }]: kind is the name as said ("smoke detector");
 * words are how it may be said (the name, singular and plural, and its last
 * word or two when no other category ends the same way); codes are the
 * letters its tags may start with (initials, first letter, first three
 * letters, letters seen in its tags, and the usual codes of a known kind).
 */
export function templateKinds(categories) {
  const byKind = new Map();
  for (const c of categories || []) {
    const name = spokenForm(c?.name);
    if (!name || !/[a-z]/.test(name)) continue;
    // "Smoke Detectors" and "Smoke Detector" are one kind, said in the singular.
    const parts = name.split(' ');
    parts[parts.length - 1] = singular(parts[parts.length - 1]);
    const kind = parts.join(' ');
    const entry = byKind.get(kind) || { kind, words: new Set(), codes: new Set(), tails: [] };
    byKind.set(kind, entry);
    const last = parts[parts.length - 1];
    const head = parts.slice(0, -1).join(' ');
    for (const w of [last, singular(last), plural(singular(last))]) entry.words.add(head ? `${head} ${w}` : w);
    if (parts.length >= 2) entry.tails.push(parts.slice(-1));
    if (parts.length >= 3) entry.tails.push(parts.slice(-2));
    const letters = parts.filter((p) => /^[a-z]/.test(p));
    if (letters.length) {
      entry.codes.add(letters[0][0]);
      if (letters.length >= 2) entry.codes.add(letters.map((p) => p[0]).join(''));
      if (letters[0].length >= 3) entry.codes.add(letters[0].slice(0, 3));
      if (letters.length === 1 && letters[0].length <= 4) entry.codes.add(letters[0]);
    }
    const known = kindOf(kind) || kindOf(last);
    for (const code of KIND_CODES[known] || []) entry.codes.add(code);
    for (const tag of c?.tags || []) {
      const { letters: tagLetters } = tagParts(tag);
      for (const l of tagLetters) if (l.length <= 4 && !(isWingLetter(l) && tagLetters.length > 1)) entry.codes.add(l);
    }
  }
  // "Pull station 3" for "Fire Alarm Pull Station": a short tail counts only
  // when no other category ends with the same words or has them as a word.
  const all = [...byKind.values()];
  for (const entry of all) {
    for (const tail of entry.tails) {
      const said = tail.join(' ');
      const forms = [said, tail.length === 1 ? singular(said) : null, tail.length === 1 ? plural(singular(said)) : null].filter(Boolean);
      const clash = all.some((o) => o !== entry && (o.kind.split(' ').slice(-tail.length).join(' ') === said || [...o.words].some((w) => forms.includes(w))));
      if (clash) continue;
      forms.forEach((f) => entry.words.add(f));
      if (tail.length > 1) entry.codes.add(tail.map((w) => w[0]).join(''));
    }
  }
  return all.map(({ kind, words, codes }) => ({ kind, words: [...words].filter(Boolean), codes: [...codes] }));
}

/** The kind one word or name is, among a project's kinds, else the usual ones. */
export function kindFromWord(word, kinds = []) {
  const said = spokenForm(word);
  if (!said) return null;
  const mine = (kinds || []).find((k) => k.kind === said || k.words.includes(said));
  if (mine) return { kind: mine.kind, codes: mine.codes };
  return { kind: kindOf(said) || said, codes: null };
}

/**
 * A floor number from how a floor is written on an item ("Floor 2", "2nd",
 * "Level 02", "second", "L2"), or null when it is not a plain number
 * ("Basement", "Mezzanine").
 */
export function floorNumberOf(value) {
  const text = lower(value).replace(/\b(floor|level|lvl|fl|storey|story|flr)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
  if (!text) return null;
  const l = /^l(\d{1,2})$/.exec(text);
  if (l) return Number(l[1]);
  if (text.includes(' ')) return null;
  const n = toNumber(text);
  return n != null && n < 200 ? n : null;
}

/** The wing letter from how a wing is written on an item ("West", "W wing"). */
export function wingLetterOf(value) {
  const text = lower(value).replace(/\b(wing|side)\b/g, ' ').replace(/[^a-z]+/g, ' ').trim();
  if (WINGS[text]) return WINGS[text];
  return /^[nsew]$/.test(text) ? text : null;
}
