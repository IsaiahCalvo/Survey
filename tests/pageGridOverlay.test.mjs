import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PAGE_GRID_KEY, PAGE_GRID_ATTR, loadPageGrid, savePageGrid, applyPageGrid, setPageGrid } from '../src/utils/pageGrid.js';

const memoryStorage = () => {
    const map = new Map();
    return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)) };
};
const fakeRoot = () => {
    const attrs = new Map();
    return { setAttribute: (k, v) => attrs.set(k, v), removeAttribute: (k) => attrs.delete(k), attrs };
};

test('page grid is off by default and remembered per device', () => {
    const s = memoryStorage();
    assert.equal(loadPageGrid(s), false);
    savePageGrid(true, s);
    assert.equal(s.getItem(PAGE_GRID_KEY), '1');
    assert.equal(loadPageGrid(s), true);
    const broken = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } };
    assert.equal(loadPageGrid(broken), false);
    assert.doesNotThrow(() => savePageGrid(true, broken));
});

test('setPageGrid flips the html attribute the CSS keys on', () => {
    const root = fakeRoot();
    const s = memoryStorage();
    setPageGrid(true, { storage: s, root });
    assert.equal(root.attrs.get(PAGE_GRID_ATTR), 'on');
    setPageGrid(false, { storage: s, root });
    assert.equal(root.attrs.has(PAGE_GRID_ATTR), false);
    applyPageGrid(true, null); // no document: no throw
});

test('grid is CSS on the page div, scaled by the page scale, not in the SVG layer', () => {
    const css = readFileSync(new URL('../src/styles/pageGrid.css', import.meta.url), 'utf8');
    assert.match(css, /html\[data-page-grid="on"\] \.survey-pdfjs-page-div::after/);
    assert.match(css, /var\(--survey-page-scale, 1\) \* 36px/);
    assert.match(css, /pointer-events: none/);
    const container = readFileSync(new URL('../src/components/PdfjsViewerContainer.jsx', import.meta.url), 'utf8');
    assert.match(container, /'--survey-page-scale': scale/);
    const svg = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');
    assert.doesNotMatch(svg, /page-grid/i);
});
