import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(
  new URL('../src/components/PdfjsViewerContainer.jsx', import.meta.url),
  'utf8',
);

test('mobile PDF root allows native selection while Text Select is active', () => {
  assert.match(
    source,
    /data-text-selection=\{interactionMode === 'TextSelection' \? 'true' : 'false'\}/,
  );
  assert.match(
    source,
    /WebkitUserSelect:\s*isMobileSurface && interactionMode !== 'TextSelection' \? 'none' : undefined/,
  );
  assert.match(
    source,
    /userSelect:\s*isMobileSurface && interactionMode !== 'TextSelection' \? 'none' : undefined/,
  );
  assert.match(
    source,
    /\.survey-pdfjs-mobile-surface\[data-text-selection='true'\] \{[\s\S]*?-webkit-user-select: text !important;[\s\S]*?user-select: text !important;/,
    'the active mobile root must override the default mobile no-selection rule',
  );
  assert.match(
    source,
    /const nativeTarget = target\?\.nodeType === 3 \? target\.parentElement : target;/,
    'selectstart can target a Text node, so the mobile guard must resolve its parent element',
  );
  assert.match(source, /nativeTarget\?\.closest\?\.\('\.textLayer, \.pdfjsTextLayer, \.annotationLayer, \[data-shape-kind\^="text-markup-"\]'\)/);
});
