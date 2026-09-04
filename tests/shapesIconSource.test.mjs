import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('Shapes category uses the supplied circle, square, and triangle icon', async () => {
  const [icon, icons, shell, mobile] = await Promise.all([
    read('../src/assets/icons/shapes.svg'),
    read('../src/Icons.jsx'),
    read('../src/AppShell.jsx'),
    read('../src/mobile/MobilePdfViewerChrome.jsx'),
  ]);

  assert.match(icon, /M16,24C16,24,16,24,16,24H4/);
  assert.match(icon, /M23,17h-8/);
  assert.match(icon, /M6\.5,13C2\.9,13,0,10\.1,0,6\.5/);
  assert.doesNotMatch(icon, /<!DOCTYPE|<metadata|<!ENTITY/i);
  assert.match(icons, /import shapesIconUrl from '\.\/assets\/icons\/shapes\.svg';/);
  assert.match(icons, /shapes:.*renderMaskIcon\(shapesIconUrl,/);
  assert.match(shell, /aria-label="Shapes"[\s\S]{0,500}<Icon name="shapes" size=\{18\}/);
  assert.match(mobile, /shape:\s*\{[\s\S]{0,100}icon: 'shapes'/);
  assert.match(mobile, /\{ id: 'rect', label: 'Rectangle', icon: 'rect' \}/);
});
