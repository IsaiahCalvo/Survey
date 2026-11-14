/* Team page extras (flag `team-plus`, Drawboard Projects parity TG-03, TG-05,
   EX-18): a note in the invite email, bulk invite from a CSV file
   (Email, Role) and the team list as a CSV. Pure: no React, no network
   (tests/teamCsv.test.mjs). */

export const INVITE_CSV_EXAMPLE = 'Email,Role\nalex@example.com,Editor\nsam@example.com,Viewer\n';
export const INVITE_CSV_MAX = 200;
export const INVITE_NOTE_MAX = 500;

const EMAIL_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;
const ROLE_WORDS = Object.freeze({
  viewer: 'Viewer', reader: 'Viewer', view: 'Viewer', read: 'Viewer',
  editor: 'Editor', collaborator: 'Editor', edit: 'Editor', 'super collaborator': 'Editor',
});

/** One CSV line into cells; handles "quoted, cells" and "" inside quotes. */
export function csvCells(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',' || ch === ';' || ch === '\t') { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/**
 * A CSV of people to invite -> { rows: [{ email, role }], problems: [string] }.
 * Columns are found by their header (Email, Role) in any order; with no
 * header the first column is the email and the second the role. A missing or
 * unknown role takes `fallbackRole`. Repeats keep the first line.
 */
export function parseInviteCsv(text, { fallbackRole = 'Editor' } = {}) {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const problems = [];
  if (!lines.length) return { rows: [], problems: ['The file is empty.'] };
  let emailCol = 0;
  let roleCol = 1;
  let start = 0;
  const head = csvCells(lines[0]).map((c) => c.toLowerCase().replace(/[-_\s]/g, ''));
  if (head.some((c) => c.includes('email'))) {
    emailCol = head.findIndex((c) => c.includes('email'));
    roleCol = head.findIndex((c) => c.includes('role') || c.includes('permission') || c.includes('access'));
    start = 1;
  }
  const seen = new Set();
  const rows = [];
  for (let i = start; i < lines.length; i += 1) {
    const cells = csvCells(lines[i]);
    const email = String(cells[emailCol] || '').toLowerCase();
    if (!EMAIL_RE.test(email)) { problems.push(`Line ${i + 1}: "${cells[emailCol] || ''}" is not an email address.`); continue; }
    if (seen.has(email)) continue;
    seen.add(email);
    const roleText = roleCol >= 0 ? String(cells[roleCol] || '').toLowerCase().trim() : '';
    const role = ROLE_WORDS[roleText] || fallbackRole;
    if (roleText && !ROLE_WORDS[roleText]) problems.push(`Line ${i + 1}: role "${cells[roleCol]}" is not Viewer or Editor, so ${email} gets ${fallbackRole}.`);
    rows.push({ email, role });
    if (rows.length >= INVITE_CSV_MAX) { problems.push(`Only the first ${INVITE_CSV_MAX} people are invited at once.`); break; }
  }
  return { rows, problems };
}

/** "3 Editors and 9 Viewers" style count for the invite card. */
export function csvRoleSummary(rows) {
  const n = { Editor: 0, Viewer: 0 };
  for (const r of rows || []) n[r.role] = (n[r.role] || 0) + 1;
  const part = (count, word) => (count ? `${count} ${word}${count === 1 ? '' : 's'}` : '');
  return [part(n.Editor, 'Editor'), part(n.Viewer, 'Viewer')].filter(Boolean).join(' and ') || 'nobody';
}

const cell = (v) => {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The team list as CSV: Name, Email, Role, Status, Access, Added. */
export function teamCsv(rows) {
  const lines = [['Name', 'Email', 'Role', 'Status', 'Access', 'Added'].join(',')];
  for (const r of rows || []) {
    lines.push([r.name, r.email, r.role, r.status, r.access, r.added].map(cell).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

export function teamCsvFileName(projectName, now = new Date()) {
  const base = String(projectName || 'Project').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Project';
  const pad = (n) => String(n).padStart(2, '0');
  return `${base} team ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.csv`;
}
