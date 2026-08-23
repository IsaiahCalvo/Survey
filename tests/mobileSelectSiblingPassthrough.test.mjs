import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const mobile = read('../src/mobile/MobilePdfViewerChrome.jsx');
const documents = read('../src/home/DocumentsLedger.jsx');
const projects = read('../src/home/ProjectsFolderTree.jsx');

test('390 Style / Arrowhead / Font selects passthrough Width and strip chrome', () => {
  const constStart = mobile.indexOf('const MOBILE_SELECT_SIBLING_PASSTHROUGH');
  assert.notEqual(constStart, -1, 'shared mobile strip passthrough constant');
  assert.match(mobile.slice(constStart, constStart + 180), /\[data-mobile-tool-properties\]/);
  const mounts = mobile.match(/passthroughSelector=\{MOBILE_SELECT_SIBLING_PASSTHROUGH\}/g) || [];
  assert.equal(mounts.length, 2, 'MobileStyledSelect + counter series menu');
  assert.match(mobile, /Width \/ Arrowhead\s+need a second tap/);
});

test('Documents and Projects search passthrough header Upload / New project', () => {
  assert.match(documents, /dismissActionSelector="\.hub-mobile-primary-action, \.documents-desktop-upload"/);
  assert.match(documents, /dismissActionSelector="\.documents-desktop-upload, \.hub-mobile-primary-action"/);
  assert.match(projects, /dismissActionSelector="\.projects-mobile-create-button, \.projects-desktop-create-button, \.projects-mobile-back-button"/);
  assert.match(projects, /dismissActionSelector="\.projects-desktop-create-button, \.projects-mobile-create-button"/);
  assert.match(projects, /className="btn primary projects-desktop-create-button"/);
});
