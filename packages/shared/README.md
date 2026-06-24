# @survey/shared

The **single source of truth** for the Survey domain *contract* — pure types and
constants shared by the desktop app (repo root, Vite/Electron) and the mobile
app (`mobile-expo-go`, Expo/React Native).

> If you are building a feature in either app, import shared shapes from here
> instead of re-declaring them. That is the whole point: the two apps must not
> drift, and the type-checker enforces it.

## What's in here

| Module | Exports |
| --- | --- |
| `surveyMarker` | `SURVEY_MARKER_TYPE`, `LEGACY_SURVEY_MARKER_TYPE`, `SURVEY_MARKER_TYPE_VALUES`, `isSurveyMarkerType()` |
| `annotationTypes` | `ANNOTATION_TYPES`, `AnnotationType`, `SUPPORTED_DB_TYPES`, `isSupportedAnnotationType()` |
| `geometry` | `Point`, `Bounds` |
| `survey` | `ChecklistSelection`, `ChecklistResponse(s)`, `SurveyMarkerCore`, `Entity`, `SurveyChecklistItem`, `SurveyCategory`, `SurveyModule`, `SurveyTemplate`, `RegionBounds`, `RegionConfig`, `SpaceConfig` |

**Rule for this package:** pure types + constants + pure functions only. **No
platform-coupled code** — no `@supabase/supabase-js`, no `fs`/DOM/`window`, no
Electron, no `fabric`. Anything impure will crash Metro/React Native at bundle
or runtime.

## How it's wired (current, pragmatic)

- Built to CommonJS in `dist/` (`npm run build` here, i.e. `tsc`).
- Resolved by both apps through a `node_modules/@survey/shared` **symlink** →
  this package. The desktop also consumes it via Vite (its CommonJS interop
  exposes the named exports). The mobile app imports it **`import type`** only,
  so it's erased at compile time and Metro never bundles it.
- `dist/` is committed for now so a fresh checkout works without a build step.

This deliberately avoids a full package-manager reinstall. Formalizing it as a
real workspace dependency (npm/pnpm `workspaces` + `pnpm install`) is a separate,
deliberate follow-up — see below.

## Adding more shared types

1. Add/port the type to a module in `src/` (copy the **real** shape from the
   source of truth — the DB schema or existing code — do not invent it).
2. `export` it from `src/index.ts`.
3. `npm run build`.
4. Have each app import it; verify `npm run build` (desktop) and
   `npx tsc --noEmit` + `npx expo export` (mobile) stay green.

## Marker: shared core done; full unification still deferred

**Done (Option C):** `SurveyMarkerCore` shares the survey-content fields that
both apps already carry identically — `moduleId`, `categoryId`, `name`,
`checklistResponses`. Each app keeps its own marker type that extends this core
with app-specific fields (mobile: `id`/coords/`notes`/`photos`/`done`; desktop:
Excel-sync / audit / persistence columns). This deliberately excludes the
fields whose shape differs (entity reference, coordinates vs bounds, note
string vs object) — touching those is the risky part. Verified: the desktop's
offline Excel-safety suites were byte-identical before and after (1,616 pass).

**Still deferred — the FULL `Marker` unification (Option A):** mobile fully
adopting the desktop's marker shape (entity id+name, bounds, note object, string
id) via adapters. The desktop's marker is entangled with the **Excel-sync
identity records** (`src/services/markerRowValues*`, `documentSurveyMarkerMapper.js`),
which match spreadsheet rows by `name`, `entityName`, `note.text`, and
`checklistResponses` — reshaping those risks corrupting the Excel roundtrip.

**Do the full unification when both are true:**
1. The mobile app reads/writes **real** marker data (connected to Supabase),
   not the current simulated data.
2. The Excel-sync design is settled.

**How:** its own scoped task — adopt the desktop shape on mobile via adapters,
and run the offline Excel-safety suites **before and after** (must stay
byte-identical) PLUS a real xlsx export→edit→import roundtrip on a credentialed
machine to prove no data is harmed.

## Also deferred (do not do casually)

- Sharing the **Supabase client / data-access layer** — it's platform-coupled;
  share it only after making it React-Native-safe.
- Relocating the desktop into `apps/desktop/` — cosmetic, breaks build/Capacitor
  paths, no benefit right now.
