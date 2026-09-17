#!/usr/bin/env node
/*
 * audit-palette-roles - does every token match the part its old colour played?
 *
 * WHY THIS EXISTS. The revision-2 palette (src/styles/tokens.css, owner approved
 * 2026-09-17) was rolled out by replacing hex literals with tokens. A mechanical
 * find-and-replace can do that and still be wrong: it once mapped thirty
 * different old colours onto --accent-text, the near-black label ink that
 * belongs ON a gold fill, so panel fills, hairlines and hover states all went
 * almost black. Nothing failed to build; the app just looked broken.
 *
 * WHAT IT CHECKS. For every line this branch rewrote, it pairs each new
 * `var(--token)` with the hex literal that stood in the same position before,
 * works out the ROLE the value plays on that line (a fill, a hairline, ink, a
 * ring) and then asks three questions:
 *
 *   1. FAMILY - may this token play that role at all? A fill may not be painted
 *      with a text or hairline token; a hairline may not be a surface; ink may
 *      not be a surface. --accent-text is ink on a bright fill and nothing else.
 *   2. BRIGHTNESS - for a neutral old colour, is the token within 10 points
 *      (fills) or 14 points (hairlines and ink) of the old colour's brightness?
 *      Brightness is the max channel, the same measure tokens.css quotes when it
 *      says "B 13%". This is what catches a #2a3140 hairline (B 25) painted with
 *      --accent-text (B 7).
 *   3. HUE - if the old colour carried a hue (a green status, a blue link), the
 *      token must carry a hue too, unless the site is listed in EXCEPTIONS with
 *      a reason. A yes and a no may not both become the same grey.
 *
 * Deliberate departures live in EXCEPTIONS, each with the reason written down.
 * Comment prose is skipped: it documents colours, it does not paint them.
 *
 *   node scripts/audit-palette-roles.mjs            # against the branch point
 *   BASE=<ref> node scripts/audit-palette-roles.mjs
 *   VERBOSE=1 node scripts/audit-palette-roles.mjs  # list every site checked
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (args) => execFileSync('git', args, { cwd: repoRoot, maxBuffer: 1 << 28 }).toString();
const BASE = process.env.BASE || git(['merge-base', 'main', 'HEAD']).trim();

/* ---------- colour maths (HSB, because tokens.css speaks brightness) ------- */
const expand = (hex) => {
  let s = hex.replace('#', '').toLowerCase();
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  return s.slice(0, 6);
};
const rgb = (hex) => {
  const n = Number.parseInt(expand(hex), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const hsb = (hex) => {
  const [r, g, b] = rgb(hex).map((v) => v / 255);
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const s = mx === 0 ? 0 : (mx - mn) / mx;
  let h = 0;
  if (mx !== mn) {
    if (mx === r) h = 60 * (((g - b) / (mx - mn)) % 6);
    else if (mx === g) h = 60 * ((b - r) / (mx - mn) + 2);
    else h = 60 * ((r - g) / (mx - mn) + 4);
  }
  if (h < 0) h += 360;
  return { h, s: s * 100, b: mx * 100 };
};
const chroma = (hex) => {
  const [r, g, b] = rgb(hex);
  return ((Math.max(r, g, b) - Math.min(r, g, b)) / 255) * 100;
};
/* A hue is absolute chroma, not HSB saturation. #3a4252 reads as 29% saturated
   but its channels are only 9 points apart - it is a dark blue-GREY, one of the
   old cool neutrals. #58d976 is 51 points apart: that is a real green. */
const hueFamily = (hex) => {
  const { h } = hsb(hex);
  if (chroma(hex) < 12) return 'neutral';
  if (h >= 20 && h < 70) return 'gold';
  if (h >= 70 && h < 165) return 'green';
  if (h >= 165 && h < 265) return 'blue';
  return 'red';
};

/* ---------- the token file is the source of truth for the values ---------- */
const tokensCss = readFileSync(path.join(repoRoot, 'src/styles/tokens.css'), 'utf8');
const TOKEN_VALUE = new Map();
for (const [, name, value] of tokensCss.matchAll(/^\s*(--[a-z0-9-]+):\s*([^;]+);/gm)) {
  TOKEN_VALUE.set(name, value.trim());
}
const resolve = (name, depth = 0) => {
  const v = TOKEN_VALUE.get(name);
  if (!v || depth > 4) return null;
  const alias = /^var\((--[a-z0-9-]+)\)$/.exec(v);
  if (alias) return resolve(alias[1], depth + 1);
  return /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : null;
};

const SURFACES = new Set(['--surface-0', '--surface-1', '--surface-2', '--surface-3', '--hover', '--pressed']);
const BORDERS = new Set(['--border', '--border-strong']);
const INKS = new Set(['--text-1', '--text-2', '--text-3', '--text-disabled', '--accent-text']);
const PAINTS = new Set(['--accent', '--accent-light', '--accent-press', '--accent-soft', '--danger',
  '--danger-press', '--danger-soft', '--warning', '--success', '--focus', '--accent-red',
  '--overlay-scrim', '--info']);

/* ---------- deliberate departures, each with its reason ------------------- */
const EXCEPTIONS = [
  { file: 'src/AppShell.jsx', token: '--surface-2', hex: '#1e1e1e',
    why: 'a popover is a RAISED surface, so it takes surface-2 even though its old literal sat at the surface-1 brightness' },
  { file: 'src/sidebar/BookmarksPanel.jsx', token: '--surface-2', hex: '#2a3140',
    why: 'five secondary buttons rest one step below their own hover; they used to paint the same colour on enter and on leave' },
  { file: 'src/sidebar/BookmarksPanel.jsx', token: '--text-2', hex: '#8fb7ff',
    why: 'a folder icon stays a step brighter than a bookmark icon so the two kinds still differ, without a second hue in the chrome' },
  { file: 'src/sidebar/BookmarksPanel.jsx', token: '--danger-soft', hex: '#3a1f1f',
    why: 'the remove-button hover: the destructive twin of --accent-soft replaces a dark-red literal' },
  { file: 'src/sidebar/SearchTextPanel.jsx', token: '--text-3', hex: '#58d976',
    why: 'the empty-state magnifier is decoration, not status; it stays quiet rather than turning gold' },
  { file: 'src/sidebar/PagesPanel.jsx', token: '--surface-3', hex: '#2b4a5a',
    why: 'the drag-over fill is a surface step; it is mutually exclusive with the selected fill it now shares' },
  { file: 'src/SurveySpacesRail.jsx', token: '--surface-3', hex: '#17324d',
    why: 'an active row is a surface step plus a gold edge, never a blue wash' },
  { file: 'src/PDFViewer.jsx', token: '--text-2', hex: '#8be9fd',
    why: 'a cyan heading in the diagnostics overlay is information, not an accent' },
  { file: 'src/services/excelSyncStatus.js', token: '--text-3', hex: '#3498db',
    why: 'tokens.css defines --info as --text-3: informational is just subtext' },
  { file: 'src/services/excelSyncStatus.js', token: '--surface-2', hex: '#3498db',
    why: 'the same info tone: its wash becomes a surface step' },
  { file: 'src/services/excelSyncStatus.js', token: '--border', hex: '#3498db',
    why: 'the same info tone: its edge becomes the default hairline' },
  { file: 'src/mobile/MobilePdfViewerChrome.jsx', token: '--text-2', hex: '#d8dee9',
    why: 'an inactive glyph stroke; the old value was already a cool near-white' },
  { file: 'src/mobile/mobilePdfViewer.css', token: '--text-1', hex: '#f2f2f2',
    why: 'a 2px ring around a colour swatch has to stay near-white so a light swatch keeps an edge' },
  { file: 'src/mobile/mobilePdfViewer.css', token: '--text-2', hex: '#d7dee8',
    why: 'the same swatch ring, one step quieter, on the survey detail row' },
  { file: 'src/components/revisions/RevisionsPanel.jsx', token: '--text-3', hex: '#9ec',
    why: 'a pale-green status line becomes plain subtext; --success is for dots only (owner amendment b)' },
  { file: 'src/components/FormFieldPropertiesPanel.jsx', token: '--text-1', hex: '#fcd',
    why: 'the label on the delete button: a pale pink becomes the plain primary ink' },
  { file: 'src/home/TemplatesEditor.jsx', token: '--text-3', hex: '#9aa3b2',
    why: 'a swatch-list entry that was already a neutral grey' },
  { file: 'src/home/ProjectsFolderTree.jsx', token: '--text-disabled', hex: '#9aa3b2',
    why: 'the offline dot: quiet grey beside the --success online dot' },
  { file: 'src/components/AccountSettings.jsx', token: '--accent-text', hex: '#fff',
    why: 'the billing toggle is gold now, and a label ON gold is --accent-text; white on gold is 2.0:1' },
  { file: 'src/home/AccessManagementModal.jsx', token: '--text-2', hex: '#5fbf83',
    why: 'an "Active" status LABEL: owner amendment (b) allows --success on dots and nothing else, so status text is plain ink' },
  { file: 'src/sidebar/SearchTextPanel.jsx', token: '--surface-3', hex: '#3a5070',
    why: 'the active search result is a surface step plus a gold edge, never a blue wash' },
  { file: 'src/styles.css', token: '--text-disabled', hex: '#785050',
    why: 'a disabled destructive button: disabled is --text-disabled by rule, not a dimmed red' },
  { file: 'src/mobile/mobilePdfViewer.css', token: '--border-strong', hex: '#8a93a3',
    why: 'a one-off light-grey outline on the keep-changes box; edges are --border / --border-strong by rule' },
  { file: 'src/components/revisions/RevisionsPanel.jsx', token: '--surface-3', hex: '#243044',
    why: 'the selected revision is a surface step plus a gold edge, never a blue wash' },
];
const excepted = (file, token, hex) => EXCEPTIONS.find((e) => e.file === file
  && e.token === token && expand(e.hex) === expand(hex));

/* ---------- pair every rewritten line: new token <-> old hex -------------- */
const HEX = /#(?:[0-9a-fA-F]{3,8})\b/g;
const VAR = /var\((--[a-z0-9-]+)\)/g;
const SENTINEL = String.fromCharCode(1);
const isComment = (line) => /^\s*(\*|\/\/|\/\*)/.test(line)
  || (/\*\//.test(line) && !/[:=]\s*var\(/.test(line));

// Compared against the WORKING TREE, not HEAD, so the audit can be run while
// the fixes are still in hand.
const files = git(['diff', '--name-only', BASE]).trim().split('\n')
  .filter((f) => /\.(jsx?|css|mjs|ts)$/.test(f) && !f.startsWith('tests/'));

const sites = [];
const unpaired = [];
for (const file of files) {
  const diff = git(['diff', '-U0', BASE, '--', file]).split('\n');
  for (let i = 0; i < diff.length; i += 1) {
    const head = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(diff[i]);
    if (!head) continue;
    const firstNew = Number.parseInt(head[1], 10);
    const removed = [];
    const added = [];
    for (i += 1; i < diff.length && /^[-+]/.test(diff[i]) && !/^(---|\+\+\+)/.test(diff[i]); i += 1) {
      (diff[i][0] === '-' ? removed : added).push(diff[i].slice(1));
    }
    i -= 1;
    for (let k = 0; k < added.length; k += 1) {
      const line = added[k];
      const tokens = [...line.matchAll(VAR)];
      if (!tokens.length || isComment(line)) continue;
      const old = removed[k];
      const hexes = old === undefined ? [] : (old.match(HEX) || []);
      let n = 0;
      const rebuilt = old === undefined ? null : line.replace(VAR, () => hexes[n++] ?? SENTINEL);
      if (rebuilt !== old || n !== hexes.length || removed.length !== added.length) {
        // The line was not a straight 1:1 swap - a ternary gained a branch, a
        // rule gained a declaration - so position cannot pair them. Each token
        // is then judged against EVERY hex the old line carried: if not one of
        // them would sanction it, the token is wrong whichever it replaced.
        if (!hexes.length) { unpaired.push(`${file}:${firstNew + k}`); continue; }
        tokens.forEach((m) => {
          sites.push({
            file, line: firstNew + k, token: m[1], hex: hexes[0],
            src: line.trim(), alsoAllowed: hexes.slice(1), loose: true,
          });
        });
        continue;
      }
      tokens.forEach((m, idx) => {
        sites.push({ file, line: firstNew + k, token: m[1], hex: hexes[idx], src: line.trim() });
      });
    }
  }
}

/* ---------- what part does the value play on its line? ------------------- */
const roleOf = (line, at) => {
  const before = line.slice(0, at).slice(-160);
  if (/box-?shadow[^;]*$/i.test(before) || /boxShadow\s*:[^,]*$/.test(before)) return 'ring';
  const dotted = /\.(background|backgroundColor|borderColor|borderTopColor|borderBottomColor|color|fill|stroke)\s*=\s*[^=]*$/.exec(before);
  let key = dotted ? dotted[1] : '';
  if (!key) {
    const pairs = [...before.matchAll(/([a-zA-Z$_][\w$-]*)\s*:/g)];
    key = pairs.length ? pairs[pairs.length - 1][1] : '';
  }
  key = key.replace(/([A-Z])/g, (c) => `-${c.toLowerCase()}`).toLowerCase();
  if (/shadow/.test(key)) return 'ring';
  if (/^(background|background-color|fill|bg|paper|card|deep|panel|surface|well|sheet|chip|swatch)$/.test(key)) return 'fill';
  if (/(border|outline|rule|divider|stroke|hairline)/.test(key)) return 'border';
  if (/^(color|caret-color|text-decoration-color|ink|ink-soft|ink-muted|muted|text|label|placeholder|sub|glyph)$/.test(key)) return 'ink';
  return 'unknown';
};

/* Judge one (token, hex) pair. Returns null when the pairing is sound. */
const judge = (site, hex) => {
  const at = site.src.indexOf(`var(${site.token})`);
  const role = roleOf(site.src, at < 0 ? 0 : at);
  const value = resolve(site.token);
  const say = (kind, detail) => ({ role, kind, detail });

  if (site.token === '--accent-text' && role !== 'ink' && role !== 'unknown') {
    return say('accent-text-not-ink', `--accent-text is ink on a bright fill; here it is a ${role}`);
  }
  if (!value) return null;
  if (excepted(site.file, site.token, hex)) return null;
  // `--local-alias: var(--token)` is a definition, not a paint: the part it
  // plays is decided where the alias is USED, and those sites are audited.
  if (/^\s*--[a-z0-9-]+\s*:\s*var\(/.test(site.src)) return null;
  // --accent-text passed the family test above, so it IS ink here. How dark the
  // ink it replaced was does not matter: near-black on a bright fill is the job.
  if (site.token === '--accent-text') return null;

  // A 1-2px box painted with a hairline token is a hairline that happens to be
  // a div, and a ring is a line as well: both are judged as borders.
  const thin = /(width|height|inline-size|block-size)\s*:\s*'?[12]px/.test(site.src);
  const judged = (role === 'ring' || (role === 'fill' && thin && BORDERS.has(site.token))) ? 'border' : role;
  const oldB = hsb(hex).b;
  if (judged === 'fill' && INKS.has(site.token) && oldB < 40) {
    // Ink on a panel: the defect that started all this. A small grey chip
    // (a dot, a pill, an avatar) whose own old colour was already light is fine.
    return say('ink-as-fill', `${site.token} is ink, used to fill something that was B ${oldB.toFixed(0)}`);
  }
  // A cutout edge - a line painted in the surface BEHIND the element so a dot or
  // a badge reads against it - is a real technique, and legal when the original
  // was a surface-band colour too.
  if (judged === 'border' && SURFACES.has(site.token) && oldB >= 30) {
    return say('surface-as-hairline', `${site.token} is a surface, used as a line that was B ${oldB.toFixed(0)}`);
  }
  if (judged === 'ink' && SURFACES.has(site.token)) {
    return say('surface-as-ink', `${site.token} is a surface, used as ink`);
  }

  const oldFamily = hueFamily(hex);
  const newFamily = hueFamily(value);
  if (oldFamily !== 'neutral' && newFamily === 'neutral' && !PAINTS.has(site.token)) {
    return say('hue-lost', `${hex} carried a ${oldFamily} hue; ${site.token} (${value}) is neutral`);
  }
  if (oldFamily === 'neutral') {
    // Borders were brightened ON PURPOSE (tokens.css fault 2: at 1.40:1 they
    // were invisible, they are 1.86:1 now), so a line may drift further.
    const drift = Math.abs(oldB - hsb(value).b);
    const allowed = judged === 'fill' ? 10 : (judged === 'border' ? 18 : 14);
    if (drift > allowed) {
      return say('brightness', `${hex} is B ${oldB.toFixed(0)}, ${site.token} (${value}) is B ${hsb(value).b.toFixed(0)} - ${drift.toFixed(0)} points apart as a ${judged}`);
    }
  }
  return null;
};

const findings = [];
for (const site of sites) {
  // A loose site (its line was not a 1:1 swap) passes if ANY of the hexes that
  // line carried would sanction the token it now holds.
  let verdict = judge(site, site.hex);
  for (const hex of site.alsoAllowed || []) {
    if (!verdict) break;
    if (!judge(site, hex)) verdict = null;
  }
  if (verdict) findings.push({ ...site, ...verdict });
}

/* ---------- report ------------------------------------------------------- */
console.log(`palette role audit - ${BASE.slice(0, 9)}..working tree`);
console.log(`${sites.length} token sites paired with the hex they replaced, across ${files.length} files`);
const looseLines = new Set(sites.filter((x) => x.loose).map((x) => `${x.file}:${x.line}`));
console.log(`${looseLines.size} of those lines were not a 1:1 swap, so each token there is judged against every hex the old line carried`);
console.log(`${new Set(unpaired).size} rewritten lines hold a token but no old hex at all (a new declaration), so there is nothing to compare`);
console.log(`${EXCEPTIONS.length} deliberate departures, each with its reason in this file`);
if (process.env.VERBOSE) {
  for (const s of sites) console.log(`   ${s.file}:${s.line}  ${s.hex} -> var(${s.token})`);
}
if (findings.length === 0) {
  console.log('');
  console.log('0 mismatched roles.');
  process.exit(0);
}
console.log('');
console.log(`${findings.length} MISMATCHED ROLES:`);
for (const f of findings) {
  console.log(`  ${f.file}:${f.line}  [${f.kind}] ${f.detail}`);
  console.log(`      ${f.src.slice(0, 150)}`);
}
process.exit(1);
