# Marker unification — decision package

```json
{
  "canonical_shape_options": [
    {
      "name": "Option A - Adopt desktop's shape as the canonical Marker",
      "plain_summary": "Make the shared Marker look like what the desktop already uses, since the desktop is the side wired into Excel and the database. Mobile keeps its own simple objects for the screen but translates to and from this shared shape when saving or syncing.",
      "excel_risk": "low",
      "pros": [
        "Excel sync identity fields (name, entityName, note.text, checklistResponses) stay exactly where the Excel code expects them, so the round-trip fingerprinting code does not move.",
        "All four critical Excel identity fields keep their current names and structure, so none of the 8 safety test files need assertion changes.",
        "Desktop already persists this shape to Supabase and exports to Excel; no data migration or document_annotations column change required.",
        "Formalizes a shape that already works in production on the recovered codebase - lowest chance of a surprise."
      ],
      "cons": [
        "Mobile does more translation: scalar notes to note.text object, single entity string to entityId+entityName, normalized x/y point to bounds rectangle, numeric id to string id.",
        "Carries desktop's heavier field set (excelSync, changedBy/changedDate, version, supabaseId) that mobile does not use.",
        "Mobile's cleaner entity-as-id model is not adopted; keeps the denormalized entityId+entityName pair."
      ],
      "what_changes_desktop": "Almost nothing functional. Desktop's marker object and mappers in src/services/documentSurveyMarkerMapper.js stay as-is; add a TypeScript SurveyMarker type in packages/shared/src/surveyMarker.ts documenting the existing shape. No change to buildSurveyMarkerRow, markerRowValues.js, or any Excel code path.",
      "what_changes_mobile": "Mobile keeps its on-screen Marker for rendering but gains a small adapter so anything it syncs uses the canonical shape: notes wrapped as note.text, entity id resolved to entityId+entityName, x/y converted to bounds, numeric id mapped to a stable string id. Mobile-only done field stays local."
    },
    {
      "name": "Option B - Adopt mobile's cleaner entity-reference shape as canonical",
      "plain_summary": "Make the shared Marker look like the simpler mobile version: entity is just an id and notes is plain text. The desktop would convert this to its richer form only at the moment it talks to Excel and the database.",
      "excel_risk": "high",
      "pros": [
        "Cleaner, smaller canonical type; entity is a single id with no duplicated name to keep in sync.",
        "Closer to a normalized model that is easier to reason about long-term.",
        "Mobile needs little to no translation since the shared shape matches what it holds."
      ],
      "cons": [
        "The Excel identity code reads marker.entityName and marker.note.text directly. Dropping entityName and flattening note to a string forces every place that builds Excel row values (markerRowValues.js lines 70-71) and every fingerprint baseline to be re-derived - the exact export/import drift that makes every row false-flag as both-sides-changed.",
        "entityName has an export-time fallback to module data (resolveMarkerModuleData); collapsing entity to an id alone risks export and import resolving the name differently, silently breaking blank-row recovery by content (identityVectorFingerprint diverges).",
        "High chance the 8 safety suites need rewriting, and any miss is a silent data-loss path on the Excel roundtrip - unacceptable on a freshly recovered codebase.",
        "Forces desktop to add a new denormalization layer in the most sensitive code path."
      ],
      "what_changes_desktop": "Significant. Desktop needs a new resolver turning entityId into entityName and note.text into and out of a plain string at the Excel and Supabase boundary, touching markerRowValues.js, documentSurveyMarkerMapper.js, and the excelSync fingerprint baseline - the riskiest possible change since it sits on row-identity matching.",
      "what_changes_mobile": "Minimal - mobile's shape becomes the shared shape almost verbatim (entity:string, notes:string)."
    },
    {
      "name": "Option C - Hybrid: shared CORE of already-matching sub-fields plus per-app extensions",
      "plain_summary": "Put in the shared type only the parts that already match perfectly across both apps (the survey identity and checklist answers), and let each app keep its own extra fields. This essentially writes down the split the codebase already lives by, with no behavior change.",
      "excel_risk": "low",
      "pros": [
        "Matches the codebase's stated decision: packages/shared/src/survey.ts already shares ChecklistResponses and Entity and says the full Marker is intentionally NOT unified yet. This safely extends that core.",
        "Zero change to any Excel code path or document_annotations columns - the four identity fields stay where they are; no test assertions change.",
        "Gives both apps a single typed contract for fields that genuinely agree (moduleId, categoryId, checklistResponses, Entity sub-shape, Bounds), catching drift at compile time without risky reshaping.",
        "Smallest, most reversible step - ideal first move on a recovered codebase; can graduate to Option A later.",
        "Leaves mobile-only done and desktop-only excelSync/audit as documented per-app extensions rather than pretending they are shared."
      ],
      "cons": [
        "Does not fully unify the Marker - apps still differ on entity (id vs id+name), note (string vs object), and coordinates (x/y vs bounds); cross-app sync of a full marker still needs an adapter later.",
        "Two app-specific marker types continue to exist, so it is a partial rather than final answer to one agreed Marker shape.",
        "Defers the harder reconciliation (coordinates, note, entity denormalization)."
      ],
      "what_changes_desktop": "Nothing functional. Desktop keeps its marker object and mappers untouched. Add a shared SurveyMarkerCore type (moduleId, categoryId, regionId, name, checklistResponses, Entity sub-shape, Bounds, visibilityScope) in packages/shared and optionally have desktop extend it for type-checking only. No Excel or DB changes.",
      "what_changes_mobile": "Mobile's Marker is refactored to extend SurveyMarkerCore for the matching fields (moduleId, categoryId, checklistResponses, entity sub-shape), keeping its own id/x/y/notes/photos/videos/done as a documented extension. No runtime behavior change."
    }
  ],
  "recommendation": "Pick Option C now (the small shared core), with Option A as the documented end-state to graduate to later. In plain terms: the desktop is the only side wired into Excel, and Excel matches rows by four specific fields - the marker's name, its entity name, its note text, and its checklist answers. Those fields are extremely sensitive; renaming or restructuring them can silently break the Excel roundtrip and lose data. On a freshly recovered codebase the safest move is the one that changes none of that. Option C only writes down, as a shared type, the fields both apps already agree on (module, category, checklist answers, the entity sub-shape, the bounds shape) - exactly the path the codebase already started in packages/shared/src/survey.ts. It touches zero Excel code, needs zero database migration, and requires zero changes to the 8 safety test files. Option B (adopt mobile's simpler shape) is the high-risk choice because it forces desktop to re-derive the entity name and note text right inside the row-identity matching code, the one place we must not disturb. Option A is a fine final destination, but reshaping mobile to fully match desktop is more work than needed for the immediate goal of one agreed contract without Excel risk; do it as a follow-up once C is in and trusted.",
  "excel_safety_gate": {
    "runnable_offline_here": true,
    "tests_to_run": [
      "node --test src/services/__tests__/markerRowValues.test.mjs",
      "node --test src/services/__tests__/rowFingerprint.test.mjs",
      "node --test src/services/__tests__/excelIdentityRecord.test.mjs",
      "node --test src/services/__tests__/rowImportMatcher.test.mjs",
      "node --test src/services/__tests__/rowImportMatcherFieldOverlap.test.mjs",
      "node --test src/services/__tests__/rowImportMatcherPositional.test.mjs",
      "node --test src/services/__tests__/excelBlankRowIdScenario.test.mjs",
      "node --test src/services/__tests__/buildScopeImportPlans.test.mjs",
      "npm test (runs scripts/run-node-tests.mjs - the full offline node:test suite under tests/ and src/**/__tests__)"
    ],
    "if_not_offline": "Not needed for the unit and integration gate - all 8 core Excel-safety suites are offline (no .env.test, no SUPABASE_INTEGRATION=1) and were confirmed green in this sandbox (95 tests pass). The only part not exercised offline is a real end-to-end Excel file roundtrip against a live Supabase document. Before go-live the owner should also: (1) run npm run test:integration (needs .env.test plus SUPABASE_INTEGRATION=1) on a credentialed machine; (2) manually export one real survey to xlsx, edit one Item/Notes/answer cell, re-import, and confirm exactly one row updates with no duplicate marker and no spurious both-sides-changed conflicts; (3) repeat the manual roundtrip on a blank-Row-ID row to confirm content recovery still pairs. Because Option C changes no Excel code, a green run of the 8 offline suites before AND after the change with byte-identical results is the gate - any change in test output means stop."
  },
  "implementation_outline": [
    "0. Branch: create a draft branch off the recovered main (feature/shared-survey-marker-core). Do all work here; do not push or merge until the gate passes.",
    "1. Baseline the gate: run the 8 offline Excel-safety suites and npm test; save the output as the before reference - results must be byte-identical after the change.",
    "2. Add the shared core type only (no behavior change): in packages/shared/src/surveyMarker.ts add a SurveyMarkerCore type covering fields both apps agree on - moduleId, categoryId, regionId (string|null), name, checklistResponses (reuse ChecklistResponses from survey.ts), the existing Entity sub-shape, Bounds (reuse geometry.ts), and visibilityScope (reuse the ANNOTATION_VISIBILITY_SCOPE enum). Do NOT add note/entityName/coordinate fields whose structure differs across apps. Export it from packages/shared/src/index.ts.",
    "3. Build the shared package: npm run build inside packages/shared so dist/ updates, since both apps consume it via file: links.",
    "4. Type-only adoption on desktop: optionally annotate the desktop marker object via a JSDoc typedef import of SurveyMarkerCore (documentSurveyMarkerMapper.js is JS) for editor checking. Make NO change to buildSurveyMarkerRow, mapSurveyMarkerRowToLocalAnnotation, markerRowValues.js, rowFingerprint.js, rowImportMatcher.js, or any Excel/Supabase code.",
    "5. Type-only adoption on mobile: refactor mobile-expo-go/App.tsx Marker to extend SurveyMarkerCore for the matching fields, keeping id(number), x, y, page, notes(string), photos, videos, and the mobile-only done as a documented extension. Update the comment at App.tsx:113 to note the core is now shared while the full marker stays app-local. No runtime logic changes.",
    "6. Resolve the done field question (see open questions) before relying on it; for now keep it mobile-only and out of the shared type.",
    "7. Re-run the gate: run the same 8 suites plus npm test. Confirm results are IDENTICAL to step 1 (95 core tests pass, no assertion changes). If anything differs, stop and investigate.",
    "8. Type-check both apps (tsc on mobile, plus desktop build/lint) to confirm the shared type compiles with no field mismatches.",
    "9. Document the decision: update docs/ANNOTATION-CONTRACT.md and the migration plan to record that SurveyMarkerCore is now shared and full Marker unification (Option A) is the deferred end-state. Update (do not delete) the existing note in packages/shared/src/survey.ts.",
    "10. Hand the draft branch to the owner with before/after test output attached; do not merge until they approve and run the live Excel roundtrip plus integration suite on a credentialed machine."
  ],
  "open_questions_for_user": [
    "The mobile done field (Record<string,boolean>) is declared but never read or written in the UI and has no desktop equivalent. Keep it mobile-local as scaffolding for a planned per-item completion feature, remove it as dead code, or promote it into the shared model? Recommend keeping it out of the shared type until the feature is real.",
    "End goal: do you want the apps to EVENTUALLY share one full Marker (Option A end-state), or keep two app-specific markers with only a shared core (Option C as the destination)? Determines whether the docs note A as a follow-up phase or as not planned.",
    "Entity representation long-term: keep desktop's denormalized entityId+entityName (needed for Excel today) or move to mobile's single entity id with name resolved on demand? Moving to id-only is the high-risk path because the Excel identity code reads entityName directly with a module-data fallback - confirm you want to keep entityId+entityName for now.",
    "Coordinates: mobile stores a normalized point (x/y 0..1) while desktop stores a bounds rectangle. If cross-app marker sync is ever needed we need an agreed conversion (point to centered rectangle of what size?). Is cross-app sync of the same marker in scope, or do the apps own separate markers?",
    "Marker id type differs (mobile number vs desktop string). If markers will ever cross apps we need one id strategy. In scope now, or can ids stay app-local while only survey content is shared?"
  ]
}
```
