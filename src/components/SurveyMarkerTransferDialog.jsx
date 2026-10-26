// Move or Copy Survey Markers to another category: pick the template, then a
// module in it, then a category in that module (owner 2026-10-26). The shell
// is the survey's one picker window (SpaceSelectionDialog: portal, scrim,
// focus trap, Escape closes).
import { useMemo, useState } from 'react';
import SpaceSelectionDialog from './SpaceSelectionDialog';
import { COLORS } from '../theme';
import { C } from '../uiPalette';
import {
  defaultSurveyMarkerTransferTarget,
  pickInTemplate,
  surveyMarkerTransferTargets,
} from '../utils/surveyMarkerTransfer.js';

const selectStyle = {
  background: COLORS.modal.panel,
  color: COLORS.modal.textPrimary,
  padding: '8px 10px',
  border: `1px solid ${COLORS.modal.borderStrong}`,
  borderRadius: 6,
  fontFamily: 'inherit',
  fontSize: 13,
};

const cancelStyle = {
  background: 'transparent', border: 0, color: C.muted, padding: '6px 10px',
  fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', borderRadius: 6,
};
const primaryStyle = (disabled) => ({
  background: C.gold, color: 'var(--accent-text)', border: 0, borderRadius: 6,
  padding: '5px 14px', height: 28, fontSize: 11.5, fontWeight: 600, fontFamily: 'inherit',
  cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
});

function Field({ label, value, options, onChange, disabled = false, empty }) {
  return (
    <label style={{ display: 'grid', gap: 6, fontSize: 12, color: COLORS.modal.textMuted }}>
      {label}
      <select aria-label={label} value={value || ''} disabled={disabled} onChange={(event) => onChange(event.target.value)} style={selectStyle}>
        {options.length === 0 ? <option value="">{empty}</option> : null}
        {options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
      </select>
    </label>
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

  return (
    <SpaceSelectionDialog open title={`${verb} ${count} ${noun}`} onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'grid', gap: 14 }} data-testid="survey-marker-transfer">
        <p style={{ margin: 0, fontSize: 13, color: COLORS.modal.textMuted }}>
          {mode === 'copy'
            ? 'Each copy keeps its name and place on the page, with no answers yet.'
            : 'They keep their answers, notes and place on the page.'}
        </p>
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
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
          {/* The footer buttons of the app's confirm and prompt dialogs
              (dialogPrompts.jsx): a quiet Cancel, then the gold action. */}
          <button type="button" className="dialog-touch-pad" onClick={onClose} style={cancelStyle}>Cancel</button>
          <button type="submit" className="dialog-touch-pad" disabled={!pick.categoryId || unchanged} style={primaryStyle(!pick.categoryId || unchanged)}>{verb}</button>
        </div>
      </form>
    </SpaceSelectionDialog>
  );
}
