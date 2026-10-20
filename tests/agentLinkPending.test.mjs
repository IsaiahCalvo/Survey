import test from 'node:test';
import assert from 'node:assert/strict';
import { agentLinkResumeUrl, clearPendingAgentCode, readPendingAgentCode, savePendingAgentCode } from '../src/home/agentLinkPending.js';

const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

test('pending code lasts 10 minutes, then is gone', () => {
  const s = memory();
  savePendingAgentCode(s, 'ABCD2345', 0);
  assert.equal(readPendingAgentCode(s, 9 * 60 * 1000), 'ABCD2345');
  assert.equal(readPendingAgentCode(s, 11 * 60 * 1000), '');
  clearPendingAgentCode(s);
  assert.equal(readPendingAgentCode(s, 0), '');
});

test('bad saved values are ignored', () => {
  const s = memory();
  s.setItem('survey.pendingAgentCode', '{"code":"<script>","at":0}');
  assert.equal(readPendingAgentCode(s, 0), '');
  s.setItem('survey.pendingAgentCode', 'not json');
  assert.equal(readPendingAgentCode(s, 0), '');
});

test('front page resumes the agent page only when coming back from sign-in with a fresh code', () => {
  const s = memory();
  savePendingAgentCode(s, 'ABCD2345', 0);
  const at = (pathname, search = '', hash = '') => ({ pathname, search, hash });
  assert.equal(agentLinkResumeUrl(at('/', '?code=1b2c-uuid'), s, 1000), '/agent-link?code=1b2c-uuid');
  assert.equal(agentLinkResumeUrl(at('/', '', '#access_token=x&type=signup'), s, 1000), '/agent-link#access_token=x&type=signup');
  assert.equal(agentLinkResumeUrl(at('/'), s, 1000), null, 'a plain visit opens the app');
  assert.equal(agentLinkResumeUrl(at('/projects', '?code=x'), s, 1000), null);
  assert.equal(agentLinkResumeUrl(at('/', '?code=x'), s, 11 * 60 * 1000), null, 'stale code');
  assert.equal(agentLinkResumeUrl(at('/', '?code=x'), memory(), 1000), null, 'no code waiting');
});
