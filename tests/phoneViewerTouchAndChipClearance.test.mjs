import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

describe('phone viewer touch targets and document chip clearance (#1789, #1790)', () => {
  it('gives comment pins a 44x44 touch hit pad on phones/coarse pointers (#1789)', () => {
    const css = read('src/styles.css');
    assert.match(
      css,
      /\[data-page-pin-anchor\]:not\(\[data-pin-pass-through="true"\]\)::after\s*\{[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px;/,
    );
  });

  it('sizes phone sheet-set bar and pinned-tools dock buttons to 44px (#1789)', () => {
    const sheetCss = read('src/sheets/sheetSet.css');
    const dockCss = read('src/components/PinnedToolsDock.css');
    assert.match(
      sheetCss,
      /\.sheet-set-bar\.is-phone \.sheet-set-bar__btn,\s*\.sheet-set-bar\.is-phone \.sheet-set-bar__picker\s*\{[^}]*height:\s*44px;[^}]*min-height:\s*44px;[^}]*min-width:\s*44px;/,
    );
    assert.match(
      dockCss,
      /\.pinned-dock-shell\.is-phone \.pinned-dock__pin\.chrome-subcontrol\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;/,
    );
  });

  it('widens the phone document chip past 46vw and reserves phone canvas bottom clearance (#1790)', () => {
    const sheetCss = read('src/sheets/sheetSet.css');
    const mobileCss = read('src/mobile/mobilePdfViewer.css');
    assert.doesNotMatch(sheetCss, /\.sheet-set-bar\.is-phone \.sheet-set-bar__picker\s*\{[^}]*max-width:\s*46vw;/);
    assert.match(
      sheetCss,
      /\.sheet-set-bar\.is-phone \.sheet-set-bar__picker\s*\{[^}]*max-width:\s*calc\(100vw - 88px\);/,
    );
    assert.match(
      mobileCss,
      /\[data-sheet-set-host\]:has\(\.pinned-dock-shell\.is-phone\):has\(\.sheet-set-bar\.is-phone\)\s+\.mobile-pdf-work-area \.pdf-engine-host\s*\{[^}]*bottom:\s*calc\(var\(--mobile-dock-bar-height\) \+ 120px\) !important;/,
    );
  });
});
