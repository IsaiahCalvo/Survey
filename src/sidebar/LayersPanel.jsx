/**
 * LayersPanel - Drawboard-style Layers panel (behind the 'layers' flag).
 *
 * "PDF content" row with an opacity slider, then the markup layers: pick the
 * active layer (new marks go there), show / hide, rename (double-click or the
 * pencil), delete (with confirm; its marks fall back to the default layer),
 * and Add layer. All edits go out as one whole next state through
 * onLayersChange; the pure rules live in utils/layers.js.
 */
import React, { useCallback, useState } from 'react';
import Icon from '../Icons';
import { useConfirmDialog } from '../components/dialogPrompts';
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

const rowStyle = (active) => ({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minHeight: 36,
  padding: '0 8px',
  borderRadius: 6,
  cursor: 'pointer',
  background: active ? 'var(--hover)' : 'transparent',
  boxShadow: active ? 'inset 2px 0 0 var(--accent)' : 'none',
});

const iconButton = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: 'var(--text-2)',
  cursor: 'pointer',
  flexShrink: 0,
};

export default function LayersPanel({ layerState, activeLayerId, onLayersChange, onActiveLayerChange, readOnly = false }) {
  const state = normalizeLayerState(layerState);
  const [editingId, setEditingId] = useState(null);
  const [draftName, setDraftName] = useState('');
  const [askConfirm, confirmDialog] = useConfirmDialog();

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

  const handleDelete = (layer) => {
    askConfirm({
      title: `Delete ${layer.name}?`,
      message: 'The layer is removed for everyone. Its markups are kept and move to the default layer.',
      confirmLabel: 'Delete',
      danger: true,
    }).then((confirmed) => {
      if (!confirmed) return;
      commit(deleteLayer(state, layer.id));
      if (activeLayerId === layer.id) onActiveLayerChange?.(DEFAULT_LAYER_ID);
    });
  };

  const opacityPercent = Math.round(state.pdfOpacity * 100);

  return (
    <div data-testid="layers-panel" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflowY: 'auto', padding: 8, gap: 8, color: 'var(--text-2)', fontSize: 13 }}>
      <div style={{ padding: '6px 8px', borderRadius: 6, background: 'var(--surface-2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontWeight: 600 }}>PDF content</span>
          <span style={{ color: 'var(--text-3)' }}>{opacityPercent}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={opacityPercent}
          aria-label="PDF content opacity"
          onChange={(e) => commit(setPdfOpacity(state, Number(e.target.value) / 100))}
          style={{ width: '100%' }}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 8px' }}>
        <span style={{ fontWeight: 600 }}>Markup layers</span>
        {!readOnly && (
          <button type="button" style={{ ...iconButton, width: 'auto', padding: '0 8px', gap: 4 }} onClick={handleAdd} aria-label="Add layer">
            <Icon name="plus" size={14} /> Add layer
          </button>
        )}
      </div>

      <div role="radiogroup" aria-label="Active layer" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {state.layers.map((layer) => {
          const active = layer.id === activeLayerId;
          return (
            <div
              key={layer.id}
              role="radio"
              aria-checked={active}
              tabIndex={0}
              data-layer-id={layer.id}
              style={rowStyle(active)}
              onClick={() => onActiveLayerChange?.(layer.id)}
              onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && editingId !== layer.id) { e.preventDefault(); onActiveLayerChange?.(layer.id); } }}
              onDoubleClick={() => startRename(layer)}
            >
              <button
                type="button"
                style={{ ...iconButton, color: layer.visible ? 'var(--text-2)' : 'var(--text-3)' }}
                aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
                aria-pressed={!layer.visible}
                onClick={(e) => { e.stopPropagation(); commit(setLayerVisible(state, layer.id, !layer.visible)); }}
              >
                <EyeIcon open={layer.visible} />
              </button>
              {editingId === layer.id ? (
                <input
                  autoFocus
                  value={draftName}
                  aria-label="Layer name"
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setDraftName(e.target.value)}
                  onBlur={finishRename}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') finishRename();
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  style={{ flex: 1, minWidth: 0, font: 'inherit', padding: '2px 4px', border: '1px solid var(--border-strong)', borderRadius: 4, background: 'var(--surface-1)', color: 'inherit' }}
                />
              ) : (
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: layer.visible ? 1 : 0.55 }}>
                  {layer.name}
                </span>
              )}
              {!readOnly && editingId !== layer.id && (
                <button type="button" style={iconButton} aria-label={`Rename ${layer.name}`} onClick={(e) => { e.stopPropagation(); startRename(layer); }}>
                  <Icon name="edit" size={14} />
                </button>
              )}
              {!readOnly && layer.id !== DEFAULT_LAYER_ID && editingId !== layer.id && (
                <button type="button" style={iconButton} aria-label={`Delete ${layer.name}`} onClick={(e) => { e.stopPropagation(); handleDelete(layer); }}>
                  <Icon name="trash" size={14} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ padding: '0 8px', color: 'var(--text-3)', fontSize: 12 }}>
        New markups go on the selected layer. Hidden layers are left out of exports.
      </div>
      {confirmDialog}
    </div>
  );
}
