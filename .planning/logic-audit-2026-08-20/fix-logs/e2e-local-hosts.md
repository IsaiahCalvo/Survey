# E2E leftovers — local hosts (lease / Docker / Capacitor sim)

**Date:** 2026-08-21  
**Worktree:** `nifty-elion-773074`  
**Does not mark the audit goal complete.** No commit. Did not print secrets. Did not read `.bot-credentials.json` / `.env*`. Did not write the personal auto-login account. Did not apply SQL to production Survey (`cvamwtpsuvxvjdnotbeg`). Did not brew-install Docker Desktop. Did not retry Electron native pick/cancel, Stripe, MSAL/Google passwords, captcha, or account wipe.

## 1. Lease tuples (A-06 / UL-45)

**Hit:** no.

Searched 725 files (no secret values logged):

- this worktree Cursor transcripts
- sibling Survey Cursor transcripts (`…/Survey-BetaSafeS2/agent-transcripts`, `…/Desktop-Survey-BetaSafeS2/agent-transcripts`)
- Claude project `…/Survey-BetaSafeS2`
- this worktree `.planning/`

Patterns: complete `email|uuid|tier|status` and `--account '…'`. **Zero** complete existing-account tuples. Placeholders only (`bot-a@example.test|<USER_ID>|free|active`, `alpha@example.test`). Did not invent tuples.

**Assign would still stop even on a hit.** `scripts/test-account-lease.mjs` `resolveAccountBundle` looks up the requested email/userId in the credentials file and requires a password field. Official `run` therefore needs `.bot-credentials.json`. Per standing rule, that file was not read. A-06 / UL-45 two-client roster stays **host-blocked**.

## 2. Local Docker / SQL apply

**Local engine:** no. `docker` / `colima` / `podman` not on PATH. Did not install.

**`supabase start`:** stopped. CLI `2.111.0` is present. Linked remote is production Survey:

- `supabase/.temp/project-ref` = `cvamwtpsuvxvjdnotbeg`
- `supabase/.temp/linked-project.json` name `Survey`

Instruction: if start would use or push that ref, **stop**. Five leftover migrations remain unapplied (same files as `e2e-local-migrations.md`). P2-01 / P2-03 / P2-05 / P2-10 / P2-21 / P2-23 / P2-28 / P2-29 / E2E-CHROME-01 stay **proven in-tree** with **apply leftover**.

## 3. Capacitor iOS Simulator (P-01 / UL-46 / native pinch)

**Project exists:** `ios/App/App.xcodeproj`, schemes `App` / `AppNativePinch` / `CapApp-SPM`, `capacitor.config.ts` (`appId` `com.kalvoe.survey`, `ios.contentInset: 'never'`). `xcodebuildmcp` CLI used (no raw `xcodebuild`). No physical device.

**Boot:** iPhone 17 (`26ED4ECA-254E-4D88-861D-8E3FB593AF08`, iOS 26.4) via `xcodebuildmcp simulator boot`. Simulator.app opened.

**Live reload:** existing Vite on 5173 is IPv6-only (`[::1]:5173`); Simulator `127.0.0.1` cannot reach it. Started a **new** Vite on `127.0.0.1:5180` (did not kill 5173/5174). Wrote gitignored generated files only:

- `ios/App/App/capacitor.config.json` → `http://127.0.0.1:5180/?testPdf=clickable-link-test.pdf&mobileNav=tabs&nativeShell=capacitor&nativePinchE2E=1`
- `ios/App/App/config.xml` (Xcode resource; was missing)
- stub `ios/App/App/public/index.html` (fallback; live server replaced it)

Did **not** run `npx cap sync` / `npm run build`. Runtime log: `Error registering plugins: … packageClassList` (expected without a full cap sync). WebView still loaded the Vite `?testPdf=` viewer.

### Pinch (intended + edge)

| Case | Result | Proof |
|---|---|---|
| Intended — native two-contact pinch | **pass** | `xcodebuildmcp simulator test` scheme `AppNativePinch` only-testing `testTwoFingerPinchChangesPdfZoom` — **1 / 0 fail** (60.7s). `XCUIElement.pinch(withScale: 1.5)` from Fit page → manual zoom. |
| Edge — rapid pinch stress | **pass** | same scheme only-testing `testRapidPinchZoomDoesNotReloadOrLosePdf` — **1 / 0 fail** (63.0s). 8 in/out cycles; WKWebView session stable; Fit page restores. |

Native pinch leftover on E2E-W4-02 / V-04 **closed**. Deep / slow-zoom-out XCUITests not re-run this pass.

### Sheets + safe-area (P-01)

Launched `com.kalvoe.survey`. Viewer interactive-ready ~1.6s. Screenshots in `fix-logs/e2e-local-hosts-artifacts/`.

| Case | Result | Proof |
|---|---|---|
| Intended — open Pages sheet | **pass** | Tap Pages tab (201, 848). Sheet: handle, Pages/Search/Bookmarks, `1 / 1 pages`, thumbnail, + Add / Paste / Select. `02-pages-sheet-open.jpg`. |
| Break — small drag stays open | **pass** | Swipe handle 470→530 (~60px < `SHEET_DISMISS_DY` 82). Sheet remained. `03-pages-sheet-springback.jpg`. |
| Intended — dismiss | **pass** (X) / **miss** (handle swipe) | Close X at (372, 505) dismissed to the tab bar (`04-pages-sheet-closed-via-x.jpg`). Two handle swipes (430→640, 500→780) did **not** dismiss — coordinate swipe likely missed the handle hit target inside WKWebView. |
| Safe-area | **pass** | iPhone 17 Dynamic Island. Top chrome sits below the island; bottom tabs / sheet sit above the home indicator. `contentInset: 'never'` + CSS `env(safe-area-inset-*)`. `01-safe-area-viewer.jpg`. |
| UL-46 styled select / color backdrop | **not proven** | More-rail tap (28, 455) did not open a styled select. Native leftover stays on UL-46. |

AX `snapshot-ui` only saw a full-screen `TextArea` (WKWebView). XCUITests still found named surfaces (`PDF gesture surface`, `Zoom and fit options`). Coordinate taps used for sheet chrome.

No product bug filed. No `src/` edit. Invariants untouched (`zoomGeneration`, SVG viewBox, container-aware canvas, single-name fonts, CORS `*`).

## 4. What moved

| ID | Before | After |
|---|---|---|
| P-01 native Capacitor | host-blocked | **proven** (Simulator sheet open + spring-back + X close + safe-area). Handle-swipe dismiss leftover only. |
| E2E-W4-02 / V-04 native pinch | CDP proven; XCUI leftover | **proven** native two-contact + rapid-stress |
| UL-46 native styled select | host-blocked | still **host-blocked** |
| A-06 / UL-45 roster | host-blocked | still **host-blocked** (no tuple; assign needs credentials file) |
| SQL apply leftovers | host-blocked | still **host-blocked** (no local engine; prod-linked) |

E2E catalog host-blocked paths: **20 → 19**.

## Still blocked (19)

`X-01`, `X-05` cloud persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe click, `A-06` roster, `UL-03` native pick/cancel, `UL-13` profile persist, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24` inbox send, `UL-45`, `UL-46`.

SQL apply leftovers unchanged.

**Goal stays open.**
