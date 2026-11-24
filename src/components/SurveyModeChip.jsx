/**
 * SurveyModeChip — "Survey · <template> v · Exit" at the tool bar's left,
 * beside Undo / Redo, the whole time Survey mode is on (Nightly
 * 'survey-mode-tools', owner 2026-11-23).
 *
 * The owner did not like "Done" at the right end of the survey bar as the way
 * out of Survey, and pointed at Plot's Viewport strip: one accent strip that
 * says which mode you are in, with the way out on it (Plot src/sheet/
 * edit-mode.ts). The survey bar only shows while the Survey Marker tool is
 * armed (utils/toolbarRows.js showsSurveyRow), so with a pen armed nothing
 * said you were still in Survey and "Done" was gone. This chip sits in the
 * tool bar, which never hides, so it shows whatever tool is armed. It holds:
 * - the mode's name on the accent fill, as Plot's strip;
 * - the template in use, a menu to switch template (it was the survey bar's
 *   first item);
 * - Exit, which leaves Survey (it was the survey bar's "Done").
 * The right rail's Survey button still turns Survey on and off as before.
 * Styles: .survey-mode-chip in styles.css.
 */
import { useState } from 'react';
import Icon from '../Icons';
import SurveyTemplateMenu from './SurveyTemplateMenu';

export default function SurveyModeChip({ toolbar = null, onLeave = null, tip = null, compact = false }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const bindTip = typeof tip === 'function' ? tip : () => ({});
  const leave = toolbar?.onExit || onLeave;
  const selectedTemplate = toolbar?.templateId ? { id: toolbar.templateId, name: toolbar.templateName } : null;
  return (
    <div
      className={`survey-mode-chip${compact ? ' is-compact' : ''}`}
      role="group"
      aria-label="Survey mode"
      data-survey-mode-chip="true"
    >
      <span className="survey-mode-chip__name">
        <Icon name="survey" size={14} color="currentColor" />
        {compact ? null : <span>Survey</span>}
      </span>
      {selectedTemplate ? (
        <SurveyTemplateMenu
          open={menuOpen}
          onOpenChange={setMenuOpen}
          templates={toolbar.templates || []}
          selectedTemplate={selectedTemplate}
          onSelect={toolbar.onSelectTemplate}
          compact={compact}
          className="survey-mode-chip__template"
          onEditTemplate={toolbar.onEditTemplate || null}
        />
      ) : (
        <span className="survey-mode-chip__hint">Pick a template</span>
      )}
      <button
        type="button"
        className="survey-mode-chip__exit"
        aria-label="Exit Survey mode"
        data-survey-mode-exit="true"
        disabled={!leave}
        onClick={() => leave?.()}
        {...bindTip('Exit Survey mode', 'below')}
      >
        Exit
      </button>
    </div>
  );
}
