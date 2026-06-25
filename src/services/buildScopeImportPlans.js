// src/services/buildScopeImportPlans.js
//
// Bridges the live Excel-import code in PDFViewer to the pure rowImportMatcher
// (STAGE1-IDENTITY-PLAN.md). For each imported worksheet that carries a visible
// `Row ID` column, it resolves the column layout, builds the matcher's `rows`
// (the Row ID cell + the exact visible values, fingerprinted identically to
// export) and `stored` (the per-scope markers that carry an excelSync identity
// record), then runs buildImportPlan and returns the decisions keyed by the real
// Excel data-row index so the caller can apply them in its existing row loop.
//
// Worksheets with NO `Row ID` column are omitted from the result — the caller
// keeps its legacy name-match fallback for those (a legacy/column-deleted sheet).
//
// Pure + async. Mutates nothing; produces decisions only. candidateDeletes are
// returned for the CALLER to triage (received markers → History-backed removal,
// never-received → review-only, stale imports → review-only); nothing is deleted here.

import { buildImportPlan } from './rowImportMatcher.js';
import { buildMarkerIdentityRecord } from './excelIdentityRecord.js';
import { computeRowFingerprints } from './rowFingerprint.js';
import { detectFieldConflicts } from './excelConflictDetect.js';
import { parseRowIdToken } from './rowIdToken.js';

const SYSTEM_HEADERS = ['Row ID', 'Changed By', 'Changed Date', 'Item', 'Entity', 'Notes'];

// Privacy-bounded short hash (FNV-1a, 8 hex) for correlating a Row ID cell across
// imports WITHOUT logging the token, notes, or any user content.
const shortHash = (value) => {
  const s = value == null ? '' : String(value);
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
};

// Default logger: one compact, content-free line per scope so the user can SEE why
// each import row was matched / created / held for review. Override in tests.
const defaultLogger = (entry) => {
  try {
    // eslint-disable-next-line no-console
    console.info('[ImportPlan]', JSON.stringify(entry));
  } catch {
    /* logging must never throw */
  }
};

// scopeKeyFor produces the COLLISION-FREE key the returned plan Map is keyed by. It uses
// JSON.stringify of the [moduleId, categoryId] tuple so no character can bleed across the two
// fields — a hyphen OR colon CAN appear inside an id, which made `${moduleId}-${categoryId}`
// ambiguous (e.g. module 'a-b' + cat 'c' vs module 'a' + cat 'b-c' both collapsed to 'a-b-c',
// letting two distinct scopes overwrite each other inside the Map). JSON array encoding is
// deterministic + unambiguous (the same collision-proof slotting templatesEditorReload uses).
// Consumers MUST look up plans with this helper (or iterate the Map values, which now carry
// scopeId/moduleId/categoryId) and must NEVER reverse-split the key.
export const scopeKeyFor = (moduleId, categoryId) => JSON.stringify([moduleId, categoryId]);

const resolveUpdatedCategory = (templateToUse, matchedCategory) => {
  const modules = templateToUse?.modules || templateToUse?.spaces || [];
  for (const mod of modules) {
    const cat = (mod.categories || []).find((c) => c.id === matchedCategory.id);
    if (cat) return cat;
  }
  return matchedCategory;
};

/**
 * @param {object} params
 * @param {Array} params.worksheetDataList  [{ jsonData, headerRow, matchedCategory, matchedModuleId }]
 * @param {object} params.surveyMarkers  current keyed marker map (reads ann.excelSync)
 * @param {object} params.templateToUse  resolves each scope's checklist items by header text
 * @param {string} params.documentId  must equal the export-side documentId
 * @param {(keyId:string)=>string|null|Promise<string|null>} params.resolveSecret
 * @param {object} [params.appValuesByMarkerId]  markerId → the marker's CURRENT visible values
 *   (same {changedBy,changedDate,item,entity,notes,answers} shape as export). When supplied,
 *   a matched ('apply') row whose SAME field was edited on BOTH sides since last sync (PLAN
 *   Amendment #6) is downgraded to a 'conflict' REVIEW instead of silently overwriting the
 *   app — the user picks the winner. Omit it (current behavior) and no apply is reclassified.
 * @returns {Promise<Map<string, {scopeId:string, moduleId:string, categoryId:string,
 *          byRowIndex:Map<number,object>, candidateDeletes:string[]}>>}
 *          keyed by the collision-free scopeKey (scopeKeyFor); each VALUE carries scopeId /
 *          moduleId / categoryId so consumers never reverse-split the key. Only scopes WITH a
 *          Row ID column are present.
 */
export const buildScopeImportPlans = async ({
  worksheetDataList = [],
  surveyMarkers = {},
  templateToUse,
  documentId,
  resolveSecret,
  appValuesByMarkerId = null,
  // Monotonic per-import sequence (wall-clock taken ONCE at the executor boundary in
  // PDFViewer — this module stays pure). Stamped as lastIngestSeq next to
  // lastSeenRowNumber on every apply/create identity record so future positional tiers
  // can tell a fresh position from a stale one. Optional: omitted → records simply
  // carry no ingest stamp (older callers, tests) and nothing changes behavior.
  ingestSeq = null,
  logger = defaultLogger
}) => {
  const result = new Map();

  // ---- Phase 1: per-worksheet prep. Cross-scope reconciliation (blank-rowid slice 3)
  // needs EVERY scope's blank-row fingerprints before ANY scope's matcher runs — a row
  // cut from one sheet and pasted into another must shield its old marker from being
  // eliminated-against locally — so row/stored construction is hoisted out of the
  // matcher pass. Worksheets without a Row ID column are skipped exactly as before.
  const prepped = [];
  for (const { jsonData, headerRow, matchedCategory, matchedModuleId } of worksheetDataList) {
      if (!Array.isArray(headerRow) || !Array.isArray(jsonData)) continue;
      const rowIdIdx = headerRow.indexOf('Row ID');
      if (rowIdIdx === -1) continue; // no Row ID column → caller keeps legacy name-match

      const scopeId = `${matchedModuleId}:${matchedCategory.id}`;
      const scopeKey = scopeKeyFor(matchedModuleId, matchedCategory.id);

      const changedByIdx = headerRow.indexOf('Changed By');
      const changedDateIdx = headerRow.indexOf('Changed Date');
      const itemIdx = headerRow.indexOf('Item');
      const entityIdx = headerRow.indexOf('Entity');
      const notesIdx = headerRow.indexOf('Notes');

      // header text → checklistId, using the live category (same resolution as the caller)
      const checklistItems = resolveUpdatedCategory(templateToUse, matchedCategory).checklist || [];
      const colToChecklistId = {};
      headerRow.forEach((colText, index) => {
        if (SYSTEM_HEADERS.includes(colText)) return;
        const trimmed = colText?.toString().trim();
        if (!trimmed) return;
        const ci = checklistItems.find((c) => c.text === trimmed);
        if (ci) colToChecklistId[index] = ci.id;
      });

      const cellAt = (row, idx) => (idx >= 0 ? row[idx] : '');
      const buildValues = (row) => {
        const answers = {};
        for (const [colIndex, checklistId] of Object.entries(colToChecklistId)) {
          answers[checklistId] = row[colIndex];
        }
        return {
          changedBy: cellAt(row, changedByIdx),
          changedDate: cellAt(row, changedDateIdx),
          item: cellAt(row, itemIdx),
          entity: cellAt(row, entityIdx),
          notes: cellAt(row, notesIdx),
          answers
        };
      };

      // rows[] mirror matcher order; jsonIndexByPos maps a decision's rowIndex back
      // to the real Excel data-row index the caller's loop uses.
      const rows = [];
      const jsonIndexByPos = [];
      for (let i = 1; i < jsonData.length; i += 1) {
        // sheetRowNumber: the TRUE 1-based sheet row, captured by the exceljs parse
        // loop as a non-index property on the row array (eachRow skips empty rows, so
        // the array index is "nth non-empty row", NOT the sheet row). null when absent
        // (older callers, fixtures) — carried as data only; the matcher ignores it.
        const sheetRowNumber =
          Number.isInteger(jsonData[i].sheetRowNumber) && jsonData[i].sheetRowNumber > 0
            ? jsonData[i].sheetRowNumber
            : null;
        rows.push({ rowIdCell: jsonData[i][rowIdIdx], values: buildValues(jsonData[i]), sheetRowNumber });
        jsonIndexByPos.push(i);
      }

      const stored = [];
      for (const [key, ann] of Object.entries(surveyMarkers)) {
        const annModuleId = ann?.moduleId || ann?.spaceId;
        if (annModuleId === matchedModuleId && ann?.categoryId === matchedCategory.id && ann?.excelSync) {
          stored.push({
            markerId: key,
            identityVectorFingerprint: ann.excelSync.identityVectorFingerprint,
            fullRowFingerprint: ann.excelSync.fullRowFingerprint,
            fieldFingerprints: ann.excelSync.fieldFingerprints,
            // Lineage for copy/paste resolution: a marker created from a copied row
            // remembers which original it copied and its position in the group.
            copyOfMarkerId: ann.excelSync.copyOfMarkerId,
            copyOrdinal: ann.excelSync.copyOrdinal,
            // Positional memory (slice 2/3): where this marker's row sat at the last
            // ingested save + which ingest observed it. The matcher validates and
            // degrades to content-only tiers when these are missing/stale.
            lastSeenRowNumber: ann.excelSync.lastSeenRowNumber,
            lastIngestSeq: ann.excelSync.lastIngestSeq
          });
        }
      }

      // Blank-row identity fingerprints for cross-scope reconciliation, using the
      // matcher's EXACT blank rule (parseRowIdToken): only a genuinely blank Row ID
      // cell counts — malformed/foreign tokens are review rows, never "blank".
      const blankFps = new Set();
      for (const r of rows) {
        const parsed = parseRowIdToken(r.rowIdCell);
        if (!parsed.ok && parsed.reason === 'blank') {
          blankFps.add((await computeRowFingerprints(r.values)).identityVectorFingerprint);
        }
      }

      prepped.push({
        scopeId, scopeKey, moduleId: matchedModuleId, categoryId: matchedCategory.id,
        rows, jsonIndexByPos, stored, blankFps
      });
  }

  // ---- Phase 2: run the matcher per scope, each told which blank-row fingerprints
  // exist in the OTHER scopes of this same import.
  await Promise.all(
    prepped.map(async ({ scopeId, scopeKey, moduleId, categoryId, rows, jsonIndexByPos, stored, blankFps }) => {
      const crossScopeBlankFingerprints = new Set();
      for (const other of prepped) {
        if (other.blankFps === blankFps) continue;
        for (const fp of other.blankFps) crossScopeBlankFingerprints.add(fp);
      }

      const plan = await buildImportPlan({
        rows, stored, documentId, scopeId, resolveSecret, crossScopeBlankFingerprints
      });

      // Attach a ready-to-stamp identity record (computed from the SAME visible row
      // values) to every apply/create decision, so when the import creates or updates
      // a marker it remembers the row by content — making the row a first-class member
      // of `stored` on the next sync. This is what stops repeated saves and blank
      // copied rows from duplicating: a second save recovers the marker by fingerprint
      // instead of creating a twin.
      await Promise.all(plan.decisions.map(async (d) => {
        if (d.action === 'apply' || d.action === 'create') {
          d.identityRecord = await buildMarkerIdentityRecord({
            values: rows[d.rowIndex].values,
            origin: 'import',
            // Positional memory (blank-Row-ID plan, slice 2): where this row sat in the
            // sheet at this ingest + which ingest observed it. Read by future positional
            // tiers only; absence (null) is always valid and changes nothing today.
            lastSeenRowNumber: rows[d.rowIndex].sheetRowNumber ?? null,
            lastIngestSeq: ingestSeq
          });
          // A new copy remembers its lineage so the next import recognizes it by
          // (origin, ordinal) instead of creating yet another twin.
          if (d.decision === 'copy-new') {
            d.identityRecord.copyOfMarkerId = d.copyOfMarkerId;
            d.identityRecord.copyOrdinal = d.copyOrdinal;
          }

          // Conflict guard (Amendment #6): if the caller told us this marker's CURRENT app
          // values and the SAME field was edited on both sides since the last sync, do not
          // silently overwrite — downgrade to a 'conflict' review so the user chooses.
          if (d.action === 'apply' && appValuesByMarkerId && d.markerId && appValuesByMarkerId[d.markerId]) {
            const baseline = surveyMarkers[d.markerId]?.excelSync?.fieldFingerprints;
            if (baseline) {
              const appNow = (await computeRowFingerprints(appValuesByMarkerId[d.markerId])).fieldFingerprints;
              const excelIn = d.identityRecord.fieldFingerprints; // incoming Excel row
              const fieldDiff = detectFieldConflicts({ baseline, appNow, excelIn });
              if (fieldDiff.conflictFields.length > 0) {
                d.action = 'review';
                d.decision = 'conflict';
                d.conflictFields = fieldDiff.conflictFields;
                d.excelValues = rows[d.rowIndex].values; // stashed so "use Excel's version" can apply later
              } else {
                // True 3-way merge (Amendment #6): Excel may write ONLY the fields Excel
                // itself changed since the baseline. App-only edits (incl. a kept "keep my
                // version" choice) are never reverted by a row that merely differs from the
                // app — the apply loop honors this whitelist when present.
                d.excelChangedFields = fieldDiff.excelChangedFields;
              }
            }
          }
        }
      }));

      const byRowIndex = new Map();
      for (const d of plan.decisions) {
        const jsonIndex = jsonIndexByPos[d.rowIndex];
        if (jsonIndex != null) byRowIndex.set(jsonIndex, d);
      }
      // Each plan VALUE is self-describing: scopeId (`${moduleId}:${categoryId}`, the value the
      // matcher signs Row-ID tokens over), moduleId, and categoryId. Consumers read identity
      // from here and never reverse-split the collision-free Map key (scopeKey).
      result.set(scopeKey, {
        scopeId, moduleId, categoryId,
        byRowIndex, candidateDeletes: plan.candidateDeletes
      });

      // Content-free observability: per-row decision + reason + short token hash, plus
      // a counts roll-up. Never logs the token, item name, notes, or any cell value.
      const counts = {};
      const perRow = plan.decisions.map((d) => {
        counts[d.decision] = (counts[d.decision] || 0) + 1;
        return {
          row: jsonIndexByPos[d.rowIndex],
          decision: d.decision,
          action: d.action,
          rowIdHash: shortHash(rows[d.rowIndex]?.rowIdCell)
        };
      });
      logger({
        scopeKey,
        storedCount: stored.length,
        rowCount: rows.length,
        counts,
        candidateDeletes: plan.candidateDeletes.length,
        rows: perRow
      });
    })
  );

  return result;
};
