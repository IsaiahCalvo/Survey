import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LINK_MODE_DISABLED,
  LINK_MODE_OPEN,
  LINK_MODE_SELECT,
  isLinkOpenModifierEvent,
  linkModeForTool,
  resolveLinkMode,
  shouldOpenLinkOnClick,
} from '../src/utils/linkClickPolicy.js';

const DRAWING_TOOLS = ['pen', 'highlighter', 'text', 'rectangle', 'circle', 'line', 'arrow', 'callout', 'cloud', 'polygon', 'eraser', 'counter', 'survey-marker'];

test('Pan opens a link on a plain click', () => {
  const mode = resolveLinkMode({ toolMode: linkModeForTool('pan') });
  assert.equal(mode, LINK_MODE_OPEN);
  assert.equal(shouldOpenLinkOnClick(mode, {}), true);
});

test('Select picks the link; Cmd/Ctrl+click opens it', () => {
  const mode = resolveLinkMode({ toolMode: linkModeForTool('select') });
  assert.equal(mode, LINK_MODE_SELECT);
  assert.equal(shouldOpenLinkOnClick(mode, {}), false);
  assert.equal(shouldOpenLinkOnClick(mode, { ctrlKey: true }), true);
  assert.equal(shouldOpenLinkOnClick(mode, { metaKey: true }), true);
  // Holding the key keeps Select's mode (the link stays pickable on release).
  assert.equal(resolveLinkMode({ toolMode: LINK_MODE_SELECT, modifierHeld: true }), LINK_MODE_SELECT);
});

test('every drawing tool leaves the press to the tool', () => {
  for (const tool of DRAWING_TOOLS) {
    const mode = resolveLinkMode({ toolMode: linkModeForTool(tool) });
    assert.equal(mode, LINK_MODE_DISABLED, tool);
    assert.equal(shouldOpenLinkOnClick(mode, { ctrlKey: true }), false, tool);
  }
});

test('Cmd/Ctrl held turns links on under any tool, and the click opens', () => {
  for (const tool of DRAWING_TOOLS) {
    const mode = resolveLinkMode({ toolMode: linkModeForTool(tool), modifierHeld: true });
    assert.equal(mode, LINK_MODE_OPEN, tool);
    assert.equal(shouldOpenLinkOnClick(mode, { ctrlKey: true }), true, tool);
  }
});

test('Text Select leaves links to native text unless the key is held', () => {
  const toolMode = linkModeForTool('text-select');
  assert.equal(resolveLinkMode({ toolMode, nativeTextSelection: true }), LINK_MODE_DISABLED);
  assert.equal(resolveLinkMode({ toolMode, nativeTextSelection: true, modifierHeld: true }), LINK_MODE_OPEN);
});

test('modifier event detection', () => {
  assert.equal(isLinkOpenModifierEvent({ ctrlKey: true }), true);
  assert.equal(isLinkOpenModifierEvent({ metaKey: true }), true);
  assert.equal(isLinkOpenModifierEvent({ shiftKey: true }), false);
  assert.equal(isLinkOpenModifierEvent(null), false);
});
