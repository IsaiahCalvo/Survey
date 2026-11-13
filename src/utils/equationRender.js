// Nightly 'equation-tool': LaTeX -> picture, in the browser. Loaded only when
// the Equation card opens (MathJax is large), so it never weighs on the first
// load. MathJax draws the equation as plain SVG paths (no fonts to fetch),
// which is then painted onto a canvas to make the PNG the mark carries.
import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import 'mathjax-full/js/input/tex/base/BaseConfiguration.js';
import 'mathjax-full/js/input/tex/ams/AmsConfiguration.js';
import 'mathjax-full/js/input/tex/newcommand/NewcommandConfiguration.js';
import 'mathjax-full/js/input/tex/boldsymbol/BoldsymbolConfiguration.js';
import 'mathjax-full/js/input/tex/cancel/CancelConfiguration.js';
import 'mathjax-full/js/input/tex/noundefined/NoUndefinedConfiguration.js';
import { cleanTex, equationRasterSize, equationSvgSize, sizedEquationSvg } from './equation.js';

let doc = null;
let adaptor = null;
function mathDocument() {
  if (doc) return doc;
  adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  doc = mathjax.document('', {
    InputJax: new TeX({
      packages: ['base', 'ams', 'newcommand', 'boldsymbol', 'cancel', 'noundefined'],
      // A typing mistake comes back as an error to show under the box.
      formatError: (_jax, err) => { throw err; },
    }),
    OutputJax: new SVG({ fontCache: 'none' }),
  });
  return doc;
}

/** MathJax's SVG for `tex` (throws with a short message on a mistake). */
export function texToSvg(tex) {
  const text = cleanTex(tex).trim();
  if (!text) throw new Error('Type an equation.');
  try {
    const node = mathDocument().convert(text, { display: true });
    return adaptor.innerHTML(node);
  } catch (error) {
    // MathJax throws its own TexError (not an Error): pass on its words.
    throw new Error(String(error?.message || 'That equation could not be drawn.'));
  }
}

/** { src (PNG data URL), pixelWidth, pixelHeight } for `tex` in `color`. */
export async function renderTexToPng(tex, color) {
  const svg = texToSvg(tex);
  const size = equationSvgSize(svg);
  if (!size) throw new Error('That equation could not be drawn.');
  const raster = equationRasterSize(size.width, size.height);
  const markup = sizedEquationSvg(svg, { width: raster.width, height: raster.height, color });
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = raster.width;
  canvas.height = raster.height;
  canvas.getContext('2d').drawImage(img, 0, 0, raster.width, raster.height);
  return {
    src: canvas.toDataURL('image/png'),
    pixelWidth: Math.round(size.width * 100) / 100,
    pixelHeight: Math.round(size.height * 100) / 100,
  };
}
