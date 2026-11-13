// Nightly 'audio-note' (Drawboard PDF Insert > Audio note): record a short
// voice note (or pick an audio file) and pin it to the page as a speaker
// badge; Play on the picked bar plays it. The badge is an inserted picture
// mark (utils/insertedImage.js), so it draws, prints, exports and syncs like
// one; the clip itself rides in data.audio as a small data URL.
import { insertedImageItem, isInsertedImage } from './insertedImage.js';

export const AUDIO_NOTE_OPEN_EVENT = 'survey:audio-note-open';
export const AUDIO_NOTE_PLAY_EVENT = 'survey:audio-note-play';
export const AUDIO_NOTE_MAX_MS = 2 * 60 * 1000;
export const AUDIO_NOTE_MAX_BYTES = 900 * 1024; // the data URL, so a note stays light to sync
export const AUDIO_NOTE_BITRATE = 32000;
export const AUDIO_NOTE_BADGE_PX = 32; // lands 24 pt square
export const AUDIO_NOTE_BADGE_COLOR = '#2F6FED';

const AUDIO_DATA_URL = /^data:audio\/(webm|ogg|mp4|mpeg|mp3|aac|wav|x-wav|wave|x-m4a|m4a|flac|x-flac)(;[^,;]*)*;base64,[A-Za-z0-9+/=]+$/i;

export const isAudioDataUrl = (src) => typeof src === 'string' && src.length <= AUDIO_NOTE_MAX_BYTES && AUDIO_DATA_URL.test(src);
export const isAudioNote = (obj) => isInsertedImage(obj) && isAudioDataUrl(obj?.data?.audio?.src);

export const formatAudioDuration = (ms) => {
  const total = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

/** Why this clip can't be pinned, or null when it can. */
export function audioNoteProblem({ src, durationMs = 0 } = {}) {
  if (typeof src !== 'string' || !/^data:audio\//i.test(src)) return 'That file is not audio.';
  if (src.length > AUDIO_NOTE_MAX_BYTES) return 'That clip is too big. Keep audio notes under about 2 minutes.';
  if (Number(durationMs) > AUDIO_NOTE_MAX_MS + 1000) return 'That clip is too long. Keep audio notes under 2 minutes.';
  if (!AUDIO_DATA_URL.test(src)) return 'That audio type can\'t be used.';
  return null;
}

/** The note as a library-like item for the placement (one save, one Undo step, picked). */
export function audioNoteItem({ badgeSrc, src, durationMs = 0, name = 'Audio note' }) {
  if (audioNoteProblem({ src, durationMs })) return null;
  const item = insertedImageItem({ src: badgeSrc, pixelWidth: AUDIO_NOTE_BADGE_PX, pixelHeight: AUDIO_NOTE_BADGE_PX, name: 'Audio note' });
  if (!item) return null;
  const object = item.payload.items[0].object;
  object.data = {
    ...object.data,
    audio: { src, durationMs: Math.max(0, Math.round(Number(durationMs) || 0)), name: String(name || 'Audio note').slice(0, 120) },
  };
  return item;
}

/** { id, src, durationMs, name } for one picked audio note, else null. */
export function selectedAudioOf(obj, id) {
  if (!isAudioNote(obj)) return null;
  const audio = obj.data.audio;
  return { id: id ?? obj.id ?? obj.data?.id ?? null, src: audio.src, durationMs: Number(audio.durationMs) || 0, name: audio.name || 'Audio note' };
}

// Lucide 'audio-lines' (ISC) on a rounded badge, as SVG for the picture.
export const AUDIO_NOTE_BADGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 24 24"><rect x="0.5" y="0.5" width="23" height="23" rx="5" fill="${AUDIO_NOTE_BADGE_COLOR}" stroke="rgba(0,0,0,0.25)" stroke-width="0.6"/><g transform="translate(4 4) scale(0.6667)" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 10v3"/><path d="M6 6v11"/><path d="M10 3v18"/><path d="M14 8v7"/><path d="M18 5v13"/><path d="M22 10v3"/></g></svg>`;
