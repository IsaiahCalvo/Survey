import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const iconUrl = new URL('../src/assets/icons/callout-arrow-outline.svg', import.meta.url);
const iconsUrl = new URL('../src/Icons.jsx', import.meta.url);

test('callout icon uses the supplied outline without its inner T or underscore', async () => {
  const [iconBytes, iconsSource] = await Promise.all([
    readFile(iconUrl),
    readFile(iconsUrl, 'utf8'),
  ]);
  const iconSource = iconBytes.toString('utf8');

  assert.equal(
    createHash('sha256').update(iconBytes).digest('hex'),
    '42900d6a797961c1bea96ac75b22a9bb4ea8afbae4aea523bd8d5aa4993a9c12',
  );
  assert.match(iconsSource, /import calloutIconUrl from '\.\/assets\/icons\/callout-arrow-outline\.svg';/);
  assert.match(iconsSource, /callout:.*renderMaskIcon\(calloutIconUrl,/);

  // The supplied file stored the T and underscore as its third and fourth
  // move-to subpaths. Only the callout shell and its hollow center may remain.
  assert.equal((iconSource.match(/[Mm](?=-?\d)/g) || []).length, 2);
  assert.doesNotMatch(iconSource, /M452\.8/);
  assert.doesNotMatch(iconSource, /M573\.78/);
  assert.doesNotMatch(iconSource, /<script|onload\s*=/i);
});
