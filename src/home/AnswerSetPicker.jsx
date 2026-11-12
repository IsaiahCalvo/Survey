/**
 * AnswerSetPicker — how a template's checklist lines are answered (nightly
 * 'custom-answers').
 *
 * AnswerChips shows a list as the colored plates people tap in Survey mode
 * (green counts as done, red is an issue, grey is neutral). The template
 * editor shows the list in use this way, under the template name, so it
 * reads as a setting and not as a stray drop-down.
 *
 * AnswerSetPicker is the window that button opens: six starter lists, one
 * per kind of question, each drawn as its chips (owner 2026-11-12: a few
 * starters, then people make their own). A click puts that list on the
 * template (the editor's Save / Cancel bar still covers it). A list that is
 * not a starter shows first as "Your list". "Make your own" hands over to
 * AnswerSetEditor, seeded with the list in use.
 */
import BodyPortal from '../components/BodyPortal';
import DialogCard from '../components/DialogCard.jsx';
import { Icon } from './HubShell';
import { answerPresetIdOf } from '../services/answerSets.js';
import './AnswerSetPicker.css';

const stopEvent = (e) => e.stopPropagation();

export function AnswerChips({ set, max = 6 }) {
  const shown = set.length > max ? set.slice(0, max - 1) : set;
  return (
    <span className="answer-chips" aria-hidden="true">
      {shown.map((a) => (
        <span key={a.value} className={`answer-chip is-${a.tone}`}>{a.value}</span>
      ))}
      {shown.length < set.length && <span className="answer-chip is-more">+{set.length - shown.length}</span>}
    </span>
  );
}

const listLabel = (set) => set.map((a) => a.value).join(', ');

// `presets` are the starters (starterAnswerSets), each with its `group` label.
export default function AnswerSetPicker({ templateName, set, presets, onPick, onMakeOwn, onClose }) {
  const currentId = answerPresetIdOf(set, presets);
  const row = (key, group, label, answers, checked, onClick) => (
    <button
      key={key}
      type="button"
      role="radio"
      aria-checked={checked}
      aria-label={label}
      className={`answer-set-option${checked ? ' is-current' : ''}`}
      onClick={onClick}
    >
      <span className="answer-set-option__group">{group}</span>
      <AnswerChips set={answers} max={10} />
      <span className="answer-set-option__check" aria-hidden="true">{checked ? <Icon name="check" size={13} /> : null}</span>
    </button>
  );
  return (
    <BodyPortal>
      {/* A portal still bubbles React presses to the editor behind it. */}
      <div onPointerDown={stopEvent} onMouseDown={stopEvent}>
        <DialogCard
          title="Checklist answers"
          ariaLabel={`Checklist answers for ${templateName || 'this template'}`}
          message="Pick a starter, or make your own. Answers already given keep their text."
          onClose={onClose}
          width={520}
          zIndex={5600}
          cardProps={{ 'data-testid': 'answer-set-picker' }}
          footer={(
            <>
              <button type="button" className="hub-btn dialog-touch-pad" onClick={onClose}>Cancel</button>
              <button type="button" className="hub-btn hub-btn--primary dialog-touch-pad" onClick={onMakeOwn}>
                {currentId ? 'Make your own…' : 'Edit your list…'}
              </button>
            </>
          )}
        >
          <div role="radiogroup" aria-label="Answer lists" className="answer-set-groups">
            {!currentId && row('own', 'Your list', `Your list: ${listLabel(set)}`, set, true, onClose)}
            {presets.map((p) => row(p.id, p.group, `${p.group}: ${listLabel(p.answers)}`, p.answers, p.id === currentId, () => onPick(p)))}
          </div>
        </DialogCard>
      </div>
    </BodyPortal>
  );
}
