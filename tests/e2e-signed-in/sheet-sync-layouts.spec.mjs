// Live sync on desktop, tablet and phone web (sheetSyncLayouts.shared.mjs).
import { test } from './helpers.mjs';
import { LAYOUTS, LAYOUT_TESTS, flagHooks } from './sheetSyncLayouts.shared.mjs';

flagHooks();
for (const layout of LAYOUTS.filter((l) => !l.app && !l.name.includes('landscape'))) {
  test.describe(`live sync, ${layout.name}`, () => {
    test.use(layout.use);
    for (const [name, run] of LAYOUT_TESTS) {
      test(name, async ({ page, context, browser }) => run({ page, context, browser }, layout));
    }
  });
}
