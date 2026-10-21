// HTML to PDF: the page is read with DOMParser (its scripts never run and
// nothing it links to is fetched), tidied by html.js and laid out by the Word
// to PDF code, so text stays real, selectable text.
import { DOC_OPTIONS, blocksToPdf, ToolError } from '../kit.js';

// pdf-lib embeds PNG and JPEG; other pictures saved inside the page (GIF,
// WebP, SVG...) are redrawn as PNG first.
async function toPng(src) {
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth || 300;
    c.height = img.naturalHeight || 150;
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const url = c.toDataURL('image/png');
    c.width = 0;
    return url;
  } catch {
    return src; // left out, and counted, when the PDF is made
  }
}

export default {
  view: 'files',
  options: DOC_OPTIONS,
  async prepare(item) {
    const { decodeHtml, pageToSimpleHtml } = await import('../html.js');
    const doc = new DOMParser().parseFromString(decodeHtml(item.bytes), 'text/html');
    item.page = pageToSimpleHtml(doc);
  },
  notice(files) {
    const linked = files.reduce((n, f) => n + (f.page?.linkedImages || 0), 0);
    const pics = linked ? ` ${linked === 1 ? 'One picture is a separate file' : `${linked} pictures are separate files`}, not saved inside the page, so ${linked === 1 ? 'it' : 'they'} can't come along.` : '';
    return `Text, headings, lists, tables and pictures carry over. Colors, columns and page styling are left out, like a printer-friendly page.${pics}`;
  },
  async run([file], o, progress) {
    const { htmlToBlocks } = await import('../docLayout.js');
    progress('Reading the page');
    let { html } = file.page;
    const other = [...new Set(html.match(/data:image\/(?!png|jpe?g)[^"]+/gi) || [])];
    for (const src of other) html = html.split(src).join(await toPng(src));
    const blocks = htmlToBlocks(html);
    if (!blocks.length) throw new ToolError('This page has no text or pictures to put in a PDF.');
    progress('Making the PDF');
    return [await blocksToPdf(blocks, file.name, o, {
      left: file.page.linkedImages,
      why: (one) => (one ? 'it is a separate file, not saved inside the page' : 'they are separate files, not saved inside the page'),
    })];
  },
};
