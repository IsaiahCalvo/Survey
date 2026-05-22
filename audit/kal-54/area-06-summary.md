# Area 6 — Sharing + invites + roles · **CHILD-FILED (KAL-55)**

- RLS access matrix verified clean in area 12 (owner/collaborator/unauthorized all behave correctly).
- `document_collaborators` insert via service role with `role='viewer'` worked — enterprise user immediately could SELECT the pro user's document.
- **KAL-23 (honest share modal + dashboard upload error toast) not in main** — `src/home/ShareModal.jsx` carries an explicit comment `// UI only for now. "Copy link" copies a placeholder link and "Send invite" just closes. Real link generation and email sending are wired separately.` The real wiring is on the unmerged kal-23 branch.
- Manage Access role-change UI, last-owner protection UI, accept-page valid/expired/revoked states, free-tier fallback rule — all part of the KAL-23 fix branch which never merged. Tracked under **KAL-55**.
- Tier gating verified at the badge / Templates-lock level (area 2 evidence). Free user cannot reach Templates from the sidebar.
