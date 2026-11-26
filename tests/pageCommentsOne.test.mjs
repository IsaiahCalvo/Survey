import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { ARM_PAGE_COMMENT_EVENT, requestPageCommentPin } from '../src/services/pagePinsStore.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('page-comments-one is a Nightly (beta) flag with a seed row', () => {
  assert.equal(FEATURE_FLAGS['page-comments-one']?.stage, 'beta');
  assert.match(read('../supabase/migrations/20261126050000_page_comments_one_flag.sql'), /'page-comments-one', 'off'/);
});

test('requestPageCommentPin is true only when a viewer takes the event', () => {
  const saved = globalThis.window;
  const target = new EventTarget();
  globalThis.window = target;
  try {
    assert.equal(requestPageCommentPin(), false, 'no viewer listening: the panel falls back to its own page thread');
    const take = (event) => event.preventDefault();
    target.addEventListener(ARM_PAGE_COMMENT_EVENT, take);
    assert.equal(requestPageCommentPin(), true);
    target.removeEventListener(ARM_PAGE_COMMENT_EVENT, take);
  } finally {
    globalThis.window = saved;
  }
});

test('the Comments panel + arms the Page comment tool, and pin threads open their card', () => {
  const panel = read('../src/sidebar/CommentsPanel.jsx');
  assert.match(panel, /if \(pageCommentsOne && requestPageCommentPin\(\)\)/);
  assert.match(panel, /pageCommentsOne \? 'Page comment' : `Comment on page/);
  assert.match(panel, /if \(pinOf\(thread\)\) setPagePinsState\(\{ openId: thread\.id \}\)/);
  const viewer = read('../src/PDFViewer.jsx');
  assert.match(viewer, /window\.addEventListener\(ARM_PAGE_COMMENT_EVENT, onArm\)/);
  assert.match(viewer, /if \(!isActive \|\| !pinsDocOn\) return undefined;/);
});
