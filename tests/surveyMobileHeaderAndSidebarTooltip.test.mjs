// Guards for Lens pass 7 Survey layout fixes:
//   - #1824: phone project app bar keeps the full file count visible ("1 file")
//     while long project titles truncate cleanly on Row 1 instead of clipping
//     the count to "1…" or wrapping Row 1 controls.
//   - #1825: phone project drill-in gives "‹ Projects" a >= 44px tap target and
//     at least an 8px (12px) gap before "Search files…".
//   - #1790 (comment): desktop sidebar project rows expose the full project
//     name via Survey's shared Tooltip (`tip(p.name, 'right')`), never native
//     `title=`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const hubCss = read('src/home/hub.css');
const projectsTree = read('src/home/ProjectsFolderTree.jsx');

test('#1824: phone hub header uses a 4-column grid and never clips mobile counts', () => {
  assert.match(
    hubCss,
    /\.survey-hub \.header \{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*minmax\(0,\s*auto\)\s+1fr\s+auto\s+auto;/,
  );
  assert.match(
    hubCss,
    /\.survey-hub \.projects-mobile-count,[\s\S]{0,160}grid-column:\s*2;[\s\S]{0,120}min-width:\s*max-content;[\s\S]{0,120}white-space:\s*nowrap;[\s\S]{0,80}overflow:\s*visible;/,
  );
  assert.match(
    hubCss,
    /\.survey-hub \.mobile-rail-nav \{[\s\S]{0,120}grid-column:\s*1;[\s\S]{0,40}grid-row:\s*1;/,
  );
  assert.match(
    hubCss,
    /\.survey-hub \.mobile-profile \{[\s\S]{0,120}grid-column:\s*4;[\s\S]{0,40}grid-row:\s*1;/,
  );
});

test('#1825: phone project back button has a 44px tap target and >= 8px gap from Search files', () => {
  assert.match(
    hubCss,
    /\.survey-hub \.projects-mobile-search-actions:has\(> \.projects-mobile-back-button\)\s*\{\s*gap:\s*(?:8|9|10|11|12|14|16)px;/,
  );
  assert.match(
    hubCss,
    /\.survey-hub \.projects-mobile-search-actions > \.projects-mobile-back-button\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;[^}]*height:\s*44px;/s,
  );
  assert.match(
    hubCss,
    /\.survey-hub:has\(\.projects-mobile-search-actions > \.projects-mobile-back-button\):not\(:has\(\.mobile-header-select-actions\)\)\s*\{[^}]*--mobile-header-h:/s,
  );
  assert.match(
    hubCss,
    /\.survey-hub \.projects-mobile-search-actions:has\(> \.projects-mobile-back-button\) > \.hub-search\s*\{\s*height:\s*44px !important;/,
  );
});

test('#1790: desktop sidebar project rows show full project name via shared Tooltip (never native title=)', () => {
  assert.match(projectsTree, /const nameTip = tip\(p\.name, 'right'\);/);
  assert.match(
    projectsTree,
    /<div style=\{\{ minWidth: 0 \}\} \{\.\.\.nameTip\}>[\s\S]{0,220}className="projects-list-row__name"[\s\S]{0,220}\{p\.name\}<\/div>/,
  );
  assert.match(
    projectsTree,
    /onFocus=\{\(event\) => \{ if \(event\.target === event\.currentTarget\) nameTip\.onFocus\?\.\(event\); \}\}/,
  );
  assert.doesNotMatch(projectsTree, /className="projects-list-row__name"[^>]*\btitle=/);
});
