import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../Icons';
import { SURVEY_LIST_SEARCH_FROM, filterSurveyListItems } from '../utils/surveyPickLists.js';
import './SurveyPickList.css';

/**
 * One list of survey things to pick from - categories (grouped by module),
 * entities (swatch + name) or templates (Recent + All) - shown when a survey
 * bar row has more than it can draw (lead decision 2026-10-13, long lists).
 *
 * Intended UX: every item by its full name, in sections; from
 * SURVEY_LIST_SEARCH_FROM rows a find field sits on top and has focus, so
 * typing narrows the list at once; Up / Down move through the rows, Enter
 * picks. The current item is bright ink with a check - calm, no gold. Written
 * to be the CONTENT of a desktop popover today and of the phone's bottom
 * sheet later (`variant="sheet"`: 44px rows), so both platforms list the
 * same way.
 *
 * @param {Array<{id: string, label?: string|null, items: Array<{id: string,
 *   label: string, swatch?: string|null, glyph?: string|null}>}>} sections
 * @param {string|null} currentId
 * @param {(item, section) => void} onPick
 * @param {string} [searchPlaceholder]
 * @param {string} [ariaLabel]
 * @param {'popover'|'sheet'} [variant]
 */
export default function SurveyPickList({
  sections,
  currentId = null,
  onPick,
  searchPlaceholder = 'Find',
  ariaLabel = 'Choose',
  emptyText = 'Nothing matches',
  variant = 'popover',
  searchFrom = SURVEY_LIST_SEARCH_FROM,
}) {
  const [query, setQuery] = useState('');
  const rowRefs = useRef([]);
  const searchRef = useRef(null);
  const total = useMemo(() => (sections || []).reduce((sum, section) => sum + (section.items?.length || 0), 0), [sections]);
  const showSearch = total >= searchFrom;
  const shown = useMemo(() => (sections || [])
    .map((section) => ({ ...section, items: filterSurveyListItems(section.items || [], showSearch ? query : '') }))
    .filter((section) => section.items.length > 0), [sections, query, showSearch]);
  const flat = useMemo(() => shown.flatMap((section) => section.items.map((item) => ({ item, section }))), [shown]);

  // Open on the find field (long list) or on the current row.
  useEffect(() => {
    const frame = typeof window !== 'undefined' ? window.requestAnimationFrame(() => {
      if (showSearch) { searchRef.current?.focus({ preventScroll: true }); return; }
      const at = flat.findIndex(({ item }) => item.id === currentId);
      const row = rowRefs.current[at >= 0 ? at : 0];
      row?.focus({ preventScroll: true });
      row?.scrollIntoView?.({ block: 'nearest' });
    }) : 0;
    return () => { if (frame) window.cancelAnimationFrame(frame); };
    // Only on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const focusRow = (index) => {
    const count = flat.length;
    if (!count) return;
    const next = (index + count) % count;
    rowRefs.current[next]?.focus();
  };
  const onRowKey = (event, index) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); focusRow(index + 1); }
    else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (index === 0 && showSearch) searchRef.current?.focus();
      else focusRow(index - 1);
    } else if (event.key === 'Home') { event.preventDefault(); focusRow(0); }
    else if (event.key === 'End') { event.preventDefault(); focusRow(flat.length - 1); }
  };

  let rowIndex = -1;
  rowRefs.current = [];
  return (
    <div className={`survey-pick survey-pick--${variant}`} data-survey-pick-list="true">
      {showSearch && (
        <label className="survey-pick__search">
          <Icon name="search" size={12} color="currentColor" />
          <input
            ref={searchRef}
            type="search"
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') { event.preventDefault(); focusRow(0); }
              else if (event.key === 'Enter' && flat.length) { event.preventDefault(); onPick?.(flat[0].item, flat[0].section); }
            }}
          />
        </label>
      )}
      <div className="survey-pick__body" role="listbox" aria-label={ariaLabel}>
        {shown.length === 0 ? (
          <div className="survey-pick__empty">{emptyText}</div>
        ) : shown.map((section) => (
          <div key={section.id} className="survey-pick__section" role="group" aria-label={section.label || undefined}>
            {section.label ? <div className="survey-pick__heading" aria-hidden="true">{section.label}</div> : null}
            {section.items.map((item) => {
              rowIndex += 1;
              const at = rowIndex;
              const current = item.id === currentId;
              return (
                <button
                  key={`${section.id}:${item.id}`}
                  ref={(element) => { rowRefs.current[at] = element; }}
                  type="button"
                  role="option"
                  aria-selected={current}
                  className={`survey-pick__row${current ? ' is-current' : ''}`}
                  data-survey-pick-id={item.id}
                  onKeyDown={(event) => onRowKey(event, at)}
                  onClick={() => onPick?.(item, section)}
                >
                  {item.swatch !== undefined ? (
                    <span
                      className={`survey-pick__swatch${item.swatch ? '' : ' is-empty'}`}
                      style={item.swatch ? { background: item.swatch } : undefined}
                      aria-hidden="true"
                    />
                  ) : null}
                  {item.glyph ? <span className="survey-pick__glyph" aria-hidden="true">{item.glyph}</span> : null}
                  <span className="survey-pick__label">{item.label}</span>
                  <span className="survey-pick__check" aria-hidden="true">
                    {current ? <Icon name="check" size={12} color="currentColor" /> : null}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
