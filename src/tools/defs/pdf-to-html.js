// PDF to HTML: one web page file. "Looks like the PDF" puts a picture of each
// page in the file with its words over it, so it looks the same and the text
// can still be found and copied. "Text only" keeps just the headings and
// paragraphs, for a small file that reads well on a phone.
import {
  SEG, base, renderPage, canvasToBytes, releaseCanvas, ToolError,
} from '../kit.js';
import {
  textLines, textParagraphs, markHeadings, bodySize,
} from '../pdfText.js';
import {
  textSpans, pageSection, htmlHead, htmlFoot, textSection,
} from '../pdfHtml.js';

// Strings past a few hundred MB break in some browsers; stop well before.
const MAX_SIZE = 400_000_000;
const enc = new TextEncoder();

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function join(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

// Pixels per page picture at each quality. Big sheets stop here, well past a
// screen's width, so a drawing set doesn't make a file too big to open.
const MAX_PIXELS = { 72: 2_500_000, 100: 5_000_000, 150: 10_000_000 };

const mb = (n) => `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;

export default {
  view: 'pages',
  select: 'keep',
  hint: 'Every page goes in the web page. Tap pages to use only those.',
  options: [
    { key: 'mode', label: 'Style', type: SEG, def: 'look', choices: [['look', 'Looks like the PDF'], ['text', 'Text only']] },
    { key: 'dpi', label: 'Picture quality', type: SEG, def: '100', choices: [['72', 'Small'], ['100', 'Normal'], ['150', 'High']], show: (o) => o.mode === 'look' },
  ],
  async run([file], opts, progress) {
    const pdf = await file.pdfjs();
    const pick = file.selected.size ? [...file.selected].sort((a, b) => a - b) : [...Array(file.pages).keys()];
    const title = base(file.name);
    const name = `${title}.html`;
    const type = 'text/html;charset=utf-8';

    if (opts.mode === 'text') {
      const pages = [];
      for (let n = 0; n < pick.length; n += 1) {
        progress(`Page ${n + 1} of ${pick.length}`);
        const page = await pdf.getPage(pick[n] + 1);
        const { items } = await page.getTextContent();
        page.cleanup();
        pages.push(textParagraphs(textLines(items)));
      }
      if (!pages.some((p) => p.length)) throw new ToolError('No text was found. This PDF may be a scan, which is a picture of the page. Pick "Looks like the PDF" instead.');
      const body = bodySize(pages.flat());
      const html = htmlHead(title, 'text') + pages.map((p, n) => (p.length ? textSection(pick[n] + 1, markHeadings(p, body)) : '')).join('') + htmlFoot('text');
      return [{ name, bytes: enc.encode(html), type }];
    }

    const parts = [enc.encode(htmlHead(title, 'look'))];
    let size = parts[0].length;
    let words = 0;
    for (let n = 0; n < pick.length; n += 1) {
      progress(`Page ${n + 1} of ${pick.length}`);
      const page = await pdf.getPage(pick[n] + 1);
      const viewport = page.getViewport({ scale: 1 });
      const { items, styles } = await page.getTextContent();
      const dpi = Number(opts.dpi);
      const scale = Math.min(dpi / 72, Math.sqrt(MAX_PIXELS[dpi] / (viewport.width * viewport.height)));
      const canvas = await renderPage(pdf, pick[n], { scale });
      const jpeg = await canvasToBytes(canvas, 'image/jpeg', 0.8);
      releaseCanvas(canvas);
      const spans = textSpans(items, styles, viewport);
      if (spans) words += 1;
      const section = enc.encode(pageSection({
        n: pick[n] + 1, width: viewport.width, height: viewport.height, image: `data:image/jpeg;base64,${toBase64(jpeg)}`, spans,
      }));
      page.cleanup();
      size += section.length;
      if (size > MAX_SIZE) throw new ToolError('This web page would be too big. Pick fewer pages, a lower picture quality, or Text only.');
      parts.push(section);
    }
    parts.push(enc.encode(htmlFoot('look')));
    const bytes = join(parts);
    const note = words
      ? `The page is ${mb(bytes.length)}, mostly the page pictures. The words can be selected and found with Ctrl+F.`
      : `The page is ${mb(bytes.length)}, mostly the page pictures. No text was found, so it holds pictures only; run OCR PDF first to make the words findable.`;
    return [{ name, bytes, type, note }];
  },
};
