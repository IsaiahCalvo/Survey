// Grayscale PDF: "Keep text sharp" rewrites the colours inside the PDF;
// "Turn pages into pictures" draws each page in grey instead, which catches
// everything but makes text unselectable.
import {
  SEG, base, pdfOut, canvasToBytes, releaseCanvas, ToolError,
} from '../kit.js';

// Photos stored as JPEG need a decoder; the browser has one.
async function decodeJpeg(bytes) {
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }), { imageOrientation: 'none' }).catch(() => null);
  if (!bitmap) return null;
  const { width, height } = bitmap;
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height });
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const { data } = ctx.getImageData(0, 0, width, height);
  releaseCanvas(canvas);
  return { width, height, data };
}

function keptNote(kept) {
  const n = kept.pictures + kept.shades + kept.inline + kept.other;
  if (!n) return null;
  return `${n} part${n === 1 ? '' : 's'} of this PDF use a kind of colour this way can't change, so ${n === 1 ? 'it' : 'they'} may still show colour. To make sure everything is grey, choose "Turn pages into pictures".`;
}

async function sharp(file, opts, progress) {
  const { grayscalePdf } = await import('../grayscale.js');
  const { bytes, kept } = await grayscalePdf(file.bytes, {
    decodeJpeg, quality: 85, onPage: (i, n) => progress(`Page ${i + 1} of ${n}`),
  });
  const out = pdfOut(`${base(file.name)}-grayscale.pdf`, bytes);
  out.note = keptNote(kept);
  return out;
}

// A drawn page as a grey JPEG. The browser saves the colour JPEG quickly and
// its brightness part is the grey picture (jpeg.js); the slower all-JavaScript
// encoder is only for a browser whose JPEGs jpeg.js can't read.
async function grayJpeg(canvas) {
  const [{ jpegToGray }, { encodeGrayJpeg, rgbaToGray }] = await Promise.all([import('../jpeg.js'), import('../imageWriters.js')]);
  const gray = jpegToGray(await canvasToBytes(canvas, 'image/jpeg', 0.85));
  if (gray) return gray;
  const { width, height } = canvas;
  return encodeGrayJpeg(rgbaToGray(canvas.getContext('2d').getImageData(0, 0, width, height).data, width, height), width, height, 85);
}

async function pictures(file, opts, progress) {
  const [{ pagesToGrayPdf }, { jpegToGray }] = await Promise.all([import('../grayscale.js'), import('../jpeg.js')]);
  const dpi = Number(opts.dpi);
  const scans = await file.scans();
  const pages = [];
  for (let i = 0; i < file.pages; i += 1) {
    progress(`Page ${i + 1} of ${file.pages}`);
    const scan = scans[i];
    let size;
    if (scan) {
      size = scan.rotate % 180 ? { width: scan.box.height, height: scan.box.width } : scan.box;
    } else {
      const vp = (await (await file.pdfjs()).getPage(i + 1)).getViewport({ scale: 1 });
      size = { width: vp.width, height: vp.height };
    }
    // An upright scan at about this many dots per inch keeps its own pixels.
    const own = scan && !scan.rotate && Math.abs((scan.width / scan.box.width) * 72 / dpi - 1) < 0.03 && (scan.gray ? scan.jpeg : jpegToGray(scan.jpeg));
    if (own) {
      pages.push({ jpeg: own, ...size });
      continue;
    }
    const canvas = await file.render(i, { scale: dpi / 72 });
    pages.push({ jpeg: await grayJpeg(canvas), ...size });
    releaseCanvas(canvas);
  }
  progress('Making the PDF');
  return pdfOut(`${base(file.name)}-grayscale.pdf`, await pagesToGrayPdf(pages));
}

export default {
  view: 'files',
  options: [
    { key: 'mode', label: 'How', type: SEG, def: 'sharp', choices: [['sharp', 'Keep text sharp'], ['pictures', 'Turn pages into pictures']] },
    { key: 'dpi', label: 'Picture quality', type: SEG, def: '150', choices: [['100', 'Small'], ['150', 'Normal'], ['300', 'High']], show: (o) => o.mode === 'pictures' },
  ],
  async run(files, opts, progress) {
    if (!files.length) throw new ToolError('Add a PDF first.');
    const out = [];
    for (let n = 0; n < files.length; n += 1) {
      const tell = files.length > 1 ? (msg) => progress(`File ${n + 1} of ${files.length}: ${msg}`) : progress;
      out.push(opts.mode === 'pictures' ? await pictures(files[n], opts, tell) : await sharp(files[n], opts, tell));
    }
    return out;
  },
};
