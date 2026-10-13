import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { useTooltip } from './Tooltip';
import { focusMovedElsewhere } from './AnnotationDropdown';
import SurveyPickList from './SurveyPickList';
import { pickSurveyRowItems } from '../utils/surveyPickLists.js';
import './AnnotationDropdown.css';

/**
 * How a survey bar row handles a long list - the ONE place that decides it,
 * so the overflow design can be swapped here without touching the bars
 * (lead decision 2026-10-13, scratchpad listDebate/DECISION.md).
 *
 * Intended UX: decided by COUNT, never by window width. Up to 8 items: every
 * one is drawn. Above 8: 7 are drawn (the current one, then the most recently
 * used, then template order - drawn in template order, so picking a chip that
 * is showing never reshuffles the row) and a plain "All N" chip at the end
 * opens the whole list (SurveyPickList) in a popover: full names, sections,
 * find field from 15.
 *
 * @param {Array<{id: string}>} items       in template order
 * @param {(item) => React.ReactNode} renderItem  one chip / swatch
 * @param {string|null} currentId
 * @param {string[]} recentIds              most recent first
 * @param {Array} sections                  the popover list (SurveyPickList)
 * @param {(item, section) => void} onPickFromList
 * @param {string} noun                     "categories" / "entities"
 * @param {Function} [tip]                  the viewer's tooltip binder
 * @param {number} [max]                    slots the row may draw (8; fewer
 *                                          only as a narrow window's last
 *                                          resort - useSurveyBarFit)
 */
export default function SurveyOverflowRow({
  items,
  renderItem,
  currentId = null,
  recentIds = [],
  sections,
  onPickFromList,
  noun = 'items',
  searchPlaceholder = 'Find',
  className = '',
  tip,
  max,
  ...rest
}) {
  const contextTip = useTooltip();
  const chromeTip = tip || contextTip;
  const [open, setOpen] = useState(false);
  const { shown, overflow, total } = pickSurveyRowItems(items, { currentId, recentIds, ...(max ? { max } : {}) });
  return (
    <div className={className} data-survey-row-overflow={overflow ? 'true' : undefined} {...rest}>
      {shown.map((item) => renderItem(item))}
      {overflow && (
        <Popover.Root open={open} onOpenChange={setOpen}>
          <Popover.Trigger asChild>
            <button
              type="button"
              className={`survey-row-all${open ? ' is-open' : ''}`}
              data-survey-row-all="true"
              aria-label={`All ${total} ${noun}`}
              aria-haspopup="listbox"
              aria-expanded={open}
              {...chromeTip(`All ${noun}`, 'below')}
            >
              All {total}
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              className="annotation-dropdown__popover survey-pick-popover"
              data-survey-all-popover={noun}
              data-annotation-dropdown-popover="true"
              align="center"
              sideOffset={6}
              collisionPadding={8}
              onCloseAutoFocus={(event) => { if (focusMovedElsewhere(event)) event.preventDefault(); }}
            >
              <SurveyPickList
                sections={sections}
                currentId={currentId}
                ariaLabel={`All ${noun}`}
                searchPlaceholder={searchPlaceholder}
                onPick={(item, section) => {
                  onPickFromList?.(item, section);
                  setOpen(false);
                }}
              />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
    </div>
  );
}
