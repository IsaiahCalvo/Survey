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

const toNumber = (word) => {
  if (/^\d+$/.test(word)) return Number(word);
  const ordinal = /^(\d+)(st|nd|rd|th)$/.exec(word);
  if (ordinal) return Number(ordinal[1]);
  if (word in NUMBER_WORDS) return NUMBER_WORDS[word];
  if (word in ORDINAL_WORDS) return ORDINAL_WORDS[word];
  return null;
};

/**
 * What a person asked for: { kind, kindWord, number, floor, wing, code }.
 * "find camera 6 on the 4th floor" -> { kind: 'camera', number: 6, floor: 4 }.
 * "C six, fourth floor west" -> { code: 'c', number: 6, floor: 4, wing: 'w' }.
 * Null when there is no number to look for.
 */
export function parseDescribedTarget(text) {
  let s = ` ${lower(text).replace(/[^a-z0-9#\s-]/g, ' ').replace(/-/g, ' ')} `;
  s = s.replace(/\b(twenty|thirty|forty|fifty)\s+(one|two|three|four|five|six|seven|eight|nine)\b/g,
    (_, t, o) => ` ${NUMBER_WORDS[t] + NUMBER_WORDS[o]} `);
  let floor = null;
  let wing = null;
  const floorPatterns = [
    /\b(\d+)(?:st|nd|rd|th)?\s+(?:floor|level|fl|story|storey)\b/,
    /\b(ground|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth)\s+(?:floor|level|story|storey)\b/,
    /\b(?:floor|level|lvl|fl)\s*(?:number\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/,
    /\bl(\d{1,2})\b/,
  ];
  for (const re of floorPatterns) {
    const m = re.exec(s);
    if (m) {
      floor = toNumber(m[1]);
      s = `${s.slice(0, m.index)} ${s.slice(m.index + m[0].length)}`;
      break;
    }
  }
  const wingMatch = /\b(west|east|north|south)\b/.exec(s);
  if (wingMatch) {
    wing = WINGS[wingMatch[1]];
    s = `${s.slice(0, wingMatch.index)} ${s.slice(wingMatch.index + wingMatch[0].length)}`;
  }
  let kind = null;
  let kindWord = null;
  for (const word of KIND_WORDS) {
    const m = new RegExp(`\\b${word}\\b`).exec(s);
    if (m) {
      kind = KIND_ALIASES[word] || word;
      kindWord = word;
      s = `${s.slice(0, m.index)} ${s.slice(m.index + m[0].length)}`;
      break;
    }
  }
  const words = s.split(/\s+/).filter(Boolean);
  // Numbers in a row: typed digit groups ("C-4-06") are a floor then a
  // number; spoken ones run together ("one seventeen" is 117, "four oh six" 406).
  const runs = [];
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
  // A bare letter code the kind list knows ("cam 6") is that kind.
  if (!kind && code) {
    const known = Object.entries(KIND_CODES).find(([, codes]) => codes.includes(code) && code.length > 1);
    if (known) kind = known[0];
  }
  return { kind, kindWord, number, floor, wing, code };
}

/** Letter and digit groups of a tag: "4W-CAM-06" -> letters [w, cam], digits ["4", "06"]. */
export function tagParts(text) {
  const parts = lower(text).match(/[a-z]+|\d+/g) || [];
  return {
    letters: parts.filter((p) => /^[a-z]/.test(p)),
    digits: parts.filter((p) => /^\d/.test(p)),
  };
}

const kindCodes = (kind, kindWord) => {
  const codes = new Set(KIND_CODES[kind] || []);
  if (kind) { codes.add(kind.replace(/\s+/g, '')); codes.add(kind[0]); }
  if (kindWord) { codes.add(kindWord.replace(/\s+/g, '')); codes.add(kindWord[0]); }
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
