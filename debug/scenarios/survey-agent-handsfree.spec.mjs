// Survey agent hands-free mode, end to end in the browser: a recorded clip
// plays into a fake microphone (Chromium's file capture; audio output is
// muted, nothing reaches a speaker), the mic cuts it into what was said,
// speech to text and the model are mocked, the agent's spoken replies are
// caught instead of played, and the spoken correction "no, D-118" moves
// the answer from D-117 to D-118.
//
// tests/fixtures/voice/two_turns_wait.wav: generator noise, "D one seventeen,
// card reader installed.", a 4.3 s pause (time to hear the reply, now that
// the mic waits about 2.5 s of quiet before it sends), "No, D one eighteen.".
// It is two_turns.wav with 2 s more of its own background noise in the pause
// and 3 s more at the end (the capture starts over when the file ends).
//
// Speech to text: by default the mock returns what the clip says, in order.
// Set SURVEY_AGENT_STT_URL to a local speech-to-text server (POST WAV bytes,
// answers { text }) to run the real words through instead.
//
// Needs VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY set to any value, as in
// survey-agent-chat.spec.mjs.
import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const PDF_FILE = 'print-fidelity.pdf';
const CLIP = join(root, 'tests', 'fixtures', 'voice', 'two_turns_wait.wav');
// As speech to text really writes them: the app puts the names back.
const SAID = ['D 117, card reader installed.', 'No, D1-18.'];
// What the server voice sends back: a real WAV (a soft tone). 0.4 s by
// default, so the next thing said comes after it; 8 s to test cutting in.
const voiceWav = (seconds) => {
  const n = 16_000 * seconds;
  const out = Buffer.alloc(44 + n * 2);
  out.write('RIFF', 0); out.writeUInt32LE(36 + n * 2, 4); out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(16_000, 24); out.writeUInt32LE(32_000, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34);
  out.write('data', 36); out.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i += 1) out.writeInt16LE(Math.round(Math.sin(i / 8) * 3000), 44 + i * 2);
  return out.toString('base64');
};
const VOICE_WAV = voiceWav(0.4);
const CHROMIUM = process.env.PW_CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

test.use({
  launchOptions: {
    ...(CHROMIUM ? { executablePath: CHROMIUM } : {}),
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${CLIP}%noloop`,
      '--mute-audio',
      '--autoplay-policy=no-user-gesture-required',
    ],
  },
  permissions: ['microphone'],
});

const TEMPLATE = {
  id: 'agent-template',
  name: 'Door Agent Template',
  modules: [{
    id: 'agent-module',
    name: 'Doors survey',
    categories: [{
      id: 'agent-doors',
      name: 'Doors',
      color: '#5ba1f0',
      checklist: [
        { id: 'cl-power', text: 'Power at door' },
        { id: 'cl-reader', text: 'Card reader' },
      ],
    }],
  }],
};

const marker = (id, name, x) => ({
  id,
  pageNumber: 1,
  bounds: { x, y: 600, width: 120, height: 80 },
  moduleId: 'agent-module',
  regionId: null,
  categoryId: 'agent-doors',
  name,
  checklistResponses: {},
  color: null,
});

async function seed() {
  const { size } = await stat(join(root, 'debug', 'fixtures', PDF_FILE));
  return {
    key: `surveyMarkers_${PDF_FILE}-${size}`,
    markers: {
      'surveyMarker-d117': marker('surveyMarker-d117', 'D-117', 200),
      'surveyMarker-d118': marker('surveyMarker-d118', 'D-118', 400),
    },
  };
}

async function transcribeClip(body, index) {
  if (!process.env.SURVEY_AGENT_STT_URL) return SAID[index] ?? '';
  const res = await fetch(process.env.SURVEY_AGENT_STT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'audio/wav', 'X-Hints': JSON.stringify(body.hints || []) },
    body: Buffer.from(body.audio, 'base64'),
  });
  return (await res.json()).text;
}

// A scripted model that reads the newest message the way the real one should.
function mockServer(page, log, { longVoice = false, firstClip = 0 } = {}) {
  let clips = 0;
  return page.route('**/functions/v1/survey-agent', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
      return;
    }
    const body = route.request().postDataJSON();
    const reply = (json) => route.fulfill({
      status: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...json, usage_left: { requests: 2900, cost_share: 1 } }),
    });
    if (body.action === 'status') return reply({ enabled: true, reason: null, transcription: true, speech: true, over_cap: false });
    // The server voice answers the first reply, then fails (as when the
    // model is not set up): the device voice must take over.
    if (body.action === 'speak') {
      log.speak.push(body.text);
      if (longVoice) return reply({ audio: voiceWav(8), mime: 'audio/wav' });
      if (log.speak.length === 1) return reply({ audio: VOICE_WAV, mime: 'audio/wav' });
      return route.fulfill({ status: 502, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'speech_unavailable' }) });
    }
    if (body.action === 'transcribe') {
      const bytes = Buffer.from(body.audio, 'base64');
      const text = await transcribeClip(body, clips + firstClip);
      clips += 1;
      log.clips.push({ mime: body.mime, bytes: bytes.length, ms: body.duration_ms, riff: bytes.subarray(0, 4).toString(), rate: bytes.readUInt32LE(24), hints: body.hints, text });
      return reply({ text });
    }
    log.turns.push(body);
    const lastUser = body.messages.map((m) => m.role).lastIndexOf('user');
    const said = body.messages[lastUser].content.toLowerCase();
    const tools = body.messages.slice(lastUser + 1).filter((m) => m.role === 'tool');
    const call = (id, name, args) => reply({ message: { content: '', tool_calls: [
      { id, type: 'function', function: { name, arguments: JSON.stringify(args) } },
    ] } });
    const correction = /\bno\b/.test(said) && said.includes('118');
    const steps = correction
      ? [['undo_last_turn', {}], ['find_items', { query: 'D-118', category_id: null }]]
      : [['find_items', { query: 'D-117', category_id: null }]];
    if (tools.length < steps.length) {
      const [name, args] = steps[tools.length];
      return call(`c${log.turns.length}`, name, args);
    }
    if (tools.length === steps.length) {
      const { matches } = JSON.parse(tools[tools.length - 1].content);
      return call(`w${log.turns.length}`, 'set_answers', { item_id: matches[0].id, answers: [{ checklist_item_id: 'cl-reader', value: 'Y' }] });
    }
    return reply({ message: { content: correction
      ? 'Took that back from D-117 (id surveyMarker-d117) and set card reader to Y on D-118.'
      : 'D-117: card reader is Y.', tool_calls: [] } });
  });
}

const readMarkers = (page) => page.evaluate(() => {
  const key = Object.keys(localStorage).find((k) => k.startsWith('surveyMarkers_'));
  return key ? JSON.parse(localStorage.getItem(key) || '{}') : {};
});
const reader = (markers, id) => markers[id]?.checklistResponses?.['cl-reader']?.selection || null;

test('hands-free: talk, hear the reply, talk again, and a spoken correction moves the answer', async ({ page }) => {
  const log = { clips: [], turns: [], speak: [] };
  const data = await seed();
  await page.addInitScript(({ template, data: d }) => {
    // Count server-voice playback (audio is muted for the whole browser).
    window.__played = 0;
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) { window.__played += 1; return start.apply(this, args); };
    localStorage.setItem('SURVEY_AGENT_BETA', '1');
    localStorage.setItem('survey.agent.speak', '1');
    localStorage.setItem('mobileWorkflowTemplates', JSON.stringify([template]));
    localStorage.setItem(d.key, JSON.stringify(d.markers));
    // Catch spoken replies instead of playing them.
    window.__spoken = [];
    class Utterance { constructor(text) { this.text = text; } }
    window.SpeechSynthesisUtterance = Utterance;
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        speak(u) { window.__spoken.push(u.text); setTimeout(() => u.onend?.(), 200); },
        cancel() {},
      },
    });
  }, { template: TEMPLATE, data });
  await mockServer(page, log);

  await page.goto(`/?testPdf=${encodeURIComponent(PDF_FILE)}&surveyTemplateWorkflowE2E=1`);
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').waitFor({ state: 'visible', timeout: 60_000 });
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await page.getByRole('button', { name: /Door Agent Template/ }).click();
  // One window: the Survey panel's mic starts hands-free with no chat
  // window, and turns gold while it listens.
  const panel = page.getByRole('region', { name: 'Survey agent' });
  await page.getByRole('button', { name: 'Survey agent: talk hands-free' }).click();
  const mic = page.getByRole('button', { name: 'Stop hands-free' }).first();
  await expect(mic).toHaveAttribute('aria-pressed', 'true');
  await expect(mic).toHaveClass(/is-recording/);
  await expect(panel).toBeHidden();
  await expect.poll(() => mic.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(216, 168, 78)');

  // The typing dots swap the Survey panel for the chat, in its place.
  await page.getByRole('button', { name: 'Open Survey agent chat' }).click();
  await expect(panel).toBeVisible();
  await expect(page.locator('#survey-rail-panel [data-testid="survey-agent-panel"]')).toBeVisible();
  await expect(panel.getByRole('status').first()).toContainText(/Listening|Hearing|Working|Speaking/);

  // First thing said: D-117 gets the answer, and the reply is spoken short.
  await expect(panel.getByText('D-117: card reader is Y.')).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => reader(await readMarkers(page), 'surveyMarker-d117')).toBe('Y');

  // Then, without a tap, the correction: D-117 is put back, D-118 gets it.
  await expect(panel.getByText(/set card reader to Y on D-118/)).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => reader(await readMarkers(page), 'surveyMarker-d118')).toBe('Y');
  await expect.poll(async () => reader(await readMarkers(page), 'surveyMarker-d117')).toBe(null);
  // The second reply is said before hands-free is stopped below.
  await expect.poll(() => log.speak.length, { timeout: 15_000 }).toBe(2);
  // A tap outside the chat goes back to the Survey panel, still listening.
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').click({ position: { x: 20, y: 20 } });
  await expect(panel).toBeHidden();
  await expect(mic).toHaveAttribute('aria-pressed', 'true');
  await mic.click();
  await expect(page.getByRole('button', { name: 'Survey agent: talk hands-free' })).toHaveAttribute('aria-pressed', 'false');

  // The mic sent real 16 kHz WAV clips, one per thing said, cut on the pause.
  expect(log.clips.length).toBeGreaterThanOrEqual(2);
  for (const clip of log.clips.slice(0, 2)) {
    expect(clip).toMatchObject({ mime: 'audio/wav', riff: 'RIFF', rate: 16_000 });
    expect(clip.ms).toBeGreaterThan(900);
    expect(clip.ms).toBeLessThan(5_000);
    expect(clip.hints).toEqual(expect.arrayContaining(['Card reader', 'D-117', 'D-118']));
  }
  // What the model got: the names as written in the survey.
  const said = log.turns.map((t) => t.messages.filter((m) => m.role === 'user').at(-1).content);
  expect(said).toEqual(expect.arrayContaining(['D-117, card reader installed.', 'No, D-118.']));
  // Each reply was spoken once, without ids or the dash in tags: the first
  // in the server voice, the second (server voice failed) by the device.
  expect(log.speak).toEqual(['D 117: card reader is Y.', 'Took that back from D 117 and set card reader to Y on D 118.']);
  expect(await page.evaluate(() => window.__played)).toBe(1);
  expect(await page.evaluate(() => window.__spoken)).toEqual(['Took that back from D 117 and set card reader to Y on D 118.']);
  console.log('HANDSFREE', JSON.stringify(log.clips.map(({ hints: _h, ...c }) => c)));
});

// The device's own speech to text (a fake engine here; headless Chromium
// has no speech service) hears each thing said while the mic cuts its clip.
// What it is sure of skips the server; the unsure second clip goes there.
test('hands-free: the device hears what it is sure of, only an unsure clip goes to the server, and the screen stays on', async ({ page }) => {
  const log = { clips: [], turns: [], speak: [] };
  const data = await seed();
  await page.addInitScript(({ template, data: d }) => {
    localStorage.setItem('SURVEY_AGENT_BETA', '1');
    localStorage.setItem('survey.agent.speak', '0');
    localStorage.setItem('mobileWorkflowTemplates', JSON.stringify([template]));
    localStorage.setItem(d.key, JSON.stringify(d.markers));
    // Each time the mic stops hearing someone, the engine gives its words
    // for that, as a real one does a moment after the speech ends.
    const script = [
      { text: 'D 117, card reader installed.', confidence: 0.93 },
      { text: 'no the one eight teen', confidence: 0.35 },
    ];
    window.__deviceRecs = 0;
    class FakeRecognition {
      start() {
        window.__deviceRecs += 1;
        let wasHearing = false;
        this.timer = setInterval(() => {
          const hearing = [...document.querySelectorAll('[role="status"]')].some((el) => el.textContent.includes('Hearing you'));
          if (wasHearing && !hearing && script.length) {
            const { text, confidence } = script.shift();
            setTimeout(() => {
              const r = [{ transcript: text, confidence }];
              r.isFinal = true;
              this.onresult?.({ resultIndex: 0, results: [r] });
            }, 200);
          }
          wasHearing = hearing;
        }, 30);
      }
      abort() { clearInterval(this.timer); }
      stop() { clearInterval(this.timer); }
    }
    window.webkitSpeechRecognition = FakeRecognition;
    window.SpeechRecognition = FakeRecognition;
    // The screen is kept on while hands-free listens.
    window.__locks = [];
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: { async request(kind) { const l = { kind, released: false, addEventListener() {}, async release() { l.released = true; } }; window.__locks.push(l); return l; } },
    });
  }, { template: TEMPLATE, data });
  await mockServer(page, log, { firstClip: 1 });

  await page.goto(`/?testPdf=${encodeURIComponent(PDF_FILE)}&surveyTemplateWorkflowE2E=1`);
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').waitFor({ state: 'visible', timeout: 60_000 });
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await page.getByRole('button', { name: /Door Agent Template/ }).click();
  await page.getByRole('button', { name: 'Open Survey agent chat' }).click();
  const panel = page.getByRole('region', { name: 'Survey agent' });
  await panel.getByRole('button', { name: 'Hands-free' }).click();

  await expect(panel.getByText('D-117: card reader is Y.')).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByText(/set card reader to Y on D-118/)).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => reader(await readMarkers(page), 'surveyMarker-d118')).toBe('Y');
  await panel.getByRole('button', { name: 'Stop hands-free' }).click();

  // One clip went to the server (the unsure one), not two.
  expect(log.clips).toHaveLength(1);
  expect(log.clips[0].text).toBe('No, D1-18.');
  // The device's words reached the model with the item name put back.
  const said = log.turns.map((t) => t.messages.filter((m) => m.role === 'user').at(-1).content);
  expect(said).toEqual(expect.arrayContaining(['D-117, card reader installed.', 'No, D-118.']));
  expect(await page.evaluate(() => window.__deviceRecs)).toBeGreaterThanOrEqual(1);
  expect(await page.evaluate(() => window.__locks.map((l) => [l.kind, l.released]))).toEqual([['screen', true]]);
});

test('hands-free in the phone apps: the phone hears the words, the web mic and the server are not used', async ({ page }) => {
  const log = { clips: [], turns: [], speak: [] };
  const data = await seed();
  await page.addInitScript(({ template, data: d }) => {
    localStorage.setItem('SURVEY_AGENT_BETA', '1');
    localStorage.setItem('survey.agent.speak', '0');
    localStorage.setItem('mobileWorkflowTemplates', JSON.stringify([template]));
    localStorage.setItem(d.key, JSON.stringify(d.markers));
    // A stand-in for the app's speech plugin (src/mobile/nativeSpeech.js).
    window.__nativeStarts = [];
    window.__surveyAgentNativeSpeech = {
      isAvailable: async () => true,
      requestPermission: async () => true,
      start(opts) {
        const session = { opts, stopped: false, stop() { session.stopped = true; } };
        window.__nativeStarts.push(session);
        return session;
      },
    };
    window.__nativeSay = (text, confidence) => {
      const s = window.__nativeStarts.at(-1);
      s.opts.onSpeechStart?.();
      s.opts.onFinal({ text, confidence });
    };
    window.__micOpens = 0;
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (c) => { window.__micOpens += 1; return real(c); };
  }, { template: TEMPLATE, data });
  await mockServer(page, log);

  await page.goto(`/?testPdf=${encodeURIComponent(PDF_FILE)}&surveyTemplateWorkflowE2E=1`);
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').waitFor({ state: 'visible', timeout: 60_000 });
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await page.getByRole('button', { name: /Door Agent Template/ }).click();
  await page.getByRole('button', { name: 'Open Survey agent chat' }).click();
  const panel = page.getByRole('region', { name: 'Survey agent' });
  await panel.getByRole('button', { name: 'Hands-free' }).click();
  await expect(panel.getByText('Listening. Just talk.')).toBeVisible();
  expect(await page.evaluate(() => window.__nativeStarts.map((s) => s.opts.lang))).toEqual(['en-US']);

  await page.evaluate(() => window.__nativeSay('D 117, card reader installed.', 0.9));
  await expect(panel.getByText('D-117: card reader is Y.')).toBeVisible({ timeout: 30_000 });
  // Too unsure to act on: asked again, nothing sent.
  const turnsBefore = log.turns.length;
  await page.evaluate(() => window.__nativeSay('mm', 0.1));
  await page.evaluate(() => window.__nativeSay('No, D1-18.', 0.85));
  await expect(panel.getByText(/set card reader to Y on D-118/)).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => reader(await readMarkers(page), 'surveyMarker-d118')).toBe('Y');
  await panel.getByRole('button', { name: 'Stop hands-free' }).click();

  const said = log.turns.slice(turnsBefore).map((t) => t.messages.filter((m) => m.role === 'user').at(-1).content);
  expect(said).not.toContain('mm');
  expect(log.clips).toHaveLength(0);
  expect(await page.evaluate(() => window.__micOpens)).toBe(0);
  expect(await page.evaluate(() => window.__nativeStarts.at(-1).stopped)).toBe(true);
});

test('hands-free: talking over a long spoken reply stops it, and what was said is heard', async ({ page }) => {
  const log = { clips: [], turns: [], speak: [] };
  const data = await seed();
  await page.addInitScript(({ template, data: d }) => {
    window.__played = 0;
    window.__stopped = 0;
    const { start, stop } = AudioBufferSourceNode.prototype;
    AudioBufferSourceNode.prototype.start = function (...args) { window.__played += 1; return start.apply(this, args); };
    AudioBufferSourceNode.prototype.stop = function (...args) { window.__stopped += 1; return stop.apply(this, args); };
    localStorage.setItem('SURVEY_AGENT_BETA', '1');
    localStorage.setItem('survey.agent.speak', '1');
    localStorage.setItem('mobileWorkflowTemplates', JSON.stringify([template]));
    localStorage.setItem(d.key, JSON.stringify(d.markers));
  }, { template: TEMPLATE, data });
  // Every reply is 8 s long: "No, D-118" comes 2 s after the first thing
  // said, well inside the first reply.
  await mockServer(page, log, { longVoice: true });

  await page.goto(`/?testPdf=${encodeURIComponent(PDF_FILE)}&surveyTemplateWorkflowE2E=1`);
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').waitFor({ state: 'visible', timeout: 60_000 });
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await page.getByRole('button', { name: /Door Agent Template/ }).click();
  await page.getByRole('button', { name: 'Open Survey agent chat' }).click();
  const panel = page.getByRole('region', { name: 'Survey agent' });
  await panel.getByRole('button', { name: 'Hands-free' }).click();

  await expect(panel.getByText('D-117: card reader is Y.')).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByRole('status').first()).toContainText('Talk to cut in', { timeout: 10_000 });
  // The correction, said over the reply: the reply stops and it is heard.
  await expect(panel.getByText(/set card reader to Y on D-118/)).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => reader(await readMarkers(page), 'surveyMarker-d118')).toBe('Y');
  await expect.poll(async () => reader(await readMarkers(page), 'surveyMarker-d117')).toBe(null);
  expect(await page.evaluate(() => window.__stopped)).toBeGreaterThanOrEqual(1);
  expect(log.clips.length).toBe(2);
  await panel.getByRole('button', { name: 'Stop hands-free' }).click();
});

test('hands-free with no signal: what is said is saved, said back as saved, and sent in order once back online', async ({ page, context }) => {
  const log = { clips: [], turns: [], speak: [] };
  const data = await seed();
  await page.addInitScript(({ template, data: d }) => {
    localStorage.setItem('SURVEY_AGENT_BETA', '1');
    localStorage.setItem('survey.agent.speak', '1');
    localStorage.setItem('mobileWorkflowTemplates', JSON.stringify([template]));
    localStorage.setItem(d.key, JSON.stringify(d.markers));
    window.__spoken = [];
    class Utterance { constructor(text) { this.text = text; } }
    window.SpeechSynthesisUtterance = Utterance;
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        speak(u) { window.__spoken.push(u.text); setTimeout(() => u.onend?.(), 200); },
        cancel() {},
      },
    });
  }, { template: TEMPLATE, data });
  await mockServer(page, log);

  await page.goto(`/?testPdf=${encodeURIComponent(PDF_FILE)}&surveyTemplateWorkflowE2E=1`);
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').waitFor({ state: 'visible', timeout: 60_000 });
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await page.getByRole('button', { name: /Door Agent Template/ }).click();
  await page.getByRole('button', { name: 'Open Survey agent chat' }).click();
  const panel = page.getByRole('region', { name: 'Survey agent' });
  await expect(panel.getByRole('button', { name: 'Hands-free' })).toBeEnabled();

  await context.setOffline(true);
  await panel.getByRole('button', { name: 'Hands-free' }).click();
  // Both things said wait as voice messages; the first is said back in full.
  await expect(panel.getByText('Voice message')).toHaveCount(2, { timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => window.__spoken)).toEqual([
    'No signal. I saved that and will send it when you are back online.',
    'Saved.',
  ]);
  expect(log.clips).toHaveLength(0);
  expect(log.turns).toHaveLength(0);

  await context.setOffline(false);
  // In order: D-117 first, then the correction moves the answer to D-118.
  await expect(panel.getByText(/set card reader to Y on D-118/)).toBeVisible({ timeout: 40_000 });
  await expect.poll(async () => reader(await readMarkers(page), 'surveyMarker-d118')).toBe('Y');
  await expect.poll(async () => reader(await readMarkers(page), 'surveyMarker-d117')).toBe(null);
  await expect(panel.getByText('D-117, card reader installed.')).toBeVisible();
  await expect(panel.getByText('Voice message')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Stop hands-free' }).click();
});

// The chat mic: hold to talk and let go to send; slide away to cancel; a
// quick tap still starts, and the next tap sends.
test('chat mic: hold to talk, slide away to cancel, tap still toggles', async ({ page }) => {
  const log = { clips: [], turns: [], speak: [] };
  const data = await seed();
  await page.addInitScript(({ template, data: d }) => {
    localStorage.setItem('SURVEY_AGENT_BETA', '1');
    localStorage.setItem('survey.agent.speak', '0');
    localStorage.setItem('mobileWorkflowTemplates', JSON.stringify([template]));
    localStorage.setItem(d.key, JSON.stringify(d.markers));
  }, { template: TEMPLATE, data });
  await mockServer(page, log);

  await page.goto(`/?testPdf=${encodeURIComponent(PDF_FILE)}&surveyTemplateWorkflowE2E=1`);
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').waitFor({ state: 'visible', timeout: 60_000 });
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await page.getByRole('button', { name: /Door Agent Template/ }).click();
  await page.getByRole('button', { name: 'Open Survey agent chat' }).click();
  const panel = page.getByRole('region', { name: 'Survey agent' });
  // The fixture's "Redactions are not applied" notice sits over the chat's
  // foot. Dismissing it is a tap outside the chat, so open the chat again.
  await page.getByRole('button', { name: 'Dismiss' }).first().click({ timeout: 5_000 }).catch(() => {});
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Open Survey agent chat' }).click();
  const mic = panel.locator('.survey-agent__mic');
  await expect(mic).toBeEnabled();
  await expect(mic).toHaveAttribute('title', 'Tap to talk (it sends when you stop), or hold');
  // hover() waits for the chat to finish sliding in.
  await mic.hover();
  const box = await mic.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // Hold, talk, let go: sent.
  await page.mouse.down();
  await expect(panel.getByRole('status').filter({ hasText: 'Let go to send' })).toBeVisible();
  await expect(mic).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(2500);
  await page.mouse.up();
  await expect(panel.getByText('D-117: card reader is Y.')).toBeVisible({ timeout: 30_000 });
  expect(log.clips).toHaveLength(1);
  await expect(mic).toHaveAttribute('aria-pressed', 'false');

  // Hold, slide away, let go: nothing is sent.
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.waitForTimeout(600);
  await page.mouse.move(cx, cy - 120, { steps: 4 });
  await expect(panel.getByRole('status').filter({ hasText: 'Let go to cancel' })).toBeVisible();
  await expect(mic).toHaveClass(/is-cancel/);
  await page.mouse.up();
  await expect(mic).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(1500);
  expect(log.clips).toHaveLength(1);

  // Two fingers: the first slides away to cancel; a second finger's tap
  // must not take over and send.
  const touch = (type, pointerId, x, y) => mic.dispatchEvent(type, {
    pointerId, pointerType: 'touch', isPrimary: pointerId === 7, button: type === 'pointermove' ? -1 : 0, clientX: x, clientY: y, bubbles: true,
  });
  await touch('pointerdown', 7, cx, cy);
  await expect(mic).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(600);
  await touch('pointermove', 7, cx, cy - 120);
  await expect(mic).toHaveClass(/is-cancel/);
  await touch('pointerdown', 8, cx, cy);
  await touch('pointerup', 8, cx, cy);
  await expect(mic).toHaveClass(/is-cancel/);
  await touch('pointerup', 7, cx, cy - 120);
  await expect(mic).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(1500);
  expect(log.clips).toHaveLength(1);

  // Tap to start, tap again to send.
  await mic.click();
  await expect(mic).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(1000);
  await expect(mic).toHaveAttribute('aria-pressed', 'true');
  await mic.click();
  await expect.poll(() => log.clips.length, { timeout: 15_000 }).toBe(2);
  await expect(mic).toHaveAttribute('aria-pressed', 'false');
});
