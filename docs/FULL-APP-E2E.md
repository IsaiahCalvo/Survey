# Full-app E2E harness

## Fast local gate

Run the complete deterministic gate at mobile `390x844` and desktop
`1400x900`:

```bash
npm run test:app-e2e
```

The runner starts isolated Vite servers, runs up to three independent suites in
parallel (override with `--concurrency=N`),
fails on browser problems, and writes a top-level JSON summary under
`.playwright-mcp/full-app-e2e/`.

Run one group while developing:

```bash
node agent-cli/full-app-e2e.mjs --suite=annotations --device=mobile
node agent-cli/full-app-e2e.mjs --suite=advanced --device=mobile
node agent-cli/full-app-e2e.mjs --suite=advanced-entities --device=mobile
node agent-cli/full-app-e2e.mjs --suite=viewer --device=all
node agent-cli/full-app-e2e.mjs --suite=projects --device=all
node agent-cli/full-app-e2e.mjs --suite=surveys --device=all
node agent-cli/full-app-e2e.mjs --suite=hub --device=all
node agent-cli/full-app-e2e.mjs --suite=stability --device=mobile
node agent-cli/full-app-e2e.mjs --suite=contracts --device=all
```

List every suite and its exact proof contract:

```bash
node agent-cli/full-app-e2e.mjs --list-suites
```

`FAST` suites use development-only fixture routes and exact browser storage
assertions. They do not claim Supabase durability.

## What the fast gate proves

- Mobile annotation lifecycle for pen, highlighter, line, arrow, rectangle,
  ellipse, text, callout, counter, Survey Marker, Space, and Region.
- Eraser partial mid-drag, whole-object erase, and Undo.
- Resize, rotation, Undo/Redo, and reload persistence for the standard
  annotation set; callout textbox, knee, and arrow-tip transforms.
- Cold mobile viewer open must reach a painted first PDF page and mounted
  annotation layer within 15 seconds. Override only for measured slow CI with
  `--viewer-ready-budget-ms`; the exact duration and budget are in the artifact.
- Survey Marker and Region resize, rotation, Undo/Redo, and exact reload
  persistence are now part of the default fast gate.
- Mobile and desktop PDF text search, result/page navigation, zoom/fit,
  clickable links, form typing/checking, back/reopen, and hard-reload persistence.
- Mobile and desktop project creation, optional/selected PDF upload, project
  and document rename, open/return, delete cascade model, and hard reload.
- Template, module, category, and checklist CRUD; saved-template reload;
  created survey open; mobile Survey Marker lifecycle; template cleanup.
- Mobile and desktop tabs, search, sorting, selection/bulk state, empty and
  loading states, long lists, exact-tab return, browser back/forward, refresh.
- A 60-document mobile idle/scroll/open stress run that bounds rendered PDF
  thumbnails and fails on a page crash, uncaught error, or dead viewer canvas.
- Signed-out account chrome, sign-in routing, credential autofill, auth
  recovery, account-lease enforcement, pinch-anchor/release, zoom-out safety,
  and two-axis pan-momentum contracts.
- Yellow/red sync-status explanation and retry-affordance contracts. Real
  cloud recovery remains part of the leased durable lane, not a mock claim.

Each suite records input type, viewport, lifecycle, exact persistence
assertions, browser diagnostics, timings, and screenshots in its JSON artifact.

## Native iOS gesture lane

Browser events do not certify a real two-finger pinch. Run the optional native
lane to drive the installed Simulator app with XCUITest and retain screenshots
plus `.xcresult` evidence:

```bash
node agent-cli/full-app-e2e.mjs --device=mobile --native
```

Run either native regression alone:

```bash
node agent-cli/full-app-e2e.mjs --suite=native-pinch --device=mobile
node agent-cli/full-app-e2e.mjs --suite=native-zoomout --device=mobile
```

The native zoom-out lane performs three slow 800%-to-6.25% contractions and
fails if the WebView session terminates or the compositor scale escapes its
safe bound. Native lanes need Xcode and an available iOS Simulator; they do not
need a real account.

## Durable real-account lane

Real Supabase/storage proof must use an exact coordinator-owned account lease:

```bash
SUPABASE_SERVICE_ROLE_KEY='<local secret>' \
node scripts/test-account-lease.mjs run \
  --task '<task-id>' \
  --lease-token '<lease-token>' \
  -- npm run test:app-e2e:durable -- \
    --owner-account='owner@example.test|<OWNER_USER_ID>' \
    --invitee-account='invitee@example.test|<INVITEE_USER_ID>'
```

The durable lane verifies the leased identity before navigation, creates exact
throwaway rows, uploads two fixture PDFs, reloads, renames, opens the viewer,
and fail-closes unless every database row and storage object is deleted and
absent after reload. It also reads the owner's paid/active entitlement from the
signed-in backend response (never the lease baseline), creates and accepts a
real project invite in the second leased account, proves Viewer writes fail,
promotes the recipient to Editor, proves an Editor rename survives hard reload,
revokes a second invite, removes the collaborator, and proves the exact invite
and collaborator rows are gone after the project cascade. The coordinator must
attest exact account restoration and release the lease after the run.

The 2026-08-02 run found a production last-owner trigger that blocks a document
FK delete cascade. The local migration
`20260802010000_allow_last_owner_document_cascade.sql` fixes the trigger while
preserving direct last-owner protection. Durable cleanup was completed manually
against exact recorded IDs and paths. The full durable lane must be rerun after
that migration is deployed.

## Honest external limits

- Browser gesture contracts do not claim native pinch proof; only the optional
  XCUITest lanes set `nativeGestureCertificationIncluded: true` in the summary.
- Collaboration requires the leased owner to have an active Pro, Enterprise,
  or Developer entitlement in the real backend. The durable harness fails
  closed if the signed-in app reports anything else.
- CAPTCHA signup, billing portal, Microsoft/Google tenants, live collaboration,
  offline reconnect, and TestFlight distribution require dedicated external
  accounts or platform configuration. Never substitute a mock result.

Phone and Simulator setup is in [MOBILE-RUN.md](./MOBILE-RUN.md).
