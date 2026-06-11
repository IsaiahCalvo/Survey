# Excel Add-in Sync Architecture — Technical Capabilities Research

**Date:** 2026-06-11
**Scope:** P2/P3 non-SharePoint path: Dropbox / GDrive / personal-OneDrive / network / local files; sync via Office.js add-in + signed row-level change sets against Supabase backend.
**Primary question:** Is "Excel add-in + signed row-level sync" the right path for non-SharePoint users?

---

## 1. Office.js Web Add-ins

### 1.1 Platform Support

| Platform | Taskpane add-in | Notes |
|---|---|---|
| Excel desktop (Windows) | Yes | Primary target; full API support; minimum Office 2016 (build 16.x) |
| Excel desktop (Mac) | Yes | Minimum Excel 15.18 (2016); uses WebKit webview; shared runtime supported |
| Excel on the web | Yes | Full support; no install required when deployed via AppSource or Centralized Deployment |
| iPad (Excel iOS) | Yes | Sideloading supported for testing; production install via AppSource only |
| Excel Mobile (Android/iOS app) | No | Add-in taskpanes are not supported in Excel mobile native apps |

**Consumer vs. work accounts:** Office.js add-ins work with both Microsoft personal (MSA) accounts (Microsoft 365 Family/Personal) and work/school accounts (M365 Business/Enterprise). The distinction matters only for **deployment**: centralized M365 admin deployment only reaches work/school tenants. Consumer users must self-install from AppSource or via a direct install link. Enterprise IT admins can **block** AppSource marketplace access per user, which would prevent self-install for managed devices — a real friction point if your targets include workers using personal licenses.

Sources:
- [Requirements for running Office Add-ins — Microsoft Learn](https://learn.microsoft.com/en-us/office/dev/add-ins/concepts/requirements-for-running-office-add-ins)
- [Deploy and publish Office Add-ins — Microsoft Learn](https://learn.microsoft.com/en-us/office/dev/add-ins/publish/publish)

---

### 1.2 Background Sync: What Runs, When, and What Stops

**Shared runtime (the key enabler):** By setting `lifetime: "long"` in the manifest's runtime definition, the add-in runs all code (taskpane, ribbon commands, custom functions) in a **single shared JavaScript runtime**. With a long lifetime, the runtime continues running code **after the taskpane is closed by the user**. `setInterval`, `setTimeout`, and `worksheet.onChanged` event handlers all continue firing.

**Critical boundary — Excel must be open.** When the user closes Excel entirely, the runtime is destroyed. No code runs, no sync happens, no callbacks fire. There is no background agent, service worker, or daemon mechanism in Office.js that survives workbook closure. This is not a gap that can be engineered around within the add-in model.

**Practical sync pattern with shared runtime:**
1. Add-in registers `worksheet.onChanged` / `table.onChanged` handlers on load.
2. User edits a cell → event fires → add-in computes signed change set → POST to Supabase Edge Function.
3. Taskpane is closed by user → shared runtime continues → events still fire → sync continues as long as workbook is open.
4. User closes Excel → sync stops. On next open, add-in auto-starts (if configured with `RunOnDocumentOpen` in manifest) and performs a reconciliation pull before resuming event-driven sync.

Sources:
- [Configure your Office Add-in to use a shared runtime — Microsoft Learn](https://learn.microsoft.com/en-us/office/dev/add-ins/develop/configure-your-add-in-to-use-a-shared-runtime)
- [Tips for using the shared JavaScript runtime — Microsoft 365 Dev Blog](https://devblogs.microsoft.com/microsoft365dev/tips-for-using-the-shared-javascript-runtime-in-your-office-add-in%E2%80%AF/)

---

### 1.3 onChanged / Table.onChanged: Granularity and Reliability

**Event payload (`WorksheetChangedEventArgs`):**

| Property | Value / Description |
|---|---|
| `address` | Cell/range address where change occurred (e.g., `"A5"`) |
| `changeType` | `"RangeEdited"` \| `"RowInserted"` \| `"RowDeleted"` \| `"ColumnInserted"` \| `"ColumnDeleted"` \| `"CellInserted"` \| `"CellDeleted"` |
| `changeDirectionState` | `insertShiftDirection` / `deleteShiftDirection` — direction cells shifted |
| `details` | Before/after value and type — **only populated for single-cell changes** |
| `source` | `"Local"` (current user) or `"Remote"` (co-author) |
| `worksheetId` | Worksheet ID |

**Row insert/delete detection:** Confirmed supported via `changeType === "RowInserted"` and `changeType === "RowDeleted"`. The `changeDirectionState` sub-object tells you the shift direction. This is sufficient to detect user-added and deleted rows. Available since ExcelApi 1.7 (Office 2019 / Microsoft 365).

**Known gaps and coalescing behavior:**
- `details` (before/after value) is only available on single-cell changes — multi-cell pastes do not give you per-cell old values.
- `onRowHiddenChanged` does **not** fire for advanced filter hide/show (only manual hide or standard filters). Workaround: polling, which Microsoft's own docs demonstrate at 500ms intervals.
- `Table.onChanged` had a historical bug where deleting table rows did not always fire the event (GitHub issue #294, reportedly fixed but worth regression-testing on your target Office versions).
- Event handlers do not persist across sessions or when the add-in is refreshed/reloaded. They must be re-registered on every workbook open.
- Undo: if a user presses Ctrl+Z after a change, a reverse `onChanged` fires for the undo. Your change-set logic must handle undo as a valid change, not a special case.
- Events can be disabled programmatically with `context.runtime.enableEvents = false` — important for batch writes from the add-in itself to avoid re-entrancy loops.

Sources:
- [Work with Events using the Excel JavaScript API — Microsoft Learn](https://learn.microsoft.com/en-us/office/dev/add-ins/excel/excel-add-ins-events)
- [Excel.WorksheetChangedEventArgs interface — Microsoft Learn](https://learn.microsoft.com/en-us/javascript/api/excel/excel.worksheetchangedeventargs?view=excel-js-preview)
- [Table.onChanged works only once — OfficeDev/office-js GitHub issue #1346](https://github.com/OfficeDev/office-js/issues/1346)

---

### 1.4 Auth: Third-Party (Supabase) OAuth from the Add-in

Office add-ins cannot use SSO for third-party (non-Microsoft) backends. The standard pattern is:

1. Taskpane calls `Office.context.ui.displayDialogAsync()` to open a popup window.
2. The popup loads your hosted sign-in page, which redirects to Supabase Auth (magic link, OAuth social, or email/password).
3. After auth, Supabase returns a JWT. The popup calls `messageParent()` to pass the JWT string back to the taskpane.
4. Taskpane stores the JWT in `localStorage` or the add-in's in-memory state for use in subsequent API calls.

**Token storage complexity:**
- The dialog and taskpane run in **separate browser runtime instances** — they do not share `sessionStorage`. As of Chromium 115+, storage partitioning is enforced, so cross-context `localStorage` sharing is unreliable.
- Recommended: pass the token via `messageParent` / `messageChild` rather than relying on shared storage.
- For the shared runtime (long lifetime), store the JWT in a module-level variable once received; it survives taskpane open/close cycles within a session.
- Token refresh: Supabase JWTs expire (default 1 hour). The add-in must use the Supabase JS SDK's `onAuthStateChange` or manually refresh using the refresh token before expiry. Refresh can happen silently in the background runtime.
- Safari (Office on the web in Safari): dialog and taskpane do not share `localStorage` at all — must use `messageParent` exclusively.

Sources:
- [Authenticate and authorize with the Office dialog API — Microsoft Learn](https://learn.microsoft.com/en-us/office/dev/add-ins/develop/auth-with-office-dialog-api)
- [Overview of authentication and authorization in Office Add-ins — Microsoft Learn](https://learn.microsoft.com/en-us/office/dev/add-ins/develop/overview-authn-authz)

---

### 1.5 Offline Behavior

Office.js add-ins are web apps hosted on your server. If the user is offline:
- The add-in taskpane will **fail to load** from your server unless you implement a service worker / PWA cache.
- Even with caching, API calls to Supabase will fail.
- No built-in queue-and-replay mechanism exists in Office.js — you must implement one (e.g., IndexedDB queue in the taskpane JS, flush on reconnect).
- Detection: use `navigator.onLine` + `window.addEventListener('online', ...)` to trigger flush when connectivity resumes.
- Practical recommendation for v1: show an "offline" banner in the taskpane, queue changes locally (IndexedDB), replay on reconnect with the same signed change-set payload. This is essential for construction sites with poor connectivity.

---

### 1.6 What Happens When Excel is Closed

Nothing runs. The add-in process terminates with Excel. There is no service worker, no native background process, and no mechanism to defer work to the OS after Excel exits. The desktop Electron app (when open) can serve as the sync endpoint for reads the next time the workbook is opened, but the add-in itself is inert when Excel is closed.

**Model implication:** The owner's description ("the main desktop app may be closed") is correct — when Excel is open with the add-in loaded, the desktop app being closed is fine, because the add-in syncs directly to Supabase. But when Excel itself is closed, there is no sync agent at all unless the desktop app is separately running. For the P2/P3 non-SharePoint path, this means sync is scoped to "while the workbook is open in Excel" — which is the correct and expected behavior for this model.

---

### 1.7 Deployment and Distribution

#### AppSource (Public Marketplace)
- Submit via Microsoft Partner Center. Add-in must conform to [Commercial Marketplace Certification Policies](https://learn.microsoft.com/en-us/legal/marketplace/certification-policies).
- Add-in must work across all platforms that support the requirement sets declared in the manifest.
- Review timeline: certification review takes approximately 3–5 business days once automated checks pass. Requires a Partner Center developer account.
- After approval: users can self-install from the Office in-app marketplace or via a direct `ms-excel:` install link you provide.
- **Best path for reaching consumer and small-biz users without IT admins.**

#### Centralized Deployment (M365 Admin Center / Integrated Apps Portal)
- Admin uploads the manifest and pushes to users/groups. Add-in appears in ribbon immediately with no user action.
- Works for M365 Business / Enterprise tenants only. Consumer personal accounts are not eligible.
- Government / sovereign clouds use "Centralized Deployment" rather than the Integrated Apps Portal — similar outcome.
- **Best path for reaching enterprise / construction company employees on managed tenants.**

#### Sideloading — Network Share (Windows-only, Dev/Testing only)
- Windows only. Not supported for Mac. Not supported for production.
- User must manually add a network share as a trusted catalog via Excel Trust Center Settings (UI or registry script).
- Not suitable for end-user distribution. Creates significant support burden.
- Explicitly not recommended for production by Microsoft.

#### Sideloading — Mac
- Separate process: copy manifest XML to `~/Library/Containers/com.microsoft.Excel/Data/Documents/wef/` (varies by Office version). Requires manual steps per machine.
- Again, dev/testing only.

#### Consumer Personal Account Restriction
- Enterprise IT admins can configure a policy that prevents employees from signing into the Microsoft Marketplace using personal Microsoft accounts. If this is set and a user's Excel is signed in with their work account, they cannot self-install AppSource add-ins.
- For construction workers using their own personal Microsoft 365 Family/Personal license, there is no admin control — they can install from AppSource freely.

Sources:
- [Deploy and publish Office Add-ins — Microsoft Learn](https://learn.microsoft.com/en-us/office/dev/add-ins/publish/publish)
- [Publish your Office Add-in to Microsoft Marketplace — Microsoft Learn](https://learn.microsoft.com/en-us/office/dev/add-ins/publish/publish-office-add-ins-to-appsource)
- [Sideload from network share (Windows) — Microsoft Learn](https://learn.microsoft.com/en-us/office/dev/add-ins/testing/create-a-network-shared-folder-catalog-for-task-pane-and-content-add-ins)

---

### 1.8 Sheet Protection and Locked Ranges

Office.js provides full programmatic control over worksheet protection:

```js
// Apply protection with password
worksheet.protection.protect(protectionOptions, password);

// Lock a specific range
range.format.protection.locked = true;

// Create editable ranges within a protected sheet
worksheet.protection.addAllowEditRange({
  title: "UserEditableZone",
  rangeAddress: "A2:Z1000",
  password: "range-specific-password"
});
```

The add-in can:
- Apply sheet protection with a password on workbook open.
- Lock all rows/columns except those the user is authorized to edit.
- Create per-user editable ranges (different passwords per range — complex but feasible).
- Detect `onProtectionChanged` events if protection state is modified.

**Critical caveat: see Section 5 for why protection alone is not a security wall.**

Sources:
- [Excel.WorksheetProtection class — Microsoft Learn](https://learn.microsoft.com/en-us/javascript/api/excel/excel.worksheetprotection?view=excel-js-preview)

---

### 1.9 Custom XML Parts and Workbook Metadata Storage

The add-in can embed persistent metadata (workbookId, syncToken, projectId, lastSyncedRevision) directly into the workbook file using `CustomXmlParts`:

```js
// Write workbook identity on first sync
const xmlString = `<syncMeta xmlns="https://yourdomain.com/sync">
  <workbookId>wb_abc123</workbookId>
  <projectId>proj_xyz</projectId>
  <lastRevision>42</lastRevision>
</syncMeta>`;
const part = await context.workbook.customXmlParts.add(xmlString);
const partId = part.id;
// Store partId in workbook settings for retrieval
context.workbook.settings.add("syncMetaXmlPartId", partId);
```

CustomXmlParts are stored inside the `.xlsx` ZIP structure and survive Save As operations. They are readable by any other Office.js add-in (or even direct ZIP inspection), so do not store sensitive tokens here — store only opaque IDs. Keep actual tokens in-memory or in server-side session state, retrieved on reconnect.

Alternative: `workbook.properties.custom` — a key-value store simpler than XML, also persisted in the file, also readable without authentication.

Sources:
- [Excel.CustomXmlPart class — Microsoft Learn](https://learn.microsoft.com/en-us/javascript/api/excel/excel.customxmlpart?view=excel-js-preview)
- [Persist add-in state and settings — Microsoft Learn](https://learn.microsoft.com/en-us/office/dev/add-ins/develop/persisting-add-in-state-and-settings)

---

## 2. xlwings

### 2.1 What xlwings Actually Is

xlwings is a Python library that bridges between a Python runtime and a running Excel session. It has three distinct deployment modes:

**xlwings Classic (open source):** Python on the same machine communicates with Excel via COM (Windows) or Apple Script / appscript (Mac). Requires Python installed locally. No server component. Used for local automation scripts — not a distributed sync mechanism.

**xlwings Server:** A web server (Python / FastAPI or similar) that exposes Python logic callable from an Office.js taskpane via `xlwings.min.js`. The JS layer calls the server for each operation. Excel is controlled through the Office.js API on the client, while Python handles business logic server-side. No local Python install required on end-user machines. Supports Excel desktop (Win/Mac), Excel web, and Google Sheets.

**xlwings Lite (Wasm):** Python running in-browser via WebAssembly (Pyodide). No server required. Limited to data manipulation in the client — no full Python ecosystem support, no Supabase SDK.

### 2.2 Verdict on xlwings for This Use Case

**Not viable as a primary sync mechanism for distributed end users.** Reasons:

1. **xlwings Server is the only relevant mode** — Classic requires local Python (non-starter for field users), Lite is too limited.
2. **xlwings Server is essentially a Python-flavored Office.js add-in backend.** It still uses Office.js for all Excel interaction. You're paying the xlwings abstraction cost on top of the same Office.js capabilities.
3. **Licensing cost is significant:** xlwings PRO Professional ($1,600/year, 1 developer) covers unlimited internal end users. Business plan ($6,000/year) covers unlimited developers + unlimited internal and external end users with multiple production instances. Enterprise ($12,000/year) for unlimited instances. For a product reaching external construction contractors, you need the Business tier minimum — $6,000/year added to your stack.
4. **No capability advantage:** xlwings Server gives you Python server-side logic, which you can achieve with Supabase Edge Functions (Deno/TypeScript) at no additional cost. The signed change-set validation, HMAC signing, RLS enforcement — all of these are native to Supabase.
5. **Platform gap closure:** xlwings Server does close the Google Sheets gap (a genuine advantage) — but the owner's model explicitly scopes P2/P3 to Excel only.

**Use xlwings if:** your business logic is complex Python (ML models, complex calculations) that would be painful to rewrite in TypeScript/Deno. Otherwise, the cost and abstraction overhead are not justified.

Sources:
- [xlwings Pricing](https://www.xlwings.org/pricing)
- [xlwings Server — Office.js Add-ins documentation](https://docs.xlwings.org/en/0.30.5/pro/server/officejs_addins.html)
- [xlwings GitHub](https://github.com/xlwings/xlwings)

---

## 3. Alternatives — One-Paragraph Verdicts

### 3.1 VSTO / COM Add-ins

**Dead end for new development.** VSTO and COM add-ins are Windows-only, require local MSI installation with elevated privileges, and Microsoft has committed that new Outlook (and progressively, the new Office host) will not support COM/VSTO. Critically, as of April 2026, new installations default to new Outlook which excludes VSTO. The deployment model is painful: every user machine needs an MSI, updates require re-installation, no centralized push. For a distributed construction-survey product targeting Windows, Mac, and web simultaneously, VSTO is not an option. The only residual argument for VSTO would be access to Windows-native COM APIs that Office.js does not expose — not relevant here.

### 3.2 Graph API Polling of Cloud Files

Already partially built in the desktop Electron app (P1 path, SharePoint/OneDrive Business). Graph API polling on `.xlsx` files works well for the SharePoint/OneDrive Business path where the file is in the cloud and Graph can watch for changes via delta queries or webhooks. For Dropbox, GDrive, and local files, Graph has no reach. Even for OneDrive Personal, Graph change notifications are less reliable than Business. The polling approach also requires the desktop app to be running and authenticated — it does not work when the desktop app is closed. This is the **correct P1 architecture** but cannot substitute for the add-in in P2/P3 scenarios.

### 3.3 Power Automate

Power Automate can trigger on Excel file changes in SharePoint/OneDrive (via file-modified triggers) and perform row-level operations using Excel Online (Business) connector actions. However: (a) requires M365 subscription with Power Automate access, (b) does not work on local or Dropbox/GDrive files, (c) Excel Online connector has significant API rate limits (300 calls/5 min per connection on standard plans), (d) no concept of signed change sets or server-side role validation, (e) latency from trigger to action is typically 1–5 minutes even on premium flows. Useful as a notification mechanism (e.g., alert a project manager when a field is changed) but not as the primary sync backbone for this model.

### 3.4 Closed-File Flush (Existing App Behavior)

The current desktop app flushes changes when the workbook is saved or closed by intercepting file-save events. This is reliable for the desktop-app-managed workflow but has no mechanism to catch edits made in Excel while the desktop app is closed. For the P2/P3 non-SharePoint path, the closed-file flush can serve as a **safety net / reconciliation step** when the workbook is next opened by the add-in: compare last-known server revision with the workbook's embedded `lastRevision`, read any rows that diverge, and push them as a reconciliation change set. This is not a replacement for real-time sync but ensures eventual consistency even if the add-in was offline for an entire work session.

---

## 4. Supabase Fit

### 4.1 RLS: Role-Based Project Membership

Current annotation RLS is `auth.uid() = user_id` (author-match). The sync model needs role-based project membership. Standard pattern:

```sql
-- Membership table
CREATE TABLE project_members (
  project_id  uuid REFERENCES projects(id),
  user_id     uuid REFERENCES auth.users(id),
  role        text CHECK (role IN ('owner', 'editor', 'viewer')),
  PRIMARY KEY (project_id, user_id)
);

-- Index critical for policy performance
CREATE INDEX idx_project_members_user_id ON project_members(user_id);

-- Policy example: editors can insert survey rows
CREATE POLICY "editors_can_insert_rows"
ON survey_rows FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM project_members
    WHERE project_id = survey_rows.project_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'editor')
  )
);

-- Viewers can only select
CREATE POLICY "members_can_select"
ON survey_rows FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM project_members
    WHERE project_id = survey_rows.project_id
      AND user_id = auth.uid()
  )
);
```

Custom JWT claims can be added via Supabase Auth Hooks (Database Webhooks on auth.users) to embed `project_memberships` in the JWT itself, avoiding a join per policy check — important at sync-heavy write throughput. However, JWT claims are set at login and become stale if membership changes mid-session; server-side membership-table check remains the authoritative source.

Sources:
- [Row Level Security — Supabase Docs](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase RLS Best Practices — Makerkit](https://makerkit.dev/blog/tutorials/supabase-rls-best-practices)

---

### 4.2 Edge Functions: Signed Change-Set Validation

**Recommended pattern — JWT-bound change sets (not raw HMAC):**

The add-in authenticates with Supabase Auth (standard JWT). Each change-set POST to the Edge Function includes the Supabase JWT in the Authorization header. The Edge Function validates:

```typescript
// Pseudocode for Edge Function handler
const jwt = req.headers.get("Authorization")?.replace("Bearer ", "");
const { data: { user }, error } = await supabaseAdmin.auth.getUser(jwt);
if (error || !user) return new Response("Unauthorized", { status: 401 });

const body = await req.json();
const { workbookId, projectId, changes, clientRevision, signature } = body;

// 1. Verify workbook is registered to this project + user has editor role
const membership = await supabaseAdmin
  .from("project_members")
  .select("role")
  .eq("project_id", projectId)
  .eq("user_id", user.id)
  .single();
if (!membership.data || !["owner","editor"].includes(membership.data.role))
  return new Response("Forbidden", { status: 403 });

// 2. Verify workbook token is valid and bound to this project
const workbookReg = await supabaseAdmin
  .from("registered_workbooks")
  .select("project_id, sync_token_hash, token_expires_at")
  .eq("workbook_id", workbookId)
  .single();
if (!workbookReg.data || workbookReg.data.project_id !== projectId)
  return new Response("Workbook not registered", { status: 403 });
// Check token_expires_at, verify sync_token_hash against HMAC of change set

// 3. OCC revision check
const currentRevision = await getServerRevision(projectId);
if (clientRevision !== currentRevision)
  return new Response(JSON.stringify({ conflict: true, serverRevision: currentRevision }), { status: 409 });

// 4. Apply changes in a transaction, increment revision
await applyChangeset(changes, projectId, user.id);

// 5. Fan out via Realtime
await supabaseAdmin.channel(`project:${projectId}`).send({ ... });
```

**Workbook sync token design:** The `sync_token` bound to each registered workbook should contain: `workbookId + projectId + userId + expiresAt`, HMAC-signed with a per-project secret stored in Supabase Vault. The token is generated server-side when the workbook is first registered, embedded in the workbook's CustomXmlParts (as an opaque string, not the secret), and validated on each change-set POST. Token rotation should occur on membership change or explicit revocation. Viewers get no workbook token — they receive read-only exports with no token embedded.

**HMAC vs JWT signing:** For the sync token itself (the workbook credential), HMAC-SHA256 with a per-project secret (stored in Supabase Vault / environment secrets, never client-visible) is appropriate. The user authentication uses Supabase's standard JWT. These two layers are independent: a token can be revoked without invalidating the user's session JWT.

Sources:
- [Supabase Edge Functions Limits](https://supabase.com/docs/guides/functions/limits)
- [Token Security and RLS — Supabase Docs](https://supabase.com/docs/guides/auth/oauth-server/token-security)

---

### 4.3 Realtime: Fanning Changes Back to Open Add-ins

Supabase Realtime works well for this pattern. Open add-ins and the desktop app subscribe to a project-scoped channel. When the Edge Function accepts a change set, it broadcasts the accepted changes via Realtime. All other subscribers apply the changes (with OCC revision check to detect conflicts):

```js
// In the add-in taskpane JS
const channel = supabase.channel(`project:${projectId}`)
  .on("broadcast", { event: "row_change" }, (payload) => {
    if (payload.revision <= localRevision) return; // already have this
    applyIncomingChange(payload.changes);
  })
  .subscribe();
```

Realtime channels are project-scoped, so only members with valid JWTs subscribed to that channel receive broadcasts. RLS applies to Postgres CDC (database Realtime), but for broadcast channels, the access control is at the Edge Function level.

---

### 4.4 Rate Limits and Quotas Relevant to Row-Level Sync

| Limit | Value | Impact |
|---|---|---|
| Edge Function max CPU time per request | 2 seconds | Fine for change-set validation; avoid blocking operations |
| Edge Function max wall clock duration | 150s (Free) / 400s (Paid) | Not relevant for per-request sync calls |
| Recursive invocation limit | ~5,000 requests/minute | Effective ceiling for sync throughput on a single project; at 30 users each saving ~3x/min = 90 req/min — well within limits |
| Edge Function max memory | 256 MB | Not a concern for JSON change-set validation |
| Supabase Auth rate limits | 30 sign-in attempts/hour per IP, 60/hour for OTP | Not relevant post-login |
| Log events throttle | 100 events per 10 seconds | Logging-only limit; does not affect function execution |

**Per-keystroke sync concern:** The owner's model implies row-level sync on each row edit (not per-keystroke). If a user edits a cell and presses Tab, one `onChanged` fires per cell. An active field user editing 20 rows/minute generates 20 Edge Function calls/minute per user. At 30 concurrent users on a project: 600 calls/minute — well within Supabase's practical limits. Implement a 500ms debounce in the add-in before sending (collect changes within a 500ms window and batch them into one change-set POST) to further reduce call volume.

Sources:
- [Edge Functions Limits — Supabase Docs](https://supabase.com/docs/guides/functions/limits)
- [Rate Limiting Edge Functions — Supabase Docs](https://supabase.com/docs/guides/functions/examples/rate-limiting)

---

## 5. Security Reality Check

### 5.1 Sheet Protection — What It Actually Protects

Excel worksheet password protection is **not encryption**. It is an obfuscation layer that prevents casual UI-based edits. The protection can be removed by:

1. **ZIP surgery (no tools needed):** Rename `.xlsx` to `.zip`, navigate to `xl/worksheets/sheet1.xml`, delete the `<sheetProtection>` XML element, rename back. Works on all XLSX files. Takes under 2 minutes. No password crack required.
2. **Password cracking:** Worksheet protection uses XOR obfuscation (legacy) or a simple hash (modern). Free tools recover worksheet passwords instantly for the XOR variant; GPU-accelerated tools handle modern hashes in hours for short passwords.
3. **File-open password (AES-256 encryption):** This IS real encryption. The file contents are encrypted, not just flagged. ZIP surgery does not help because the XML itself is ciphertext. This requires brute force to break. Setting a file-open password on viewer exports is meaningfully stronger — but adds friction (users must enter a password to open).

**Model assumption confirmed:** The owner is correct that **server-side rejection is the real security wall.** Sheet protection prevents accidental edits by honest users; it does not stop a motivated bad actor. The signed change-set model — where the server validates workbook token, project membership, role, and revision before accepting any write — is the correct enforcement layer. Viewer workbooks with no embedded sync token simply cannot submit changes the server will accept, regardless of whether they bypass sheet protection.

**Practical recommendation:** Apply sheet protection to viewer exports as a UX friction layer (deters casual edits, makes the read-only intent clear in the UI), but document internally that it is not a security control. Never rely on it alone.

Sources:
- [Excel security is a myth — How-To Geek](https://www.howtogeek.com/microsoft-excel-security-is-a-myth/)
- [Unprotect Excel Sheet Without Password — Xelplus](https://www.xelplus.com/unprotect-excel-sheet/)

---

### 5.2 Signed Change-Set Token Design

**Recommended token binding — what the workbook sync token MUST bind:**

```
workbook_token = HMAC-SHA256(
  key     = project_secret,   // stored in Supabase Vault, never in workbook
  message = workbookId
           + "|" + projectId
           + "|" + userId      // the user who registered this workbook
           + "|" + expiresAt   // ISO8601 timestamp
)
```

**Additional server-side checks on each change-set POST:**

| Check | Why |
|---|---|
| Token HMAC valid | Proves the token was issued by your server |
| `expiresAt` not past | Limits token reuse window (recommend 30–90 day TTL for workbook tokens, refreshable) |
| `workbookId` registered to `projectId` | Prevents a token from one project being used against another |
| `userId` matches authenticated JWT user | Prevents token transfer between users |
| User has editor role in `project_members` | Role enforcement independent of token |
| `clientRevision` matches server `currentRevision` | OCC — detects concurrent conflicting edits |
| `revocationFlag` not set | Allows immediate revocation on membership removal |

**What viewer exports must NOT contain:** any sync token. Viewer exports should have their `CustomXmlParts` stripped of any `syncMeta` or contain only a `workbookId` with a `viewer: true` flag. The server rejects any change-set POST that references a viewer-class workbook ID regardless of what else is in the request.

---

## 6. Verdict

### 6.1 Is "Excel Add-in + Signed Row-Level Sync" the Right Path for Non-SharePoint Users?

**Yes — it is the correct architecture** for P2/P3 non-SharePoint files. It is the only Office.js-native mechanism that can provide push sync for workbooks stored outside Microsoft's cloud. The signed change-set model correctly places the security enforcement on the server (where it cannot be bypassed by file manipulation) while allowing the add-in to operate autonomously while Excel is open.

**The model is sound. The execution risks are distribution friction and the Excel-closed gap — not the core design.**

### 6.2 The Weakest Links

**1. Add-in distribution friction (the hardest constraint)**

For enterprise/managed tenants (construction companies with M365 Business): Centralized Deployment via the M365 Admin Center is clean, but someone at each company must be an M365 admin and willing to install a third-party add-in. Small subcontractors often have no IT function. This is a human/sales friction, not a technical blocker — but it is real.

For consumer and small-biz users on personal licenses (M365 Family/Personal): AppSource self-install is the only path. AppSource review takes 3–5 business days per submission update, which slows iteration. Users must actively install the add-in — they will not encounter it automatically.

For users on employer-managed tenants that block the AppSource marketplace: they cannot self-install. They are blocked until their IT admin acts. This is the hardest case and will likely require a human escalation path.

**2. Excel-closed gap (design constraint, not a bug)**

Sync only runs while Excel is open and the add-in is loaded. If a user edits a row, saves, and closes Excel — the changes are in the file but not synced until the next open. The add-in must perform a reconciliation pull on every workbook open to catch this gap. The closed-file flush from the existing desktop app adds a second safety net, but only when the desktop app is running.

This means the model is "eventually consistent with Excel-open as the sync window" — not real-time when Excel is closed. For a construction survey app, this is almost certainly acceptable: sync happens during active work sessions.

**3. onChanged event reliability edge cases**

Table row deletion historically had reliability issues (GitHub issue #294). Multi-cell paste does not provide per-cell before-values. Advanced filter row-hide does not fire `onRowHiddenChanged`. These are manageable but require defensive implementation (snapshot comparison on reconnect, explicit reconciliation on open).

### 6.3 What the Owner's Model Gets Right

- Server rejection as the real security wall — correct.
- Per-email Graph permissions for SharePoint/OneDrive Business (P1) — correct, uses the strongest available mechanism.
- Add-in for everything else — correct, only viable non-Graph path.
- Signed workbook token + role + revision validation — correct layered defense.
- Viewer exports with no write token — correct; ZIP surgery on the workbook gives the attacker nothing usable server-side.

### 6.4 One Thing the Model Should Clarify

The model assumes the add-in can be silently loaded (shared runtime, `RunOnDocumentOpen`) whenever the workbook is opened. This requires the add-in to already be installed in the user's Excel. The first-time experience requires the user to install the add-in before the workbook's `CustomXmlParts` sync metadata is useful. A graceful fallback is needed: if the workbook is opened without the add-in installed, the workbook should show a banner (via a built-in Excel feature like a smart tag or the document's own instructions sheet) directing the user to install the add-in from AppSource.

### 6.5 Pragmatic v1 vs Full Vision

**v1 (pragmatic, shippable in ~4–6 weeks of add-in dev):**
- Office.js taskpane add-in with shared runtime, `lifetime: "long"`.
- Auth via Supabase dialog-based OAuth (email/password or magic link).
- `worksheet.onChanged` handler with 500ms debounce → POST signed change set to Supabase Edge Function.
- On workbook open: reconciliation pull (compare embedded `lastRevision` in CustomXmlParts to server revision, fetch and apply delta).
- Basic sheet protection on viewer exports (UX friction, not security).
- Manual AppSource distribution (requires Microsoft Partner Center account + 3–5 day review).
- No offline queue — show error banner if offline.

**Full vision (adds):**
- IndexedDB offline change queue with replay on reconnect.
- Realtime subscription fan-out to other open add-ins/desktop app.
- Token rotation and revocation via membership-change webhooks.
- Centralized Deployment integration for enterprise tenant admins.
- Conflict resolution UI in taskpane (OCC conflict surfaced to user, not silently dropped).
- Per-user editable range locking (add-in programmatically sets `AllowEditRange` based on server-returned permissions on open).

---

## Sources

- [Work with Events using the Excel JavaScript API](https://learn.microsoft.com/en-us/office/dev/add-ins/excel/excel-add-ins-events)
- [Excel.WorksheetChangedEventArgs interface](https://learn.microsoft.com/en-us/javascript/api/excel/excel.worksheetchangedeventargs?view=excel-js-preview)
- [Excel.TableChangedEventArgs interface](https://learn.microsoft.com/en-us/javascript/api/excel/excel.tablechangedeventargs?view=excel-js-preview)
- [Configure your Office Add-in to use a shared runtime](https://learn.microsoft.com/en-us/office/dev/add-ins/develop/configure-your-add-in-to-use-a-shared-runtime)
- [Authenticate and authorize with the Office dialog API](https://learn.microsoft.com/en-us/office/dev/add-ins/develop/auth-with-office-dialog-api)
- [Overview of authentication and authorization in Office Add-ins](https://learn.microsoft.com/en-us/office/dev/add-ins/develop/overview-authn-authz)
- [Deploy and publish Office Add-ins](https://learn.microsoft.com/en-us/office/dev/add-ins/publish/publish)
- [Publish your Office Add-in to Microsoft Marketplace](https://learn.microsoft.com/en-us/office/dev/add-ins/publish/publish-office-add-ins-to-appsource)
- [Sideload from network share (Windows only)](https://learn.microsoft.com/en-us/office/dev/add-ins/testing/create-a-network-shared-folder-catalog-for-task-pane-and-content-add-ins)
- [Requirements for running Office Add-ins](https://learn.microsoft.com/en-us/office/dev/add-ins/concepts/requirements-for-running-office-add-ins)
- [Excel.WorksheetProtection class](https://learn.microsoft.com/en-us/javascript/api/excel/excel.worksheetprotection?view=excel-js-preview)
- [Excel.CustomXmlPart class](https://learn.microsoft.com/en-us/javascript/api/excel/excel.customxmlpart?view=excel-js-preview)
- [Persist add-in state and settings](https://learn.microsoft.com/en-us/office/dev/add-ins/develop/persisting-add-in-state-and-settings)
- [Row Level Security — Supabase Docs](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase RLS Best Practices — Makerkit](https://makerkit.dev/blog/tutorials/supabase-rls-best-practices)
- [Edge Functions Limits — Supabase Docs](https://supabase.com/docs/guides/functions/limits)
- [Rate Limiting Edge Functions — Supabase Docs](https://supabase.com/docs/guides/functions/examples/rate-limiting)
- [Token Security and RLS — Supabase Docs](https://supabase.com/docs/guides/auth/oauth-server/token-security)
- [xlwings Pricing](https://www.xlwings.org/pricing)
- [xlwings Server — Office.js Add-ins](https://docs.xlwings.org/en/0.30.5/pro/server/officejs_addins.html)
- [xlwings GitHub](https://github.com/xlwings/xlwings)
- [Excel security is a myth — How-To Geek](https://www.howtogeek.com/microsoft-excel-security-is-a-myth/)
- [Unprotect Excel Sheet Without Password — Xelplus](https://www.xelplus.com/unprotect-excel-sheet/)
- [Office Add-ins vs VSTO Add-ins 2025 Guide — MetaDesign Solutions](https://metadesignsolutions.com/blog/office-add-ins-vs-vsto-add-ins-what-should-you-use-today)
- [OfficeDev/office-js GitHub issue #294 — Table row delete not triggering onChanged](https://github.com/OfficeDev/office-js/issues/294)
- [OfficeDev/office-js GitHub issue #1346 — Table.onChanged works only once](https://github.com/OfficeDev/office-js/issues/1346)
