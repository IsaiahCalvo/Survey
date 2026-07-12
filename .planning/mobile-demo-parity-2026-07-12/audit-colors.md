# ACCENT COLOR AUDIT — mobile code paths (official accent: GOLD `#d8a84e` = `--accent-primary`, App.css:32; `--accent-blue` is aliased to the same gold, App.css:33)

## 1. THE OLD BLUE (demo palette — ground truth)

| Value | Defined at | Role in old demo |
|---|---|---|
| `#4A90E2` | mobile-expo-go/src/constants.tsx:21 (`blue: '#4A90E2'`) | primary blue accent (active text/icons, solid active buttons, badges) |
| `#2B6FB6` | mobile-expo-go/src/styles.ts:127,214,619,661,1467,1898,1954,2198,2401,2469,2508,3110,3263 | active-state border (13 uses) |
| `#315F91` | mobile-expo-go/src/styles.ts:960,977,2128,2743 | dock/active border variant |
| `#2F6BB8` | mobile-expo-go/src/styles.ts:1098 | active page-card border |
| `#132135` / `#162236` / `#17263a` | styles.ts (11×/3×/3×) | navy "active" tint backgrounds |
| `#2A3B54` | styles.ts (2×) | avatar background |
| `#35BEEA` / `#A7E1F4` | mobile-expo-go/src/components/format/FormatPrimitives.tsx:191-192 (`blue`/`softBlue`) | alignment-glyph illustration fills |

**Every one of these exact demo values was copied verbatim into the new app's mobile CSS/JSX** (see below). The demo itself already used gold `#D8A84E` in 3 spots (constants.tsx:23 `yellow`, styles.ts:558,593).

## 2. OFFENDING OCCURRENCES — `src/mobile/mobilePdfViewer.css` (all UI chrome, all blue leftovers)

| file:line | Value | UI element painted | Should be |
|---|---|---|---|
| src/mobile/mobilePdfViewer.css:142 | `#2b6fb6` | page pill open border (`.mobile-pdf-header__page-pill.is-open`) | `var(--accent-primary)` (or dim gold `#b6904a`) |
| src/mobile/mobilePdfViewer.css:143 | `#121b2a` | page pill open bg (navy tint) | gold-tint dark bg (e.g. `#2a2218`, hub.css:19 `--gold-bg`) |
| src/mobile/mobilePdfViewer.css:181 | `#4a90e2` | page menu active item text | `var(--accent-primary)` |
| src/mobile/mobilePdfViewer.css:182 | `#132135` | page menu active item bg | gold-tint dark bg |
| src/mobile/mobilePdfViewer.css:264 | `#4a90e2` | tool-rail button active icon (`.mobile-pdf-tools__button.is-active`) | `var(--accent-primary)` |
| src/mobile/mobilePdfViewer.css:266 | `#2b6fb6` | tool-rail button active border | dim gold |
| src/mobile/mobilePdfViewer.css:325-326 | `#4a90e2` ×2 | survey category button active bg+border (solid) | `var(--accent-primary)` |
| src/mobile/mobilePdfViewer.css:354 | `#4a90e2` | survey entity button active border | `var(--accent-primary)` |
| src/mobile/mobilePdfViewer.css:422 | `#2a3b54` | presence avatar bg (`.mobile-pdf-tools__avatar`) | gold-tint dark bg |
| src/mobile/mobilePdfViewer.css:423 | `#4a90e2` | presence avatar border | `var(--accent-primary)` |
| src/mobile/mobilePdfViewer.css:440 | `#4a90e2` | active-user count badge bg | `var(--accent-primary)` (+ dark text `#17120a` like line 495-496) |
| src/mobile/mobilePdfViewer.css:556-557 | `#4a90e2` ×2 | properties bar primary action button bg+border | `var(--accent-primary)` + dark text |
| src/mobile/mobilePdfViewer.css:577-579 | `#4a90e2` / `#132235` / `#2b6fb6` | "keep tool" toggle active text/bg/border | gold trio |
| src/mobile/mobilePdfViewer.css:584-585 | `#4a90e2` ×2 | keep-toggle checkbox active bg+border | `var(--accent-primary)` |
| src/mobile/mobilePdfViewer.css:818-819 | `#4a90e2` / `#132135` | format (B/I/…) button active text/bg | gold pair |
| src/mobile/mobilePdfViewer.css:869 | `#4a90e2` / `#132135` | properties dropdown menu active item | gold pair |
| src/mobile/mobilePdfViewer.css:874 | `#4a90e2` / `#132135` | properties edit button active | gold pair |
| src/mobile/mobilePdfViewer.css:973 | `#132135` | text-defaults sheet tab active bg (focus outline at :977 is ALREADY gold — half-migrated) | gold-tint dark bg |
| src/mobile/mobilePdfViewer.css:1104-1105 | `#122238` / `#4a90e2` | ink-swatch SELECTION ring bg+border (`.mobile-pdf-text-card__colors > button.is-active`) — selection chrome, not ink | gold pair |
| src/mobile/mobilePdfViewer.css:1174-1175 | `#132135` / `#2b6fb6` | text format B/I/U/S button active bg+border | gold pair |
| src/mobile/mobilePdfViewer.css:1224-1226 | `#4a90e2` / `#132135` / `#2b6fb6` | alignment picker button active text/bg/border | gold trio |
| src/mobile/mobilePdfViewer.css:1254 | `#132135` | fill/stroke color-tab active bg | gold-tint dark bg |
| src/mobile/mobilePdfViewer.css:1323-1325 | `#4a90e2` / `#162236` / `#315f91` | bottom dock active button text/bg/border (`.mobile-pdf-dock__side/center.is-active`) | gold trio |
| src/mobile/mobilePdfViewer.css:1461-1462 | `#2a3b54` / `#4a90e2` | users-sheet avatar bg+border | gold pair |
| src/mobile/mobilePdfViewer.css:1471 | `#4a90e2` | users-sheet role/"You" label text | `var(--accent-primary)` |
| src/mobile/mobilePdfViewer.css:1563-1564 | `#4a90e2` / `#132135` | survey template menu active item text/bg | gold pair |
| src/mobile/mobilePdfViewer.css:1637-1638 | `#4a90e2 !important` ×2 | survey sheet `.btn-active` bg+border | `var(--accent-primary)` + dark text |
| src/mobile/mobilePdfViewer.css:1862-1863 | `#1d2740 !important` / `#2f6bb8 !important` | active page thumbnail card bg+border (`.mobile-page-card.is-active`) | gold-tint bg + `var(--accent-primary)` border |

## 3. OFFENDING OCCURRENCES — `src/mobile/MobilePdfViewerChrome.jsx`

| file:line | Value | UI element | Should be |
|---|---|---|---|
| MobilePdfViewerChrome.jsx:116,118,127,129,141,148,159 | `#35BEEA` ×7 | SVG fills in text-alignment picker glyphs (`MobileTextAlignmentGlyph`) — UI chrome iconography, copied from demo FormatPrimitives.tsx:191 | gold `#d8a84e` (or neutral gray) |
| MobilePdfViewerChrome.jsx:117,128 | `#A7E1F4` ×2 | secondary SVG fill in same glyphs (demo `softBlue`, FormatPrimitives.tsx:192) | soft gold (e.g. `#e8d5a8`) or neutral |

## 4. NOT bugs (checked, classified)

- **Annotation ink (user-picked)**: `MOBILE_ANNOTATION_COLORS` incl. `#4A90E2` at MobilePdfViewerChrome.jsx:64 — mirrors demo `desktopColorPresets` (mobile-expo-go/src/constants.tsx:163); `#ff0000`/`#1e293b` swatch-fill fallbacks (MobilePdfViewerChrome.jsx:362-363,425,439,467-468,475-500,670-688; mobilePdfViewer.css:620-626) — ink defaults, leave.
- **Semantic**: sync-status colors `#2bbd7e`/`#f5a524`/`#ef4444` (src/mobile/mobilePdfViewerModel.js:4-6); page-select green `#58d976` (mobilePdfViewer.css:1873,1878,1898-1899,1936 — demo used same green ×4); hub-tab active green `#28a745` (css:1731-1732, = demo `COLORS.green`); exit-footer danger red `#f08a8a` (css:1652,1696). Fine.
- **Neutral/gray**: all `#f2f2f2/#a8b0bf/#24272d/#1b1f25/#343a45/#181c24`-family darks + white/black rgba — palette-consistent with demo neutrals. Fine.
- **Gold already correct in mobile viewer (only 3 spots)**: mobilePdfViewer.css:496 (popover initials badge), :977 (tab focus outline), MobilePdfViewerChrome.jsx:80 (`toHexColor` fallback `#d8a84e`).
- **AppShell.jsx mobile-conditional**: clean — only neutral `#20242c` rail bg (src/AppShell.jsx:2744) and `transparent` (:2884). `#1e293b` at :1634,1648 is desktop rich-text font-color fallback (ink); `#CBDCFF` at :528 is a survey entity tint (user-facing category color, semantic). No blue accents.
- **hub.css mobile block (@media max-width:720px, lines 207-2580)**: nav/tab active states correctly use `var(--gold)` (hub.css:425-427); rest is neutral inks + gold rgba tints.

## 5. REVIEW items (blue-ish but from the hub's own decorative palette, not the demo blue)

| file:line | Value | UI element | Note |
|---|---|---|---|
| src/home/hub.css:1350-1351 | `var(--blue)` + `rgba(122,183,230,0.13)` | mobile project file-row icon tint (`.projects-mobile-file-icon`) | `--blue: #7ab7e6` is hub's own decorative token (hub.css:20, part of gold/blue/green/rose/lilac set also used by AvatarStack, HubShell.jsx:67) — intentional variety palette, NOT demo `#4A90E2`; flag only if strict gold-only chrome wanted |
| src/home/HubShell.jsx:75 | `#1f4a7a` | `PdfThumb` default ribbon color (stylised document-thumbnail placeholder, mobile+desktop hub) | decorative illustration; optional swap to gold-family |

## 6. COUNT SUMMARY

- **Blue-leftover UI-chrome declarations in `src/mobile/mobilePdfViewer.css`: 46** — `#4a90e2` ×23, `#2b6fb6` ×5, `#315f91` ×1, `#2f6bb8` ×1, navy active-bgs ×14 (`#132135` ×9, `#132235`/`#122238`/`#121b2a`/`#162236`/`#1d2740` ×1 each), `#2a3b54` ×2 — spanning **28 distinct selectors/UI elements** (every `.is-active`/selected state in the mobile viewer, plus presence avatars, user badge, primary buttons).
- **Blue-leftover SVG fills in `src/mobile/MobilePdfViewerChrome.jsx`: 9** (`#35BEEA` ×7, `#A7E1F4` ×2).
- **Total hard blue leftovers in mobile viewer code: 55**, all exact copies of the old demo's blue palette (`#4A90E2` family, mobile-expo-go/src/constants.tsx:21 + styles.ts + FormatPrimitives.tsx:191-192).
- **AppShell.jsx mobile-conditional: 0. hub.css mobile block: 0 hard leftovers (+1 review). HubShell.jsx: +1 review.**
- **Gold coverage inside mobile viewer today: 3 occurrences total** — the re-skin essentially did not happen in `src/mobile/`; suggested mapping: blue text/icon/border → `var(--accent-primary)`, solid blue fills → `var(--accent-primary)` + dark text `#17120a` (pattern already at mobilePdfViewer.css:495-496), navy tint bgs → gold-tint dark (`#2a2218` per hub.css:19), darker blue borders → `--gold-soft #b6904a` (hub.css:18).