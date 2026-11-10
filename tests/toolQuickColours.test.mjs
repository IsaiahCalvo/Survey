// Per-tool quick colours (Nightly 'tool-quick-colours', Drawboard PDF Pro
// trial audit 2026-11-10): the highlighter's discs are highlighter colours.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HIGHLIGHTER_QUICK_COLOURS, QUICK_COLOURS, isCustomQuickColour, quickColoursForTool,
} from '../src/utils/quickStylePresets.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

test('highlighter gets yellow first (its default) only with the flag', () => {
  assert.equal(FEATURE_FLAGS['tool-quick-colours']?.stage, 'beta');
  assert.deepEqual(quickColoursForTool('highlighter', true).colours, HIGHLIGHTER_QUICK_COLOURS);
  assert.equal(HIGHLIGHTER_QUICK_COLOURS[0].toLowerCase(), '#ffff00');
  assert.deepEqual(quickColoursForTool('highlighter', false).colours, QUICK_COLOURS);
  assert.deepEqual(quickColoursForTool('pen', true).colours, QUICK_COLOURS);
});

test('the custom disc is chosen against the discs on show', () => {
  assert.equal(isCustomQuickColour('#ffff00'), true);
  assert.equal(isCustomQuickColour('#ffff00', HIGHLIGHTER_QUICK_COLOURS), false);
  assert.equal(isCustomQuickColour('#ff0000', HIGHLIGHTER_QUICK_COLOURS), true);
});
