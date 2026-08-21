# Feature matrix — exhaustive E2E surface

Written: 2026-08-20 · Wave 1 foundation
Derived from the live app (`src/AppShell.jsx`, `src/mobile/MobilePdfViewerChrome.jsx`, `src/components/CompactColorPicker.jsx`, `src/viewerShared.js`, `src/components/Callout/types.js`, `README.md`, `docs/ARCHITECTURE.md`) plus graphify query on user-facing export/save/picker nodes. **Not a copy of the audit.**

Every row is a user-facing feature that must be E2E-tested: intended use, adversarial/break, and named edge cases. Discrete values listed in this file **must all be exercised** (every swatch, every font, every arrowhead, every form tool).

---

## Shared discrete values (exercise on every feature that exposes them)

### Color picker (`CompactColorPicker`)

Preset swatches (16, including first-cell specials):

`transparent`, `#FF0000`, `#FF0080`, `#FF00FF`, `#8000FF`, `#0000FF`, `#0080FF`, `#00FFFF`, `#00FF80`, `#00FF00`, `#80FF00`, `#FFFF00`, `#FF8000`, `#FFFFFF`, `#808080`, `#000000`

Plus:

- First-cell modes: `transparent` **and** `{ kind: 'match' }` (“Match Fill”)
- HSV spectrum: corners + mid (H=0/120/240, S=0/100, V=0/100)
- Opacity slider: `0`, `1`, `50`, `99`, `100` (and `minOpacity` floors where the picker sets one)
- Hex field: valid `#RRGGBB` / `#rrggbb`; reject `zzzzzz`, `#fff`, empty, `rgb(1,2,3)`, `#GG0000`
- Surfaces that host a picker: stroke, fill, border, font color, counter color, pin/survey color (every host)

### Fonts and type

Families (single names only — never a CSS stack): `Arial`, `Helvetica`, `Times New Roman`, `Courier New`, `Georgia`, `Verdana`

Sizes: `8 9 10 11 12 14 16 18 20 24 28 32 36 40 48 56 64 72` plus a non-preset custom size (must appear prepended)

Format toggles (on/off, combinations): **Bold**, **Italic**, **Underline**, **Strikethrough** — all 16 boolean combos on text **and** callout

Alignment if exposed: left / center / right

### Stroke / size

- Stroke width: `1` … `50` (presets from `ANNOTATION_SIZE_PRESETS.width` plus min, max, mid, and a typed custom)
- Eraser size: `1` … `100`
- Counter size: `COUNTER_SIZE_MIN` … `COUNTER_SIZE_MAX` (presets `ANNOTATION_SIZE_PRESETS.counter`)
- Line styles: `solid`, `dashed`, `dotted`; rectangles also `cloud` + intensity control
- Arrowheads (6): `none`, `solidTriangle`, `vShape`, `openCircle`, `openTriangle`, `horizontalLine` — on **arrow** and **callout**

### Zoom / view

Modes: Fit width, Fit page, Actual size (100%), Manual. Shortcuts `0` / `1` / `2` must match the dropdown (not degrade to Manual). Pinch, trackpad, toolbar +/-, typed percent. Mid-gesture zoom must auto-commit via `zoomGeneration` (do not break that signal).

### Transforms (every drawable)

Move, resize (all handles), rotate (handle + rotation field + arrow-key nudge), undo/redo of each, save/reload, export, print. Multi-select of mixed types including at least one line/arrow.

---

## 1. Navigation tools

| Feature | Intended | Break / adversarial | Edges |
|---|---|---|---|
| Pan | Drag canvas; scroll still works | Pan while a creation tool is mid-stroke; pan during zoom | Continuous vs (if ever) single-page; trackpad vs mouse; touch |
| Select | Click selects; drag moves; handles resize/rotate; Delete removes | Click through stacked objects (topmost); select after undo; select after remote delete | Empty page; locked import; multi-page |
| Text-select | Select native PDF text; highlight/underline/strike/squiggly from it | Select across columns/rotated text; empty selection | Imported text markup locks |

## 2. Draw tools

| Feature | Intended | Break | Edges |
|---|---|---|---|
| Pen | Freehand stroke commits; color/width; undo; save/export/print | Switch tool mid-stroke (P1-21); zoom mid-stroke; 1px tap-dot | Every color + width 1 and 50; overlap other ink |
| Highlighter | Semi-transparent stroke over content | Same as pen; erase only highlighter vs all ink | Blend over dark/light page |
| Text highlight | Markup on PDF text | Empty/garbled text layer; rotate page then highlight | All 4 native markup types |
| Eraser partial (default) | Pixel-carve **ink only**; skip shapes/text/stamps | Erase over a stack; erase collaborator ink; erase imported /Ink vs /Square | Zoom mid-erase; locked; permission modal (P1-22) |
| Eraser entire | Whole-delete **topmost permitted** hit per sample | Locked top object must not shield; markers/callouts outrank `objects[]` | Imported appearance composites delete as one unit |

## 3. Shape tools

| Feature | Intended | Break | Edges |
|---|---|---|---|
| Rectangle | Draw, fill, border, dash, **cloud + intensity** | Resize then print (P1-04); export cloud (P1-03); concurrent delete mid-resize (P1-06) | Every swatch × solid/dashed/dotted/cloud; 0-area click |
| Ellipse / circle | Draw oval; restyle; legacy `type:'circle'` must restyle (P1-27) | Same resize/print; toolbar no-op on `circle` | Perfect circle vs oval; scaleX/scaleY ≠ 1 |
| Line | Two-point line; no arrowhead by default; dash styles | Export/print position (P1-01); group rotate (P1-05) | Horizontal, vertical, tiny (<3pt should not commit), 45° |
| Arrow | Same as line + every arrowhead style | Export drops heads (P1-02); print flatten style | All 6 heads × all colors; endpoint edit after import |
| Counter | Place numbered pin; series across pages; delete renumbers and **persists** (P1-14) | Delete #2 of a 3-page series; reload; teammate edit | Size min/max; every counter color; undo |

## 4. Review tools

| Feature | Intended | Break | Edges |
|---|---|---|---|
| Text box | Create, type, every font/size/format/color, resize, rotate | Blank existing → delete not ghost (P1-28); stale-index commit (P1-07); font opacity slider (P1-37) | Empty create; max length; paste rich text; IME |
| Callout | Leader + box; all arrowheads; all line styles; edit text | Text commit clobbers teammate geometry (P1-15); no kb clipboard (P1-34); Shift+marquee (P1-29) | Knee drag; repeat paste offset on A0 vs Letter (P1-35) |

## 5. Form tools

Exercise **every** `FORM_TOOL_IDS` entry (textbox and siblings shown in the Forms category). For each: place, select, properties panel, type/check, tab order, save, export, re-open, print. Break: overlapping fields, required empty, rename collision.

## 6. Select / clipboard / z-order

| Feature | Intended | Break | Edges |
|---|---|---|---|
| Move / resize / rotate | Geometry persists; export/print match screen | Stale index (P1-06); line group-rotate (P1-05); SHX lock (P1-31) | Zoom mid-drag; undo; multi-select mixed types |
| Bring to front / back / forward / backward | Survives next edit, reload, collaborator | KB-2; context-menu stale index (P1-33) | Multi-select reorder; paste lands on top |
| Copy / cut / paste | Single, multi, callouts (keyboard **and** context menu) | P1-34; Cmd+Shift+D must not dump files (P1-20) | Cross-page paste; repeat-paste offset (P1-35) |
| Duplicate | If implemented, one copy on top; if not, overlay must not claim a shortcut that downloads files | P1-20 | — |

## 7. Undo / redo

Sequences to run on **every** tool above:

1. Create → undo → redo
2. Edit → teammate edit same object → undo (P1-11)
3. Callout/marker/space/highlight action → new shape → redo (P1-09)
4. Import PDF with markups → first draw → undo (P1-13)
5. Excel auto-sync → undo through the checkpoint (P1-12)
6. Rotation-field hold (P1-32) → one undo step, not 30
7. Selection after undo points at the same id (P1-08)

## 8. Pages

Reorder, delete, rotate, duplicate, cut/copy/paste page, rename, mirror, reset. Filtered Space reorder must not move hidden pages (P1-43). Clipboard remaps (P1-18). Concurrent page ops conflict (P1-19). Thumbnails cache (P1-42). Search invalidates after mutate (P1-49).

## 9. Bookmarks / spaces / search

- Bookmarks: add (must land at max+1, P1-44), rename (reject duplicate reverts, P1-48), drag reorder (P1-47), delete group (count + undo, P1-45), two windows (P1-46)
- Spaces: create, assign pages, activate empty (P1-51), concurrent rename vs assign (P1-50), delete region while teammate draws (P1-52)
- Search: find, next/prev, highlight, then reorder/rotate and confirm hits follow

## 10. Survey markers + Excel / OneDrive

- Markers visible on reopen without selecting a module (P1-16)
- Move/resize permission fail-closed (P1-24)
- Live Sync connect once (P2-20); copy does not promise two-way push (P2-19)
- Manual Sync to Excel: success only if writes succeeded (P2-09)
- Duplicate-row create on SharePoint-tier (P2-10); create-op whitelist (P2-21)
- OneDrive save: any name collision warns (P2-04); picker refreshes token (P2-22)

## 11. Save / export / print / import

For **every annotation type × every discrete style value**:

1. On-screen matches
2. Save (cloud) → reload
3. Export PDF → open in a reader **and** re-import
4. Print flatten → on-page, correct size/position/heads/clouds
5. Hostile geometry (`NaN`, `Infinity`) is skipped, not written (P2-37)

Line/arrow fixtures **must** include real `left`/`top`/`width`/`height` (P1-01).

## 12. Collaboration / presence / offline

- Two users: insert/delete during the other’s drag/edit (P1-06, P1-07, P1-15)
- Presence heartbeat so idle readers stay in “N viewing” (P2-17)
- Restore? toast on remote delete of your selection (P1-30 / P2-16)
- Access-removed banner survives login-expiry (P2-12)
- Re-sign-in with a **different** account is blocked or remounts (P2-18)
- Offline queue: either works end-to-end or is removed (P2-02) — do not test a starved subsystem as if live

## 13. Auth / account / sharing / roles / billing

| Feature | Intended | Break | Edges |
|---|---|---|---|
| Email sign-in / sign-up | Captcha, session, guest | Wrong password; expired session mid-doc | Invite bounce (P2-33) |
| Google | Sign-in; **Connect** must `linkIdentity` (P2-08) | Connect with a different Google account | Google-only change-password (P2-32) |
| Microsoft | Web + desktop + mobile each complete | Mobile dead-end (P2-13); desktop/web clobber (P2-14); stale-tab wipe (P2-24); account switch (P2-25); network blip (P2-26) | Electron double-launch (P2-36) |
| Sharing | Tier-enforced server-side (P2-01); revoke removes access (P2-05) | Devtools invite on free; email-fail pending+active | Template sharing too |
| Roles | Viewers cannot Manage Team (P2-06); promoted owners get Manage Access (P2-07); last-owner race (P2-23) | Concurrent demote | Viewer-only look |
| Account delete | Warn + transfer if collaborators (P2-03) before enabling button (P2-15); staged errors (P2-30) | Direct API call today | Profile name vs password partial save (P2-31) |
| Billing | Checkout, portal, trial **once** (P2-28); emails return to app not google.com (P2-27); webhook idempotent (P2-29); `?billing=success` toasted (P2-38) | Replay webhook; cancel+resubscribe | Failed card |

## 14. Desktop / mobile chrome

- Electron quit waits for real save completion, not a blind 5s (P2-11); single-instance lock (P2-36)
- Mobile sheets: dismiss/reopen, tap-outside animation, `touchcancel` (P2-35)
- Shortcuts overlay: every listed shortcut either works or is removed (P2-34)
- Sync pill: healthy save shows Saving… not Offline (P1-53)

---

## E2E execution notes

- Dev no-auth: `http://localhost:5173/?testPdf=<fixture.pdf>` for drawing/export without CAPTCHA.
- Real-auth / sharing / billing: lease accounts via `scripts/test-account-lease.mjs` — never mint accounts in a worker.
- High-risk files: container-aware canvas sizing, SVG viewBox zoom, `zoomGeneration`, single-name `fontFamily`, CORS `*` stay untouched.
- After any high-risk edit: `npm test` or `node scripts/run-node-tests.mjs` and record baseline in `FIX-LOG.md`.
