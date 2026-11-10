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
} from '../utils/measure/measureScale.js';

// Space kept between the card and the window's edges.
const EDGE = 8;

const depthText = (depth) => (depth == null ? '' : String(depth));

export default function MeasureEditPopover({ measure, onPatch, onClose, side = 'below', tip, tipSide = 'below' }) {
  const mark = measure?.mark || null;
  const scale = measure?.scale || null;
  const kind = getMeasureKind(mark);
  const saved = mark?.data?.measure || {};
  const savedLabel = normalizeMeasureLabelText(saved.label);
  const savedDepth = normalizeMeasureDepth(saved.depth);
  const usesDepth = DEPTH_MEASURE_KINDS.includes(kind);
  const unit = isValidMeasureScale(scale) ? MEASURE_UNITS[scale.unit].label : 'in';

  const [labelDraft, setLabelDraft] = useState(savedLabel);
  const [depthDraft, setDepthDraft] = useState(depthText(savedDepth));
  const labelRef = useRef(null);
  const depthRef = useRef(null);
  const cardRef = useRef(null);

  // An undo, redo or a collaborator's edit changes the mark under the card:
  // a field that is not being typed in shows the mark's value again.
  useEffect(() => {
    if (document.activeElement !== labelRef.current) setLabelDraft(savedLabel);
  }, [savedLabel]);
  useEffect(() => {
    if (document.activeElement !== depthRef.current) setDepthDraft(depthText(savedDepth));
  }, [savedDepth]);

  const draftsRef = useRef({ labelDraft, depthDraft, savedLabel, savedDepth });
  draftsRef.current = { labelDraft, depthDraft, savedLabel, savedDepth };
  // Set once the card is closing with Escape: what was typed is dropped, even
  // when the field's blur arrives as the card goes away.
  const discardRef = useRef(false);
  // The value last written from a field, until the mark comes back with it:
  // a blur and a close right after one write must not write it again.
  const writtenRef = useRef({ label: undefined, depth: undefined });
  useEffect(() => { writtenRef.current.label = undefined; }, [savedLabel]);
  useEffect(() => { writtenRef.current.depth = undefined; }, [savedDepth]);
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
  const commitTyped = useCallback(() => {
    commitLabel();
    if (usesDepth) commitDepth();
  }, [commitDepth, commitLabel, usesDepth]);

  // The app's dismiss rules: a press outside closes it (keeping what was
  // typed), Escape closes it (dropping what was typed).
  useEffect(() => watchLightPopover({
    contains: (target) => Boolean(target?.closest?.('[data-measure-edit-popover], [data-selection-quick-measure]')),
    close: (_event, reason) => {
      if (reason === 'escape') discardRef.current = true;
      else commitTyped();
      onClose?.();
    },
  }), [commitTyped, onClose]);

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
  }, [side, preview, usesDepth]);

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
    </div>
  );
}
