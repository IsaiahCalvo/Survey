// RTF to PDF: our RTF reader (../rtf.js) turns the file into blocks and the
// Word to PDF layout draws them, so text stays real, selectable text.
import { DOC_OPTIONS, blocksToPdf, docNotice } from '../kit.js';

export default {
  view: 'files',
  options: DOC_OPTIONS,
  async prepare(item) {
    const { inspectRtf } = await import('../rtf.js');
    item.notes = inspectRtf(item.bytes);
  },
  notice: docNotice,
  async run([file], o, progress) {
    const { readRtf } = await import('../rtf.js');
    progress('Reading the document');
    const { blocks, skippedImages } = readRtf(file.bytes);
    progress('Making the PDF');
    return [await blocksToPdf(blocks, file.name, o, { left: skippedImages })];
  },
};
