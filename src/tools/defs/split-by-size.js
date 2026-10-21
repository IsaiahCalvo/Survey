// Split PDF by size: parts that each stay under a size, in one ZIP.
import { SEG, ToolError, base, pdfOut } from '../kit.js';

const MB = 1000 * 1000;
const limitOf = (opts) => {
  const n = Number(opts.limit === 'custom' ? opts.custom : opts.limit);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const pageList = (pages) => pages.map((i) => i + 1).join(', ');

export default {
  view: 'files',
  options: [
    { key: 'limit', label: 'Keep each part under', type: SEG, def: '10', choices: [['10', '10 MB'], ['20', '20 MB'], ['25', '25 MB'], ['custom', 'Other']] },
    { key: 'custom', label: 'Size in MB', type: 'number', def: '15', min: 1, show: (o) => o.limit === 'custom' },
  ],
  notice([file], opts) {
    const mb = limitOf(opts || {});
    if (file && mb && file.size <= mb * MB) return `This file is already under ${mb} MB, so it stays in one part.`;
    return null;
  },
  async run([file], opts, progress) {
    const mb = limitOf(opts);
    if (!mb) throw new ToolError('Type a size in MB, like 10.');
    if (file.size <= mb * MB) {
      const out = pdfOut(file.name, file.bytes);
      out.note = `The file is already under ${mb} MB, so there was nothing to split.`;
      return [out];
    }
    const { splitBySize, partName } = await import('../splitBySize.js');
    const { parts, tooBig } = await splitBySize(file.bytes, mb * MB, progress);
    const stem = base(file.name);
    const out = parts.map((p, i) => pdfOut(partName(stem, i + 1, parts.length), p.bytes));
    let note = `${parts.length} parts, each under ${mb} MB.`;
    if (tooBig.length) {
      const one = tooBig.length === 1;
      note = `${parts.length} parts. Page${one ? '' : 's'} ${pageList(tooBig)} ${one ? 'is' : 'are each'} over ${mb} MB on ${one ? 'its' : 'their'} own, so ${one ? 'it has its own part' : 'each has its own part'}. Try Compress PDF on ${one ? 'that part' : 'those parts'}.`;
    }
    out[0].note = note;
    return out;
  },
};
