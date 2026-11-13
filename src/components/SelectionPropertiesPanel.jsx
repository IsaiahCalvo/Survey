// Nightly 'properties-panel': Drawboard PDF's "Expand menu" properties panel
// (checked live 2026-11-10, /mnt/project-files/drawboard-trial/deep/expand-panel.md).
//
//   - Opened from "Expand menu" on the selection quick bar; a 260 px card on
//     the right of the viewer, under the tool bar, that does not push the page.
//     It stays open across picks until Collapse. Desktop and tablet only:
//     Drawboard has no panel on a phone.
//   - Header: "N annotations selected", the kind (or "Mixed subjects"), and
//     who made it and when.
//   - Sections that fold: Transform (X Y / W H / R, page points from the
//     page's top-left), Selected colors, Stroke (colour, opacity, thickness;
//     pen ink has no thickness), Border styles (dash pattern, arrow ends),
//     Fill.
//   - Number boxes: Up / Down step 1 and apply at once; Enter commits and
//     hands focus back to the page; Tab and blur commit.
//   - Every change is the same write the tool bar makes (the published tool
//     bar API) or the page layer's own move / turn / resize, so it saves,
//     syncs and undoes like any other edit.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icons';
import { QuickColourDots } from './QuickStyleControls';
import { useSelectedItems, viewerBounds } from './SelectionQuickBar.jsx';
import { isFeatureOn } from '../featureFlags.js';
import { LINE_STYLE_SAMPLE_ICONS, lineStyleOptionsWith } from '../utils/lineStyleOptions.js';
import { ARROWHEAD_MENU_ORDER, ARROWHEAD_SHORT_LABELS } from './Callout/types.js';
import { LineEndingsPanel } from './LineEndingsPicker.jsx';
import { ARRANGE_SELECTION_EVENT } from '../utils/alignMarks.js';
import { getAnnotationAuthorId } from '../lib/collab/permissionScope.js';
import { getAnnotationRenderIdentity } from '../utils/annotationStorageIdentity.js';
import { authorLabel, markCreatedAt } from '../utils/markupList.js';
import {
  setPropertiesDockElement,
  setPropertiesPanelOpen,
  setPropertiesPanelPinned,
  usePropertiesDockElement,
  usePropertiesPanelOpen,
  usePropertiesPanelPinned,
} from '../utils/propertiesPanelStore.js';
import { composeTextColor, splitTextColor } from '../utils/textColorOpacity.js';
import { FILL_QUICK_COLOURS, FILL_QUICK_COLOUR_NAMES } from '../utils/quickStylePresets.js';
import { HATCH_PATTERNS } from '../utils/hatchFill.js';
import {
  TRANSFORM_SELECTION_EVENT,
  formatPt,
  headerCountText,
  kindLabel,
  kindOfObject,
  parseTyped,
  planTypedMove,
  readTransform,
  shiftRead,
  wrapDegrees,
} from '../utils/selectionProperties.js';
import './SelectionPropertiesPanel.css';

const THICKNESS_TICKS = [1, 2, 3, 6, 10, 50];
const OPACITY_TICKS = [25, 50, 75, 100];
// Drawboard's Text section: Size slider ticks, as measured 2026-11-10.
const TEXT_SIZE_TICKS = [10, 12, 16, 20, 42, 64];

// The id the page layer broadcasts for a picked mark (data-annotation-id).
const objectId = (object) => String(getAnnotationRenderIdentity(object).annotationId ?? '');

function formatDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** A Drawboard number box: commit on Enter (focus to the page), Tab, blur; Up / Down step 1 at once. */
function NumberBox({ label, value, placeholder, disabled, onCommit, step = 1 }) {
  const ref = useRef(null);
  const editingRef = useRef(false);
  useEffect(() => {
    if (!editingRef.current && ref.current) ref.current.value = value ?? '';
  }, [value]);
  const commit = () => {
    editingRef.current = false;
    const typed = parseTyped(ref.current?.value);
    if (typed == null) {
      if (ref.current) ref.current.value = value ?? '';
      return;
    }
    onCommit(typed);
  };
  return (
    <label className="props-panel__field">
      <span className="props-panel__field-label">{label}</span>
      <input
        ref={ref}
        className="props-panel__number"
        type="text"
        inputMode="decimal"
        aria-label={label}
        defaultValue={value ?? ''}
        placeholder={placeholder}
        disabled={disabled}
        data-props-field={label}
        onFocus={() => { editingRef.current = true; }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          } else if (event.key === 'Escape') {
            editingRef.current = false;
            event.currentTarget.value = value ?? '';
            event.currentTarget.blur();
          } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            const base = parseTyped(event.currentTarget.value) ?? parseTyped(value) ?? 0;
            const next = base + (event.key === 'ArrowUp' ? step : -step);
            event.currentTarget.value = formatPt(next);
            onCommit(next);
          }
        }}
      />
    </label>
  );
}

function Section({ title, children, id }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="props-panel__section" data-props-section={id}>
      <button
        type="button"
        className="props-panel__section-head"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{title}</span>
        <Icon name="chevronDown" size={14} color="currentColor" style={{ transform: open ? 'none' : 'rotate(-90deg)' }} />
      </button>
      {open && <div className="props-panel__section-body">{children}</div>}
    </section>
  );
}

function SliderRow({ label, value, ticks, min, max, unit, onPreview, onCommit, mixed }) {
  const [draft, setDraft] = useState(null);
  const shown = draft ?? (Number.isFinite(Number(value)) ? Number(value) : min);
  const ticksId = `props-ticks-${label.replace(/\s+/g, '-')}`;
  return (
    <div className="props-panel__slider-row">
      <span className="props-panel__row-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={shown}
        aria-label={label}
        list={ticksId}
        onChange={(event) => { const v = Number(event.target.value); setDraft(v); onPreview(v); }}
        onPointerUp={() => { if (draft != null) { onCommit(draft); setDraft(null); } }}
        onKeyUp={() => { if (draft != null) { onCommit(draft); setDraft(null); } }}
      />
      <datalist id={ticksId}>{ticks.map((t) => <option key={t} value={t} />)}</datalist>
      <span className="props-panel__value" data-props-value={label}>{mixed && draft == null ? 'Mixed' : `${Math.round(shown)}${unit}`}</span>
    </div>
  );
}

export default function SelectionPropertiesPanel({
  enabled,
  phone,
  api,
  paint,
  onOpenColourPicker,
  annotationsByPage,
  viewerId,
  tip,
  textFormat,
}) {
  const flagOn = useMemo(() => isFeatureOn('properties-panel'), []);
  const items = useSelectedItems();
  const open = usePropertiesPanelOpen();
  const pinned = usePropertiesPanelPinned();
  const dockEl = usePropertiesDockElement();
  const [frame, setFrame] = useState(null);
  // The "Selected colors" swatch whose colour row is open.
  const [recolourFrom, setRecolourFrom] = useState(null);
  const chromeTip = tip || (() => ({}));

  const picked = useMemo(() => {
    const list = Array.isArray(items) ? items : [];
    const pages = new Set(list.map((item) => item.pageNumber));
    const objects = [];
    const kinds = [];
    for (const item of list) {
      const objs = annotationsByPage?.[item.pageNumber]?.objects || [];
      const object = item.typeKey === 'callout' || item.typeKey === 'surveyMarker'
        ? null
        : objs.find((o) => objectId(o) === String(item.id)) || null;
      if (object) objects.push(object);
      kinds.push(kindOfObject(object, item.typeKey));
    }
    return { list, objects, kinds, pageNumber: pages.size === 1 ? [...pages][0] : null };
  }, [annotationsByPage, items]);

  // Pinned, it docks beside the viewer and stays up with nothing picked.
  const docked = Boolean(flagOn && enabled && !phone && pinned && dockEl);
  const active = docked || (flagOn && enabled && !phone && open && picked.list.length > 0);

  // Sit on the right of the viewer, under the tool bar. Measured before paint,
  // so a panel just unpinned (no frame yet this session) never blinks out.
  useLayoutEffect(() => {
    if (!active || docked) return undefined;
    const place = () => {
      // The on-screen viewer (a tab behind keeps its own), under the tool bars.
      const b = viewerBounds(false);
      setFrame({ top: b.top + 10, right: Math.max(10, window.innerWidth - b.right + 10), bottom: Math.max(10, window.innerHeight - b.bottom + 10) });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [active, docked]);

  // Callouts and Survey Markers are boxes in the page layer, not page objects.
  const extraBoxes = useMemo(() => {
    if (!active) return [];
    return picked.list
      .filter((item) => item.typeKey === 'callout' || item.typeKey === 'surveyMarker')
      .map((item) => {
        const svg = document.querySelector(`svg[data-svg-annotation-layer="${item.pageNumber}"]`);
        const attr = item.typeKey === 'callout' ? 'data-callout-id' : 'data-survey-marker-id';
        const el = svg?.querySelector(`[${attr}="${CSS.escape(String(item.id))}"]`);
        const toPage = svg?.getScreenCTM?.()?.inverse?.();
        const r = el?.getBoundingClientRect?.();
        if (!toPage || !r) return null;
        const a = new DOMPoint(r.left, r.top).matrixTransform(toPage);
        const b = new DOMPoint(r.right, r.bottom).matrixTransform(toPage);
        return { left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
      })
      .filter(Boolean);
  }, [active, picked.list]);

  const transform = useMemo(
    () => (active ? readTransform(picked.objects, extraBoxes) : null),
    [active, extraBoxes, picked.objects],
  );

  // Moves sent since `transform` was last read. Arrow steps and the blur
  // after them all measure from here, so a step the page has taken but the
  // panel has not read back yet is not sent again.
  const sentMoveRef = useRef({ read: null, dx: 0, dy: 0 });
  if (sentMoveRef.current.read !== transform) sentMoveRef.current = { read: transform, dx: 0, dy: 0 };
  const commitMove = useCallback((field, value) => {
    const sent = sentMoveRef.current;
    const move = planTypedMove(shiftRead(transform, sent), field, value);
    if (!move || picked.pageNumber == null) return;
    if (sent.read === transform) { sent.dx += move.dx; sent.dy += move.dy; }
    window.dispatchEvent(new CustomEvent(ARRANGE_SELECTION_EVENT, { detail: { pageNumber: picked.pageNumber, op: 'move', ...move } }));
  }, [picked.pageNumber, transform]);

  const commitSize = useCallback((field, value) => {
    if (!transform?.sizable || picked.pageNumber == null) return;
    window.dispatchEvent(new CustomEvent(TRANSFORM_SELECTION_EVENT, { detail: { pageNumber: picked.pageNumber, op: 'size', field, value } }));
  }, [picked.pageNumber, transform]);

  const commitTurn = useCallback((value) => {
    const angle = wrapDegrees(value);
    if (angle == null || !transform?.turnable || picked.pageNumber == null) return;
    window.dispatchEvent(new CustomEvent(TRANSFORM_SELECTION_EVENT, { detail: { pageNumber: picked.pageNumber, op: 'turn', angle } }));
  }, [picked.pageNumber, transform]);

  if (!active || (!docked && !frame) || typeof document === 'undefined') return null;

  // "Selected colors": a swatch opens a row of colours; a pick recolours
  // every use of that colour in the pick.
  const recolour = (from, to) => {
    setRecolourFrom(null);
    if (picked.pageNumber == null) return;
    window.dispatchEvent(new CustomEvent(TRANSFORM_SELECTION_EVENT, { detail: { pageNumber: picked.pageNumber, op: 'recolour', from, to } }));
  };

  // A group pick publishes what every member can take; one mark goes by its
  // kind, as the tool bar's own pills do.
  const tool = api?.contextTool;
  const caps = api?.selectionCapabilities || {
    stroke: true,
    width: tool !== 'counter',
    lineStyle: ['arrow', 'line', 'rect', 'ellipse', 'polygon', 'polyline', 'text', 'callout'].includes(tool),
    arrowheads: tool === 'arrow' || tool === 'line',
    fill: ['rect', 'ellipse', 'polygon', 'cloud', 'text', 'callout', 'counter'].includes(tool),
  };
  const mixed = api?.selectionMixed || {};
  const onlyInk = picked.kinds.length > 0 && picked.kinds.every((k) => k === 'pen' || k === 'highlighter');
  const single = picked.list.length === 1 ? picked.objects[0] : null;
  const author = single ? authorLabel(getAnnotationAuthorId(single), { viewerId }) : null;
  const created = single ? formatDate(markCreatedAt(single)) : '';
  const colours = [...new Set(picked.objects.flatMap((o) => [o.stroke, o.fill])
    .filter((c) => typeof c === 'string' && c && c !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(c)))].slice(0, 12);
  const styleValue = (api?.lineBorderStyle === 'cloud' && !api?.supportsCloudStyle) ? 'solid' : (api?.lineBorderStyle || 'solid');
  const textParts = splitTextColor(textFormat?.state?.fontColor);
  const fillNone = Boolean(paint?.fill) && !mixed.fillOpacity && paint.fill.opacity <= 0;
  // "No fill" changes only the opacity, so a pick of mixed fill colours keeps
  // them (Bugbot on #1387). A shape keeps one side visible, as the dots do.
  const clearFill = () => {
    if (paint?.shapeOneVisibleRule && (api?.strokeOpacity ?? 100) <= 0) api?.handleStrokeOpacityChange?.(100);
    api?.handleFillOpacityChange?.(0);
  };
  const textSize = Number(textFormat?.state?.fontSize) || 16;
  const setWidth = (width) => {
    api?.handleStrokeWidthInputChange?.({ target: { value: String(width) } });
    api?.handleStrokeWidthInputBlur?.({ currentTarget: { value: String(width) } });
  };

  return createPortal(
    <aside
      className={`props-panel${docked ? ' props-panel--docked' : ''}`}
      data-properties-panel="true"
      data-properties-panel-docked={docked ? 'true' : undefined}
      aria-label="Properties"
      style={docked ? undefined : { top: frame.top, right: frame.right, bottom: frame.bottom }}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <header className="props-panel__header">
        <div className="props-panel__heading">
          {/* Drawboard: a pinned panel with nothing picked is titled "Select". */}
          <div className="props-panel__count" data-props-count>{picked.list.length ? headerCountText(picked.list.length) : 'Select'}</div>
          {picked.list.length > 0 && <div className="props-panel__kind" data-props-kind>{kindLabel(picked.kinds)}</div>}
          {single && <div className="props-panel__meta">{[author, created].filter(Boolean).join(' · ')}</div>}
        </div>
        {!pinned && (
          <button
            type="button"
            className="props-panel__icon-button"
            aria-label="Collapse menu"
            {...chromeTip('Collapse menu', 'below')}
            onClick={() => setPropertiesPanelOpen(false)}
          >
            <Icon name="panelRight" size={16} color="currentColor" />
          </button>
        )}
        <button
          type="button"
          className={`props-panel__icon-button${pinned ? ' is-pinned' : ''}`}
          aria-label={pinned ? 'Unpin side panel' : 'Pin to side panel'}
          aria-pressed={pinned}
          data-props-pin
          {...chromeTip(pinned ? 'Unpin side panel' : 'Pin to side panel', 'below')}
          onClick={() => setPropertiesPanelPinned(!pinned)}
        >
          <Icon name="pushPin" size={16} color="currentColor" />
        </button>
      </header>
      {picked.list.length === 0 ? (
        <div className="props-panel__body props-panel__empty" data-props-empty>Pick a mark to see its settings here.</div>
      ) : (
      <div className="props-panel__body">
        {transform && (
          <Section title="Transform" id="transform">
            <div className="props-panel__grid">
              <NumberBox label="X" value={formatPt(transform.x)} disabled={picked.pageNumber == null} onCommit={(v) => commitMove('x', v)} />
              <NumberBox label="Y" value={formatPt(transform.y)} disabled={picked.pageNumber == null} onCommit={(v) => commitMove('y', v)} />
              <NumberBox label="W" value={formatPt(transform.w)} disabled={!transform.sizable} onCommit={(v) => commitSize('w', v)} />
              <NumberBox label="H" value={formatPt(transform.h)} disabled={!transform.sizable} onCommit={(v) => commitSize('h', v)} />
              <NumberBox
                label="R"
                value={transform.rMixed ? '' : formatPt(transform.r)}
                placeholder={transform.rMixed ? 'Mixed' : undefined}
                disabled={!transform.turnable}
                onCommit={commitTurn}
              />
            </div>
          </Section>
        )}
        {colours.length > 0 && (
          <Section title="Selected colors" id="colours">
            <div className="props-panel__colours">
              {colours.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`props-panel__colour${recolourFrom === c ? ' is-current' : ''}`}
                  style={{ background: c }}
                  data-props-colour={c}
                  aria-label={`Recolour ${c}`}
                  aria-expanded={recolourFrom === c}
                  disabled={picked.pageNumber == null}
                  {...chromeTip('Change this colour everywhere in the selection', 'below')}
                  onClick={() => setRecolourFrom((cur) => (cur === c ? null : c))}
                />
              ))}
            </div>
            {recolourFrom && colours.includes(recolourFrom) && (
              <div className="props-panel__row props-panel__recolour" data-props-recolour={recolourFrom}>
                <span className="props-panel__row-label">To</span>
                <QuickColourDots value={recolourFrom} onPick={(hex) => recolour(recolourFrom, hex)} />
              </div>
            )}
          </Section>
        )}
        {caps.stroke !== false && paint && (
          <Section title="Stroke" id="stroke">
            <div className="props-panel__row" data-annotation-color-trigger>
              <span className="props-panel__row-label">Color</span>
              <QuickColourDots
                value={mixed.strokeColor ? null : paint.quick.color}
                customActive={mixed.strokeColor ? false : undefined}
                onPick={(hex) => paint.quick.apply(hex, paint.quick.opacity)}
                onOpenPicker={onOpenColourPicker}
              />
            </div>
            <SliderRow
              label="Opacity"
              value={api?.strokeOpacity}
              mixed={Boolean(mixed.strokeOpacity)}
              ticks={OPACITY_TICKS}
              min={0}
              max={100}
              unit="%"
              onPreview={(v) => api?.handleStrokeOpacityChange?.(v, { phase: 'preview' })}
              onCommit={(v) => api?.handleStrokeOpacityChange?.(v, { phase: 'commit' })}
            />
            {caps.width !== false && !onlyInk && (
              <div className="props-panel__row" role="group" aria-label="Thickness">
                <span className="props-panel__row-label">Thickness</span>
                <div className="props-panel__chips">
                  {THICKNESS_TICKS.map((w) => {
                    const current = !mixed.width && Number(api?.strokeWidthInputValue) === w;
                    return (
                      <button key={w} type="button" className={`props-panel__chip${current ? ' is-current' : ''}`} aria-pressed={current} aria-label={`Thickness ${w} pt`} onClick={() => setWidth(w)}>
                        {w}
                      </button>
                    );
                  })}
                </div>
                <span className="props-panel__value" data-props-value="Thickness">{mixed.width ? 'Mixed' : `${api?.strokeWidthInputValue ?? ''} pt`}</span>
              </div>
            )}
          </Section>
        )}
        {(caps.lineStyle || caps.arrowheads) && (
          <Section title="Border styles" id="border">
            {caps.lineStyle && (
              <div className="props-panel__tiles" role="group" aria-label="Dash pattern">
                {lineStyleOptionsWith(isFeatureOn('line-dashes') && api?.contextTool !== 'callout')
                  .filter((option) => option.value !== 'cloud' || api?.supportsCloudStyle)
                  .map((option) => {
                    const current = !mixed.lineStyle && option.value === styleValue;
                    return (
                      <button key={option.value} type="button" className={`props-panel__tile${current ? ' is-current' : ''}`} aria-pressed={current} aria-label={option.label} {...chromeTip(option.label, 'below')} onClick={() => api?.setLineBorderStyle?.(option.value)}>
                        <Icon name={LINE_STYLE_SAMPLE_ICONS[option.value]} size={24} color="currentColor" />
                      </button>
                    );
                  })}
              </div>
            )}
            {caps.arrowheads && isFeatureOn('line-endings') && api?.selectedLineEnds && (
              // Nightly 'line-endings': Drawboard's Start | End grid of ten.
              <LineEndingsPanel api={api} tool={api?.contextTool} tip={chromeTip} compact />
            )}
            {caps.arrowheads && !(isFeatureOn('line-endings') && api?.selectedLineEnds) && (
              <>
                <div className="props-panel__row-label props-panel__sub">Endings</div>
                <div className="props-panel__tiles" role="group" aria-label="Arrow end">
                  {ARROWHEAD_MENU_ORDER.map((head) => {
                    const current = api?.arrowheadStyle === head;
                    return (
                      <button key={head} type="button" className={`props-panel__tile props-panel__tile--word${current ? ' is-current' : ''}`} aria-pressed={current} onClick={() => api?.setArrowheadStyle?.(head)}>
                        {ARROWHEAD_SHORT_LABELS[head] || head}
                      </button>
                    );
                  })}
                </div>
                {api?.setArrowBothEnds && (
                  <label className="props-panel__check">
                    <input type="checkbox" checked={Boolean(api?.arrowBothEnds)} onChange={(event) => api.setArrowBothEnds(event.target.checked)} />
                    <span>Both ends</span>
                  </label>
                )}
              </>
            )}
          </Section>
        )}
        {caps.fill && (
          <Section title="Fill" id="fill">
            {paint?.fill && (
              // Drawboard: a "none" swatch, then white and the presets.
              <div className="props-panel__row" data-props-fill-colour>
                <span className="props-panel__row-label">Color</span>
                <button
                  type="button"
                  className={`props-panel__none${fillNone ? ' is-current' : ''}`}
                  data-props-fill-none
                  aria-label="No fill"
                  aria-pressed={fillNone}
                  {...chromeTip('No fill', 'below')}
                  onClick={clearFill}
                />
                <QuickColourDots
                  value={fillNone || mixed.fillColor ? null : paint.fill.color}
                  colours={FILL_QUICK_COLOURS}
                  names={FILL_QUICK_COLOUR_NAMES}
                  onPick={(hex) => paint.fill.apply(hex, paint.fill.opacity > 0 ? paint.fill.opacity : 1)}
                />
              </div>
            )}
            <SliderRow
              label="Fill opacity"
              value={api?.fillOpacity}
              mixed={Boolean(mixed.fillOpacity)}
              ticks={OPACITY_TICKS}
              min={0}
              max={100}
              unit="%"
              onPreview={(v) => api?.handleFillOpacityChange?.(v, { phase: 'preview' })}
              onCommit={(v) => api?.handleFillOpacityChange?.(v, { phase: 'commit' })}
            />
            {api?.selectedHatch && typeof api?.setSelectedHatch === 'function' && (
              // Nightly 'hatch-fill': Drawboard's hatch patterns, drawn in the border colour.
              <div className="props-panel__row props-panel__row--wrap" data-props-hatch>
                <span className="props-panel__row-label">Pattern</span>
                <button
                  type="button"
                  className={`props-panel__none${api.selectedHatch.pattern ? '' : ' is-current'}`}
                  data-props-hatch-none
                  aria-label="No pattern"
                  aria-pressed={!api.selectedHatch.pattern}
                  {...chromeTip('No pattern', 'below')}
                  onClick={() => api.setSelectedHatch(null)}
                />
                {HATCH_PATTERNS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`props-panel__hatch${api.selectedHatch.pattern === p.id ? ' is-current' : ''}`}
                    data-props-hatch-pattern={p.id}
                    aria-label={p.label}
                    aria-pressed={api.selectedHatch.pattern === p.id}
                    {...chromeTip(p.label, 'below')}
                    onClick={() => api.setSelectedHatch(p.id)}
                  >
                    <Icon name={p.icon} size={18} color="currentColor" />
                  </button>
                ))}
              </div>
            )}
          </Section>
        )}
        {textFormat?.api && (
          // Drawboard's Text section (text box and callout): Color, Opacity
          // and Size. Font, bold and align stay on the text bar, as there.
          <Section title="Text" id="text">
            <div className="props-panel__row" data-props-text-colour>
              <span className="props-panel__row-label">Color</span>
              <QuickColourDots
                value={textParts.hex}
                onPick={(hex) => textFormat.api.setFontColor?.(composeTextColor(hex, textParts.opacity))}
              />
            </div>
            <SliderRow
              label="Text opacity"
              value={Math.round(textParts.opacity * 100)}
              ticks={OPACITY_TICKS}
              min={5}
              max={100}
              unit="%"
              onPreview={(v) => textFormat.api.setFontColor?.(composeTextColor(textParts.hex, v / 100), { phase: 'preview' })}
              onCommit={(v) => textFormat.api.setFontColor?.(composeTextColor(textParts.hex, v / 100), { phase: 'commit' })}
            />
            <SliderRow
              label="Size"
              value={textSize}
              ticks={TEXT_SIZE_TICKS}
              min={6}
              max={72}
              unit=" pt"
              onPreview={() => {}}
              onCommit={(v) => textFormat.api.setFontSize?.(v)}
            />
          </Section>
        )}
      </div>
      )}
    </aside>,
    docked ? dockEl : document.body,
  );
}

// AppShell's dock: a column beside the viewer, there only while the panel is
// pinned, so the viewer narrows and the page stays centred in what is left.
export function PropertiesPanelDockHost({ enabled }) {
  const flagOn = useMemo(() => isFeatureOn('properties-panel'), []);
  const pinned = usePropertiesPanelPinned();
  const ref = useCallback((el) => setPropertiesDockElement(el), []);
  if (!flagOn || !enabled || !pinned) return null;
  return <div ref={ref} className="props-panel-dock" data-properties-dock="true" />;
}
