# E2E catalog completeness hunt — 2026-08-21

**Worktree:** `nifty-elion-773074`  
**Vite:** reused `http://localhost:5173` (`npm run dev:ui`, not killed; HTTP 200). Did **not** kill 5174.  
**Harness:** `debug/scenarios/e2e-catalog-completeness.spec.mjs` + `debug/playwright.reuse-5173.config.mjs`  
**Live:** **5 / 5 passed** (10.6s confirmed; reconfirm 13.7s).  
**This pass does not claim the audit goal complete.** Did not apply migrations. Did not stamp `file.id`. Did not invent captcha / Stripe / MSAL / Capacitor / second-account / wipe passes. No commit.

## Hunt method

Read `COMPLETION-AUDIT.md`, `E2E-STATUS.md`, `E2E-STATUS-CHROME.md`, `E2E-UNLISTED.md`, `FEATURE-MATRIX.md`, `E2E-NEW-ISSUES.md`, and `fix-logs/` receipts. Cross-checked those 59 + 46 rows against live hub / editor chrome (AppShell, CompactColorPicker, DocumentsLedger, ProjectsFolderTree, ArchiveScreen, SpacesPanel, KeyboardShortcutsOverlay). `graphify query` first (graph exists). Did **not** re-run the prior leftover-five (`e2e-unblocked-followup-2.spec.mjs`).

Prior leftover-five stay closed: T-04 clamp, E-02 Shift+45°, D-02 print-exclusion, C-05 counter number color, S-04 selected `arrowheadStyle`. Receipt `fix-logs/e2e-unblocked-followup-2.md`.

Stale §3 notes that “only Georgia” / “only red/blue swatches” were live are superseded by `fix-logs/e2e-adversarial-repass.md` (all 6 fonts after resize; 15-swatch spam last-wins `#000000`).

## Hard list found (uncatalogued or catalog-subset, unblocked)

| Surface | Control | Why it was unproven | Result |
|---|---|---|---|
| Hub documents | Search / rename / delete | Not a 59/46 row; hubPreview local state | **live** |
| Hub projects | Rename / delete / create | Create is a no-op unless `workflowE2E=1` | **live** |
| Hub archive | Empty chrome | Container needs `user.id` + Supabase; preview is empty | **live empty**; restore **blocked** |
| U-02 spaces | Rename + add pages | Create/delete-last already live; rename/pages were not | **live** |
| UL-33 | Dashed / Dotted | Node + live Solid/Cloud only | **live** armed create |

## Newly live-pass (each: intended + break + edge)

| ID | Intended | Break | Edge | Result |
|---|---|---|---|---|
| Hub documents | Search `Package 2` filters | `zzzz-no-such-document` → no-match copy | Rename blank Save disabled; rename + delete `test.pdf` | **held** |
| Hub projects | Rename Tower 5 → Hunt Tower | Blank blur restores name | Delete Lab Reno; regular preview New project is a no-op; `?workflowE2E=1` creates after empty-name disabled | **held** |
| Hub archive | `Nothing in Archive` + Go to documents | Restore / Delete forever absent until Select | Select actions stay disabled; no prod archive write | **held** |
| U-02 extras | Rename Space 1 → Hunt Space | Page `99` rejected / no row | Page `1` adds a region; `file.id` null; blank name kept | **held** |
| UL-33 | Armed Dashed rect stores `6,4` | Armed Dotted second rect stores `2,4`; first stays dashed | Ellipse Style has no Cloud; Rectangle offers Cloud | **held** |

## Product fix (min-diff)

**Document More menu could dismiss on the opening click.** `DocumentActionMenu` mounted `DismissBarrier` without the More trigger, so the opening pointer was “outside.” Pass `trigger={docMenu.trigger}` into `insideRefs`. Search-focus still consumes the first outside tap (harness must blur search first). Not a high-risk file.

`zoomGeneration` / SVG `viewBox` / container-aware canvas / single-name `fontFamily` / CORS `*` untouched.

## Remaining unblocked-unproven

**0.** Every catalogued unblocked control now has live proof (this receipt + prior leftover receipts). Did not invent substitute tests for already-proven leftover-five.

## Remaining host-blocked

| Leftover | Why |
|---|---|
| Five in-tree SQL migrations | Production-linked Survey (`cvamwtpsuvxvjdnotbeg`) + no local Docker. Not applied. |
| X-01 identity-churn | Needs a signed-in cloud user whose session identity changes. |
| A-06 / UL-45 two-client roster | Needs a second signed-in collab account. |
| A-01 / UL-15 captcha completion | Turnstile token + real password form. |
| UL-16 wipe | Destructive account delete. |
| A-05 / UL-20 Stripe | Start trial / Checkout not clicked. |
| A-02 / UL-21 live MSAL | Auto-login already **Connected as**. Did not Disconnect / start OAuth. |
| UL-22 Google OAuth | Live host OAuth. |
| A-03 / UL-24 email delivery | Invalid Send already fail-closed. Did not send to a real inbox. |
| P-01 / UL-46 native Capacitor | No device / XCUI. |
| U-04 cloud usage count | Needs Dashboard + Supabase. HubPreview path already closed. |
| X-06 Excel host writeback | Live sheet host. |
| X-05 form cloud persist | Needs a saved `file.id` write. |
| UL-13 profile persist | Would mutate the production profile. |
| Hub Archive restore / delete forever | `ArchiveScreenContainer` loads real Supabase archive when `user.id` is set. Preview has no id (empty chrome proven). |
| UL-03 native Electron chooser | IPC proven; native dialog canceled-stub only. |
| UL-40–43 custom print panel | `PRINT_PANEL_ENABLED=false`. Proven once with a DEV flip; flag restored. |

## Catalogs now claim full unblocked coverage?

**Yes**, with evidence: this receipt + `e2e-unblocked-followup.md` / `e2e-unblocked-followup-2.md` + `e2e-adversarial-repass.md` (6 fonts / 15 swatches). Host-blocked rows stay blocked. **Goal stays open.**

## Files

- `src/home/DocumentsLedger.jsx` — More-menu trigger inside dismiss barrier
- `debug/scenarios/e2e-catalog-completeness.spec.mjs`
- `E2E-STATUS.md` / `E2E-UNLISTED.md` / `E2E-NEW-ISSUES.md` / `COMPLETION-AUDIT.md` — leftover status only

No commit.
