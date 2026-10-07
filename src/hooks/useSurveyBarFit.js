import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { planSurveyBarStep, SURVEY_BAR_STEPS } from '../utils/responsiveToolbar.js';

/**
 * The survey bar's fit (2026-10-07, after the rail-headers round found the
 * template name cut and the module pill over the category chips at 1024px
 * with both side panels open).
 *
 * Intended UX: nothing in the survey bar ever overlaps, or runs under an open
 * side panel, at any desktop width. It gives ground in a fixed order — the
 * template name shortens, then goes (the gold glyph stays), the module name
 * shortens, then Reuse, the module menu and finally the template menu move
 * into a "..." menu. The category chips and Done always stay. The order and
 * the widths are the pure maths in utils/responsiveToolbar.js
 * (planSurveyBarStep); this hook only measures and re-plans before paint.
 *
 * `insetLeft` / `insetRight` are the side panels drawn over the bar (the bar
 * eases its padding as a panel opens, so the plan reads where it settles, not
 * the eased padding). The names are measured as text (canvas), so the plan
 * never depends on what the bar is drawing now and cannot flip back and forth.
 *
 * Returns { ref, step }: put `ref` on the .survey-subrow element.
 */
let measureContext = null;
const textWidth = (text, font) => {
  if (!text || typeof document === 'undefined') return 0;
  try {
    measureContext = measureContext || document.createElement('canvas').getContext('2d');
    if (!measureContext) return 0;
    measureContext.font = font.font;
    // .chrome-pill's -0.01em; a browser without canvas letterSpacing measures
    // a hair wide, which only ever errs towards giving ground early.
    if ('letterSpacing' in measureContext) measureContext.letterSpacing = font.letterSpacing;
    return measureContext.measureText(String(text)).width;
  } catch {
    return 0;
  }
};

export default function useSurveyBarFit({ enabled, insetLeft = 0, insetRight = 0, templateName = '', moduleNames = [], categoriesKey = '' }) {
  const [bar, setBar] = useState(null);
  const [step, setStep] = useState(SURVEY_BAR_STEPS[0]);
  const stepRef = useRef(step);
  stepRef.current = step;
  const inputRef = useRef(null);
  inputRef.current = { insetLeft, insetRight, templateName, moduleNames };

  const plan = useCallback(() => {
    if (!enabled || !bar || typeof window === 'undefined') return false;
    const width = bar.getBoundingClientRect().width;
    if (!(width > 0)) return false;
    const { insetLeft: l, insetRight: r, templateName: name, moduleNames: modules } = inputRef.current;
    const style = window.getComputedStyle(bar);
    const padding = 16; // .survey-subrow: 8px each side, plus the insets
    const room = width - padding - (Number(l) || 0) - (Number(r) || 0);
    const ui = style.getPropertyValue('--font-ui').trim() || style.fontFamily;
    const templateText = Math.ceil(textWidth(name, { font: `600 12px ${ui}`, letterSpacing: '-0.12px' }));
    const moduleText = Math.ceil(Math.max(0, ...(modules || []).map((m) => textWidth(m, { font: `600 11px ${ui}`, letterSpacing: '-0.11px' }))));
    const cats = bar.querySelector('.survey-subrow__cats');
    const categories = cats ? cats.scrollWidth : 0;
    const next = planSurveyBarStep(room, { templateText, moduleText, categories });
    bar.style.setProperty('--survey-template-min', `${next.widths.templateMin}px`);
    bar.style.setProperty('--survey-module-min', `${next.widths.moduleMin}px`);
    if (next.step === stepRef.current) return false;
    stepRef.current = next.step;
    setStep(next.step);
    return true;
  }, [enabled, bar]);

  // A name, a module, the categories or a panel changed: re-plan before paint.
  const modulesKey = (moduleNames || []).join('\u0000');
  useLayoutEffect(() => { plan(); }, [plan, insetLeft, insetRight, templateName, modulesKey, categoriesKey]);

  // The window changed width: re-plan before the next paint, so a narrowing
  // window never shows a frame of overlapping controls.
  useEffect(() => {
    if (!enabled || !bar || typeof ResizeObserver === 'undefined') return undefined;
    let lastWidth = -1;
    const observer = new ResizeObserver((records) => {
      const width = records[records.length - 1]?.borderBoxSize?.[0]?.inlineSize
        ?? bar.getBoundingClientRect().width;
      if (Math.abs(width - lastWidth) < 0.5) return;
      lastWidth = width;
      flushSync(() => { plan(); });
    });
    observer.observe(bar);
    // Web fonts arriving change the names' widths.
    const fonts = typeof document !== 'undefined' ? document.fonts : null;
    const onFonts = () => plan();
    fonts?.addEventListener?.('loadingdone', onFonts);
    return () => {
      observer.disconnect();
      fonts?.removeEventListener?.('loadingdone', onFonts);
    };
  }, [enabled, bar, plan]);

  return { ref: setBar, step };
}
