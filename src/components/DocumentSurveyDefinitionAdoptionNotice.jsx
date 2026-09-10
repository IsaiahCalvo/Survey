import React from 'react';
import BodyPortal from './BodyPortal.js';

export default function DocumentSurveyDefinitionAdoptionNotice({ available = false, review,
  busy = false, error = '', onRequest, onConfirm, onCancel }) {
  if (!review) {
    if (!available) return null;
    return <BodyPortal><section data-document-survey-definition-offer style={{ position: 'fixed', zIndex: 7550,
      right: 16, bottom: 16, width: 'min(360px, calc(100% - 32px))', padding: 14,
      borderRadius: 10, background: '#202631', color: '#f4f6f8', border: '1px solid #465164',
      boxShadow: '0 8px 24px rgba(0,0,0,.32)' }}>
      <p style={{ margin: '0 0 10px', fontSize: 14 }}>
        You can save this template&apos;s survey structure with the document.
      </p>
      {error && <p role="alert" style={{ color: '#ffb3b3', margin: '0 0 10px' }}>{error}</p>}
      <button type="button" disabled={busy} onClick={() => { void onRequest?.(); }}>
        Review survey structure
      </button>
    </section></BodyPortal>;
  }

  const modules = review.preview?.modules || [];
  const categoryCount = modules.reduce((count, module) => count + module.categories.length, 0);
  const checklistCount = modules.reduce((count, module) => count + module.categories.reduce(
    (categoryTotal, category) => categoryTotal + category.checklist.length, 0), 0);

  return <BodyPortal><section data-document-survey-definition-review role="dialog"
    aria-label="Review document survey structure" style={{ position: 'fixed', zIndex: 7600,
      top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
      width: 'min(620px, calc(100% - 24px))', maxHeight: 'calc(100vh - 32px)', overflow: 'auto',
      padding: 16, borderRadius: 10, background: '#202631', color: '#f4f6f8',
      border: '1px solid #465164', boxShadow: '0 12px 32px rgba(0,0,0,.38)' }}>
    <h2 style={{ margin: '0 0 8px', fontSize: 17 }}>Use this survey structure for this document?</h2>
    <p style={{ margin: '0 0 8px', fontSize: 14 }}>
      {review.templateName} has {modules.length} {modules.length === 1 ? 'module' : 'modules'}, {' '}
      {categoryCount} {categoryCount === 1 ? 'category' : 'categories'}, and {checklistCount} {' '}
      {checklistCount === 1 ? 'checklist item' : 'checklist items'}.
      This saves the structure with this document. Later template edits will not change it.
    </p>
    <p style={{ margin: '0 0 8px', fontSize: 13, color: '#c9d0db' }}>
      This does not rewrite existing marks.
    </p>
    <ul style={{ maxHeight: 230, overflow: 'auto', margin: '8px 0 12px', paddingLeft: 20 }}>
      {modules.map(module => <li key={module.id} style={{ margin: '7px 0' }}>
        <strong>{module.name}</strong>
        <ul style={{ margin: '4px 0', paddingLeft: 20 }}>
          {module.categories.map(category => <li key={category.id} style={{ margin: '5px 0' }}>
            <span>{category.name} ({category.checklist.length} {' '}
              {category.checklist.length === 1 ? 'checklist item' : 'checklist items'})</span>
            <ul style={{ margin: '3px 0', paddingLeft: 20 }}>
              {category.checklist.map(item => <li key={item.id}>
                {item.text}{item.archived ? ' (Archived)' : ''}
              </li>)}
            </ul>
          </li>)}
        </ul>
      </li>)}
    </ul>
    {error && <p role="alert" style={{ color: '#ffb3b3', margin: '0 0 10px' }}>{error}</p>}
    <button type="button" disabled={busy} onClick={() => { void onConfirm?.(); }}>
      Use for this document
    </button>
    <button type="button" disabled={busy} onClick={onCancel} style={{ marginLeft: 8 }}>
      Keep current structure
    </button>
  </section></BodyPortal>;
}
