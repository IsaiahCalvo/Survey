// src/featureFlags.js — one switch board for unfinished features.
//
// New work ships in the code but stays hidden until its flag is on. Each flag
// has a stage:
//   beta    - an unfinished feature. Only Survey Nightly shows it. The stable
//             app (surveytool.app) never does, whatever /flags says and even
//             for testers: Isaiah wants the app people pay for free of beta.
//   rollout - ready for stable. /flags turns it on for testers, then everyone.
// A flag is on for this browser when the first of these that answers says so:
//   0. a beta flag in a stable production build: always off
//   1. localStorage 'survey.flag.<key>' = '1' / '0' (or the flag's older key)
//   2. the nightly build (VITE_RELEASE_CHANNEL=nightly) turns every BETA flag
//      on, except one marked nightlyOn: false (kept hidden). Rollout flags
//      go on to steps 3-5 there as on stable, so Survey Nightly is the live
//      app plus the beta features and nothing else
//      (owner 2026-10-27: nightly turned 'pro-lock' on, so Survey tools
//      were locked there and not on surveytool.app)
//   3. a build-wide env var, where the flag has one
//   4. the server's answer for this person, saved from the last load
//      (feature_flags table: off, testers only, or on for everyone)
//   5. default: off
// Test builds skip step 0 so tests can still turn beta flags on: dev servers
// (vite dev) and `--mode e2e` builds (the e2e harness and the native-app walks,
// which run against a throwaway local database, never production). Moving a feature to stable = change its stage to
// 'rollout' (docs/RELEASE-CHANNELS.md).
// Features read their flag once at load, so a change made at /flags shows on
// the next reload. To add a flag: add it here and insert its row in a
// migration (see supabase/migrations/20261021030000_feature_flags.sql).

export const FEATURE_FLAGS = Object.freeze({
  // 2026-11-09 (owner: "get this onto production"): counter-list,
  // grid-settings, spline-polyline, export-modes, pinned-tools, layers,
  // marker-tracking, document-versions, survey-report, guest-links,
  // microsoft-sign-in, custom-answers, own-excel-layouts (back to beta 2026-11-12) and mark-comments moved from beta to rollout after their /flags rows were turned on, so
  // surveytool.app follows /flags for them.
  // 2026-11-12 (owner): grid-settings and survey-report went back to beta
  // (Nightly only); the marker-tracking list chips got their own beta flag.
  // On surveytool.app since 2026-11-09 (owner: "let's deploy it", with a
  // "Beta" tag under its tool icon).
  'smart-fill': Object.freeze({
    label: 'Smart fill',
    legacyKey: 'SMART_FILL_BETA',
    env: 'VITE_ENABLE_SMART_FILL',
    stage: 'rollout',
  }),
  'survey-agent': Object.freeze({
    label: 'Survey agent',
    legacyKey: 'SURVEY_AGENT_BETA',
    env: 'VITE_ENABLE_SURVEY_AGENT',
    stage: 'beta',
  }),
  'annotation-agent': Object.freeze({
    label: 'Agent annotation writes',
    env: 'VITE_ENABLE_ANNOTATION_AGENT',
    stage: 'beta',
  }),
  // Read by the survey-mcp edge function, not the app: Claude or ChatGPT
  // connectors write only for people this flag is on for at /flags.
  'survey-connector-writes': Object.freeze({
    label: 'Outside connector survey writes',
    stage: 'beta',
  }),
  'pro-lock': Object.freeze({
    label: 'Lock Pro features for Free plan',
    stage: 'rollout',
  }),
  'legacy-collab-retired': Object.freeze({
    label: 'Retire the legacy collab layer (step 1)',
    stage: 'rollout',
  }),
  'survey-marker-fields': Object.freeze({
    label: 'Survey markers merge concurrent field edits',
    stage: 'rollout',
  }),
  // Infrastructure, not a feature: opens read PDFs from their Cloudflare R2
  // copy (services/pdfR2Source.js, docs/PDF-R2.md). Needs R2 set up first.
  'pdf-r2': Object.freeze({
    label: 'Open PDFs from the Cloudflare R2 copy (saves Supabase download costs)',
    stage: 'rollout',
  }),
  'custom-answers': Object.freeze({
    label: 'Make-your-own checklist answers in templates',
    stage: 'rollout',
  }),
  // Owner 2026-11-12: back to Nightly only.
  'survey-report': Object.freeze({
    label: 'Survey report as a PowerPoint deck (cover, progress chart, issues)',
    stage: 'beta',
  }),
  layers: Object.freeze({
    label: 'Layers panel (markup layers + PDF content opacity)',
    stage: 'rollout',
  }),
  'pinned-tools': Object.freeze({
    label: 'Pinned tools dock (favourite tools with their own colour and width)',
    stage: 'rollout',
  }),
  'counter-list': Object.freeze({
    label: 'Counts list: rename, recolour and reorder counts in one place',
    stage: 'rollout',
  }),
  'company-admin': Object.freeze({
    label: 'Company workspace: people, roles, seats, shared storage and activity log (Enterprise)',
    stage: 'beta',
  }),
  'microsoft-sign-in': Object.freeze({
    label: 'Sign in with Microsoft (work, school or personal account)',
    stage: 'rollout',
  }),
  'export-modes': Object.freeze({
    label: 'Export PDF choices: annotated, flattened or plain, and which pages',
    stage: 'rollout',
  }),
  // Owner 2026-11-12: back to Nightly only.
  'grid-settings': Object.freeze({
    label: 'Page grid spacing: fine, normal, wide or custom (paper or drawing units)',
    stage: 'beta',
  }),
  'spline-polyline': Object.freeze({
    label: 'Curved polyline: bend smoothly through the clicked corners',
    stage: 'rollout',
  }),
  // Back to Nightly only (owner 2026-11-12): it copies one row of column
  // names from the first sheet, not the customer's real workbook, so the live
  // app offers a custom layout built by our team instead.
  'own-excel-layouts': Object.freeze({
    label: 'Your own Excel layout: upload your sheet and match its columns',
    stage: 'beta',
  }),
  // Owner 2026-10-27: wire it in but keep it hidden, so Nightly does not turn
  // it on by itself; /flags or 'survey.flag.conditional-lines' = '1' does.
  'conditional-lines': Object.freeze({
    label: 'Conditional checklist lines: show a line only after a certain answer',
    stage: 'beta',
    nightlyOn: false,
  }),
  'document-versions': Object.freeze({
    label: 'Version history: a new version keeps the old ones, with old-over-new compare',
    stage: 'rollout',
  }),
  // Drawboard Projects parity DL-28 / RV-22 (2026-11-12): delete one version
  // from the Versions list (Undo toast); the one before becomes current.
  'version-delete': Object.freeze({ label: 'Delete one version: take a single version out of the Versions list, with Undo', stage: 'beta' }),
  'mark-library': Object.freeze({
    label: 'Mark library: save marks to a personal or project library and drop them on any page',
    stage: 'beta',
  }),
  'mark-comments': Object.freeze({
    label: 'Comments on marks: threads, replies and @mentions with an email link',
    stage: 'rollout',
  }),
  'marker-tracking': Object.freeze({
    label: 'Survey items: status, assigned to and due date',
    stage: 'rollout',
  }),
  // Owner 2026-11-12: the Assigned to me / Due soon / Late / Hide done chips
  // over the Survey list stay on Nightly until they look right.
  'tracking-filters': Object.freeze({
    label: 'Survey list chips: Assigned to me, Due soon, Late, Hide done',
    stage: 'beta',
  }),
  'guest-links': Object.freeze({
    label: 'Guest links: open one document without an account, as viewer or editor, until a set time',
    stage: 'rollout',
  }),
  // The app's Google Sheets (and later Microsoft 365) live sync panel; the
  // sheet-sync function also lets flag admins and Nightly testers link.
  'sheet-team-sync': Object.freeze({
    label: 'Live team sync with Google Sheets: phones, web and desktop write to the sheet',
    stage: 'beta',
  }),
  // Drawboard Projects trial audit (2026-11-09): more measure tools.
  'sheet-revisions': Object.freeze({
    label: 'Sheet revisions: read the sheet number from the title block on upload and offer it as a new version',
    stage: 'beta',
  }),
  'measure-depth': Object.freeze({
    label: 'Measure: Polylength, Wall area and Volume (area or outline x a depth)',
    stage: 'beta',
  }),
  // Drawboard Projects round 2 (2026-11-10): its twelve review stamps.
  'review-stamps': Object.freeze({
    label: 'Review stamps: Approved, Rejected, For construction and more, with your name and the date, in the Library panel',
    stage: 'beta',
  }),
  // Drawboard Projects round 2 (2026-11-10): Export PDF keeps only chosen
  // people's marks and layers, and can add the comments as a CSV.
  'export-filters': Object.freeze({
    label: 'Export filters: only some people\'s marks or some layers, plus comments as a CSV',
    stage: 'beta',
  }),
  // Drawboard Projects round 2 (2026-11-10): its "Review & Publish" step.
  'upload-check': Object.freeze({
    label: 'Upload check: fix each file\'s name, sheet number and revision before it uploads',
    stage: 'beta',
  }),
  // Drawboard Projects parity EX-10/12/17 (2026-11-12): Export project, one
  // zip of every file (with marks, every revision if asked), comments and
  // the Issues and Tasks registers, built on the device.
  'project-export': Object.freeze({ label: 'Export project: one zip of every file with marks or originals, all revisions, comments and issues CSVs', stage: 'beta' }),
  // Drawboard Projects parity UP-10..23 (2026-11-12): the upload check as a
  // review grid. On its own or with 'upload-check' (it replaces that step).
  'upload-review': Object.freeze({
    label: 'Upload review: title-block pictures, discipline, bulk revision and discipline, Remove, Show problems, one document per page',
    stage: 'beta',
  }),
  // Drawboard Projects round 2 (2026-11-10): review status per drawing.
  'document-review': Object.freeze({
    label: 'Document review: status, owner and markup count on each document, with filter chips',
    stage: 'beta',
  }),
  // Drawboard phone apps (2026-11-10): PDFs opened from Files, Mail or Teams.
  'open-in-survey': Object.freeze({
    label: 'Open in Survey: PDFs opened from Files, Mail, Outlook or Teams on a phone upload and open',
    stage: 'beta',
  }),
  // Drawboard phone apps (2026-11-10): a photo or camera shot becomes a PDF.
  'photo-upload': Object.freeze({
    label: 'Photo or camera: Upload takes photos too and turns each into a one-page PDF',
    stage: 'beta',
  }),
  // Drawboard phone apps (2026-11-10): night / glare reading.
  'dark-pages': Object.freeze({
    label: 'Dark pages: show PDF pages light-on-dark (marks keep their colours)',
    stage: 'beta',
  }),
  // Drawboard (2026-11-10): rest the pen at the end of a stroke to straighten it.
  'smart-ink': Object.freeze({
    label: 'Smart ink: hold the pen still at the end of a stroke to snap it to a line, rectangle or ellipse',
    stage: 'beta',
  }),
  // Drawboard (2026-11-10): every mark in one list, with search, filters,
  // measurement totals and a CSV.
  'markup-list': Object.freeze({
    label: 'Markups panel: every mark in one list with search, filters, measurement totals and a CSV',
    stage: 'beta',
  }),
  'measure-scale-chip': Object.freeze({
    label: 'Measure: a "No scale on this page" chip with Set scale while a measure tool is armed',
    stage: 'beta',
  }),
  'eraser-keeps-shapes': Object.freeze({
    label: 'Partial eraser only cuts ink and leaves shapes, text and callouts alone',
    stage: 'beta',
  }),
  'tool-quick-colours': Object.freeze({
    label: 'Highlighter quick colours are highlighter colours (yellow, green, pink)',
    stage: 'beta',
  }),
  'measure-keys': Object.freeze({
    label: 'Alt+Shift+L / P / A (and Q / V) pick a measure tool',
    stage: 'beta',
  }),
  'calibrate-entry': Object.freeze({
    label: "Calibrate takes feet-inches (20' 6\", 20-6) and shows the traced paper length",
    stage: 'beta',
  }),
  'measure-edit': Object.freeze({
    label: 'Measure: a Measurement button on a picked measurement sets its label, depth, caption lines and caption size',
    stage: 'beta',
  }),
  'align-marks': Object.freeze({
    label: 'Align and space picked marks (mark menu)',
    stage: 'beta',
  }),
  'word-wrap': Object.freeze({
    label: 'New text boxes and callouts wrap at spaces, not mid-word',
    stage: 'beta',
  }),
  'paste-across-documents': Object.freeze({
    label: 'Copy marks in one document and paste them in another',
    stage: 'beta',
  }),
  'shift-square': Object.freeze({
    label: 'Hold Shift while drawing a rectangle or ellipse for a square or circle',
    stage: 'beta',
  }),
  'phone-mark-more': Object.freeze({
    label: 'Phone: a More button on the picked-mark bar opens the full mark menu',
    stage: 'beta',
  }),
  'poly-back-step': Object.freeze({
    label: 'Backspace or Undo while placing a polygon or polyline takes the last point off',
    stage: 'beta',
  }),
  'home-download': Object.freeze({
    label: 'Download a document, with its marks, from the Home list',
    stage: 'beta',
  }),
  'new-document': Object.freeze({
    label: 'New blank document from Home (size, pages, lined, grid or dots)',
    stage: 'beta',
  }),
  'default-units': Object.freeze({
    label: 'Default units setting: imperial or metric for page scale and new documents',
    stage: 'beta',
  }),
  'menu-keys': Object.freeze({
    label: 'Keys shown on the mark right-click menu rows',
    stage: 'beta',
  }),
  'zoom-to-area': Object.freeze({
    label: 'Zoom to an area: Ctrl+Shift+drag draws a box and the view fills with it',
    stage: 'beta',
  }),
  'guest-sample': Object.freeze({
    label: 'Try the sample drawing signed out, as a try-out that is not saved',
    stage: 'beta',
  }),
  'viewer-share': Object.freeze({
    label: 'Share from inside a document: a Share button in the viewer top bar',
    stage: 'beta',
  }),
  'focus-mode': Object.freeze({
    label: 'Full screen: hide the browser and system bars, keep tabs and rails (Ctrl/Cmd+Shift+F)',
    stage: 'beta',
  }),
  'search-options': Object.freeze({
    label: 'Search: Match case and Whole word',
    stage: 'beta',
  }),
  'hide-marks': Object.freeze({
    label: 'Hide all marks from the right rail, with a chip to bring them back',
    stage: 'beta',
  }),
  'tab-keys': Object.freeze({
    label: 'Alt+Shift+] and Alt+Shift+[ step through the open documents',
    stage: 'beta',
  }),
  'lazy-accepted-shadow': Object.freeze({
    label: 'Open: keep the second copy of the marks only in the background worker until something needs it here',
    stage: 'beta',
  }),
  'open-visible-first': Object.freeze({
    label: 'Open: build the marks of the page on screen first, the pages around it after it has drawn',
    stage: 'beta',
  }),
  'back-button': Object.freeze({
    label: 'Back (browser or Android) closes the open sheet, then the document, instead of leaving Survey',
    stage: 'beta',
  }),
  // Drawboard Home parity (2026-11-10), one flag each so Isaiah can pick.
  'home-tags': Object.freeze({
    label: 'Home: your own tags on documents (row chips, Tags list, search by tag)',
    stage: 'beta',
  }),
  'home-shared-views': Object.freeze({
    label: 'Home: Shared by me and Shared with me filters',
    stage: 'beta',
  }),
  'home-columns': Object.freeze({
    label: 'Home: Last opened and Created columns, more sorts, list sizes',
    stage: 'beta',
  }),
  // Drawboard Projects parity (2026-11-10).
  'project-issues': Object.freeze({
    label: 'Projects: Issues and Tasks lists with IDs, statuses, filters, archive, CSV and activity',
    stage: 'beta',
  }),
  'share-extras': Object.freeze({
    label: 'Share dialog: owner row with (you), sort by Role / Name / Activity, personal message on email invites',
    stage: 'beta',
  }),
  'home-templates': Object.freeze({
    label: 'Home New menu: Notebook paper in one tap and Other templates (ruled, Cornell, grids, graph, isometric, hex, music)',
    stage: 'beta',
  }),
  'sheet-set-view': Object.freeze({
    label: 'Project sheets as a set: previous / next sheet, sheet picker, Shift+Left / Right, List and Grid views, Open all',
    stage: 'beta',
  }),
  'drawboard-keys': Object.freeze({
    label: 'Drawboard keys: Shift+Up / Down previous / next page; Alt+O / Alt+U next / previous version (with Versions on)',
    stage: 'beta',
  }),
  'sheet-register': Object.freeze({
    label: 'Sheet register: sheet number, revision and discipline on Home, discipline and open-items filters, sheet number sort, bulk status and discipline, Edit details, list CSV',
    stage: 'beta',
  }),
  'project-activity': Object.freeze({
    label: 'Projects: an Activity tab with what happened to the project (files, revisions, issues, people) in 15-minute groups',
    stage: 'beta',
  }),
  spotlight: Object.freeze({
    label: 'Spotlight: share your view from the people list; others follow your document, page and zoom (green frame, N following)',
    stage: 'beta',
  }),
  'page-op-sync': Object.freeze({
    label: 'Page changes in one window reload the PDF in the other windows that have it open',
    stage: 'beta',
  }),
  // Drawboard PDF Pro trial (2026-11-10): "Snap to content" beside "Snap to annotations".
  'snap-content': Object.freeze({
    label: "Snap to the PDF's own drawing: line ends, midpoints and along straight lines (Snapping menu: Marks / Drawing)",
    stage: 'beta',
  }),
  'box-drag-move': Object.freeze({
    label: 'Drag inside a picked mark to move it',
    stage: 'beta',
  }),
  // Drawboard file model (2026-11-10, drawboard-trial/file-model.md): keep a
  // document on this device so it opens with no signal; marks sync later.
  'offline-docs': Object.freeze({
    label: 'Available offline: keep a document on this device so it opens with no signal',
    stage: 'beta',
  }),
  // Open a PDF with no account; it stays on this device until saved to an
  // account (Drawboard's "Temporary" files, without their two-tab data loss).
  'device-files': Object.freeze({
    label: 'Open a PDF with no account (kept on this device)',
    stage: 'beta',
  }),
  'line-dashes': Object.freeze({
    label: 'Line styles: Long dash and Dash-dot as well as Solid, Dashed and Dotted',
    stage: 'beta',
  }),
  'eraser-look': Object.freeze({
    label: "Eraser look: Drawboard's cross-and-eraser cursor, a trail where it moves, hit marks lit orange until release, and icon mode buttons",
    stage: 'beta',
  }),
  'properties-panel': Object.freeze({
    label: "Properties panel: Drawboard's Expand menu, a card with typed X Y W H R, stroke, border and fill for the picked marks",
    stage: 'beta',
  }),
  'text-fit-height': Object.freeze({
    label: 'Text box height fits its words both ways: widening a text box from its side brings its height back down',
    stage: 'beta',
  }),
  'poly-click-starts': Object.freeze({
    label: 'Polygon and Polyline: with a mark picked, the first click drops the pick and places the first point',
    stage: 'beta',
  }),
  'stamp-tool': Object.freeze({
    label: "Stamp tool: Drawboard's twelve preset stamps in a Stamp card; pick one, then click the page to drop it",
    stage: 'beta',
  }),
  'line-endings': Object.freeze({
    label: "Line endings: Drawboard's ten heads for the start and end of a Line or Arrow, at Drawboard's sizes",
    stage: 'beta',
  }),
  'pen-types': Object.freeze({
    label: "Pen types: Drawboard's Basic (fixed), Pro (pressure or speed) and Calligraphy (direction) pens",
    stage: 'beta',
  }),
  'typing-undo': Object.freeze({
    label: 'Undo while typing steps back one word at a time, not the whole typing session',
    stage: 'beta',
  }),
  'drag-auto-scroll': Object.freeze({
    label: 'Drawing a shape, moving a mark or box selecting near the edge of the view scrolls it',
    stage: 'beta',
  }),
  'insert-image': Object.freeze({
    label: 'Image: put a picture from a file or the clipboard on the page as a mark you can move, resize and rotate',
    stage: 'beta',
  }),
  'tape-tool': Object.freeze({
    label: 'Tape: an opaque band that covers part of the page; tap it under Pan to see what is under it',
    stage: 'beta',
  }),
  'turn-scale-keys': Object.freeze({
    label: 'Keys: Ctrl / Cmd + Left / Right turn the picked mark 1° (5° with Shift), Ctrl / Cmd + Up / Down scale it',
    stage: 'beta',
  }),
  'link-tool': Object.freeze({
    label: 'Hyperlink tool (Shift+H): drag a box and link it to a page, a website or an area; "Go to" on the picked bar follows it',
    stage: 'beta',
  }),
  // Drawboard Projects' page pins: drop a Comment, Issue or Task pin on the
  // page (N; M cycles the type), with the rail's "Show pins" filter.
  'comment-pins': Object.freeze({
    label: 'Page pins (N): drop a Comment, Issue or Task pin on the page, with a Show pins filter',
    stage: 'beta',
  }),
  'measure-plus': Object.freeze({
    label: 'Measure formats: feet-inches readings, precision, custom scales and a default scale',
    stage: 'beta',
  }),
  // Drawboard PDF Pro push (2026-11-12, drawboard-trial/pdf-pro/apps-side-by-side.md).
  'page-menu-extras': Object.freeze({
    label: 'Page right-click: Move page up / down, Unlock all, Select all text',
    stage: 'beta',
  }),
  'paste-in-place-key': Object.freeze({
    label: 'Ctrl+Shift+V pastes the copied marks at their original spot',
    stage: 'beta',
  }),
  'selection-count': Object.freeze({
    label: 'Selection bar shows how many marks a multi-pick holds',
    stage: 'beta',
  }),
  'tool-style-preview': Object.freeze({
    label: 'Desktop colour popover: a live preview of what the tool will draw (colour, width, line style)',
    stage: 'beta',
  }),
  'page-templates': Object.freeze({
    label: 'Page right-click: Template page below (notebook, Cornell, grids, isometric, music papers)',
    stage: 'beta',
  }),
  'snapshot-tool': Object.freeze({
    label: 'Snapshot tool: drag an area of a page, it is copied as a picture',
    stage: 'beta',
  }),
  'signature-tool': Object.freeze({
    label: 'Signature tool: draw or type a signature, save it, click the page to sign',
    stage: 'beta',
  }),
  'text-highlight-tool': Object.freeze({
    label: 'Highlight text: the band follows the pointer as you drag over words, and letting go highlights them',
    stage: 'beta',
  }),
  'page-turn-keys': Object.freeze({
    label: 'Keys: with nothing picked, Left / Right and Shift + Up / Down turn the page',
    stage: 'beta',
  }),
  'page-spreads': Object.freeze({
    label: 'Page fit card: Single / Double / Cover page views (pages side by side, like an open book)',
    stage: 'beta',
  }),
  'phone-sign': Object.freeze({ label: 'Add signature: Phone tab (scan a QR code, sign on the phone, it lands on the Draw pad)', stage: 'beta' }),
  'group-marks': Object.freeze({
    label: 'Group / Ungroup in the mark menu: a click on any member picks the whole group',
    stage: 'beta',
  }),
  // Drawboard file model (2026-11-10, page-records-plan.md): page changes are
  // saved as a page list with the marks; the PDF is built only on the way out.
  'page-records': Object.freeze({
    label: 'Page changes never rewrite the PDF: other windows follow at once and it works offline',
    stage: 'beta',
  }),
  // Drawboard file model (2026-11-10, drive-sync-back-plan.md): open a PDF
  // from OneDrive or SharePoint and save the marked-up PDF back to it.
  'drive-sync-back': Object.freeze({
    label: 'Open PDFs from OneDrive and save the marked-up PDF back to OneDrive',
    stage: 'beta',
  }),
});

export const FLAG_OVERRIDE_PREFIX = 'survey.flag.';
export const FLAG_CACHE_KEY = 'survey.flags.server';
export const FLAGS_CHANGED_EVENT = 'survey:flags-changed';

function readEnv() {
  try {
    return import.meta.env || {};
  } catch {
    return {};
  }
}

function safeStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    // Private browsing can throw on access.
    return null;
  }
}

function read(storage, key) {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function readCache(storage) {
  try {
    const parsed = JSON.parse(read(storage, FLAG_CACHE_KEY) || 'null');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function releaseChannel(env = readEnv()) {
  return env?.VITE_RELEASE_CHANNEL === 'nightly' ? 'nightly' : 'stable';
}

function isTestBuild(env) {
  return env?.DEV === true || env?.MODE === 'e2e';
}

export function isBetaFlag(key) {
  return FEATURE_FLAGS[key]?.stage === 'beta';
}

export function isFeatureOn(key, { storage = safeStorage(), env = readEnv() } = {}) {
  const def = FEATURE_FLAGS[key];
  if (!def) return false;
  if (def.stage === 'beta' && releaseChannel(env) !== 'nightly' && !isTestBuild(env)) return false;
  let own = read(storage, FLAG_OVERRIDE_PREFIX + key);
  if (own !== '1' && own !== '0' && def.legacyKey) own = read(storage, def.legacyKey);
  if (own === '1') return true;
  if (own === '0') return false;
  if (def.stage === 'beta' && def.nightlyOn !== false && releaseChannel(env) === 'nightly') return true;
  if (def.env && env?.[def.env] === '1') return true;
  const cached = readCache(storage);
  return cached?.[key] === true;
}

// Features read their flag once at load. A browser that has never been to
// Survey has no saved answers, so without a wait a feature turned on for
// everyone stayed hidden for a new person's whole first visit (audit
// 2026-11-10). main.jsx holds the first render on this: at once when answers
// are saved (or storage cannot be read), else until the server's first answer
// or maxMs, whichever comes first.
export function waitForFirstFlags(firstAnswer, { storage = safeStorage(), maxMs = 1500, setTimer = setTimeout } = {}) {
  if (!storage || read(storage, FLAG_CACHE_KEY) !== null) return Promise.resolve();
  return Promise.race([
    Promise.resolve(firstAnswer).catch(() => {}),
    new Promise((resolve) => setTimer(resolve, maxMs)),
  ]).then(() => {});
}

// Ask the server which flags are on for whoever is signed in (or nobody) and
// save the answer for the next load. Returns true when the answer changed.
export async function refreshFeatureFlags(supabase, { storage = safeStorage() } = {}) {
  if (!supabase?.rpc) return false;
  const { data, error } = await supabase.rpc('get_my_feature_flags');
  if (error || !data || typeof data !== 'object') return false;
  const next = {};
  for (const key of Object.keys(FEATURE_FLAGS)) next[key] = data[key] === true;
  const before = JSON.stringify(readCache(storage) || {});
  const after = JSON.stringify(next);
  if (before === after) return false;
  try {
    storage?.setItem(FLAG_CACHE_KEY, after);
  } catch {
    return false;
  }
  try {
    globalThis.dispatchEvent?.(new CustomEvent(FLAGS_CHANGED_EVENT, { detail: next }));
  } catch {
    // No DOM events here (tests, workers).
  }
  return true;
}

export function normalizeTesterEmails(text) {
  const list = String(text || '')
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
  return [...new Set(list)].sort();
}
