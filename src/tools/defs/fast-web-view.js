import { base, pdfOut, runQpdf } from '../kit.js';

export default {
  view: 'files',
  async run([file], opts, progress) {
    const { linearizePdf } = await import('../webview.js');
    progress('Setting up fast web view');
    const r = await linearizePdf(runQpdf, file.bytes);
    return [{ ...pdfOut(`${base(file.name)}-web.pdf`, r.bytes), note: r.note }];
  },
};
