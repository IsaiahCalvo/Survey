// src/services/excelLockFile.js
//
// Detects whether a local .xlsx is currently OPEN in desktop Excel by looking for the
// "owner"/lock file Excel drops next to it (PLAN.md capability matrix: a local file
// must NEVER be written while Excel has it open — macOS lets the write succeed but
// Excel's autosave then clobbers it). Excel names that file `~$<filename>` in the same
// directory while the workbook is open, and removes it on close.
//
// This module is PURE (path math only). The actual filesystem existence check is done
// by the caller via the Electron file APIs — see isExcelWorkbookOpen in PDFViewer.

const splitPath = (filePath) => {
  const s = String(filePath || '');
  const idx = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  if (idx === -1) return { dir: '', sep: '/', base: s };
  return { dir: s.slice(0, idx), sep: s[idx], base: s.slice(idx + 1) };
};

/** Directory portion of a path ('' when there is none). */
export const parentDir = (filePath) => splitPath(filePath).dir;

/** Filename portion of a path. */
export const baseName = (filePath) => splitPath(filePath).base;

/**
 * The path of Excel's owner/lock file for a workbook: `<dir>/~$<filename>`.
 * Returns null for an empty path.
 */
export const excelLockFilePath = (filePath) => {
  const { dir, sep, base } = splitPath(filePath);
  if (!base) return null;
  return dir ? `${dir}${sep}~$${base}` : `~$${base}`;
};

/** True when a directory entry name looks like an Excel owner/lock file. */
export const isExcelOwnerFile = (name) => typeof name === 'string' && name.startsWith('~$');

/**
 * The owner/lock file's bare NAME (no directory) for a workbook: `~$<filename>`.
 * Returns null for an empty path.
 */
export const excelOwnerFileName = (filePath) => {
  const { base } = splitPath(filePath);
  return base ? `~$${base}` : null;
};

/**
 * True when a directory entry name is the owner/lock file for THIS specific workbook
 * — not merely any open workbook sharing the folder. We must only block a push when the
 * lock file belongs to the exact target file (e.g. `~$Security_export.xlsx` blocks
 * `Security_export.xlsx`, but a stray `~$Budget.xlsx` does not). Comparison is
 * case-insensitive because the default macOS/Windows filesystems are case-insensitive.
 */
export const isOwnerFileFor = (entryName, filePath) => {
  const owner = excelOwnerFileName(filePath);
  if (!owner || typeof entryName !== 'string') return false;
  return entryName.toLowerCase() === owner.toLowerCase();
};
