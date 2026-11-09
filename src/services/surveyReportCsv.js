// Survey report as a CSV table (nightly flag 'survey-report'): one row per
// survey item with its category, status and issue lines. Opens in Excel,
// Google Sheets or Numbers; the numbers match the PowerPoint report.
import { summarizeSurvey } from './surveySummary.js';
import { itemFollowUp } from './surveyReportPptx.js';
import { todayKey } from '../utils/markerTracking.js';

const STATUS_LABEL = { done: 'Done', partly: 'Partly done', notStarted: 'Not started' };
// Follow-up: the item's status / who has it / due date; Note: its note.
export const SURVEY_REPORT_CSV_HEADER = ['Category', 'Item', 'Status', 'Lines answered', 'Lines', 'Issues', 'Follow-up', 'Note'];

// Quote every text cell; a leading = + - @ is made plain text so a
// spreadsheet never runs it as a formula.
function cell(value) {
  if (typeof value === 'number') return String(value);
  let v = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return `"${v.replace(/"/g, '""')}"`;
}

export function surveyReportCsv({ template, markers, people = [], when = new Date() } = {}) {
  const summary = summarizeSurvey({ template, markers, rows: true });
  const today = todayKey(when);
  const lines = [SURVEY_REPORT_CSV_HEADER.map(cell).join(',')];
  for (const c of summary.categories) {
    for (const r of c.rows) {
      const issues = r.issues.map((l) => `${l.text}: ${l.answer}`).join('; ');
      const follow = itemFollowUp(markers?.[r.id], { people, today });
      lines.push([c.name, r.name, STATUS_LABEL[r.status], r.answered, r.total, issues, follow.tracking, follow.note].map(cell).join(','));
    }
  }
  // A byte-order mark so Excel reads it as UTF-8 (units like °F).
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** "<template> report.csv" without unsafe characters. */
export function surveyReportCsvFileName(template) {
  const base = String(template?.name || 'Survey').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Survey';
  return `${base} report.csv`;
}

export function downloadSurveyReportCsv(input) {
  const blob = new Blob([surveyReportCsv(input)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = surveyReportCsvFileName(input?.template);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
