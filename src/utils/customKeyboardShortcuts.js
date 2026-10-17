import { documentedChords } from './keyboardShortcuts.js';
import { isTypingTarget } from './annotationFamilyRules.js';

const STORAGE_KEY = 'survey:keyboard-shortcuts';
const assignable = (chord) => !/(click|arrows|space|escape|enter|delete|backspace|pageup|pagedown|\?)/.test(chord);
export const canAssignShortcut = assignable;
let saved = {};
try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { /* blocked storage */ }
if (!saved || typeof saved !== 'object' || Array.isArray(saved)) saved = {};
const known = new Set(documentedChords());
saved = Object.fromEntries(Object.entries(saved).filter(([key, value]) => known.has(key) && assignable(key) && typeof value === 'string' && value.length < 40));
export const shortcutBinding = (chord) => saved[chord] || chord;
const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');
export function eventChord(event) {
  const key = String(event.key || '').toLowerCase();
  if (['control', 'meta', 'alt', 'shift', 'dead', 'unidentified'].includes(key) || !key) return null;
  return [event.metaKey || event.ctrlKey ? 'mod' : '', event.altKey ? 'alt' : '', event.shiftKey ? 'shift' : '', key === '+' ? '=' : key].filter(Boolean).join('+');
}
export function assignShortcut(original, chord) {
  if (!assignable(original) || !known.has(original)) return 'This shortcut cannot be changed.';
  if (!chord || !/^(?:(?:mod|alt|shift)\+)*[a-z0-9\[\]=/.-]$/.test(chord)) return 'Press a letter or a key combination.';
  if (['mod+w', 'mod+q', 'mod+l', 'mod+t', 'mod+n', 'mod+r', 'mod+shift+w', 'mod+shift+t'].includes(chord)) return 'This key is used by your browser.';
  const conflict = [...known].find(key => key !== original && shortcutBinding(key) === chord);
  if (conflict) return `This key is already used (${shortcutBinding(conflict).toUpperCase()}).`;
  saved = { ...saved, [original]: chord };
  if (original === chord) delete saved[original];
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); } catch { /* keep this session */ }
  return null;
}
export function resetShortcut(original) {
  const conflict = [...known].find(key => key !== original && shortcutBinding(key) === original);
  if (conflict) return 'The default key is used by another shortcut. Change that shortcut first.';
  const next = { ...saved };
  delete next[original];
  saved = next;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); } catch { /* keep this session */ }
  return null;
}
export function installShortcutRemapping() {
  if (typeof window === 'undefined') return () => {};
  const remap = event => {
    if (event.__surveyRemapped || isTypingTarget(event.target)) return;
    const pressed = eventChord(event);
    const original = Object.keys(saved).find(key => saved[key] === pressed);
    if (!original) {
      if (saved[pressed] && saved[pressed] !== pressed) { event.preventDefault(); event.stopImmediatePropagation(); }
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    const parts = original.split('+');
    const key = parts.pop();
    const shifted = parts.includes('shift');
    const forwarded = new KeyboardEvent(event.type, {
      key: shifted && key.length === 1 ? key.toUpperCase() : key,
      code: /^[a-z]$/.test(key) ? `Key${key.toUpperCase()}` : event.code,
      shiftKey: shifted, altKey: parts.includes('alt'), ctrlKey: parts.includes('mod') && !isMac(), metaKey: parts.includes('mod') && isMac(),
      repeat: event.repeat, bubbles: true, cancelable: true,
    });
    Object.defineProperty(forwarded, '__surveyRemapped', { value: true });
    (event.target || document.body).dispatchEvent(forwarded);
  };
  window.addEventListener('keydown', remap, true);
  window.addEventListener('keyup', remap, true);
  return () => { window.removeEventListener('keydown', remap, true); window.removeEventListener('keyup', remap, true); };
}
