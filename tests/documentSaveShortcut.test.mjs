import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const source = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const start = source.indexOf('useEffect(() => {', source.indexOf('// Keyboard shortcuts'));
const end = source.indexOf('\n  }, [goToNextPage', start);
assert.ok(start >= 0 && end > start, 'exercise the actual viewer keyboard effect');
const effect = source.slice(start + 'useEffect('.length, end + '\n  }'.length);

function mountKeyboard(window, { active = true, save = () => {}, tool = () => {} } = {}) {
  const scope = {
    window, document: window.document, isActive: active,
    handleSaveDocument: save, setActiveTool: tool, scrollMode: 'continuous',
  };
  return new Function(...Object.keys(scope), `return (${effect})();`)(...Object.values(scope));
}

for (const tag of ['input', 'textarea', 'div']) {
  for (const modifier of ['metaKey', 'ctrlKey']) {
    test(`${modifier}+S saves the active document with focus in ${tag}`, () => {
      const dom = new JSDOM(`<${tag} id="field" tabindex="0" contenteditable="true"></${tag}>`);
      // JSDOM does not implement the browser's contentEditable property.
      if (tag === 'div') dom.window.document.getElementById('field').contentEditable = 'true';
      dom.window.document.getElementById('field').focus();
      let saves = 0;
      const cleanup = mountKeyboard(dom.window, { save: () => saves++ });
      const event = new dom.window.KeyboardEvent('keydown', {
        key: 's', [modifier]: true, bubbles: true, cancelable: true,
      });
      dom.window.dispatchEvent(event);
      assert.equal(saves, 1);
      assert.equal(event.defaultPrevented, true, 'do not open browser Save Page');
      cleanup?.();
      dom.window.close();
    });
  }
}

test('one shortcut saves only the active tab, and cleanup removes the listener', () => {
  const dom = new JSDOM('<div></div>');
  let activeSaves = 0;
  let inactiveSaves = 0;
  const cleanActive = mountKeyboard(dom.window, { save: () => activeSaves++ });
  const cleanInactive = mountKeyboard(dom.window, { active: false, save: () => inactiveSaves++ });
  const save = () => dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'S', ctrlKey: true }));
  save();
  assert.equal(activeSaves, 1);
  assert.equal(inactiveSaves, 0);
  cleanActive?.();
  cleanInactive?.();
  save();
  assert.equal(activeSaves, 1);
  dom.window.close();
});

test('typing, Alt modifiers, and composition do not invoke Save or change tools', () => {
  const dom = new JSDOM('<input id="field">');
  dom.window.document.getElementById('field').focus();
  let saves = 0;
  let tools = 0;
  const cleanup = mountKeyboard(dom.window, { save: () => saves++, tool: () => tools++ });
  for (const args of [
    { key: 's' }, { key: 'p' }, { key: 's', ctrlKey: true, altKey: true },
    { key: 's', metaKey: true, isComposing: true },
  ]) {
    const event = new dom.window.KeyboardEvent('keydown', { ...args, cancelable: true });
    dom.window.dispatchEvent(event);
    assert.equal(event.defaultPrevented, false);
  }
  assert.equal(saves, 0);
  assert.equal(tools, 0);
  cleanup?.();
  dom.window.close();
});

test('keyboard effect follows the active-tab prop', () => {
  const deps = source.slice(end, source.indexOf(']);', end) + 3);
  assert.match(deps, /\bisActive\b/);
});

test('native zoom events change only the active tab and stop after cleanup', () => {
  const zoomStart = source.indexOf('useEffect(() => {', source.indexOf('// Electron: listen for pdf-zoom'));
  const zoomEnd = source.indexOf('\n  }, [', zoomStart);
  assert.ok(zoomStart >= 0 && zoomEnd > zoomStart);
  const zoomEffect = source.slice(zoomStart + 'useEffect('.length, zoomEnd + '\n  }'.length);
  const dom = new JSDOM('');
  const calls = [];
  const mount = (isActive, id) => new Function('window', 'isActive', 'zoomIn', 'zoomOut', 'resetZoom',
    `return (${zoomEffect})();`)(dom.window, isActive,
    () => calls.push(`${id}:in`), () => calls.push(`${id}:out`), () => calls.push(`${id}:reset`));
  const cleanActive = mount(true, 'active');
  const cleanHidden = mount(false, 'hidden');
  const zoom = (direction) => dom.window.dispatchEvent(new dom.window.CustomEvent('pdf-zoom', { detail: { direction } }));
  for (const direction of ['in', 'out', 'reset']) zoom(direction);
  assert.deepEqual(calls, ['active:in', 'active:out', 'active:reset']);
  cleanActive?.();
  cleanHidden?.();
  zoom('in');
  assert.equal(calls.length, 3);
  assert.match(source.slice(zoomEnd, source.indexOf(']);', zoomEnd)), /\bisActive\b/);
  dom.window.close();
});
