import { useMemo } from 'react';
import AnnotationDropdown from './AnnotationDropdown';
import SurveyPickList from './SurveyPickList';
import Icon from '../Icons';
import useSurveyRecents from '../hooks/useSurveyRecents';
import { SURVEY_LIST_SEARCH_FROM, surveyTemplateSections } from '../utils/surveyPickLists.js';

/**
 * The survey bar's template menu (its left end): [gold survey glyph]
 * <template> v. Under 15 templates it is the app's plain setting menu, as
 * before. From 15 (lead decision 2026-10-13, long lists) it gains the phone's
 * "Find a template" field and the 3 most recently used templates at the top
 * (SurveyPickList, the same list the bar's "All" menus use). `compact` is the
 * narrow look: the glyph and chevron only (the name stays in the tooltip and
 * the accessible name). `onEditTemplate` (nightly 'custom-answers') adds
 * "Edit template…" under the list: the home Templates editor, where a
 * template's answers and lines are set.
 */
export default function SurveyTemplateMenu({
  open,
  onOpenChange,
  templates,
  selectedTemplate,
  onSelect,
  compact = false,
  className,
  onEditTemplate = null,
}) {
  const recents = useSurveyRecents('template', 'all', selectedTemplate?.id ?? null);
  const long = (templates || []).length >= SURVEY_LIST_SEARCH_FROM;
  const sections = useMemo(() => (long ? surveyTemplateSections(templates, recents) : null), [long, templates, recents]);
  return (
    <AnnotationDropdown
      open={open}
      onOpenChange={onOpenChange}
      label={`Survey template: ${selectedTemplate?.name || 'Survey'}. Switch template`}
      className={className}
      value={selectedTemplate?.id || ''}
      preview={<Icon name="survey" size={14} color="var(--accent)" />}
      triggerContent={selectedTemplate?.name || 'Survey'}
      options={(templates || []).map((template) => ({
        value: template.id,
        label: template.name || 'Untitled template',
      }))}
      onSelect={onSelect}
      width="auto"
      compact={compact}
      dataMarker="data-survey-template-menu"
      footer={onEditTemplate ? (
        <>
          <div className="annotation-dropdown__separator" role="separator" />
          <button
            type="button"
            className="annotation-dropdown__option"
            onClick={() => {
              onOpenChange?.(false);
              onEditTemplate();
            }}
          >
            <Icon name="edit" size={13} color="currentColor" />
            Edit template…
          </button>
        </>
      ) : null}
    >
      {long ? (
        <SurveyPickList
          sections={sections}
          currentId={selectedTemplate?.id ?? null}
          ariaLabel="Switch template"
          searchPlaceholder="Find a template"
          emptyText="No templates match"
          onPick={(item) => {
            onSelect?.(item.id);
            onOpenChange?.(false);
          }}
        />
      ) : undefined}
    </AnnotationDropdown>
  );
}
