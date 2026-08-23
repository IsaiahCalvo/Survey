# Align `counterControlsContract` to live Start mount — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.  
Does **not** claim leftover-18 GAP = 0.

Last worker (`2b6ed288` remapped-page resize) reported official `npm test` fail-stopped on standing `counterControlsContract` (`disabled={startLocked}` vs live `locked={startLocked}`). That was drift from mounting shared `CounterStartNumberField` on 390 (`c3e4a7c1` / `03f5f2b4`). Distinct from leftover-18 / X-01 / 390 Start / series Delete E2E. Did **not** invent Start behavior. Did **not** replay those E2Es. Did **not** loosen 8448 / 75/250.

## X-01 glance (names only)

| Check | Result |
|---|---|
| Process `VITE_DEV_AUTO_LOGIN_EMAIL` / `PASSWORD` / `SUPABASE_SERVICE_ROLE_KEY` | **absent** |
| `.env.local` those three names | **PRESENT** (gitignored; values not printed) |
| `FILE_ID` / `VITE_DEV_AUTO_LOGIN_FILE_ID` / `LEASE_TOKEN` | **absent** |
| Coordinator lease (`scripts/test-account-lease.mjs assign`) | **none** |
| `.bot-credentials.json` | **none** |

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** cloud-write. Did **not** write another X-01 receipt.

## Product

No product change. Live mount is already:

- `AppShell.jsx` / `MobilePdfViewerChrome.jsx`: `locked={startLocked}` when `selectedCounterSeriesSize !== 1`
- `CounterStartNumberField.jsx`: `disabled={locked}` + `aria-label="Counter start number"`

The pre-extract inline AppShell input used `disabled={startLocked}`. After extract, that prop lives on the shared field as `locked`. Not a product typo.

## Contract

`tests/counterControlsContract.test.mjs` now asserts the live mount (`locked={startLocked}`) and that the shared field maps `locked` → native `disabled`. Viewer series-start publish + one-pin gate unchanged.

Focused Node `counterControlsContract` **4 / 4** + `counterSizeStartNumber` **3 / 3** + leftover18 **12 / 12** (**19 / 19**). Official `npm test` is sequential and too heavy to finish here; this contract is no longer the fail-stop. Cap **8448** / 75/250 not loosened.

CORS `*` / `zoomGeneration` / SVG viewBox zoom / container-aware canvas sizing / Fabric `fontFamily` untouched.

## Leftover-18

Still parked. X-01 still needs coordinator lease + real saved `file.id`. Goal stays OPEN.
