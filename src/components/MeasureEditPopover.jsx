// The quick bar's Measurement popover (Nightly flag 'measure-edit', Drawboard
// PDF Pro trial audit 2026-11-10): one picked measurement's label, depth,
// caption lines and caption size, in one card.
//
// Intended UX:
//   - Label and Depth are typed: the caption preview at the top of the card
//     follows every key, and the mark itself changes on Enter, on leaving the
//     field, or when the card closes by a press outside it. Escape puts the
//     field back and closes the card. So a typed change is ONE undo step.
//   - Caption lines (only the readings that make sense for the kind) and the
//     caption size change the mark at once, one undo step per press.
//   - Every write goes through PDFViewer's selected-mark write
//     (api.patchSelectedMeasure -> handlePatchSelectedAnnotation), so it
//     saves, syncs and undoes like any other style change.
//   - It opens away from the selection like the Line popover, and moves or
//     flips so the whole card stays on screen (the phone too).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { watchLightPopover } from './dismissRules.js';
import {
  DEPTH_MEASURE_KINDS,
  MEASURE_CAPTION_SIZES,
  MEASURE_FIELD_NAMES,
  MEASURE_LABEL_FONT_PX,
  MEASURE_LABEL_MAX_CHARS,
  MEASURE_UNITS,
  applyMeasureEdit,
  buildMeasureLabel,
  getMeasureKind,
  isValidMeasureScale,
  measureCaptionFields,
  measureShownFields,
  normalizeMeasureCaptionSize,
  normalizeMeasureDepth,
  normalizeMeasureLabelText,
  SEGMENT_CAPTION_KINDS,
  SEGMENT_CAPTION_PLACES,
  segmentCaptionPlace,
  MEASURE_PRESETS,
  isOwnScaleMeasure,
  scaleFromPreset,
  customMeasureScaleIndex,
  loadCustomMeasureScales,
} from '../utils/measure/measureScale.js';
import { defaultMeasurePrecision, displayForScaleUnit } from '../utils/measure/measureFormat.js';
import ValueSelect from './ValueSelect.jsx';
import MeasureScaleDialog from './MeasureScaleDialog.jsx';
import Icon from '../Icons';
import { isFeatureOn } from '../featureFlags.js';
import {
  DIMENSION_CAPTION_PLACES,
  dimensionCaptionPlace,
  dimensionLeader,
  DIMENSION_CAPTION_BG_COLORS,
  DIMENSION_CAPTION_BG_OPACITIES,
  DIMENSION_CAPTION_TEXT_COLORS,
  dimensionCaptionPt,
  dimensionCaptionStyle,
  isDimensionMeasure,
  normalizeDimensionCaptionPt,
  normalizeDimensionLeader,
} from '../utils/measure/dimensionLine.js';

// Space kept between the card and the window's edges.
const EDGE = 8;

const depthText = (depth) => (depth == null ? '' : String(depth));
const CAPTION_PLACE_NAMES = Object.freeze({ inline: 'Inline', above: 'Above' });
const SEGMENT_PLACE_NAMES = Object.freeze({ off: 'Off', inline: 'Inline', upright: 'Upright', above: 'Above' });
const SEGMENT_PLACE_TIPS = Object.freeze({
  off: 'No length on each side',
  inline: 'Each side\u2019s length on the side, along it',
  upright: 'Each side\u2019s length on the side, level',
  above: 'Each side\u2019s length beside the side',
});

export default function MeasureEditPopover({ measure, onPatch, onClose, side = 'below', tip, tipSide = 'below' }) {
  const mark = measure?.mark || null;
  const scale = measure?.scale || null;
  const kind = getMeasureKind(mark);
  const saved = mark?.data?.measure || {};
  const savedLabel = normalizeMeasureLabelText(saved.label);
  const savedDepth = normalizeMeasureDepth(saved.depth);
  const usesDepth = DEPTH_MEASURE_KINDS.includes(kind);
  const unit = isValidMeasureScale(scale) ? MEASURE_UNITS[scale.unit].label : 'in';
  // A Length drawn as a dimension line (measure-plus) also has a leader and a
  // caption place.
  const isDim = isDimensionMeasure(mark);
  const savedLeader = isDim ? dimensionLeader(mark) : null;
  // Its caption style (Drawboard's Caption pop-over): size in pt, colours.
  const savedPt = isDim ? dimensionCaptionPt(mark) : null;
  const captionStyle = isDim ? dimensionCaptionStyle(mark) : null;
  // A Polylength or Perimeter's segment captions (measure-plus).
  const plusOn = isFeatureOn('measure-plus');
  const segmentPlace = SEGMENT_CAPTION_KINDS.includes(kind) && plusOn ? segmentCaptionPlace(mark) : null;
  // Its own scale or the page's (measure-plus, Drawboard's per-measure scale).
  const ownScale = plusOn && isOwnScaleMeasure(mark) ? saved.scale : null;
  const ownPreset = ownScale ? MEASURE_PRESETS.find((p) => p.label === ownScale.label) : null;
  // The custom scales applied on this screen (Set page scale) come after the presets.
  const [customScales, setCustomScales] = useState(() => (plusOn ? loadCustomMeasureScales() : []));
  // Drawboard's Add Scale (+) and Edit Scale (pencil, on a custom scale).
  const [scaleEditor, setScaleEditor] = useState(null);
  const ownCustom = ownScale && !ownPreset ? customMeasureScaleIndex(customScales, ownScale) : -1;
  const scaleValue = !ownScale ? 'page' : (ownPreset ? ownPreset.id : (ownCustom >= 0 ? `custom:${ownCustom}` : 'own'));
  const scaleOptions = plusOn ? [
    { value: 'page', label: scale?.label ? `Page scale (${scale.label})` : 'Page scale' },
    ...(ownScale && !ownPreset && ownCustom < 0 ? [{ value: 'own', label: ownScale.label || 'Own scale' }] : []),
    ...MEASURE_PRESETS.map((p) => ({ value: p.id, label: p.label })),
    ...customScales.map((s, i) => ({ value: `custom:${i}`, label: s.label })),
  ] : null;
  const pickScale = (value) => {
    if (value === 'page') { onPatch?.({ ownScale: null, pageScale: scale }); return; }
    if (value.startsWith('custom:')) {
      const saved = customScales[Number(value.slice(7))];
      if (saved) onPatch?.({ ownScale: { ...saved } });
      return;
    }
    const base = scaleFromPreset(value);
    if (!base) return;
    const display = displayForScaleUnit(base.unit);
    onPatch?.({ ownScale: { ...base, display, precision: defaultMeasurePrecision(display) } });
  };

  const [labelDraft, setLabelDraft] = useState(savedLabel);
  const [depthDraft, setDepthDraft] = useState(depthText(savedDepth));
  const [leaderDraft, setLeaderDraft] = useState(depthText(savedLeader));
  const [ptDraft, setPtDraft] = useState(depthText(savedPt));
  const labelRef = useRef(null);
  const depthRef = useRef(null);
  const leaderRef = useRef(null);
  const ptRef = useRef(null);
  const cardRef = useRef(null);

  // An undo, redo or a collaborator's edit changes the mark under the card:
  // a field that is not being typed in shows the mark's value again.
  useEffect(() => {
    if (document.activeElement !== labelRef.current) setLabelDraft(savedLabel);
  }, [savedLabel]);
  useEffect(() => {
    if (document.activeElement !== depthRef.current) setDepthDraft(depthText(savedDepth));
  }, [savedDepth]);
  useEffect(() => {
    if (document.activeElement !== leaderRef.current) setLeaderDraft(depthText(savedLeader));
  }, [savedLeader]);
  useEffect(() => {
    if (document.activeElement !== ptRef.current) setPtDraft(depthText(savedPt));
  }, [savedPt]);

  const draftsRef = useRef({ labelDraft, depthDraft, leaderDraft, ptDraft, savedLabel, savedDepth, savedLeader, savedPt });
  draftsRef.current = { labelDraft, depthDraft, leaderDraft, ptDraft, savedLabel, savedDepth, savedLeader, savedPt };
  // Set once the card is closing with Escape: what was typed is dropped, even
  // when the field's blur arrives as the card goes away.
  const discardRef = useRef(false);
  // The value last written from a field, until the mark comes back with it:
  // a blur and a close right after one write must not write it again.
  const writtenRef = useRef({ label: undefined, depth: undefined, leader: undefined, pt: undefined });
  useEffect(() => { writtenRef.current.label = undefined; }, [savedLabel]);
  useEffect(() => { writtenRef.current.depth = undefined; }, [savedDepth]);
  useEffect(() => { writtenRef.current.leader = undefined; }, [savedLeader]);
  useEffect(() => { writtenRef.current.pt = undefined; }, [savedPt]);
  const commitLabel = useCallback(() => {
    if (discardRef.current) return;
    const drafts = draftsRef.current;
    const next = normalizeMeasureLabelText(drafts.labelDraft);
    setLabelDraft(next);
    const current = writtenRef.current.label !== undefined ? writtenRef.current.label : drafts.savedLabel;
    if (next === current) return;
    writtenRef.current.label = next;
    onPatch?.({ label: next });
  }, [onPatch]);
  const commitDepth = useCallback(() => {
    if (discardRef.current) return;
    const drafts = draftsRef.current;
    const next = normalizeMeasureDepth(String(drafts.depthDraft).replace(',', '.'));
    if (!next) {
      // Not a depth: the field goes back to the mark's.
      setDepthDraft(depthText(drafts.savedDepth));
      return;
    }
    setDepthDraft(depthText(next));
    const current = writtenRef.current.depth !== undefined ? writtenRef.current.depth : drafts.savedDepth;
    if (next === current) return;
    writtenRef.current.depth = next;
    onPatch?.({ depth: next });
  }, [onPatch]);
  const commitLeader = useCallback((typed) => {
    if (discardRef.current) return;
    const drafts = draftsRef.current;
    const next = normalizeDimensionLeader(typed ?? drafts.leaderDraft);
    if (next == null) {
      // Not a number: the field goes back to the mark's.
      setLeaderDraft(depthText(drafts.savedLeader));
      return;
    }
    setLeaderDraft(depthText(next));
    const current = writtenRef.current.leader !== undefined ? writtenRef.current.leader : drafts.savedLeader;
    if (next === current) return;
    writtenRef.current.leader = next;
    onPatch?.({ leader: next });
  }, [onPatch]);
  const commitPt = useCallback((typed) => {
    if (discardRef.current) return;
    const drafts = draftsRef.current;
    const next = normalizeDimensionCaptionPt(typed ?? drafts.ptDraft);
    if (next == null) {
      setPtDraft(depthText(drafts.savedPt));
      return;
    }
    setPtDraft(depthText(next));
    const current = writtenRef.current.pt !== undefined ? writtenRef.current.pt : drafts.savedPt;
    if (next === current) return;
    writtenRef.current.pt = next;
    onPatch?.({ captionPt: next });
  }, [onPatch]);
  const commitTyped = useCallback(() => {
    commitLabel();
    if (usesDepth) commitDepth();
    if (isDim) { commitLeader(); commitPt(); }
  }, [commitDepth, commitLabel, commitLeader, commitPt, isDim, usesDepth]);

  // The app's dismiss rules: a press outside closes it (keeping what was
  // typed), Escape closes it (dropping what was typed).
  useEffect(() => watchLightPopover({
    // The Scale drop-down's list is portalled to <body>: a pick there is inside,
    // and so is the Add / Edit scale dialog (and its drop-downs).
    contains: (target) => Boolean(target?.closest?.('[data-measure-edit-popover], [data-selection-quick-measure], .measure-edit__scale-menu, [data-measure-scale-dialog], .measure-scale__menu')),
    escape: !scaleEditor,
    close: (_event, reason) => {
      if (reason === 'escape') discardRef.current = true;
      else commitTyped();
      onClose?.();
    },
  }), [commitTyped, onClose, scaleEditor]);

  const fieldKeyDown = (event, commit, reset) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      discardRef.current = true;
      reset();
      onClose?.();
    }
    // Keys typed here are the field's: never a page shortcut (Delete, letters).
    event.stopPropagation();
  };

  const shown = useMemo(() => (mark ? measureShownFields(mark) : []), [mark]);
  const fields = measureCaptionFields(kind);
  const toggleField = (field) => {
    const next = shown.includes(field) ? shown.filter((f) => f !== field) : [...shown, field];
    onPatch?.({ fields: next });
  };
  const size = normalizeMeasureCaptionSize(saved.captionSize) || MEASURE_LABEL_FONT_PX;
  const captionPlace = isDim ? dimensionCaptionPlace(mark) : null;
  // Up / Down step the leader by 1 pt (10 with Shift), like Drawboard's ▲▼.
  const leaderKeyDown = (event) => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      const base = normalizeDimensionLeader(leaderDraft) ?? savedLeader ?? 0;
      const step = (event.shiftKey ? 10 : 1) * (event.key === 'ArrowUp' ? 1 : -1);
      commitLeader(String(Math.round((base + step) * 100) / 100));
      return;
    }
    fieldKeyDown(event, () => commitLeader(), () => setLeaderDraft(depthText(savedLeader)));
  };
  // Up / Down step the caption size by 1 pt.
  const ptKeyDown = (event) => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      const base = normalizeDimensionCaptionPt(ptDraft) ?? savedPt ?? 9;
      commitPt(String(base + (event.key === 'ArrowUp' ? 1 : -1)));
      return;
    }
    fieldKeyDown(event, () => commitPt(), () => setPtDraft(depthText(savedPt)));
  };

  // The caption as it will read with what is typed so far.
  const preview = useMemo(() => {
    if (!mark) return null;
    const changes = { label: labelDraft };
    const depth = normalizeMeasureDepth(String(depthDraft).replace(',', '.'));
    if (usesDepth && depth) changes.depth = depth;
    const label = buildMeasureLabel(applyMeasureEdit(mark, changes), scale);
    return label ? (label.lines || [label.text]) : null;
  }, [depthDraft, labelDraft, mark, scale, usesDepth]);

  // Keep the whole card on screen: slide it sideways, flip it to the other
  // side of the bar when it does not fit, and scroll it when neither side does.
  const [place, setPlace] = useState({ side, dx: 0, maxHeight: null });
  useLayoutEffect(() => {
    const card = cardRef.current;
    const bar = card?.parentElement;
    if (!card || !bar) return;
    const barRect = bar.getBoundingClientRect();
    const height = card.scrollHeight;
    const width = card.offsetWidth;
    const roomAbove = barRect.top - 6 - EDGE;
    const roomBelow = window.innerHeight - barRect.bottom - 6 - EDGE;
    let nextSide = side;
    if (side === 'above' && height > roomAbove && roomBelow > roomAbove) nextSide = 'below';
    if (side === 'below' && height > roomBelow && roomAbove > roomBelow) nextSide = 'above';
    const room = nextSide === 'above' ? roomAbove : roomBelow;
    const centre = barRect.left + barRect.width / 2;
    const left = centre - width / 2;
    const minLeft = EDGE;
    const maxLeft = window.innerWidth - EDGE - width;
    const dx = Math.round(Math.max(minLeft, Math.min(maxLeft, left)) - left);
    const maxHeight = height > room ? Math.max(120, Math.floor(room)) : null;
    setPlace((current) => (current.side === nextSide && current.dx === dx && current.maxHeight === maxHeight
      ? current
      : { side: nextSide, dx, maxHeight }));
  }, [side, preview, usesDepth, isDim]);

  if (!mark || !kind) return null;
  return (
    <div
      ref={cardRef}
      className="selection-quick-bar__popover measure-edit"
      data-selection-quick-bar-popover="true"
      data-measure-edit-popover="true"
      data-side={place.side}
      role="dialog"
      aria-label="Measurement"
      style={{
        transform: place.dx ? `translateX(${place.dx}px)` : undefined,
        maxHeight: place.maxHeight ? `${place.maxHeight}px` : undefined,
      }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="measure-edit__preview" data-measure-edit-preview aria-live="polite">
        {preview && preview.length
          ? preview.map((line, i) => <span key={i} className={i === 0 && labelDraft.trim() && shown.includes('label') ? 'is-label' : undefined}>{line}</span>)
          : <span className="measure-edit__empty">No caption</span>}
      </div>
      <label className="measure-edit__field">
        <span className="measure-edit__name">Label</span>
        <input
          ref={labelRef}
          type="text"
          className="measure-edit__input"
          data-measure-edit-label
          value={labelDraft}
          maxLength={MEASURE_LABEL_MAX_CHARS}
          placeholder="Add a label"
          autoComplete="off"
          enterKeyHint="done"
          onChange={(event) => setLabelDraft(event.target.value)}
          onBlur={commitLabel}
          onKeyDown={(event) => fieldKeyDown(event, commitLabel, () => setLabelDraft(savedLabel))}
        />
      </label>
      {usesDepth && (
        <label className="measure-edit__field">
          <span className="measure-edit__name">Depth</span>
          <span className="measure-edit__with-unit">
            <input
              ref={depthRef}
              type="text"
              inputMode="decimal"
              className="measure-edit__input"
              data-measure-edit-depth
              value={depthDraft}
              autoComplete="off"
              enterKeyHint="done"
              aria-label={`Depth (${unit})`}
              onChange={(event) => setDepthDraft(event.target.value)}
              onBlur={commitDepth}
              onKeyDown={(event) => fieldKeyDown(event, commitDepth, () => setDepthDraft(depthText(savedDepth)))}
            />
            <span className="measure-edit__unit" aria-hidden="true">{unit}</span>
          </span>
        </label>
      )}
      {isDim && (
        <label className="measure-edit__field">
          <span className="measure-edit__name">Leader</span>
          <span className="measure-edit__with-unit">
            <input
              ref={leaderRef}
              type="text"
              inputMode="decimal"
              className="measure-edit__input"
              data-measure-edit-leader
              value={leaderDraft}
              autoComplete="off"
              enterKeyHint="done"
              aria-label="Leader (pt)"
              onChange={(event) => setLeaderDraft(event.target.value)}
              onBlur={() => commitLeader()}
              onKeyDown={leaderKeyDown}
            />
            <span className="measure-edit__unit" aria-hidden="true">pt</span>
          </span>
        </label>
      )}
      <fieldset className="measure-edit__lines">
        <legend className="measure-edit__name">Show in caption</legend>
        {fields.map((field) => (
          <label key={field} className="measure-edit__tick" data-measure-edit-field={field}>
            <input
              type="checkbox"
              checked={shown.includes(field)}
              // Nothing to show until a label is typed.
              disabled={field === 'label' && !normalizeMeasureLabelText(labelDraft)}
              onChange={() => toggleField(field)}
            />
            <span>{MEASURE_FIELD_NAMES[field]}</span>
          </label>
        ))}
      </fieldset>
      {scaleOptions && (
        <div className="measure-edit__sizes measure-edit__sizes--stack" data-measure-edit-scale={scaleValue}>
          <span className="measure-edit__name" aria-hidden="true">Scale</span>
          <div className="measure-edit__scale-row">
            <ValueSelect look="field" size="sm" label="Scale" value={scaleValue} onChange={pickScale} options={scaleOptions} menuClassName="measure-edit__scale-menu" />
            {ownCustom >= 0 && (
              <button
                type="button"
                className="measure-edit__icon-btn"
                aria-label="Edit scale"
                data-measure-edit-scale-edit="true"
                {...(tip ? tip('Edit scale', tipSide) : {})}
                onClick={() => setScaleEditor({ scale: customScales[ownCustom], index: ownCustom })}
              >
                <Icon name="edit" size={13} color="currentColor" />
              </button>
            )}
            <button
              type="button"
              className="measure-edit__icon-btn"
              aria-label="Add scale"
              data-measure-edit-scale-add="true"
              {...(tip ? tip('Add scale', tipSide) : {})}
              onClick={() => setScaleEditor({ scale: ownScale || scale || null, index: -1 })}
            >
              <Icon name="plus" size={14} color="currentColor" />
            </button>
          </div>
        </div>
      )}
      {scaleEditor && (
        <MeasureScaleDialog
          pageNumber={1}
          markMode={scaleEditor.index >= 0 ? 'edit' : 'add'}
          editIndex={scaleEditor.index}
          currentScale={scaleEditor.scale}
          onApply={(next) => {
            setScaleEditor(null);
            setCustomScales(loadCustomMeasureScales());
            if (next) onPatch?.({ ownScale: { ...next } });
          }}
          onCalibrate={() => {}}
          onCancel={() => setScaleEditor(null)}
        />
      )}
      {segmentPlace && (
        <div className="measure-edit__sizes measure-edit__sizes--stack" role="group" aria-label="Segment captions">
          <span className="measure-edit__name" aria-hidden="true">Segment captions</span>
          <span className="measure-edit__size-buttons">
            {SEGMENT_CAPTION_PLACES.map((place) => (
              <button
                key={place}
                type="button"
                className={`measure-edit__size measure-edit__place${segmentPlace === place ? ' is-current' : ''}`}
                data-measure-edit-segments={place}
                aria-pressed={segmentPlace === place}
                {...(tip ? tip(SEGMENT_PLACE_TIPS[place], tipSide) : {})}
                onClick={() => onPatch?.({ segmentCaptions: place })}
              >
                {SEGMENT_PLACE_NAMES[place]}
              </button>
            ))}
          </span>
        </div>
      )}
      {isDim && (
        <div className="measure-edit__sizes" role="group" aria-label="Caption place">
          <span className="measure-edit__name" aria-hidden="true">Caption</span>
          <span className="measure-edit__size-buttons">
            {DIMENSION_CAPTION_PLACES.map((place) => (
              <button
                key={place}
                type="button"
                className={`measure-edit__size measure-edit__place${captionPlace === place ? ' is-current' : ''}`}
                data-measure-edit-place={place}
                aria-pressed={captionPlace === place}
                {...(tip ? tip(place === 'above' ? 'Caption beside the line' : 'Caption on the line', tipSide) : {})}
                onClick={() => onPatch?.({ captionPlace: place })}
              >
                {CAPTION_PLACE_NAMES[place]}
              </button>
            ))}
          </span>
        </div>
      )}
      {isDim ? (
        <>
          <label className="measure-edit__field">
            <span className="measure-edit__name">Caption size</span>
            <span className="measure-edit__with-unit">
              <input
                ref={ptRef}
                type="text"
                inputMode="decimal"
                className="measure-edit__input"
                data-measure-edit-caption-pt
                value={ptDraft}
                autoComplete="off"
                enterKeyHint="done"
                aria-label="Caption size (pt)"
                onChange={(event) => setPtDraft(event.target.value)}
                onBlur={() => commitPt()}
                onKeyDown={ptKeyDown}
              />
              <span className="measure-edit__unit" aria-hidden="true">pt</span>
            </span>
          </label>
          <div className="measure-edit__sizes measure-edit__sizes--stack" role="group" aria-label="Caption colour">
            <span className="measure-edit__name" aria-hidden="true">Text</span>
            <span className="measure-edit__swatches">
              <button
                type="button"
                className={`measure-edit__swatch measure-edit__swatch--auto${!captionStyle.color ? ' is-current' : ''}`}
                style={{ background: mark?.stroke || 'currentColor' }}
                data-measure-edit-caption-color="auto"
                aria-label="Same as the line"
                aria-pressed={!captionStyle.color}
                {...(tip ? tip('Same as the line', tipSide) : {})}
                onClick={() => onPatch?.({ captionColor: null })}
              />
              {DIMENSION_CAPTION_TEXT_COLORS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`measure-edit__swatch${captionStyle.color === option.color ? ' is-current' : ''}`}
                  style={{ background: option.color }}
                  data-measure-edit-caption-color={option.id}
                  aria-label={`${option.label} text`}
                  aria-pressed={captionStyle.color === option.color}
                  {...(tip ? tip(option.label, tipSide) : {})}
                  onClick={() => onPatch?.({ captionColor: option.color })}
                />
              ))}
            </span>
          </div>
          <div className="measure-edit__sizes measure-edit__sizes--stack" role="group" aria-label="Caption background">
            <span className="measure-edit__name" aria-hidden="true">Background</span>
            <span className="measure-edit__swatches">
              <button
                type="button"
                className={`measure-edit__swatch measure-edit__swatch--none${!captionStyle.bg ? ' is-current' : ''}`}
                data-measure-edit-caption-bg="none"
                aria-label="No background"
                aria-pressed={!captionStyle.bg}
                {...(tip ? tip('No background', tipSide) : {})}
                onClick={() => onPatch?.({ captionBg: null })}
              />
              {DIMENSION_CAPTION_BG_COLORS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`measure-edit__swatch${captionStyle.bg === option.color ? ' is-current' : ''}`}
                  style={{ background: option.color }}
                  data-measure-edit-caption-bg={option.id}
                  aria-label={`${option.label} background`}
                  aria-pressed={captionStyle.bg === option.color}
                  {...(tip ? tip(option.label, tipSide) : {})}
                  onClick={() => onPatch?.({ captionBg: option.color })}
                />
              ))}
            </span>
          </div>
          {captionStyle.bg && (
            <div className="measure-edit__sizes measure-edit__sizes--stack" role="group" aria-label="Background opacity">
              <span className="measure-edit__name" aria-hidden="true">Opacity</span>
              <span className="measure-edit__size-buttons">
                {DIMENSION_CAPTION_BG_OPACITIES.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`measure-edit__size measure-edit__place${captionStyle.bgOpacity === value ? ' is-current' : ''}`}
                    data-measure-edit-caption-bg-opacity={value}
                    aria-pressed={captionStyle.bgOpacity === value}
                    onClick={() => onPatch?.({ captionBgOpacity: value })}
                  >
                    {`${Math.round(value * 100)}%`}
                  </button>
                ))}
              </span>
            </div>
          )}
        </>
      ) : (
        <div className="measure-edit__sizes" role="group" aria-label="Caption size">
          <span className="measure-edit__name" aria-hidden="true">Caption size</span>
          <span className="measure-edit__size-buttons">
            {MEASURE_CAPTION_SIZES.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`measure-edit__size${size === option.px ? ' is-current' : ''}`}
                data-measure-edit-size={option.id}
                aria-label={`${option.name} caption`}
                aria-pressed={size === option.px}
                {...(tip ? tip(`${option.name} caption (${option.px} px)`, tipSide) : {})}
                onClick={() => onPatch?.({ captionSize: option.px })}
              >
                {option.label}
              </button>
            ))}
          </span>
        </div>
      )}
    </div>
  );
}
