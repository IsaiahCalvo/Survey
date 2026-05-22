# Area 1 — App startup + build · **PASS**

- `npm install` 1017 packages, postinstall bootstrap-dev-env clean (logs/npm-install.log)
- `npm run build` PASS — vite build 28.79s, 14.88MB index chunk (pre-existing, not introduced by audit). Logs/build.log
- `npm test` — node:test 680 tests / 6 skipped. Pre-audit baseline: 673 pass / 1 fail (stale regex in tests/annotationInitialHydrationSource.test.mjs:14). After regex fix: 674 pass / 0 fail.
- Console errors during normal flow: only Syncfusion storage 400s for the hand-crafted RLS-probe doc whose `file_path` doesn't exist in storage (test artifact, not product bug). Real user uploads write the file before constructing the URL.
