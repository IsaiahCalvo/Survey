# Invite ?docId= resolves the invite row; revoke voids leftover invites

**This-pass (2026-08-25):** product + proof for receipts-comment bug (b).

## Change

- `src/home/documentDeepLink.js` — owned-list vs invite-row resolver;
  `already_accepted` interpretation; revoke-void filter
- `src/AppShell.jsx` — `?docId=` uses the resolver, not only the visitor list.
  DEV seed stays on a ref / window until open (StrictMode remount + dashboard
  `documents` replace)
- `src/services/documentInviteService.js` — second visitor on a reusable
  link-only invite is granted, not `already_accepted`
- `src/services/documentAnnotationService.js` — remove collaborator voids
  matching `document_invites` via `revoked_at`
- `src/DevTestRoute.jsx` — `documentDeepLinkInviteE2E` fixture (no `file.id`)

## Proof

- Node `tests/documentDeepLinkInvite.test.mjs` **7 / 7**
- Node `tests/kal438ExistingUserInvite.test.mjs` **16 / 16** (data-URL loader
  rewrites the new `documentDeepLink` import)
- Playwright `e2e-invite-deeplink-resolve.spec.mjs` **2 / 2 (6.0s)** on reused
  Vite `http://127.0.0.1:5173`
- Intended: empty visitor list + invite seed opens the editor
- Break: missing invite stays on Documents
- Edge: owned-list seed still opens; hubPreview has no `docId`
- No second-account host. No cloud write. Did **not** stamp `file.id`
- Isolated **8448** still standing
