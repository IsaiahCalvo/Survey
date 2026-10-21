// Fast web view (linearize): qpdf reorders the file so the first page and an
// index of the rest come first. A browser or reader can then show page 1 while
// the rest is still downloading. No DOM; the qpdf runner is passed in.
import { ToolError } from './errors.js';
import { repairPdf } from './repair.js';

// A linearized file says so in its first object, within the first 1 KB.
export function isLinearized(bytes) {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  return /\/Linearized\s/.test(head);
}

const FAILED = 'This file could not be read as a PDF. It may be damaged. Try Repair PDF first, then try again.';

export async function linearizePdf(run, bytes) {
  let r = await run(bytes, ['--linearize']);
  let fixed = false;
  if (!r.out) {
    // qpdf can't mend a broken index in this build; let the repair steps
    // rebuild the file, then try once more.
    const repaired = await repairPdf(bytes, { run }).catch(() => null);
    if (!repaired) throw new ToolError(FAILED);
    r = await run(repaired.bytes, ['--linearize']);
    if (!r.out) throw new ToolError(FAILED);
    fixed = true;
  }
  let note = isLinearized(bytes)
    ? 'This PDF was already set up for fast web view. It has been set up again, freshly.'
    : 'Done. Browsers can now show the first page while the rest is still loading.';
  if (fixed) note += ' The file was damaged, so it was repaired first.';
  return { bytes: r.out, note };
}
