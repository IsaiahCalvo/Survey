import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    RECENT_COLORS_KEY, RECENT_COLORS_MAX, pushRecentColor, loadRecentColors, rememberRecentColor, normaliseRecentColor,
} from '../src/utils/recentColors.js';

const memoryStorage = () => {
    const map = new Map();
    return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), map };
};
const throwingStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };

test('recent colours: newest first, deduped, capped at 8, normalised', () => {
    let list = [];
    for (let i = 0; i < 10; i += 1) list = pushRecentColor(list, `#00000${i}`.slice(0, 7).padEnd(7, '0'));
    assert.equal(list.length, RECENT_COLORS_MAX);
    list = pushRecentColor(['#AAAAAA', '#BBBBBB'], 'bbbbbb');
    assert.deepEqual(list, ['#BBBBBB', '#AAAAAA']);
    assert.equal(normaliseRecentColor('transparent'), null);
    assert.deepEqual(pushRecentColor(['#AAAAAA'], 'transparent'), ['#AAAAAA']);
});

test('recent colours persist per device and survive broken storage', () => {
    const s = memoryStorage();
    rememberRecentColor('#123456', s);
    rememberRecentColor('#abcdef', s);
    assert.deepEqual(loadRecentColors(s), ['#ABCDEF', '#123456']);
    assert.deepEqual(JSON.parse(s.getItem(RECENT_COLORS_KEY)), ['#ABCDEF', '#123456']);
    s.setItem(RECENT_COLORS_KEY, '{not json');
    assert.deepEqual(loadRecentColors(s), []);
    assert.deepEqual(loadRecentColors(throwingStorage), []);
    assert.deepEqual(rememberRecentColor('#111111', throwingStorage), ['#111111']);
});

test('the shared picker records and shows recent colours', () => {
    const src = readFileSync(new URL('../src/components/CompactColorPicker.jsx', import.meta.url), 'utf8');
    assert.match(src, /loadRecentColors\(\)/);
    assert.match(src, /noteRecent\(hex\)/);
    assert.match(src, /noteRecent\(state\.latest\[0\]\)/);
    assert.match(src, /data-recent-colors="true"/);
});
