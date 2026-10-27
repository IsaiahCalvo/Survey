// Photo and Signature lines (nightly 'custom-answers'): their images are
// Survey Marker note media tagged with the line's id (`lineId`).
import { normalizeNoteMedia } from './surveyMediaService.js';
import { itemKind, photoAnswerText, signatureAnswerText } from './answerSets.js';
import { localToday } from '../../supabase/functions/_shared/kitShape.js';

/** The media on a note that answers one line. */
export const lineMediaOf = (note, lineId) => normalizeNoteMedia(note || {}).filter((m) => m.lineId === lineId);

/** The answer a line's media gives: "2 photos", "Signed 2026-10-26" or ''. */
export function lineMediaAnswer(item, media) {
  if (!media.length) return '';
  if (itemKind(item) === 'signature') {
    const at = new Date(media[media.length - 1].createdAt || Date.now());
    return signatureAnswerText(localToday(Number.isNaN(at.getTime()) ? new Date() : at));
  }
  return photoAnswerText(media.length);
}
