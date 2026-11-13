// Nightly 'audio-note' (Drawboard Insert > Audio note).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FEATURE_FLAGS } from '../src/featureFlags.js';
import {
  AUDIO_NOTE_MAX_BYTES, AUDIO_NOTE_MAX_MS, audioNoteItem, audioNoteProblem, formatAudioDuration, isAudioNote, selectedAudioOf,
} from '../src/utils/audioNote.js';
import { planSelectionQuickBar } from '../src/utils/selectionQuickBar.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const BADGE = 'data:image/png;base64,iVBORw0KGgo=';
const CLIP = 'data:audio/webm;codecs=opus;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYEC';

test('audio-note is a Nightly beta flag with a seeded off row', () => {
  assert.equal(FEATURE_FLAGS['audio-note']?.stage, 'beta');
  assert.match(read('supabase/migrations/20261113190000_drawboard_tool_flags.sql'), /\('audio-note', 'off'/);
});

test('a clip must be real audio, short and small', () => {
  assert.equal(audioNoteProblem({ src: CLIP, durationMs: 3000 }), null);
  assert.match(audioNoteProblem({ src: 'data:image/png;base64,AAAA' }), /not audio/);
  assert.match(audioNoteProblem({ src: CLIP, durationMs: AUDIO_NOTE_MAX_MS + 5000 }), /too long/);
  assert.match(audioNoteProblem({ src: `data:audio/webm;base64,${'A'.repeat(AUDIO_NOTE_MAX_BYTES)}` }), /too big/);
  assert.match(audioNoteProblem({ src: 'data:audio/x-evil;base64,AAAA' }), /can't be used/);
  assert.equal(formatAudioDuration(83_400), '1:23');
});

test('the note is a 24 pt badge picture that carries the clip', () => {
  const item = audioNoteItem({ badgeSrc: BADGE, src: CLIP, durationMs: 3200, name: 'Door 4' });
  const object = item.payload.items[0].object;
  assert.equal(object.width, 24);
  assert.ok(isAudioNote(object));
  assert.deepEqual(selectedAudioOf(object, 'a1'), { id: 'a1', src: CLIP, durationMs: 3200, name: 'Door 4' });
  assert.equal(audioNoteItem({ badgeSrc: BADGE, src: 'data:text/html;base64,PHNjcmlwdD4=' }), null);
});

test('toolbar, phone rail, picked bar and recorder are wired', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /audioNoteEnabled \? \[\{ id: 'audio-note', label: 'Audio note', iconName: 'audioNote', action: 'audio-note' \}\]/);
  assert.match(read('src/mobile/MobilePdfViewerChrome.jsx'), /\{ id: 'audio-note', label: 'Audio note', icon: 'audioNote', flag: 'audio-note', action: 'audio-note' \}/);
  const api = { selectedAudio: { id: 'a1', src: CLIP, durationMs: 1, name: 'x' }, playSelectedAudio: () => {} };
  assert.equal(planSelectionQuickBar({ items: [{ id: 'a1', typeKey: 'image' }], api }).audio, true);
  assert.equal(planSelectionQuickBar({ items: [{ id: 'a1', typeKey: 'image' }, { id: 'b', typeKey: 'rect' }], api }).audio, undefined);
  const host = read('src/components/AudioNoteHost.jsx');
  assert.match(host, /useAudioRecorder\(\{\s*bitsPerSecond: AUDIO_NOTE_BITRATE/);
  assert.match(host, /if \(recState === 'recording' && elapsedMs >= AUDIO_NOTE_MAX_MS\) stopRec\(\);/);
  // Nothing plays on its own: only Play on the picked bar or the card's player.
  assert.doesNotMatch(host, /autoPlay|autoplay/);
  assert.match(read('src/components/SurveyMediaCapture.jsx'), /bitsPerSecond > 0 \? \{ audioBitsPerSecond: bitsPerSecond \} : \{\}/);
});
