/* Category Types on a template Category (KAL-618, Nightly flag 'suite').
   A Category (Camera) may carry Types (PTZ, Fisheye). Each is a chip with its
   own remove button; the field at the end adds one on Enter. Types link to the
   library when templates are saved (src/library/libraryModel.js). */
import { useState } from 'react';
import { useTooltip } from '../components/Tooltip';
import { Icon } from './HubShell';
import { newCategoryTypeProblem } from '../library/libraryModel.js';

export default function CategoryTypesRow({ category, types = [], phone = false, onAdd, onRemove }) {
  const tip = useTooltip();
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState('');
  const hit = phone ? 44 : 20;
  const commit = () => {
    if (!draft.trim()) { setProblem(''); return; }
    const why = newCategoryTypeProblem({ types }, draft);
    if (why) { setProblem(why); return; }
    onAdd(draft);
    setDraft('');
    setProblem('');
  };
  return (
    <div data-category-types={category?.id} style={{ padding: phone ? '8px 12px 4px' : '6px 0 2px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
        <span className="meta" style={{ fontSize: 11, minWidth: 38 }}>Types</span>
        {types.map((type) => (
          <span
            key={type.id}
            data-category-type-id={type.id}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 2, paddingLeft: 8,
              border: '1px solid var(--rule)', borderRadius: 999, fontSize: 12,
              minHeight: phone ? 32 : 22, background: 'var(--paper)',
            }}
          >
            {type.name}
            <button
              type="button"
              aria-label={`Remove Type ${type.name}`}
              {...tip(`Remove Type ${type.name}`)}
              onClick={(e) => { e.stopPropagation(); onRemove(type.id); }}
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: hit, height: phone ? 32 : hit, border: 0, background: 'transparent',
                color: 'var(--text-2)', cursor: 'pointer', padding: 0,
              }}
            ><Icon name="close" size={10} /></button>
          </span>
        ))}
        <input
          type="text"
          value={draft}
          aria-label={`Add a Type to ${category?.name || 'this Category'}`}
          aria-invalid={problem ? 'true' : undefined}
          placeholder={types.length ? 'Add a Type' : 'Add a Type, such as PTZ'}
          onChange={(e) => { setDraft(e.target.value); if (problem) setProblem(''); }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            if (e.key === 'Escape') { setDraft(''); setProblem(''); }
          }}
          onBlur={commit}
          style={{
            flex: '1 1 120px', minWidth: 100, height: phone ? 36 : 24, fontSize: phone ? 16 : 12,
            border: 0, borderBottom: '1px dashed var(--rule)', background: 'transparent',
            color: 'inherit', outline: 'none', padding: '0 2px',
          }}
        />
      </div>
      {problem ? <div role="alert" className="meta" style={{ fontSize: 11, paddingTop: 3, color: 'var(--danger, #c0392b)' }}>{problem}</div> : null}
    </div>
  );
}
