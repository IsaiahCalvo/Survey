import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { SURVEY_BAR_PARTS, planSurveyBar } from '../utils/responsiveToolbar.js';

/**
 * The survey bar's layout (owner 2026-10-13: "the panel pushes the
 * sub-toolbar out of place ... The sub-toolbar must remain fixed").
 *
 * Intended UX: the bar's centre group (module menu, category chips, Reuse)
 * sits on the tool bar's own centre - the Draw / Shapes / Text icons - and
 * never moves when a side panel opens or closes; only the end pieces (the
 * template menu, Done) move in and out with the panels, giving ground first
 * when room runs short. Nothing overlaps or runs under an open panel. The
 * order and the widths are the pure maths in utils/responsiveToolbar.js
 * (planSurveyBar); this hook only measures and re-plans before paint.
 *
 * `insetLeft` / `insetRight` are the side panels drawn over the bar now (the
 * bar eases its end padding as a panel opens, so the plan reads where it
 * settles, not the eased padding). The names are measured as text (canvas),
 * so the plan never depends on what the bar is drawing now and cannot flip
 * back and forth.
 *
 * The centre's spot is written as a CSS variable on the survey row slot
 * (both survey rows inherit it): --survey-centre-x, the tool bar's centre in
 * bar coordinates; and on the bar itself: --survey-template-room,
 * --survey-module-short. `plan.rowMax` / `plan.entityRowMax` are how many
 * slots the category and entity rows may draw (8, fewer only as a narrow
 * window's last resort).
 *
 * Returns { ref, plan }: put `ref` on the .survey-subrow element.
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

export const DEFAULT_SURVEY_BAR_PLAN = Object.freeze({ step: 'full', template: 'full', done: 'word', stable: true, rowMax: 8, entityRowMax: 8 });

const toolBarCluster = () => (typeof document === 'undefined'
  ? null
  : document.querySelector('#chrome-top-host [data-tool-toolbar]'));

export default function useSurveyBarFit({ enabled, insetLeft = 0, insetRight = 0, templateName = '', moduleNames = [], categoriesKey = '', categoryCount = 0, entityCount = 0 }) {
  const [bar, setBar] = useState(null);
  const [plan, setPlan] = useState(DEFAULT_SURVEY_BAR_PLAN);
  const planRef = useRef(plan);
  planRef.current = plan;
  const inputRef = useRef(null);
  inputRef.current = { insetLeft, insetRight, templateName, moduleNames, categoryCount, entityCount };
  // The widest category chip seen for this list (most are 28px; two or three
  // initials can stretch one). Only ever grows, so the plan cannot flip as
  // fewer chips are drawn.
  const chipRef = useRef({ key: null, width: 0 });

  const replan = useCallback(() => {
    if (!enabled || !bar || typeof window === 'undefined') return false;
    const barRect = bar.getBoundingClientRect();
    if (!(barRect.width > 0)) return false;
    const { insetLeft: l, insetRight: r, templateName: name, moduleNames: modules, categoryCount: cats, entityCount: ents } = inputRef.current;
    // The tool bar's centre: the group icons' box (it already carries the
    // window-width shift useResponsiveToolbar may give it), as rows 2 and 3.
    const clusterRect = toolBarCluster()?.getBoundingClientRect();
    const centre = clusterRect && clusterRect.width > 0
      ? clusterRect.left + clusterRect.width / 2 - barRect.left
      : barRect.width / 2;
    const style = window.getComputedStyle(bar);
    const ui = style.getPropertyValue('--font-ui').trim() || style.fontFamily;
    const templateText = Math.ceil(textWidth(name, { font: `600 12px ${ui}`, letterSpacing: '-0.12px' }));
    const moduleText = Math.ceil(Math.max(0, ...(modules || []).map((m) => textWidth(m, { font: `600 11px ${ui}`, letterSpacing: '-0.11px' }))));
    // The rows' widths come from their COUNTS (what the count rule draws),
    // never from what is drawn now, so the plan cannot flip back and forth.
    const chips = [...bar.querySelectorAll('.survey-subrow__cats > .chrome-subcontrol')]
      .map((chip) => chip.getBoundingClientRect().width);
    const chipKey = `${modules?.length}:${cats}:${name}`;
    if (chipRef.current.key !== chipKey) chipRef.current = { key: chipKey, width: 0 };
    chipRef.current.width = Math.max(chipRef.current.width, SURVEY_BAR_PARTS.chip, ...chips);
    const allText = (count) => Math.ceil(textWidth(`All ${count}`, { font: `600 11px ${ui}`, letterSpacing: '-0.11px' })) + SURVEY_BAR_PARTS.allPadding;
    const emptyEl = bar.querySelector('.survey-subrow__empty');
    const next = planSurveyBar({
      barWidth: barRect.width,
      centre,
      insetLeft: Number(l) || 0,
      insetRight: Number(r) || 0,
      templateText,
      moduleText,
      categoryCount: Number(cats) || 0,
      chip: Math.ceil(chipRef.current.width),
      allChip: allText(Number(cats) || 0),
      empty: emptyEl ? Math.ceil(emptyEl.getBoundingClientRect().width) : SURVEY_BAR_PARTS.empty,
      entityCount: Number(ents) || 0,
      entityAllChip: allText(Number(ents) || 0),
    });
    const centreX = `${Math.round(centre * 2) / 2}px`;
    bar.style.setProperty('--survey-template-room', `${next.templateRoom}px`);
    bar.style.setProperty('--survey-module-short', `${next.moduleShort}px`);
    const slot = bar.closest('#chrome-survey-row-slot') || bar;
    slot.style.setProperty('--survey-centre-x', centreX);
    const current = planRef.current;
    if (current.step === next.step && current.template === next.template
      && current.done === next.done && current.stable === next.stable
      && current.rowMax === next.rowMax && current.entityRowMax === next.entityRowMax) return false;
    const look = {
      step: next.step,
      template: next.template,
      done: next.done,
      stable: next.stable,
      rowMax: next.rowMax,
      entityRowMax: next.entityRowMax,
    };
    planRef.current = look;
    setPlan(look);
    return true;
  }, [enabled, bar]);

  // A name, a module, the categories or a panel changed: re-plan before paint.
  const modulesKey = (moduleNames || []).join('\u0000');
  useLayoutEffect(() => { replan(); }, [replan, insetLeft, insetRight, templateName, modulesKey, categoriesKey, categoryCount, entityCount]);

  // Leaving Survey: the slot's variables go with the bar.
  useEffect(() => {
    if (!bar) return undefined;
    const slot = bar.closest('#chrome-survey-row-slot');
    return () => {
      slot?.style.removeProperty('--survey-centre-x');
    };
  }, [bar]);

  // The window changed width (or the tool bar's icons were shifted): re-plan
  // before the next paint, so a narrowing window never shows a frame of
  // overlapping controls.
  useEffect(() => {
    if (!enabled || !bar || typeof ResizeObserver === 'undefined') return undefined;
    let lastWidth = -1;
    const observer = new ResizeObserver((records) => {
      const width = records[records.length - 1]?.borderBoxSize?.[0]?.inlineSize
        ?? bar.getBoundingClientRect().width;
      if (Math.abs(width - lastWidth) < 0.5) return;
      lastWidth = width;
      flushSync(() => { replan(); });
    });
    observer.observe(bar);
    // The chips' row changes width with no render of ours (a web font).
    const cats = bar.querySelector('.survey-subrow__cats');
    const catsObserver = new ResizeObserver(() => replan());
    if (cats) catsObserver.observe(cats);
    // The tool bar's icons move only with the window (useResponsiveToolbar
    // sets their `left`); that plan may land after ours on a resize.
    const cluster = toolBarCluster();
    const clusterObserver = typeof MutationObserver !== 'undefined' && cluster
      ? new MutationObserver(() => replan())
      : null;
    clusterObserver?.observe(cluster, { attributes: true, attributeFilter: ['style'] });
    // Web fonts arriving change the names' widths.
    const fonts = typeof document !== 'undefined' ? document.fonts : null;
    const onFonts = () => replan();
    fonts?.addEventListener?.('loadingdone', onFonts);
    return () => {
      observer.disconnect();
      catsObserver.disconnect();
      clusterObserver?.disconnect();
      fonts?.removeEventListener?.('loadingdone', onFonts);
    };
  }, [enabled, bar, replan]);

  return { ref: setBar, plan };
}
