// Measures how tall a text mark's words are when wrapped at its width, with
// the exact content style the page draws them with (renderText), so a resize
// can grow the box to fit (textBoxFit.js). Browser only: returns null when
// there is no document.
import { TEXT_PADDING, buildPlainTextContentStyle } from './svgAnnotationRenderers.jsx';
import { probeStyleValue } from './textBoxFit.js';

let probe = null;

export function measureTextContentHeight(obj) {
  if (typeof document === 'undefined' || !obj) return null;
  const outerWidth = Math.abs((Number(obj.width) || 0) * (Number(obj.scaleX) || 1));
  const innerWidth = Math.max(0, outerWidth - 2 * TEXT_PADDING);
  if (!(innerWidth > 0)) return null;
  if (!probe || !probe.isConnected) {
    probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.setAttribute('data-text-measure-probe', 'true');
    Object.assign(probe.style, {
      position: 'fixed', left: '-10000px', top: '0', visibility: 'hidden', pointerEvents: 'none',
    });
    document.body.appendChild(probe);
  }
  const style = buildPlainTextContentStyle({
    innerWidth,
    innerDisplayHeight: 0,
    fontSize: Number(obj.fontSize) || 16,
    fontFamily: obj.fontFamily,
    fontWeight: obj.fontWeight,
    fontStyle: obj.fontStyle,
    color: obj.fill,
    textAlign: obj.textAlign,
    verticalAlign: 'top',
    underline: obj.underline,
    linethrough: obj.linethrough,
    lineHeight: obj.lineHeight,
  });
  probe.removeAttribute('style');
  Object.assign(probe.style, {
    position: 'fixed', left: '-10000px', top: '0', visibility: 'hidden', pointerEvents: 'none',
  });
  for (const [key, value] of Object.entries(style)) {
    probe.style[key] = probeStyleValue(key, value);
  }
  probe.style.height = 'auto';
  probe.style.overflow = 'visible';
  probe.textContent = String(obj.text || '');
  return probe.scrollHeight;
}
