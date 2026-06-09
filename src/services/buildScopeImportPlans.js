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
// Pure + async. Mutates nothing; produces decisions only. Excel-driven deletion of
// a placed marker stays OFF: candidateDeletes are returned for review surfacing,
// never acted on here.

import { buildImportPlan } from './rowImportMatcher.js';

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

// scopeKey matches the existing excelItemsByScope key in PDFViewer's import loop.
export const scopeKeyFor = (moduleId, categoryId) => `${moduleId}-${categoryId}`;

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
 * @returns {Promise<Map<string, {byRowIndex:Map<number,object>, candidateDeletes:string[]}>>}
 *          keyed by scopeKey; only scopes WITH a Row ID column are present.
 */
export const buildScopeImportPlans = async ({
  worksheetDataList = [],
  surveyMarkers = {},
  templateToUse,
  documentId,
  resolveSecret,
  logger = defaultLogger
}) => {
  const result = new Map();

  await Promise.all(
    worksheetDataList.map(async ({ jsonData, headerRow, matchedCategory, matchedModuleId }) => {
      if (!Array.isArray(headerRow) || !Array.isArray(jsonData)) return;
      const rowIdIdx = headerRow.indexOf('Row ID');
      if (rowIdIdx === -1) return; // no Row ID column → caller keeps legacy name-match

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
        rows.push({ rowIdCell: jsonData[i][rowIdIdx], values: buildValues(jsonData[i]) });
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
            fieldFingerprints: ann.excelSync.fieldFingerprints
          });
        }
      }

      const plan = await buildImportPlan({ rows, stored, documentId, scopeId, resolveSecret });

      const byRowIndex = new Map();
      for (const d of plan.decisions) {
        const jsonIndex = jsonIndexByPos[d.rowIndex];
        if (jsonIndex != null) byRowIndex.set(jsonIndex, d);
      }
      result.set(scopeKey, { byRowIndex, candidateDeletes: plan.candidateDeletes });

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
