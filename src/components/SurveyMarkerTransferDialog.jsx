// Move or Copy Survey Markers to another category: pick the template, then a
// module in it, then a category in that module (owner 2026-10-26). The shell
// is the app's one dialog look (DialogCard), portalled to document.body: the
// rail sits under the viewer's own stacking context, which would paint the
// left rail and toolbars over it.
import { useMemo, useState } from 'react';
import BodyPortal from './BodyPortal';
import DialogCard from './DialogCard.jsx';
import ValueSelect from './ValueSelect.jsx';
import { COLORS, Z_INDEX } from '../theme';
import {
  defaultSurveyMarkerTransferTarget,
  pickInTemplate,
  surveyMarkerTransferTargets,
} from '../utils/surveyMarkerTransfer.js';

const fieldLabelStyle = { display: 'grid', gap: 6, fontSize: 12, color: COLORS.modal.textMuted };

function Field({ label, value, options, onChange, disabled = false, empty }) {
  return (
    <div style={fieldLabelStyle}>
      <span aria-hidden="true">{label}</span>
      <ValueSelect
        label={label}
        value={value || ''}
        placeholder={options.length === 0 ? empty : undefined}
        disabled={disabled}
        options={options.map((option) => ({ value: option.id, label: option.name }))}
        onChange={onChange}
      />
    </div>
  );
}

export default function SurveyMarkerTransferDialog({
  mode,
  count,
  currentTemplate,
  templates,
  from,
  onConfirm,
  onClose,
}) {
  const targets = useMemo(() => surveyMarkerTransferTargets(currentTemplate, templates), [currentTemplate, templates]);
  const [pick, setPick] = useState(() => defaultSurveyMarkerTransferTarget(targets, from));
  const [error, setError] = useState('');
  const template = targets.find((entry) => entry.id === pick.templateId) || null;
  const modules = (template?.modules || []).filter((mod) => mod.categories.length > 0);
  const mod = modules.find((entry) => entry.id === pick.moduleId) || null;
  const categories = mod?.categories || [];
  const verb = mode === 'copy' ? 'Copy' : 'Move';
  const noun = count === 1 ? 'Survey Marker' : 'Survey Markers';
  const unchanged = mode === 'move' && pick.moduleId === from?.moduleId && pick.categoryId === from?.categoryId;

  const update = (next) => { setPick(next); setError(''); };
  const submit = (event) => {
    event.preventDefault();
    const result = onConfirm(pick);
    if (result?.ok) onClose();
    else setError(result?.reason || `Could not ${verb.toLowerCase()} them.`);
  };

  const blocked = !pick.categoryId || unchanged;

  return (
    <BodyPortal>
      <DialogCard
        as="form"
        title={`${verb} ${count} ${noun}`}
        message={mode === 'copy'
          ? 'Each copy keeps its name and place on the page, with no answers yet.'
          : 'They keep their answers, notes and place on the page.'}
        onClose={onClose}
        width={420}
        zIndex={Z_INDEX.modalOverlay}
        cardProps={{ onSubmit: submit, 'data-testid': 'survey-marker-transfer' }}
        footer={(
          <>
            <button type="button" className="hub-btn dialog-touch-pad" onClick={onClose}>Cancel</button>
            <button type="submit" className="hub-btn hub-btn--primary dialog-touch-pad" disabled={blocked}>{verb}</button>
          </>
        )}
      >
        <div style={{ display: 'grid', gap: 14 }}>
          <Field
            label="Template"
            value={pick.templateId}
            options={targets}
            empty="No templates"
            onChange={(id) => update(pickInTemplate(targets.find((entry) => entry.id === id), { moduleId: pick.moduleId }))}
          />
          <Field
            label="Module"
            value={pick.moduleId}
            options={modules}
            empty="No modules"
            disabled={modules.length === 0}
            onChange={(id) => update(pickInTemplate(template, { moduleId: id, avoidCategoryId: from?.moduleId === id ? from?.categoryId : null }))}
          />
          <Field
            label="Category"
            value={pick.categoryId}
            options={categories}
            empty="No categories"
            disabled={categories.length === 0}
            onChange={(id) => update({ ...pick, categoryId: id })}
          />
          {error ? <p role="alert" style={{ margin: 0, color: 'var(--danger)', fontSize: 13 }}>{error}</p> : null}
        </div>
      </DialogCard>
    </BodyPortal>
  );
}
