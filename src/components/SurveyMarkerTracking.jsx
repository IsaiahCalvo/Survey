// The open survey item's Status / Assigned to / Due line (Nightly, flag
// 'marker-tracking'), above its note on the phone and on the desktop rail.
// Every change goes through `onChange(patch)`, which writes the marker's own
// `tracking` field (utils/markerTracking.js). The people are those who can
// open the document (mark_comment_people), so an item is only ever given to
// someone who can see it.
import { useRef } from 'react';
import { MARKER_STATUSES, dueLabel, isOverdue, readTracking, shortDayLabel, todayKey } from '../utils/markerTracking.js';
import Icon from '../Icons';
import { personLabel } from '../services/markComments.js';
import ValueSelect from './ValueSelect.jsx';
import './surveyMarkerTracking.css';

const stop = (e) => e.stopPropagation();

function personOptions(people, userId, assigneeId) {
  const list = (people || []).map((p) => ({ value: p.id, label: p.id === userId ? `${personLabel(p)} (me)` : personLabel(p) }));
  // Someone who has since left the document keeps their name slot.
  if (assigneeId && !list.some((o) => o.value === assigneeId)) list.push({ value: assigneeId, label: 'Former member' });
  return [{ value: '', label: 'Nobody' }, ...list];
}

// Desktop due date: a pill like Status and Assigned to (never the browser's
// bare mm/dd/yyyy field), opening the system date picker. The real date input
// stays under it for the picker, keyboard typing and tests.
function DueDatePill({ due, today, canEdit, onPick, tip }) {
  const inputRef = useRef(null);
  const open = () => {
    const input = inputRef.current;
    if (!input || !canEdit) return;
    try { input.showPicker(); } catch { input.focus(); }
  };
  return (
    <span className={`value-select value-select--field value-select--sm survey-tracking__due${due ? ' has-date' : ' is-empty'}`}>
      <button
        type="button"
        className="chrome-pill survey-tracking__due-pill"
        aria-label={due ? `Due date, ${shortDayLabel(due, today)}` : 'Set a due date'}
        disabled={!canEdit}
        onClick={(e) => { e.stopPropagation(); open(); }}
      >
        <Icon name="clock" size={12} color="currentColor" />
        <span className="chrome-pill__label">{due ? shortDayLabel(due, today) : 'Set date'}</span>
      </button>
      {due && canEdit ? (
        <button
          type="button"
          className="survey-tracking__due-clear"
          aria-label="Clear due date"
          {...(tip ? tip('Clear due date', 'below') : {})}
          onClick={(e) => { e.stopPropagation(); onPick(null); }}
        >
          <Icon name="close" size={10} color="currentColor" />
        </button>
      ) : null}
      <input
        ref={inputRef}
        type="date"
        className="survey-tracking__due-input"
        aria-label="Due date"
        data-tracking-due
        tabIndex={-1}
        value={due || ''}
        disabled={!canEdit}
        onClick={stop}
        onChange={(e) => onPick(e.target.value || null)}
      />
    </span>
  );
}

export default function SurveyMarkerTracking({ marker, people = [], userId = null, canEdit = true, onChange, variant = 'desktop', tip = null }) {
  const tracking = readTracking(marker);
  const phone = variant === 'phone';
  const today = todayKey();
  const late = isOverdue(tracking, today);
  const statusOptions = MARKER_STATUSES.map((s) => ({ value: s.value, label: s.label }));
  const assigneeOptions = personOptions(people, userId, tracking.assigneeId);
  const set = (patch) => { if (canEdit) onChange?.(patch); };

  const select = (key, label, value, options) => (phone ? (
    <select
      className="survey-tracking__native"
      aria-label={label}
      value={value}
      disabled={!canEdit}
      onClick={stop}
      onChange={(e) => set({ [key]: e.target.value })}
    >
      {options.map((o) => <option key={o.value || 'none'} value={o.value}>{o.label}</option>)}
    </select>
  ) : (
    <ValueSelect size="sm" label={label} value={value} options={options} disabled={!canEdit} onChange={(next) => set({ [key]: next })} />
  ));

  return (
    <div
      className={`survey-tracking survey-tracking--${variant}`}
      data-testid="survey-tracking"
      data-status={tracking.status}
      onClick={stop}
    >
      <div className="survey-tracking__field">
        <span className="survey-tracking__label">Status</span>
        <span data-tracking-status>{select('status', 'Status', tracking.status, statusOptions)}</span>
      </div>
      <div className="survey-tracking__field">
        <span className="survey-tracking__label">Assigned to</span>
        <span data-tracking-assignee>{select('assigneeId', 'Assigned to', tracking.assigneeId || '', assigneeOptions)}</span>
      </div>
      <label className="survey-tracking__field">
        <span className={`survey-tracking__label${late ? ' is-late' : ''}`}>{tracking.due ? dueLabel(tracking.due, today) : 'Due'}</span>
        {phone ? (
          <input
            type="date"
            className="survey-tracking__date"
            aria-label="Due date"
            data-tracking-due
            value={tracking.due || ''}
            disabled={!canEdit}
            onClick={stop}
            onChange={(e) => set({ due: e.target.value || null })}
          />
        ) : (
          <DueDatePill due={tracking.due} today={today} canEdit={canEdit} tip={tip} onPick={(due) => set({ due })} />
        )}
      </label>
    </div>
  );
}

/** The closed row's small sign: who has it and whether it is late or done. */
export function SurveyMarkerTrackingBadge({ marker, people = [], userId = null, tip = null }) {
  const tracking = readTracking(marker);
  if (!marker?.tracking) return null;
  const today = todayKey();
  const late = isOverdue(tracking, today);
  const person = tracking.assigneeId ? (people || []).find((p) => p.id === tracking.assigneeId) : null;
  const who = tracking.assigneeId ? (tracking.assigneeId === userId ? 'me' : personLabel(person)) : '';
  const parts = [tracking.status === 'open' ? '' : MARKER_STATUSES.find((s) => s.value === tracking.status)?.label, who && `Assigned to ${who}`, tracking.due && dueLabel(tracking.due, today)].filter(Boolean);
  if (!parts.length) return null;
  const text = parts.join(' · ');
  const initials = who === 'me' ? 'Me' : (personLabel(person) || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <span
      className={`survey-tracking-badge${late ? ' is-late' : ''}${tracking.status === 'done' ? ' is-done' : ''}${tracking.status === 'in-progress' ? ' is-active' : ''}`}
      data-tracking-badge={late ? 'late' : tracking.status}
      aria-label={text}
      {...(tip ? tip(text, 'left') : {})}
    >
      {tracking.assigneeId ? initials : (late ? 'Late' : MARKER_STATUSES.find((s) => s.value === tracking.status)?.label)}
    </span>
  );
}
