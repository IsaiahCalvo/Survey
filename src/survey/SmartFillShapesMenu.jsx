/**
 * SmartFillShapesMenu — the Smart fill shapes button and its card, in the
 * Survey Marker group beside Teach (owner 2026-10-26: "we also have to figure
 * out a UI for allowing users to create custom shapes that get filled").
 *
 * Intended UX: the card lists every shape Smart fill looks for besides the
 * drawing's own outlines (the ones taught from a drawing and the ones picked
 * here), each with its outline, name and size. A name is renamed in place
 * (Enter or leaving the field saves it); the bin removes a shape at once with
 * an Undo toast. Below the list, "Teach from the drawing" arms the box tool
 * as before, and the outlines (circle, square, diamond, hexagon, octagon,
 * triangle, pill) arm it with that outline: the next box dragged over one tag
 * sizes the outline, and Save shape keeps it in the open survey template, so
 * Smart fill finds tags of that shape even where it can't read the drawing's
 * own outline (a scan, or a tag drawn as loose lines).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import AnchoredPopover from '../components/AnchoredPopover';
import { watchLightPopover } from '../components/dismissRules.js';
import { useTooltip } from '../components/Tooltip';
import Icon from '../Icons';
import { showToast, dismissToast } from '../utils/toast';
import { SHAPE_PRESETS } from './smartFillTemplates.js';
import {
  getSmartFillTemplateName,
  removeSmartFillShape,
  renameSmartFillShape,
  setSmartFillTeachArmed,
  useSmartFillShapes,
} from './smartFillTemplateShapes.js';
import '../components/AnnotationDropdown.css';
import './SmartFillShapesMenu.css';

function ShapeOutline({ ring, size = 20 }) {
  // The unit ring drawn on the house 24 grid, 3 units in from each side.
  const points = ring.map(([u, v]) => `${(3 + u * 18).toFixed(2)},${(3 + v * 18).toFixed(2)}`).join(' ');
  return (
    <svg className="sf-shapes__outline" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <polygon points={points} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

function ShapeRow({ shape, where }) {
  const tip = useTooltip();
  const [name, setName] = useState(shape.name || '');
  useEffect(() => setName(shape.name || ''), [shape.name]);
  const commit = () => {
    const next = name.trim();
    if (!next || next === shape.name) {
      setName(shape.name || '');
      return;
    }
    void renameSmartFillShape(shape.id, next);
  };
  const remove = async () => {
    const { ok, undo } = await removeSmartFillShape(shape.id);
    if (!ok) {
      showToast('That shape could not be removed. Try again.', 'error', { id: 'smart-fill-shapes' });
      return;
    }
    showToast(`Removed ${shape.name || 'the shape'}. Smart fill stops looking for it.`, 'info', {
      id: 'smart-fill-shapes',
      duration: 8000,
      action: { label: 'Undo', onClick: () => { void undo(); } },
    });
  };
  const w = Math.round(shape.width * 10) / 10;
  const h = Math.round(shape.height * 10) / 10;
  return (
    <li className="sf-shapes__row" data-smart-fill-shape={shape.id} data-smart-fill-shape-where={where}>
      <ShapeOutline ring={shape.ring} />
      <span className="sf-shapes__text">
        <input
          className="sf-shapes__name"
          value={name}
          maxLength={60}
          aria-label={`Name of ${shape.name || 'shape'}`}
          onChange={(event) => setName(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
            if (event.key === 'Escape') { event.stopPropagation(); setName(shape.name || ''); }
          }}
        />
        <span className="sf-shapes__size">{w} × {h} pt{where === 'browser' ? ' · this browser' : ''}</span>
      </span>
      <button
        type="button"
        className="sf-shapes__remove"
        aria-label={`Remove ${shape.name || 'shape'}`}
        data-smart-fill-shape-remove="true"
        onClick={remove}
        {...tip('Remove', 'below')}
      >
        <Icon name="trash" size={14} />
      </button>
    </li>
  );
}

export default function SmartFillShapesMenu({ chromeTip, glyphSize }) {
  const tip = useTooltip();
  const list = useSmartFillShapes();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);
  const cardRef = useRef(null);
  const getAnchor = useCallback(() => buttonRef.current, []);

  useEffect(() => {
    if (!open) return undefined;
    cardRef.current?.querySelector('[data-smart-fill-shapes-teach]')?.focus();
    return watchLightPopover({
      contains: (target) => Boolean(buttonRef.current?.contains(target) || cardRef.current?.contains(target)),
      close: () => setOpen(false),
    });
  }, [open]);

  const arm = (preset) => {
    setOpen(false);
    setSmartFillTeachArmed(true, { preset: preset?.id || null });
    dismissToast('smart-fill-shapes');
    showToast(preset
      ? `Drag a box over one tag to size the ${preset.label.toLowerCase()}. Smart fill will look for that shape.`
      : 'Drag a box around a tag Smart fill missed. It will learn that shape.', 'info', { id: 'smart-fill-no-match', duration: 8000 });
  };

  const where = getSmartFillTemplateName();
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`btn chrome-subcontrol ${open ? 'btn-active' : 'btn-ghost'}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-smart-fill-shapes-toggle="true"
        onClick={() => setOpen((value) => !value)}
        {...(chromeTip ? chromeTip('Smart fill shapes', 'below') : {})}
        aria-label="Smart fill shapes"
      >
        <Icon name="shapes" size={glyphSize} />
      </button>
      {open && (
        <AnchoredPopover getAnchor={getAnchor} gap={6}>
          <div
            ref={cardRef}
            role="dialog"
            aria-label="Smart fill shapes"
            data-smart-fill-shapes="true"
            className="annotation-dropdown__popover sf-shapes"
            style={{ position: 'absolute', top: '100%', left: '50%', marginTop: 6, transform: 'translate(-50%, 0)' }}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && event.target.tagName !== 'INPUT') {
                event.stopPropagation();
                setOpen(false);
                buttonRef.current?.focus();
              }
            }}
          >
            <div className="sf-shapes__head">
              <span className="sf-shapes__title">Smart fill shapes</span>
              <span className="sf-shapes__where">{where ? `Saved in ${where}` : 'Saved in this browser'}</span>
            </div>
            {list.length ? (
              <ul className="sf-shapes__list" aria-label="Shapes Smart fill looks for">
                {list.map(({ shape, where: kept }) => <ShapeRow key={shape.id} shape={shape} where={kept} />)}
              </ul>
            ) : (
              <p className="sf-shapes__empty">No shapes yet. Teach one from the drawing, or pick an outline and drag it over one tag.</p>
            )}
            <div className="sf-shapes__add">
              <button type="button" className="annotation-dropdown__option sf-shapes__teach" data-smart-fill-shapes-teach="true" onClick={() => arm(null)}>
                <Icon name="template" size={14} />
                <span>Teach from the drawing</span>
              </button>
              <span className="sf-shapes__label" id="sf-shapes-pick">Or pick an outline</span>
              <div className="sf-shapes__presets" role="group" aria-labelledby="sf-shapes-pick">
                {SHAPE_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className="sf-shapes__preset"
                    data-smart-fill-shape-preset={preset.id}
                    aria-label={`${preset.label}: drag it over one tag`}
                    onClick={() => arm(preset)}
                    {...tip(preset.label, 'below')}
                  >
                    <ShapeOutline ring={preset.ring} size={22} />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </AnchoredPopover>
      )}
    </>
  );
}
