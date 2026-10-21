import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RECENT_COLORS_MAX } from '../src/utils/recentColors.js';

const src = readFileSync(new URL('../src/components/CompactColorPicker.jsx', import.meta.url), 'utf8');

test('phone recent row sits on the preset row\'s columns', () => {
    const start = src.indexOf('data-recent-colors="true"');
    assert.ok(start > 0);
    const block = src.slice(start, src.indexOf('recentColors.map', start));
    // Phone branch: one track per preset, spread like the presets row, no wrap.
    assert.match(block, /gridTemplateColumns: `repeat\(\$\{presets\.length\}, max-content\)`/);
    assert.match(block, /justifyContent: 'space-between'/);
    assert.doesNotMatch(block, /flexWrap/);
});

test('all recent colours fit on the preset tracks (one row, no wrap)', () => {
    const m = /export const PRESET_COLORS = Object\.freeze\(\[([\s\S]*?)\]\)/.exec(src);
    assert.ok(m);
    const presets = m[1].match(/'#[0-9A-Fa-f]{6}'/g) || [];
    assert.ok(presets.length >= RECENT_COLORS_MAX, `${presets.length} presets < ${RECENT_COLORS_MAX} recents`);
});
