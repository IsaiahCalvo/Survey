import { useMemo } from 'react';
import SurveyOverflowRow from './SurveyOverflowRow';
import useSurveyRecents from '../hooks/useSurveyRecents';
import { getCategoryGlyphLabel } from '../viewerShared.js';

/**
 * The survey bar's category chips (desktop). One chip per category of the
 * chosen module, its initials in a ring; pick one, then drag on the page to
 * place a Survey Marker of that category (the chip's tooltip names it).
 * Chosen = gold ring + gold letters only while placement is armed (survey
 * calm gold). Above 8 categories the row draws 7 and an "All N" chip
 * (SurveyOverflowRow) whose list holds every category of the template by full
 * name, grouped by module - the chosen module first. Picking one from another
 * module switches to that module.
 */
export default function SurveyCategoryChips({
  templateId,
  modules,
  selectedModuleId,
  selectedCategoryId,
  armed,
  onPick,
  tip,
  max,
}) {
  const selectedModule = (modules || []).find((module) => module.id === selectedModuleId) || modules?.[0] || null;
  const categories = useMemo(() => selectedModule?.categories || [], [selectedModule]);
  const activeId = armed ? selectedCategoryId : null;
  const recents = useSurveyRecents('category', templateId, activeId);
  const sections = useMemo(() => {
    const ordered = selectedModule
      ? [selectedModule, ...(modules || []).filter((module) => module !== selectedModule)]
      : (modules || []);
    return ordered
      .filter((module) => (module.categories || []).length > 0)
      .map((module) => ({
        id: module.id,
        label: module.name || 'Untitled module',
        items: (module.categories || []).map((category) => ({
          id: category.id,
          label: category.name || 'Untitled category',
          glyph: getCategoryGlyphLabel(category.name),
          moduleId: module.id,
        })),
      }));
  }, [modules, selectedModule]);

  if (categories.length === 0) {
    return (
      <div className="survey-subrow__cats">
        <span className="survey-subrow__empty">No categories</span>
      </div>
    );
  }
  return (
    <SurveyOverflowRow
      className="survey-subrow__cats"
      items={categories}
      currentId={activeId ?? null}
      recentIds={recents}
      sections={sections}
      noun="categories"
      searchPlaceholder="Find a category"
      tip={tip}
      max={max}
      onPickFromList={(item) => onPick?.(item.id, item.moduleId)}
      renderItem={(category) => {
        const isActive = armed && selectedCategoryId === category.id;
        const glyph = getCategoryGlyphLabel(category.name);
        return (
          <button
            key={category.id}
            type="button"
            onClick={() => onPick?.(category.id, selectedModule?.id)}
            {...(tip ? tip(category.name || 'Untitled category', 'below') : {})}
            className={`btn chrome-subcontrol ${isActive ? 'btn-active' : 'btn-ghost'}`}
            // KAL-65: instant chip above is the tooltip; a native title=
            // would stack the OS tooltip on top of it.
            aria-label={category.name || 'Untitled category'}
            aria-pressed={isActive}
          >
            <span className={`survey-subrow__glyph${glyph.length > 1 ? ' is-wide' : ''}`} aria-hidden="true">
              {glyph}
            </span>
          </button>
        );
      }}
    />
  );
}
