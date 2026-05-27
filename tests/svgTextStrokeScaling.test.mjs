import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const rendererSource = fs.readFileSync(
  path.resolve('src/utils/svgAnnotationRenderers.jsx'),
  'utf8'
);

test('renderText textbox border scales with the SVG page instead of screen pixels', () => {
  const renderTextStart = rendererSource.indexOf('export const renderText =');
  const renderCalloutStart = rendererSource.indexOf('export const renderCallout =');
  assert.ok(renderTextStart >= 0, 'renderText should exist');
  assert.ok(renderCalloutStart > renderTextStart, 'renderCallout should follow renderText');

  const renderTextSource = rendererSource.slice(renderTextStart, renderCalloutStart);
  const borderComment = renderTextSource.indexOf('Border rect: drawn only when the textbox carries');
  assert.ok(borderComment >= 0, 'textbox border branch should exist');

  const borderSource = renderTextSource.slice(borderComment, renderTextSource.indexOf('{!hideText', borderComment));
  assert.doesNotMatch(
    borderSource,
    /vectorEffect=/,
    'textbox border should not opt into vector-effect:non-scaling-stroke'
  );
});
