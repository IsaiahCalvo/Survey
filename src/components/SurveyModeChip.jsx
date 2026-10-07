/**
 * SurveyModeChip.jsx — "Survey · <template> ✕", Survey named outside its panel.
 *
 * Owner 2026-10-07 ("I'm still just not the biggest fan of how we get in and
 * out of survey mode ... this exit survey button"), ruled after a debate
 * (scratchpad railDrawboard/DEBATE.md): the Survey tab / dock button only
 * opens and closes the Survey panel, like every rail tab; while Survey is on,
 * this chip says so outside the panel and its ✕ leaves Survey. It is the
 * Space chip's twin (ActiveSpaceChip, same look and the same two parts) and
 * sits beside it: the desktop tool bar left of Export, the phone just under
 * the top bar. The words open the Survey panel.
 */
import React from 'react';
import Icon from '../Icons';

export default function SurveyModeChip({ templateName, onOpen = null, onLeave = null, className = '', ...rest }) {
  const name = templateName || 'Survey';
  return (
    <div className={`active-space-chip survey-mode-chip${className ? ` ${className}` : ''}`} data-survey-mode-chip="true" {...rest}>
      <button
        type="button"
        className="active-space-chip__open"
        aria-label={`Survey is on, ${name}. Open the Survey panel`}
        onClick={onOpen || undefined}
      >
        <Icon name="survey" size={12} color="currentColor" />
        <span className="active-space-chip__name">Survey</span>
        <span className="active-space-chip__meta">· {name}</span>
      </button>
      <button
        type="button"
        className="active-space-chip__off"
        aria-label="Leave Survey"
        onClick={onLeave || undefined}
      >
        <Icon name="close" size={10} color="currentColor" />
      </button>
    </div>
  );
}
