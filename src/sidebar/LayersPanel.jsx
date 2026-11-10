/**
 * LayersPanel - Drawboard-style Layers panel (behind the 'layers' flag).
 *
 * "PDF content" row with five opacity steps, then the markup layers: pick the
 * active layer (new marks go there), show / hide, rename (double-click or the
 * pencil), delete (act first with an Undo toast; its marks fall back to the
 * default layer), and Add layer (the + in the rail head; inline on phone). All edits go out as one whole next state through
 * onLayersChange; the pure rules live in utils/layers.js.
 */
import React, { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icons';
import './LayersPanel.css';
import SectionIconButton from '../components/SectionIconButton.jsx';
import { useTooltip } from '../components/Tooltip.jsx';
import { showToast } from '../utils/toast';
import {
  DEFAULT_LAYER_ID,
  addLayer,
  deleteLayer,
  normalizeLayerState,
  renameLayer,
  setLayerVisible,
  setPdfOpacity,
} from '../utils/layers.js';

function EyeIcon({ open }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      {open ? <circle cx="12" cy="12" r="3" /> : <line x1="3" y1="3" x2="21" y2="21" />}
    </svg>
  );
}

const PDF_OPACITY_STEPS = [[100, '100%'], [75, '75%'], [50, '50%'], [25, '25%'], [0, 'Off']];

export default function LayersPanel({ layerState, activeLayerId, onLayersChange, onActiveLayerChange, readOnly = false, headActionsHost = null }) {
  const state = normalizeLayerState(layerState);
  const [editingId, setEditingId] = useState(null);
  const [draftName, setDraftName] = useState('');
  const tip = useTooltip();

  const commit = useCallback((next) => { onLayersChange?.(next); }, [onLayersChange]);

  const startRename = (layer) => {
    if (readOnly) return;
    setEditingId(layer.id);
    setDraftName(layer.name);
  };
  const finishRename = () => {
    if (editingId) commit(renameLayer(state, editingId, draftName));
    setEditingId(null);
  };

  const handleAdd = () => {
    const { state: next, layer } = addLayer(state);
    commit(next);
    onActiveLayerChange?.(layer.id);
    setEditingId(layer.id);
    setDraftName(layer.name);
  };

  // Act first, Undo after (the app's rule instead of a confirm). The layer's
  // marks keep their layer id, so putting the old state back restores them.
  const handleDelete = (layer) => {
    const before = state;
    const wasActive = activeLayerId === layer.id;
    commit(deleteLayer(state, layer.id));
    if (wasActive) onActiveLayerChange?.(DEFAULT_LAYER_ID);
    showToast(`Deleted ${layer.name}`, 'info', {
      action: {
        label: 'Undo',
        onClick: () => {
          commit(before);
          if (wasActive) onActiveLayerChange?.(layer.id);
        },
      },
    });
  };

  const opacityPercent = Math.round(state.pdfOpacity * 100);
  const addInHead = Boolean(headActionsHost) && !readOnly;

  return (
    <div data-testid="layers-panel" className="layers-panel">
      {addInHead && createPortal(
        <SectionIconButton action="add" label="Add layer" data-layer-add="true" onClick={handleAdd} />,
        headActionsHost,
      )}
      {/* Owner 2026-10-26 (issue note #18): "I don't like the slider". The
          PDF's strength is five steps now, one press each, the current one
          gold like every pick in the chrome; Off leaves only the markups. */}
      <section className="layers-panel__section" aria-labelledby="layers-pdf-head">
        <div className="layers-panel__head">
          <span id="layers-pdf-head" className="layers-panel__title">PDF page</span>
          {/* The gold step already says it; a number shows only for a value
              between the steps (older saves). */}
          {!PDF_OPACITY_STEPS.some(([percent]) => percent === opacityPercent) && (
            <span className="layers-panel__meta nums">{`${opacityPercent}%`}</span>
          )}
        </div>
        <div className="layers-opacity" role="radiogroup" aria-label="PDF content opacity">
          {PDF_OPACITY_STEPS.map(([percent, word]) => (
            <button
              key={percent}
              type="button"
              role="radio"
              aria-checked={opacityPercent === percent}
              aria-label={percent === 0 ? 'Hide PDF content' : `PDF content ${percent}%`}
              data-pdf-opacity={percent}
              className={`layers-opacity__step${opacityPercent === percent ? ' is-active' : ''}`}
              onClick={() => commit(setPdfOpacity(state, percent / 100))}
            >
              {word}
            </button>
          ))}
        </div>
      </section>

      <section className="layers-panel__section" aria-labelledby="layers-markup-head">
        <div className="layers-panel__head">
          <span id="layers-markup-head" className="layers-panel__title">Markup layers</span>
          {!readOnly && !addInHead && (
            <button type="button" className="layers-panel__text-btn" data-layer-add="true" onClick={handleAdd}>
              <Icon name="plus" size={14} /> Add layer
            </button>
          )}
        </div>

        <div role="radiogroup" aria-label="Active layer" className="layers-panel__list">
          {state.layers.map((layer) => {
            const active = layer.id === activeLayerId;
            const editing = editingId === layer.id;
            return (
              <div
                key={layer.id}
                role="radio"
                aria-checked={active}
                tabIndex={0}
                data-layer-id={layer.id}
                className={`layers-row${active ? ' is-active' : ''}${layer.visible ? '' : ' is-hidden'}${editing ? ' is-editing' : ''}`}
                onClick={() => onActiveLayerChange?.(layer.id)}
                onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !editing) { e.preventDefault(); onActiveLayerChange?.(layer.id); } }}
                onDoubleClick={() => startRename(layer)}
              >
                <button
                  type="button"
                  className="layers-row__btn layers-row__eye"
                  aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
                  aria-pressed={!layer.visible}
                  {...tip(layer.visible ? 'Hide' : 'Show', 'below')}
                  onClick={(e) => { e.stopPropagation(); commit(setLayerVisible(state, layer.id, !layer.visible)); }}
                >
                  <EyeIcon open={layer.visible} />
                </button>
                {editing ? (
                  <input
                    autoFocus
                    className="layers-row__input"
                    value={draftName}
                    aria-label="Layer name"
                    onFocus={(e) => e.target.select()}
                    // A new layer's name must start selected, so typing
                    // replaces it: the focus from the Add press can land
                    // before the name is in the box ("Layer 1t4 layer").
                    ref={(el) => {
                      if (!el || el.dataset.namePicked) return;
                      el.dataset.namePicked = 'true';
                      requestAnimationFrame(() => { if (el.isConnected) { el.focus(); el.select(); } });
                    }}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setDraftName(e.target.value)}
                    onBlur={finishRename}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') finishRename();
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                  />
                ) : (
                  <span className="layers-row__name">{layer.name}</span>
                )}
                {!readOnly && !editing && (
                  <span className="layers-row__tools">
                    <button type="button" className="layers-row__btn" aria-label={`Rename ${layer.name}`} {...tip('Rename', 'below')} onClick={(e) => { e.stopPropagation(); startRename(layer); }}>
                      <Icon name="edit" size={14} />
                    </button>
                    {layer.id !== DEFAULT_LAYER_ID && (
                      <button type="button" className="layers-row__btn" aria-label={`Delete ${layer.name}`} {...tip('Delete', 'below')} onClick={(e) => { e.stopPropagation(); handleDelete(layer); }}>
                        <Icon name="trash" size={14} />
                      </button>
                    )}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <p className="layers-panel__note">New markups go on the selected layer. Hidden layers are left out of exports.</p>
      </section>
    </div>
  );
}
