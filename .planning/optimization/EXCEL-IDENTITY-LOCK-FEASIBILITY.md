# Excel Identity Lock Feasibility Memo

**Question:** Can the app programmatically export an Excel workbook whose edit/view permissions are locked to specific Microsoft-account email addresses — so that owners and contributors can edit while viewers can only read, enforced by Microsoft sign-in?

**Produced:** 2026-06-10. Read-only research pass; no source files modified.

---

## Plain-language answer up front

**Partially yes — under specific conditions, for specific storage paths.**

The owner's proposal is achievable for files that live in **business OneDrive for Business or SharePoint**, provided the tenant holds at least **Microsoft 365 Business Premium** (or any E3/E5 plan). The enforcement strength and the "travels-with-the-download" property depend on which layer you add. For **personal OneDrive** (consumer Microsoft accounts) the strongest option is unavailable by design; only cloud-level sharing controls apply. For **loose local or emailed copies** no Microsoft mechanism enforces identity after the file leaves the cloud boundary — that gap is real and unavoidable.

There is no single API call that stamps "this person can edit, that person can only view" into the `.xlsx` bytes themselves in a form Excel enforces. There are two complementary mechanisms, and neither is a silver bullet alone:

1. **Graph API sharing invitations** (`driveItem/invite`) — controls access to the cloud copy; stops at the cloud boundary.
2. **Microsoft Purview IRM / sensitivity labels with admin-defined per-user rights** — encrypts the file bytes; protection travels with a downloaded copy; enforced at open even offline (for up to 30 days by default). This is the "yes" that satisfies the owner's concern about downloaded copies.

---

## Mechanism comparison table

| Mechanism | What it protects | Enforcement strength | Works when downloaded? | Per-email rights (view vs edit)? | Programmatic apply? | Licensing |
|---|---|---|---|---|---|---|
| **Graph `driveItem/invite`** — sharing invitation with `roles: ["read"]` or `["write"]`, `requireSignIn: true` | Cloud copy only (OneDrive / SharePoint) | Strong for cloud access; zero enforcement once file is downloaded or emailed | No — a downloaded copy is an unprotected `.xlsx` | Yes — set `roles: ["read"]` per recipient email, different calls for different roles | Yes — one POST per recipient; works in delegated and app-only flows; already uses the same `graphClient` the app has | Files.ReadWrite.All; no premium license needed |
| **Purview IRM — "Assign permissions now" sensitivity label** (admin-defined, specific users/groups, granular rights) | File bytes — AES encryption travels with the file everywhere | Strong — enforced at open by Azure Rights Management; works offline for up to 30 days (use-license cache) | **Yes** | Yes — label can assign `View`-only rights to one set of emails and `Edit`/`Co-Owner` to another; granular to individual accounts or Entra groups | **Partially** — `driveItem/assignSensitivityLabel` Graph API exists (v1.0, GA), but it assigns a **pre-defined label by GUID**; per-user rights are baked into the label at design time in the Purview admin portal, not injected at export time; it is a metered/protected API (additional Azure billing setup required) | **M365 Business Premium** minimum (includes AIP P1); Azure Rights Management must be activated on the tenant; personal MSA accounts **not supported** as rights recipients |
| **Purview IRM — "User-defined permissions" label + SharePoint "Extend permissions on download"** | File bytes, keyed to the SharePoint site permissions at download time | Strong for SharePoint-homed files; permissions changes to the SharePoint site propagate to already-downloaded copies (just-in-time check at open) | **Yes, with caveats** — user must be able to reach the original SharePoint site; offline breaks after 30 days; deleted/moved file breaks access | Yes — SharePoint Owner → Full Control; SharePoint Edit → Editor (no label change); SharePoint Read → View-only | **Partially** — SharePoint library must be configured by a site admin with a specific "Extend protection on download" checkbox; requires PowerShell tenant setup first; not a single Graph call | M365 Business Premium+; co-authoring for encrypted files must be enabled; SharePoint IRM must NOT be enabled on the library |
| **Workbook password / sheet protection / Allow Edit Ranges** | In-file advisory lock only | **Advisory only** — enforced only by Excel's own UI; bypassed by any other application reading the file; `Allow Edit Ranges` per-user ACL requires domain/AD join and has known enforcement gaps even there | Advisory only | Per-range only, not per-person view vs edit of the whole file | Achievable via ExcelJS (can set sheet protection + password); per-user ACL in `Allow Edit Ranges` is not settable via ExcelJS | None |
| **OneDrive "people you specify" sharing link** with sign-in required | Cloud copy only | Same as invite — cloud boundary only | No | Read or Write per link; not per-person from a single link | Yes via `driveItem/createLink` with `scope: "users"` and `recipients` | Files.ReadWrite.All |

---

## Internal grounding: how the app exports today

Sources: `src/services/excelGraphService.js`, `src/PDFViewer.jsx` (lines noted), `src/services/excelCapability.js`.

**Export writes two ways depending on the file's storage tier** (`excelCapability.js`, `EXCEL_CAPABILITY` enum):

- **`business-graph` tier** (`isOneDrive: true`, work tenant, `driveType: business|documentLibrary`): `uploadExcelFile(graphClient, filePath, buffer)` → HTTP PUT to `/me/drive/root:{path}:/content` or `uploadFileContentById` — a Graph API call that replaces the file in OneDrive/SharePoint. (`PDFViewer.jsx:12598`, `13213`, `13219`)
- **`local` / `personal-onedrive` tier**: `window.electronAPI.writeFile(localOneDrivePath, buffer)` — writes to the local filesystem path; OneDrive sync client picks it up. (`PDFViewer.jsx:13240`)
- **No export path currently calls `driveItem/invite` or any permission/label API.** The app uploads bytes only.

The app already knows: whether the file is OneDrive (`isOneDrive`), whether it is business vs personal (`tenantId` / `driveType` from `classifyExcelCapability`), and which emails are project members (the collab-permission model in `COLLAB-PERMISSION-MODEL-MEMO.md`). All the inputs for adding a sharing step exist.

**The live-writeback gate (`LIVE_WRITEBACK_ENABLED = false`)** is separate from sharing — sharing invitations don't require the workbook-session APIs that the gate guards. Invitations can be issued against any file the app has a Graph client for, regardless of whether live cell-sync is on.

---

## What is feasible for each storage scenario

### (a) Business OneDrive for Business / SharePoint files

**Full layered protection is achievable.**

- **Layer 1 — Cloud sharing (Graph invite):** Immediately after uploading the file, POST to `POST /me/drive/items/{fileId}/invite` with `requireSignIn: true`. Call once for the contributor emails with `roles: ["write"]` and once for the viewer emails with `roles: ["read"]`. This gates cloud access by identity. It does NOT protect a downloaded copy.
- **Layer 2 — IRM encryption (optional, travels with download):** If the tenant has Business Premium or better AND a Purview admin has pre-created an appropriate sensitivity label, call `POST /me/drive/items/{fileId}/assignSensitivityLabel` with the label GUID. The label must be authored in the Purview portal with "Assign permissions now" for the right role tier — one label for contributors, one for viewers, or a label that separately assigns View vs Edit to the survey's exact emails. This is the only mechanism that protects a downloaded copy.
  - **Constraint:** Label recipients are defined at label-creation time in Purview Admin, not injected dynamically per-export. For dynamic per-project recipient lists the app would need either: (a) a separate label per role tier (not per project), or (b) the MIP SDK (heavier, server-side) to bake per-export user lists directly into the Rights Management protection.
  - **Constraint:** `assignSensitivityLabel` is a metered API — requires Azure billing configuration and carries per-call charges. It is a "protected API" requiring additional validation beyond OAuth consent.
  - **Constraint:** IRM-encrypted files cannot be read by the app's own ExcelJS parser without decryption — if the app ever downloads and parses its own exported file for two-way sync, IRM encryption on the cloud copy will block that unless the app's service principal is listed as a super user.
- **Layer 3 — SharePoint "extend permissions on download":** For SharePoint-homed libraries only, a site admin can configure the library with a user-defined-permissions label and the "Extend protection on download" checkbox. When a user downloads the file, SharePoint stamps it with AzureRMS protection derived from that user's current SharePoint permissions (Owner → Full Control, Edit → Edit, Read → View). **This does not require per-export API calls** — it is a library configuration done once. It is the most operationally light path to protection-that-travels, but it requires admin-level SharePoint configuration and has the limitation that downloaded files stop opening if the SharePoint site is deleted or the user loses access.

### (b) Personal OneDrive (consumer / MSA accounts)

- **Graph sharing invite works**: `driveItem/invite` is supported for personal OneDrive but `requireSignIn` on personal drives behaves differently — it creates a link the recipient must sign in to use, but enforcement is via link-sharing not Entra identity.
- **IRM / sensitivity labels are NOT available**: `assignSensitivityLabel` explicitly states "Delegated (personal Microsoft account): Not supported." Consumer tenants do not have Azure Rights Management activated. The `driveType: personal` gate in `excelCapability.js` (line 79) already excludes these from the live-sync tier — the same boundary applies to IRM.
- **Bottom line:** For personal OneDrive, only cloud-access control is feasible. A downloaded copy is unprotected.

### (c) Loose local / emailed copies

**No Microsoft mechanism applies.** Once a file is written to `window.electronAPI.writeFile(localOneDrivePath, buffer)` and picked up by the OneDrive sync client — or emailed as an attachment — it is a plain `.xlsx` byte stream. There is no identity enforcement at all. This is true regardless of what happens in the cloud.

**The only protection that would follow the file through email or USB:** Purview IRM encryption on the file bytes (Layer 2 above) — but that requires the file to have been uploaded to OneDrive/SharePoint first so `assignSensitivityLabel` can be called, or the MIP SDK applied on the server side before the file is written locally. For local-first exports, IRM is not accessible.

---

## Recommended architecture (layered)

For **business OneDrive / SharePoint files** (the app's primary target for live sync):

```
Export complete (file uploaded to OneDrive)
    │
    ├─► POST /drive/items/{id}/invite   ← contributors (roles: ["write"])
    │                                      viewers     (roles: ["read"])
    │                                      requireSignIn: true
    │                                      (cloud-boundary enforcement, free, immediate)
    │
    └─► [Optional, if tenant has Purview IRM configured]
        POST /drive/items/{id}/assignSensitivityLabel
        sensitivityLabelId: <survey-viewer-label-guid> | <survey-editor-label-guid>
        (protection travels with download; metered API; requires admin label setup)
```

The **app's existing import guardrails** (delete-grace window, RECEIVED-only deletes, History restore, export-clock guard, 3-way merge) remain the last line of defense against rogue edits that slip through. They are not rendered obsolete by the sharing layer — they handle cases where someone who legitimately has write access makes conflicting edits.

**For local / personal-OneDrive exports:** add a visible warning at export time ("This file is not access-controlled — anyone with the file can edit it") rather than silently exporting. No technical enforcement is available.

---

## Cost and effort tiers

| Tier | What you get | Effort | Prerequisites |
|---|---|---|---|
| **Tier 0 — status quo + UI warning** | Nothing new technically; add a banner on local/personal exports noting the file is open | ~1 day | None |
| **Tier 1 — Graph sharing invitations** (cloud boundary only) | Sign-in-required read or write permission per email; enforced at cloud access | ~2-3 days (one new Graph call after upload, map collab roles to read/write) | Business OneDrive / SharePoint file; existing Graph client + `Files.ReadWrite.All` scope (already in use) |
| **Tier 2 — Tier 1 + Purview label assignment** (protection travels with download) | IRM encryption on bytes; downloaded copies enforce sign-in via AzureRMS | ~1-2 weeks additional (metered API setup, label design in Purview portal, two labels or MIP SDK for dynamic recipients, handle 423 on locked file, test that the app's own import parser can still read labeled files) | M365 Business Premium or E3/E5 on every user's account; Azure Rights Management activated; Purview admin access to create labels; metered API billing configured; NOT compatible with personal MSA accounts |
| **Tier 3 — SharePoint "extend permissions on download"** (operational alternative to Tier 2 for SharePoint-homed files) | Protection-that-travels via SharePoint permission snapshot at download time; no per-export API call | ~1 week (SharePoint admin PowerShell setup, library configuration, end-user education on the new open-requires-network constraint) | SharePoint-homed file (not personal OneDrive); M365 Business Premium+; co-authoring for encrypted files enabled; site admin access |

---

## Option 1 (accept openness) assessed honestly

If the project does nothing new, the existing guardrails are:

- **Delete-grace window** — a row missing from Excel on first import only sets a pending flag, not an immediate delete. An accidental or malicious delete takes one extra import to stick.
- **RECEIVED-only auto-delete** — markers Excel never received are protected from auto-deletion regardless.
- **History restore** — any auto-deleted Survey Marker is in 30-day trash, one-click restorable.
- **Export-clock guard** — a stale workbook (older than the last export) is refused on auto-import; the user is asked before a manual pull is applied from a stale file.
- **3-way merge** — both-sides edits surface as review items rather than silent overwrites.
- **The hardest attack:** someone with the `.xlsx` file edits a row's checklist answers and saves. On next import the app sees the conflict and flags it for review (after the 3-way-merge fix). They cannot silently commit a delete of a placed Survey Marker without triggering the delete-grace + review path. They can silently change attribute values (notes, answers) if they have the file before the 3-way baseline was stamped — that is the real residual risk.

**Verdict on Option 1:** the guardrails substantially reduce the attack surface for an insider with a file copy. The realistic threat is answer/note tampering on a copy of an old file, not mass deletion of placed Survey Markers. For a construction/field-survey product where the file is shared inside a project team, Option 1 is defensible — but it should be paired with a Tier 0 UI warning so the team is not misled into thinking the file is access-controlled.

---

## Open questions for the product owner

1. **What M365 SKU do the customers' tenants carry?** IRM (Tier 2) requires Business Premium or better on every user who needs to open encrypted files. If customers are on Business Basic or Standard, IRM is not available to them at all.

2. **Are the survey project's "viewer" and "contributor" email lists stable at export time, or do they change between exports?** The `assignSensitivityLabel` API assigns a label by GUID, not a per-export user list. For per-export user lists you need either: multiple tenant-wide labels (one per role, fixed recipients) — impractical for many projects — or the MIP SDK to bake rights dynamically, which is a significantly heavier integration.

3. **Is IRM encryption compatible with the app's own two-way sync?** An IRM-encrypted file in OneDrive cannot be downloaded and parsed by ExcelJS without decryption. The app's import path (`downloadExcelFile` → `exceljs.Workbook().xlsx.load()`) would break on an IRM-labeled file unless the app's service principal is granted super-user rights in AzureRMS — a non-trivial admin operation.

4. **For the SharePoint-only path (Tier 3):** Are customers willing to accept the constraint that downloaded copies stop opening if the SharePoint site is deleted or the user's permissions are revoked? This is a feature for some use cases (audit trail, project closure) and a surprise for others.

5. **Is Tier 1 (Graph sharing invitations) sufficient for the immediate concern?** It gates cloud access by identity with no licensing overhead and fits the existing `graphClient` the app already holds. The gap (unprotected downloaded copy) could be addressed with a UI disclosure rather than IRM.

---

## Sources

- [driveItem: invite — Microsoft Graph v1.0](https://learn.microsoft.com/en-us/graph/api/driveitem-invite?view=graph-rest-1.0) — sharing invitation API, `requireSignIn`, roles, personal OneDrive restrictions
- [driveItem: assignSensitivityLabel — Microsoft Graph v1.0](https://learn.microsoft.com/en-us/graph/api/driveitem-assignsensitivitylabel?view=graph-rest-1.0) — label assignment API, metered/protected status, 423 on locked files, personal MSA not supported
- [Apply encryption using sensitivity labels — Microsoft Purview](https://learn.microsoft.com/en-us/purview/encryption-sensitivity-labels) — admin-defined vs user-defined permissions, per-email granular rights, AzureRMS, offline access / use-license cache (30 days default)
- [Configure SharePoint to extend permissions to downloaded documents — Microsoft Purview](https://learn.microsoft.com/en-us/purview/sensitivity-labels-sharepoint-extend-permissions) — SharePoint library "Extend protection on download" feature, SharePoint permission → AzureRMS rights mapping, online-required limitation
- [Enable sensitivity labels for files in SharePoint and OneDrive](https://learn.microsoft.com/en-us/purview/sensitivity-labels-sharepoint-onedrive-files) — tenant prerequisites
- [Microsoft Purview Information Protection labeling overview — Microsoft Graph](https://learn.microsoft.com/en-us/graph/security-information-protection-overview) — Graph label APIs scope vs MIP SDK
- [Permission resource — Microsoft Graph v1.0](https://learn.microsoft.com/en-us/graph/api/resources/permission?view=graph-rest-1.0)
- Internal: `src/services/excelGraphService.js` — export via `uploadExcelFile` (Graph PUT) and `uploadFileContentById`
- Internal: `src/services/excelCapability.js` — `EXCEL_CAPABILITY` tiers, personal vs business gate (`CONSUMER_TENANT_ID`, `BUSINESS_DRIVE_TYPES`)
- Internal: `src/PDFViewer.jsx:13240` — local path via `window.electronAPI.writeFile`; `13213/13219` — OneDrive path via `uploadExcelFile`
- Internal: `HANDOFF-excel-sync-next.md` — live-sync workstream state, `LIVE_WRITEBACK_ENABLED` gate
- Internal: `.planning/optimization/EXCEL-SYNC-MAP.md` — export mutation matrix, two-way sync architecture
