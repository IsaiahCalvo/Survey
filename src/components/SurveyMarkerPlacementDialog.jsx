import { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icons';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { COLORS, SHADOWS } from '../theme';

// Category and entity are one decision. Already chosen toolbar values seed
// the form, and Reuse can still place the next marker without another prompt.
export default function SurveyMarkerPlacementDialog({ marker, template, categoryId, onCancel, onConfirm }) {
  const modules = template.modules || template.spaces || [];
  const [moduleId, setModuleId] = useState(marker.moduleId || modules[0]?.id || '');
  const [category, setCategory] = useState(categoryId || '');
  const [entityId, setEntityId] = useState(marker.entityId || '');
  const categories = modules.find((entry) => entry.id === moduleId)?.categories || [];
  const entities = template.entities || [];
  const ref = useRef(null);
  useFocusTrap(ref, true, { onEscape: onCancel });
  const valid = categories.some((entry) => entry.id === category)
    && (!entities.length || entities.some((entry) => entry.id === entityId));
  const field = { display: 'grid', gap: 6, marginTop: 14, fontSize: 13 };
  const input = { boxSizing: 'border-box', minWidth: 0, width: '100%', padding: '10px 12px', background: COLORS.modal.panel, color: COLORS.modal.textPrimary, border: `1px solid ${COLORS.modal.borderStrong}`, borderRadius: 6 };
  // Portalled to <body>: inside the viewer's z 5000 stacking context the
  // desktop rails (5600) painted over the scrim and stayed clickable, so a
  // category could be deleted from the rail under this open dialog.
  const node = <div onClick={onCancel} style={{ position: 'fixed', inset: 0, zIndex: 10001, background: COLORS.modal.overlay, backdropFilter: 'blur(8px)', display: 'grid', placeItems: 'center', padding: 20 }}>
    <form ref={ref} role="dialog" aria-modal="true" aria-labelledby="survey-marker-categorize-dialog-title" onClick={(event) => event.stopPropagation()} onSubmit={(event) => {
      event.preventDefault();
      if (!valid) return;
      const entity = entities.find((entry) => entry.id === entityId);
      onConfirm({ ...marker, moduleId, ...(entity ? { entityId: entity.id, entityName: entity.name, entityColor: entity.color } : {}) }, category);
    }} style={{ boxSizing: 'border-box', maxHeight: 'calc(100dvh - 40px)', overflowY: 'auto', width: 'min(440px, calc(100vw - 40px))', maxWidth: '100%', background: COLORS.modal.surface, color: COLORS.modal.textPrimary, padding: 24, border: `1px solid ${COLORS.modal.border}`, borderRadius: 8, boxShadow: SHADOWS.xl }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 id="survey-marker-categorize-dialog-title" style={{ margin: 0, fontSize: 18 }}>Categorize Survey Marker</h3>
        <button type="button" className="btn btn-icon" aria-label="Cancel Survey Marker" onClick={onCancel}><Icon name="close" size={18} /></button>
      </div>
      <p style={{ color: COLORS.modal.textMuted, fontSize: 13 }}>Choose the module, category and entity for this Survey Marker.</p>
      <label style={field}>Module<select aria-label="Module" value={moduleId} style={input} onChange={(event) => { setModuleId(event.target.value); setCategory(''); }}>
        {modules.map((entry) => <option key={entry.id} value={entry.id}>{entry.name || 'Untitled module'}</option>)}
      </select></label>
      <label style={field}>Category<select aria-label="Category" value={category} style={input} onChange={(event) => setCategory(event.target.value)}>
        <option value="">Choose a category</option>
        {categories.map((entry) => <option key={entry.id} value={entry.id}>{entry.name || 'Untitled category'}</option>)}
      </select></label>
      {entities.length ? <label style={field}>Entity<select aria-label="Entity" value={entityId} style={input} onChange={(event) => setEntityId(event.target.value)}>
        <option value="">Choose an entity</option>
        {entities.map((entry) => <option key={entry.id} value={entry.id}>{entry.name || 'Untitled entity'}</option>)}
      </select></label> : <p style={{ fontSize: 13, color: COLORS.modal.textMuted }}>This template has no entities.</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8, marginTop: 22 }}>
        <button type="button" className="btn btn-default" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={!valid}>Add Survey Marker</button>
      </div>
    </form>
  </div>;
  return typeof document !== 'undefined' && document.body ? createPortal(node, document.body) : node;
}
