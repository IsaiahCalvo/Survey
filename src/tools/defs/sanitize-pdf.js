import { ToolError, base, pdfOut } from '../kit.js';

export default {
  view: 'files',
  options: [
    { key: 'info', label: 'Document details: title, author, dates and the app that made it', type: 'check', def: true },
    { key: 'metadata', label: 'Hidden XMP metadata', type: 'check', def: true },
    { key: 'scripts', label: 'Scripts and actions that run on their own', type: 'check', def: true },
    { key: 'files', label: 'Attached files', type: 'check', def: true },
    { key: 'comments', label: 'Comments and markups', type: 'check', def: false },
  ],
  async run([file], opts) {
    if (!['info', 'metadata', 'scripts', 'files', 'comments'].some((k) => opts[k])) throw new ToolError('Tick at least one thing to remove.');
    const { sanitizePdf } = await import('../sanitize.js');
    const r = await sanitizePdf(file.bytes, opts);
    return [{ ...pdfOut(`${base(file.name)}-clean.pdf`, r.bytes), note: r.note }];
  },
};
