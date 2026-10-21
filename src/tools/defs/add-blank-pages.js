import { SEG, base, pdfOut, ToolError } from '../kit.js';
import { parsePageSet } from '../ranges.js';

export default {
  view: 'pages',
  options: [
    { key: 'where', label: 'Where', type: SEG, def: 'each', choices: [['each', 'After every page'], ['after', 'After some pages'], ['start', 'At the start'], ['end', 'At the end']] },
    { key: 'after', label: 'After pages', type: 'text', def: '', placeholder: '2, 5-7', show: (o) => o.where === 'after', help: 'Use commas and dashes, like 2, 5-7.' },
    { key: 'count', label: 'Blank pages each time', type: 'number', def: '1', min: 1 },
  ],
  async run([file], o) {
    const { addBlankPages } = await import('../reorder.js');
    let after = [];
    if (o.where === 'after') {
      if (!String(o.after).trim()) throw new ToolError('Type the pages to add blank pages after, like 2, 5.');
      after = parsePageSet(o.after, file.pages);
    }
    const bytes = await addBlankPages(file.bytes, { where: o.where, after, count: o.count });
    return [pdfOut(`${base(file.name)}-with-blanks.pdf`, bytes)];
  },
};
