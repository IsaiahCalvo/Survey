import React from 'react';

export default function DocumentEntityCatalogAdoptionNotice({ review, busy = false,
  error = '', onConfirm, onCancel }) {
  if (!review) return null;
  const count = review.preview?.entities?.length || 0;
  return <section data-document-entity-catalog-review role="dialog" aria-modal="true"
    aria-label="Review document entity list" style={{ position: 'fixed', zIndex: 7600,
      top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
      width: 'min(560px, calc(100% - 24px))', maxHeight: 'calc(100vh - 32px)', overflow: 'auto',
      padding: 16, borderRadius: 10, background: '#202631', color: '#f4f6f8',
      border: '1px solid #465164', boxShadow: '0 12px 32px rgba(0,0,0,.38)' }}>
    <h2 style={{ margin: '0 0 8px', fontSize: 17 }}>Use this entity list for this document?</h2>
    <p style={{ margin: '0 0 8px', fontSize: 14 }}>
      {review.templateName} has {count} {count === 1 ? 'entity' : 'entities'}.
      This copies the list into this document. Later template edits will not change it.
    </p>
    <p style={{ margin: '0 0 8px', fontSize: 13, color: '#c9d0db' }}>
      Existing markers keep the name and color saved when they were assigned.
    </p>
    <ul style={{ maxHeight: 180, overflow: 'auto', margin: '8px 0 12px', padding: 0,
      listStyle: 'none' }}>
      {review.preview.entities.map(entity => <li key={entity.id} style={{ display: 'flex',
        alignItems: 'center', gap: 8, margin: '5px 0' }}>
        <span aria-hidden="true" style={{ width: 18, height: 18, borderRadius: 4,
          background: entity.color, opacity: entity.opacity,
          border: entity.borderColor ? `2px solid ${entity.borderColor}` : '1px solid #778092' }} />
        <span>{entity.name}</span>
        <small style={{ color: '#aeb7c5' }}>fill {Math.round(entity.opacity * 100)}%
          {entity.borderColor ? ` · border ${Math.round((entity.borderOpacity ?? 1) * 100)}%` : ''}
          {entity.matchFill ? ' · match fill' : ''}</small>
      </li>)}
    </ul>
    {error && <p role="alert" style={{ color: '#ffb3b3', margin: '0 0 10px' }}>{error}</p>}
    <button type="button" disabled={busy} onClick={() => { void onConfirm?.(); }}>Use for this document</button>
    <button type="button" disabled={busy} onClick={onCancel} style={{ marginLeft: 8 }}>Keep current choices</button>
  </section>;
}
