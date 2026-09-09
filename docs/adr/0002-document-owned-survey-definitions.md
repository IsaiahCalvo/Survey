---
status: accepted; implementation in progress
---

# Document-owned survey definitions

Document membership does not grant access to the owner's private templates.
Shared work must therefore not depend on those templates to recover module,
category or checklist definitions. Use an explicit, reviewed, document-owned
copy, alongside the separate entity list. This decision does not enable a cloud
feature or claim that the runtime migration is complete.

## Scope

- Copy stable module IDs/names, category IDs/names and checklist IDs/text in their
  existing array order. Preserve archived checklist rows and their archive label
  and timestamp fields: saved answers refer to those IDs.
- Do not copy entities, template accent/name, Excel links, drive paths, sync
  settings, view state, regions, page assignments, responses, notes or media.
- The document owner reviews the exact source and adopts it. Members read under
  document access rules. Editors can assign existing definitions under existing
  annotation rights; this does not give them template-author rights.
- Use one bounded immutable tree per document, read as a whole. This is small
  reference data, not an unbounded mutable annotation or sync log. Keep IDs,
  revision, source version/digest and operation receipt outside the tree for
  exact lookup, concurrency checks and retry proof.
- Keep local documents local. A local adoption must use the document's existing
  revision-checked save, and ordinary saves/page replacement must retain it.
- Do not seed from a mutable document template ID, global palette, old sidecar
  or a previously accepted entity list. Existing documents need explicit review.
- Do not delete or rewrite legacy data when this feature is disabled or when
  the source is invalid. Old readers need an explicit compatibility plan before
  accepted files can be reopened through them.

## Identity and compatibility

Preserve valid legacy aliases only when they resolve to one unambiguous tree.
Do not mint missing IDs during server preview. An id-less template or string-only
checklist must be repaired and saved before adoption.

The current item model derives module data keys from names. Static Excel also
derives sheet and header identities from names. Collision checks must follow
those exact rules, including Unicode and Excel truncation, before a snapshot can
become the runtime source. Do not hide incompatibility with an ASCII-only rule or
silently remap an existing assignment.

The audit also found static Excel column construction using single characters
after column E. The shared-definition path must not inherit that checklist-size
limit. Fix column addressing and verify workbook/schema parity without live
Microsoft services before wiring larger accepted checklists.

## Acceptance criteria

- Given an active document member without source-template access, when a valid
  definition is adopted, then module/category/checklist reads and assignments
  use that document's definitions without reading the private template.
- Given two competing adoptions or a changed source, when requests reach the
  database, then exactly one reviewed snapshot can win and a stale request
  cannot replace it. A lost reply can be reconciled by its exact receipt.
- Given a revoked member or closing account, when a cloud read is attempted,
  then access fails closed. Reads otherwise follow existing document rights:
  locked documents still need labels, and an owner can read their archived file.
  Preview and adoption reject archived or locked documents.
- Given a local file, when adoption/save/reopen/page replacement occurs, then
  the same definitions and prior assignments survive with no cloud request.
- Given private template settings, malformed data, aliases or missing IDs, when
  preview is requested, then only allowlisted valid definitions can be returned;
  errors retain the old file and source data.
- Given a flag-off or unadopted document, when existing flows run, then legacy
  behavior remains intact without silent adoption or wider template access.

## Release limits

Document definition history, explicit upgrades, legacy sidecar retirement,
real two-user/offline/revocation verification and cloud deployment remain part
of the full data-layer goal. Static workbook tests do not prove Microsoft 365
integration. Do not start a Microsoft trial or live Microsoft testing here.
