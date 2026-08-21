# E2E new issues — chrome cluster

Found while automating survey / bookmarks / pages / share / account / billing / Microsoft / Excel / mobile sheets / Electron quit / collab banners. Not the annotation-canvas inventory.

## E2E-CHROME-01 — Stripe webhook has no persisted event-id idempotency

- **Severity:** medium (emails can double; subscription rows are a soft upsert)
- **Repro:** Stripe retries `checkout.session.completed` / `invoice.payment_succeeded` / `customer.subscription.trial_will_end` after the first handler wrote `user_subscriptions` but before the 200 returned.
- **Actual:** `user_subscriptions` update is repeat-safe. `sendEmail` + billing-portal session create run again.
- **Expected:** persist `event.id` (or equivalent) and skip side effects on replay.
- **Files:** `supabase/functions/stripe-webhook/index.ts`, `supabase/functions/_shared/stripeWebhookPolicy.ts`
- **Decision this wave:** extracted `shouldTreatCheckoutReplayAsNoop` for the row upsert. Did **not** add a `stripe_events` table (schema change).

## E2E-CHROME-02 — Live thumbnail / bookmark-drag / sheet-drag / Electron menus need a window

- **Severity:** coverage gap
- **Why not automated:** Node cannot prove IntersectionObserver thumbnail upgrades, dnd-kit pointer projection, Capacitor finger-follow, or Electron File/Export/Print menu clicks.
- **Rows:** V-06 (live thumbs), V-07 (live drag), P-01 (live sheet), P-03 (Open/Export/Print)
- **Status:** **closed 2026-08-20** for V-06 / V-07 / P-03 and P-01 finger-follow (Playwright 1440×900 + 390×844 proxy + unpackaged Electron). Native Capacitor webview still not run. Remaining fail is E2E-CHROME-04.

## E2E-CHROME-04 — Mobile sheet `touchcancel` leaves the sheet stranded mid-drag

- **Severity:** medium (sheet stays `translateY(Npx)` until the next open/close; hook contract is violated)
- **Status:** **closed 2026-08-20** — hosts now bind `onTouchCancel` to the same `settleDrag()` handler as `onTouchEnd`.
- **Repro:** 390×844 `?testPdf=clickable-link-test.pdf`. Open pages/search/bookmarks sheet. `touchstart` on `.mobile-pdf-sheet__handle`, slow `touchmove` to +30px (`translateY(30px)`), then `touchcancel`. Wait 350ms.
- **Actual (before):** transform stayed `translateY(30px)`; sheet did not spring back or dismiss.
- **Expected / now:** same as `touchend` — `useMobileSheetMotion` `onTouchCancel` calls `settleDrag()` so a sub-threshold cancel springs home.
- **Fix:** hook already exported `dragHandlers.onTouchCancel`. Wired at:
  - `src/PDFSidebar.jsx`
  - `src/mobile/MobilePdfViewerChrome.jsx` (text + users sheets)
  - `src/SurveySpacesRail.jsx`
- Did not edit `PDFViewer.jsx`, BookmarksPanel, PagesPanel. `requestClose` / `resetMotion` / generation-guard unchanged.
- Receipt: `fix-logs/e2e-chrome-04-touchcancel.md`.

## E2E-CHROME-03 — Live MSAL / Excel / Stripe Checkout need their host

- **Severity:** coverage gap
- **Why not automated:** Microsoft reconnect, OneDrive folder pick, Excel writeback, and Stripe Checkout are network + host-app flows.
- **Rows:** A-02, X-06, A-05
- **Status:** **closed (Vite 2026-08-21)** — intended + break + edge on 5173 `?hubPreview=1` / `?testPdf=` (`debug/scenarios/e2e-chrome-03-vite.spec.mjs`). Live MSAL / Excel workbook / Stripe Checkout leftovers stay on A-02 / X-06 / A-05.

## Fixed here (were fails, now pass)

| Was | Fix |
|---|---|
| Bookmark create skipped name-clash / page-range (rename already gated) | `prepareBookmarkCreate` + BookmarksPanel wiring |
| Trial/payment portal emails linked to `https://www.google.com` | `BILLING_PORTAL_RETURN_URL = https://surveytool.app/` |
| Second Electron instance opened a second app | `app.requestSingleInstanceLock()` + focus existing window |
