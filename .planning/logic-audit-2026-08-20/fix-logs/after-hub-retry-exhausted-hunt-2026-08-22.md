# Hunt after Hub load-error Try again — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Does **not** re-claim unblocked GAP = 0.

Last slice live-proved Hub **Try again** (`HubLoadError` / `retryLoad`). This pass independently hunted remaining reachable chrome vs E2E-STATUS / FEATURE-MATRIX / E2E-UNLISTED + live `/?hubPreview=1` every tab + `?testPdf=clickable-link-test.pdf` + unused query seams. Did **not** copy the prior hunt receipt as truth. Did **not** replay Hub Try again as the leftover.

## Hunt (what was actually opened / clicked)

Playwright **2 / 2 (9.5s)** on reused Vite `http://localhost:5173`.

- `debug/scenarios/e2e-after-hub-retry-independent-hunt.spec.mjs`
- `debug/scenarios/e2e-after-hub-retry-hunt-seams.spec.mjs`

| Surface | Opened / clicked | Class |
|---|---|---|
| `/?hubPreview=1` every tab | Documents / Projects / Templates / Archive buttons + More / Select / Upload / Team / New project / New template / Search / ⌘K counts | Families already dedicated-sliced. Try again **0** on the seed. Not replayed as filler. |
| Documents More (SE-011) | Preview & details / Rename / Copy / Paste / Delete / Share / Lock document | Already dedicated: extras, catalog-completeness, Share Access, Lock persist. No extra More item. |
| Documents Preview SE-011 | Team label **1**; Team buttons **0**; Collaborators **0**; Recent activity **0**; Last edited **1**; Uploaded **1**; Open file / Share / Close preview | Preview Team + dates are **display-only**. Collaborators / Recent activity are comment-only — not compiled. Open file / Share already dedicated. |
| Documents Search | `zzzz-no-such-document` → `No documents match your search.` **2**; owner **0**; clear restores SE-011 | catalog-completeness Search. Not a new leftover. |
| Hub `⌘K` / Meta+K | Visible kbd **2** per tab. Meta+K leaves Search focused; Keyboard shortcuts **0** | Decorative hint. No live shortcut. |
| `empty=1` Documents | `No documents yet`; Upload PDF click → `[hub preview] upload`; file input **0**; Try again **0** | EmptyState Upload leftover-18 UL-03. |
| `empty=1` Projects | `No projects yet`; New project click → `[hub preview] new project`; Create project dialog **0** | Stub unless `workflowE2E`. Catalog already proved the workflow modal. Not invented. |
| `empty=1` Templates | `No templates yet`; New template click mints `Template N` (**2**) and still logs `[hub preview] new template` | U-03 `createTemplate` local mint (already dedicated). Hub callback is observer-only. |
| `empty=1` Archive | `Nothing in Archive`; Go to documents click lands `No documents yet` **2**; archive empty **0** | catalog-completeness Archive empty chrome. Not a new leftover. |
| `guest=1` AuthModal | Welcome back; Continue without an account **1**; Create an account → signup title + Create account; Forgot password → Send reset link; SSO → Company domain. Google **1** not clicked | leftover-18 A-01 / A-02. Continue without already A-01. |
| `hubError=documents\|projects\|templates` | Alert + Try again **1**; seed **0**. **Not clicked** | Already dedicated this campaign. Inventoried only. |
| `hubError=archive` | Alert **0**; Try again **0**; Site plan **2** | Archive ignores `hubError`. No unique control. |
| `hubLoading=documents\|projects\|templates` | Skeletons 69 / 95 / 80; disabled Select **1**; Try again **0**; seed **0** | Display-only loading chrome. Disabled Select is not a control. |
| `longDocs=1` | **18** unique ids; pagination **0**; page-number chrome **0**; More **18**; Select **1** | Same Documents extras / Select chrome, more rows. `contentVisibility` only. |
| `mobileState=detail` Projects @ 390 | Search files **1**; Manage team **1**; Open **0**; Back **0**; Tower **3** | Projects file Search + Team write already dedicated. Starting state, not new chrome. |
| `mobileState=detail` Templates @ 390 | Title **2**; New category **1**; Edit color **0**; Security Walk-Through **1** | Templates family already dedicated. |
| `workflowE2E=1` Projects | Hidden upload input **1**; New project opens Create project **1**; Escape | catalog-completeness workflow create. Not invented as this leftover. |
| Account menu | Settings / Sign out | A-04 already dedicated. |
| Settings tabs | General / Connected / Subscription. No Theme / Appearance / Notifications. | General / Usage already dedicated. |
| Connected services | Connect **2**; Disconnect **0** | leftover-18 A-02 / UL-21 / UL-22. Connect **not** clicked. |
| Subscription | Start trial **1**; Usage **1**; Monthly/Annual **0**; Manage **1** | leftover-18 A-05 / UL-20. Start trial **not** clicked. |
| `?spike=features` | survey-hub **0**; Draw **0**; body empty | Throwaway DEV FeatureSpike. Not product chrome. |
| `?testPdf=` editor rest | Close tab / Export / Undo/Redo / Draw / Shapes / Text / Pages / Search / Bookmarks / Spaces / History / Survey / Fit / zoom. Font **0**. More **0**. Print / stamp / measure **0**. `?` opens Keyboard shortcuts **1** | Families already proven. Print/stamp/measure compile-hidden. |
| 390 Documents | Open navigation; account Archive / Settings / Sign out; mobile sort File / Project / Last edited / Size; Select Delete / Share / Duplicate / All | Archive-in-menu is A-04 nav. Mobile sort is extras `onHeaderClick`. Select chrome already classified. |

## Other chrome in the inventory (not a new leftover)

| Candidate | Class | Why |
|---|---|---|
| leftover-18 (`X-01`, `X-05` persist, `X-06` writeback, `U-04`, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`) | **Parked** | Host / captcha / Stripe / MSAL / second account. Do not invent `.env.local`. |
| Upload | **leftover-18 UL-03** | HubPreview `console.log('[hub preview] upload')` unless `workflowE2E`. Native chooser parked. Clicked empty Upload PDF; no `<input type=file>`. |
| Empty New project (no workflowE2E) | **Stub** | `console.log('[hub preview] new project')`. Modal only on `workflowE2E` (already catalog). |
| Empty New template | **Already proven** | TemplatesEditor `createTemplate` mints `Template N` locally. U-03 / hub-templates leftovers. |
| Archive Go to documents | **Already proven** | catalog-completeness empty chrome. |
| Preview Team / Last edited / Uploaded | **Display-only** | Owner avatar + dates. No control. |
| Collaborators / Recent activity | **Not compiled** | Comment in DocumentsLedger only. Count **0**. |
| ⌘K | **Display-only** | Search kbd hint. No `keydown` handler. |
| hubLoading skeletons / disabled Select | **Display-only** | `tabIndex={-1}` `disabled`. No Try again. |
| `longDocs=1` | **Same chrome** | 18 rows; no pagination / Load more. |
| `mobileState=detail` | **Already proven** | Initial open of Projects drill / Templates editor. |
| `hubError=archive` | **No-op** | Archive has no HubLoadError path. |
| Hub Try again | **Already dedicated** | Inventoried on `hubError=*`. Not clicked as this leftover. |
| Connect / Start trial / Google / Create account / Send reset | **leftover-18** | Not submitted. |
| Print / stamp / measure / Group / Extract / Note-Link / Forms | **Compile-hidden** | Flags / `false &&` / omitted. |
| Templates category Move/Copy / Copy-to-Spaces / checklist Y/N/N-A | **Stub / parked** | Not invented. |
| `?spike=features` | **Throwaway** | DEV FeatureSpike. Not a user-facing leftover. |

## What is claimed

This hunt found **no** unique unblocked leftover that is not leftover-18, not compile-hidden / stub, and not already a dedicated slice.

This hunt does **not** say unique unblocked GAP = 0. Leftover-18 still blocks `/goal` complete. Goal stays open.
