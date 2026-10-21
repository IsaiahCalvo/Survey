import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceLog, loggedCaller, scrubLogValue, sendVoiceLog } from '../src/agent/voiceLog.js';

const fakeClock = () => {
  let t = 1000;
  return { now: () => t, advance: (ms) => { t += ms; } };
};

test('times count from the tap, turns are kept to the newest few', () => {
  const c = fakeClock();
  const log = createVoiceLog({ maxTurns: 3, now: c.now, wall: () => Date.UTC(2026, 9, 21) });
  log.tap('hands_free_tap');
  c.advance(120);
  log.event('mic_started', { native: false });
  for (let i = 0; i < 5; i += 1) { c.advance(1000); log.turn('clip', { ms: 900 }); log.event('heard', { text: `D-1-1${i}` }); }
  const snap = log.snapshot();
  assert.equal(snap.started_at, '2026-10-21T00:00:00.000Z');
  assert.equal(snap.turns.length, 3);
  assert.deepEqual(snap.turns.map((t) => t.n), [4, 5, 6]);
  assert.equal(snap.turns[2].events[0].t, 5120);
  assert.equal(snap.turns[2].events[1].data.text, 'D-1-14');
});

test('no audio, keys or tokens get in, and long text is cut', () => {
  const out = scrubLogValue({ text: 'x'.repeat(1000), audio: 'AAAA', apiKey: 'gsk_1', access_token: 't', nested: { Authorization: 'Bearer y', ok: 1 } });
  assert.equal(out.text.length, 301);
  assert.equal(out.audio, undefined);
  assert.equal(out.apiKey, undefined);
  assert.equal(out.access_token, undefined);
  assert.deepEqual(out.nested, { ok: 1 });
});

test('the caller logs what was heard, each model step and failures, and a failure sends the log once a session', async () => {
  const sent = [];
  const log = createVoiceLog({ onError: (type) => sent.push(type) });
  log.tap();
  const replies = {
    transcribe: { text: 'D-1-17 is installed' },
    turn: { message: { content: '', tool_calls: [{ id: 'a', function: { name: 'set_answers', arguments: '{"item_name":"D-1-17","all_lines":"Y"}' } }] }, finish_reason: 'tool_calls' },
  };
  const call = loggedCaller(async (p) => {
    if (p.action === 'fail') { const e = new Error('no'); e.code = 'transcription_failed'; throw e; }
    return replies[p.action];
  }, () => log);
  await call({ action: 'transcribe', audio: 'BASE64AUDIO', duration_ms: 1500 });
  await call({ action: 'turn', messages: [{ role: 'user', content: 'x' }] });
  await assert.rejects(call({ action: 'fail' }));
  await assert.rejects(call({ action: 'fail' }));
  const events = log.snapshot().turns.flatMap((t) => t.events);
  assert.deepEqual(events.map((e) => e.type), ['tap', 'transcribe_sent', 'transcribed', 'model_sent', 'model_done', 'call_failed', 'call_failed']);
  assert.equal(events[2].data.text, 'D-1-17 is installed');
  assert.equal(events[4].data.tools[0].name, 'set_answers');
  assert.ok(!JSON.stringify(events).includes('BASE64AUDIO'));
  assert.deepEqual(sent, ['call_failed']);
  log.tap();
  await assert.rejects(call({ action: 'fail' }));
  assert.equal(sent.length, 2);
});

test('sending stores the timeline in survey_agent_voice_logs, and nothing when empty', async () => {
  const rows = [];
  const supabase = { from: (table) => ({ insert: async (row) => { rows.push({ table, row }); return { error: null }; } }) };
  const log = createVoiceLog();
  assert.equal(await sendVoiceLog(supabase, log), false);
  log.tap();
  log.event('heard', { text: 'hi' });
  assert.equal(await sendVoiceLog(supabase, log, { reason: 'error', release: 'abc', platform: 'web test' }), true);
  assert.equal(rows[0].table, 'survey_agent_voice_logs');
  assert.equal(rows[0].row.reason, 'error');
  assert.equal(rows[0].row.release, 'abc');
  assert.equal(rows[0].row.log.turns[0].events[1].data.text, 'hi');
});
