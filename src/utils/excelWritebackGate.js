/**
 * excelWritebackGate.js — Stage 0 safety switch for Excel writeback.
 *
 * The current automatic Excel writeback rebuilds and re-uploads the ENTIRE
 * workbook on every save / delete / live-sync tick (the `silent` export path),
 * which can stomp a concurrent editor's file and formatting. Until Stage 3's
 * safe patch-only writer + durable outbound queue land, all AUTOMATIC (silent)
 * writeback is disabled. Manual export ("Sync to Excel" / export-a-copy) runs
 * the non-silent path and is unaffected.
 *
 * Flip EXCEL_AUTOMATIC_WRITEBACK_ENABLED to true only when the patch-writer ships.
 */

export const EXCEL_AUTOMATIC_WRITEBACK_ENABLED = false;

/**
 * True when an export should be blocked because it is an automatic (silent)
 * writeback while automatic writeback is disabled. Manual exports (silent=false)
 * are never blocked; nothing is blocked once the switch is enabled.
 *
 * @param {boolean} silent  whether this is a silent/automatic export
 * @param {boolean} [enabled]  override the global switch (for tests)
 * @returns {boolean}
 */
export function isSilentWritebackBlocked(silent, enabled = EXCEL_AUTOMATIC_WRITEBACK_ENABLED) {
  return Boolean(silent) && !enabled;
}
