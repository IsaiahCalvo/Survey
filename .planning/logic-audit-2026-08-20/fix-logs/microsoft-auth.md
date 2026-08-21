# Microsoft auth — logic-audit fix log

Bucket: `microsoft-auth` · Date: 2026-08-20
IDs: P2-13, P2-14, P2-24, P2-25, P2-26

Microsoft auth remains an intentional keep (MSAL config / `src/authConfig.js` untouched). Full Capacitor deep-link OAuth (`@capacitor/browser` + custom scheme / Universal Links + `appUrlOpen`) is **out of scope** this wave; P2-13 uses the hide-Connect stopgap.

---

### P2-13 — Microsoft sign-in on iOS/Android is a dead end
- Date: 2026-08-20
- Status: fixed (stopgap)
- Files changed: `src/utils/microsoftOAuthRouting.js`, `src/contexts/MSGraphContext.jsx`, `src/components/AccountSettings.jsx` (consumer of the hide flag)
- Intended behavior confirmed: Capacitor native (`Capacitor.isNativePlatform()` or `capacitor://` / `ionic://` origin) reports `isMicrosoftConnectAvailable === false`. `login()` throws before `window.location.href`. Account Settings hides Connect/Reconnect and shows “Not available in the iOS/Android app. Connect on web or desktop.” Web still offers full-page PKCE; Electron still uses system-browser / embedded OAuth window.
- Break / adversarial attempts: Capacitor origin still maps `microsoftRedirectUriFor` to production `/mobile` (legacy Azure fallback, unchanged for `accountNativeE2EContracts`) but PKCE never starts. Electron `microsoftSignIn` / `openOAuthWindow` still short-circuit full-page redirect. Cross-origin return URLs still throw.
- Edges covered: registered origins (prod, www, localhost:5173, `/mobile`); unknown browser origin → production; `cleanMicrosoftReturnUrl` strips only OAuth fields; capacitor/ionic hide.
- Test command + result: `node --test tests/microsoftOAuthRouting.test.mjs tests/msGraphMicrosoftAuth.test.mjs tests/msalAuthMain.test.mjs tests/microsoftAuthMainContracts.test.mjs src/services/__tests__/microsoftConnectionMarker.test.mjs tests/accountNativeE2EContracts.test.mjs tests/accountPlatformParity.test.mjs` → **53/53 pass**.
- Remaining risk: Deep-link OAuth is not implemented. Expo `?nativeShell=expo` in a browser is not Capacitor and still offers Connect (correct). Disconnect remains visible if a session was established on another surface.

---

### P2-14 — Desktop Microsoft connect clobbers web/mobile tokens
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/services/microsoftConnectionMarker.js`, `src/contexts/MSGraphContext.jsx`
- Intended behavior confirmed: `adoptMainAuthResult` read-merges the existing `connected_services` row. `buildConnectionMarkerRow` still writes a no-token marker when nothing is stored; when a web PKCE `refresh_token` already exists it is preserved next to `token_custody: main-process`. Web restore uses `hasLegacyRendererTokens` so a merged row still authenticates. A desktop-only marker (no tokens) no longer shows as a broken “Reconnect.”
- Break / adversarial attempts: empty/`null` existing tokens are not invented. Unrelated metadata keys are not copied. Classifiers: merged row is both main-custody and legacy-token.
- Edges covered: fresh marker no tokens; merge keeps access/refresh/id/expires; web restore path prefers tokens over “disconnected.”
- Test command + result: same focused suite, 53/53 pass (`desktop marker merge…`, `desktop restore merges…`).
- Remaining risk: `storeTokens` (web refresh) still replaces metadata and can drop `token_custody`; next desktop launch re-merges. Not a per-device row — both surfaces still share one `user_id,service_name` slot.

---

### P2-24 — One tab’s stale MS token failure wipes the shared connection row
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/services/microsoftConnectionMarker.js`, `src/contexts/MSGraphContext.jsx`
- Intended behavior confirmed: on hard refresh failure, the row is re-read. Wipe only if `storedRefreshToken === failedRefreshToken`. If another tab already wrote a newer refresh token, this tab adopts that row (and returns its still-fresh access token as `refresh_reason: 'adopted_remote'`) instead of nulling `metadata`.
- Break / adversarial attempts: missing stored token → no wipe (main-custody / already-cleared rows survive). Empty failed token → no wipe. Same token → wipe allowed.
- Edges covered: equal / unequal / null / empty tokens.
- Test command + result: same suite, 53/53 pass (`stale-tab wipe only clears…`, `hard token failure compare-before-wipe…`).
- Remaining risk: if the adopted remote access token is already expired, this tab returns `null` without `needsReconnect` and the next `ensureFreshToken` must retry with the new refresh token. Live two-tab browser sequence not run.

---

### P2-25 — Switching MS accounts on desktop can silently refresh as the old account
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/electron/msalAuthMain.js`
- Intended behavior confirmed: after `acquireTokenInteractive`, cached accounts other than the selected `homeAccountId` are removed. Silent refresh prefers the last interactive account, then `accounts[0]`.
- Break / adversarial attempts: missing preferred id evicts all (safe: interactive result always has an account). Unknown preferred id falls back to `accounts[0]`. Empty cache → `null`.
- Edges covered: two-account eviction + silent refresh uses `new-id`; interaction vs transient classification unchanged.
- Test command + result: same suite, 53/53 pass (`preferred-account helpers…`, `interactive sign-in evicts…`).
- Remaining risk: preferred id is in-memory only for the process lifetime; after a restart, eviction has already left a single account in the encrypted cache. No live Microsoft account-picker run this wave.

---

### P2-26 — Network blip at desktop launch treated as a broken Microsoft connection
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/electron/msalAuthMain.js`, `src/contexts/MSGraphContext.jsx`, `src/services/microsoftConnectionMarker.js` (`interpretMainProcessRestore`)
- Intended behavior confirmed: silent failure is `needsInteraction` only for InteractionRequired / `invalid_grant` / consent/login required. Network/`fetch failed`/unknown errors are `transient`. Desktop restore: adopt / reconnect / transient. Transient keeps the cached account, sets error “Microsoft temporarily unreachable”, and retries on `window` `online` — it does **not** set `needsReconnect`.
- Break / adversarial attempts: still one retry before classify. `signedIn: false` still falls through to the legacy/web row. Unknown errors fail open as transient (cannot lock the user out on a blip).
- Edges covered: InteractionRequired, invalid_grant, network_error, ENOTFOUND, unknown message.
- Test command + result: same suite, 53/53 pass (`silent token errors classify…`, `network blip on silent refresh…`, `desktop restore classifies…`).
- Remaining risk: “Microsoft temporarily unreachable” is context `error` only; no dedicated toast. Online retry is Electron-only (`microsoftGetAccessToken`). Visual confirmation of the launch-blip UX not run.

---

## Files changed

- `src/utils/microsoftOAuthRouting.js`
- `src/services/microsoftConnectionMarker.js`
- `src/electron/msalAuthMain.js`
- `src/contexts/MSGraphContext.jsx`
- `src/components/AccountSettings.jsx` (P2-13 hide consumer; not in the primary allowlist — required so Connect is actually hidden)
- `src/services/__tests__/microsoftConnectionMarker.test.mjs`
- `tests/microsoftOAuthRouting.test.mjs` (new)
- `tests/msGraphMicrosoftAuth.test.mjs` (new)
- `tests/msalAuthMain.test.mjs`
- `tests/microsoftAuthMainContracts.test.mjs`

## Tests

```
node --test \
  tests/microsoftOAuthRouting.test.mjs \
  tests/msGraphMicrosoftAuth.test.mjs \
  tests/msalAuthMain.test.mjs \
  tests/microsoftAuthMainContracts.test.mjs \
  src/services/__tests__/microsoftConnectionMarker.test.mjs \
  tests/accountNativeE2EContracts.test.mjs \
  tests/accountPlatformParity.test.mjs
```

53/53 pass.

## Remaining risk (bucket)

- Capacitor OneDrive/Excel stays unavailable until deep-link OAuth ships.
- Shared `connected_services` row is still one slot (merge, not per-device).
- No live Microsoft login / two-tab / account-switch session this wave.
