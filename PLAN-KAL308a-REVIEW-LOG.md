# Plan Review Log: KAL-308a — move Row-ID signing secret server-side

Started 2026-06-24. MAX_ROUNDS=3. PLAN_FILE=PLAN-KAL308a.md. Builder=Claude, adversarial critic=Codex (read-only).
Note: PLAN-KAL308a.md already survived one adversarial pass (workflow kal308a-understand critic); this design (Model B) is the REVISION that resolves that pass's S3/A1/A2/C2 findings. Codex here stress-tests the Model B posture + migration.

Codex thread: 019efbc0-b32b-7163-9f16-eddfd7ebe971

## Round 1 — Codex (VERDICT: REVISE)

Model B validated: "No concrete auth bypass from vending secret to current editor/owner; stolen secret alone still fails actor-role." Findings:
- BLOCKING: localStorage signing fallback creates registered workbooks the Edge can't verify. Fix: Supabase-backed export uses server secret or BLANK, never localStorage.
- BLOCKING: KAL-308 needs a stored canonical signing-id; token signs composite (PDFViewer.jsx:12231). Fix: store exact signing doc id; Edge verifies against stored value, not parsed token value.
- HIGH: export secret call is sync (PDFViewer.jsx:12236); must explicitly await server secret before token generation.
- HIGH: get-or-create RPC race; use atomic INSERT ON CONFLICT RETURNING; concurrency test.
- HIGH: import resolves tokens in parallel (rowImportMatcher.js:62); memoize in-flight secret promise per doc/key to avoid RPC storm.
- HIGH: legacy too soft; active registration + localStorage-only Row-IDs must hard-block server sync (forced re-export/re-link preflight).
- MEDIUM: RLS lacks explicit posture/tests; revoke direct access, no SELECT policies, test editor-direct-SELECT empty + viewer-RPC-denied.
- MEDIUM: local-only/no-UUID path has no actor-role wall / Edge verification; state it stays client-only/offline; secured sync requires a UUID.

### Claude's response (round 1 → revision)

Accepted all 8. Model B confirmed acceptable by Codex. Changes in PLAN-KAL308a.md:
- Registered export = server secret or BLANK, never localStorage signing (blocking #1).
- Added `signing_doc_id` column FROZEN at first mint; RPC returns it; client signs/verifies over the returned stored value; Edge checks token.documentId against it (blocking #2) — this ALSO resolves the rename→foreign instability for free.
- Export explicitly awaits the server secret before token gen (#3).
- RPC = atomic INSERT ... ON CONFLICT DO UPDATE ... RETURNING + concurrency test (#4).
- Resolver memoizes the in-flight promise per (doc,key) → one RPC under parallel matcher resolution (#5).
- Legacy upgraded to a REQUIRED hard preflight: active registration + no server key → block + forced re-export (`kal308a_has_server_key`) (#6).
- Explicit RLS: REVOKE all client access, no SELECT policies, + tests (editor-direct-SELECT empty, viewer-RPC-denied) (#7).
- Local-only/no-UUID docs explicitly client-only/offline; secured sync requires a UUID (#8).

No rejections. Re-submitting for round 2.

## Round 2 — Codex (VERDICT: APPROVED)

No plan blockers. Model B still acceptable (identity-binding; actor role is the auth wall). Build notes:
- Import must pre-resolve {secret, signingDocId} before buildScopeImportPlans; classifyRowIdToken checks documentId before resolveSecret (rowIdToken.js:197) — pass frozen signingDocId, not the current composite, else frozen-id tokens classify foreign.
- Gate kal308a_has_server_key (editor/owner) too; else it leaks key existence by UUID.
- RLS test should accept "permission denied" OR empty (REVOKE ALL may raise, not return empty).
- Legacy localStorage import fallback must never be used by Edge/server-sync path.

### Claude's response
All 4 folded into PLAN-KAL308a.md "Build notes". CONVERGED after 2 rounds.

## RESULT: APPROVED (2 rounds). Implementing now.
