/**
 * surveyHeadIcons.jsx - the Survey panel's Categories head line glyphs
 * (owner 2026-10-02, after bf3888e: "The icons looked way better").
 *
 * The section header pair is [Select] [Add]: Select = list-checks, Add =
 * plus, a 16px glyph in a 28px hit on desktop - the same pair, sizes and
 * states as the shared section header icon button another change is adding
 * (src/components/SectionIconButton.jsx + the `listChecks` glyph in
 * src/Icons.jsx, not merged into this branch yet).
 *
 * TODO(section-icons merge): once SectionIconButton and Icons.jsx's
 * `listChecks` are on this branch, render
 *   <SectionIconButton action="select" label="Select" ... />
 *   <SectionIconButton action="add" label="Add category" ... />
 * in SurveySpacesRail.jsx's Categories head line and delete this file. The
 * path below is copied verbatim from that `listChecks` glyph (24 grid, the
 * house 1.5 stroke, round caps), so nothing changes visually on the switch.
 */
export const SURVEY_HEAD_ICON = 16;

export function ListChecksGlyph({ size = SURVEY_HEAD_ICON, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
      <path d="M3 7L5 9L9 5M3 17L5 19L9 15" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13 6H21M13 12H21M13 18H21" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
