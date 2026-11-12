// Rows for the app's own right-click menu on a text field, selected text or a
// link (components/AppContextMenuHost.jsx draws them; nativeContextMenuGuard.js
// decides which). They stand in for the browser's own menu, which never shows
// in Survey (owner 2026-11-12).
//
// The menu leaves focus in the field, so the commands run against the field's
// live caret and selection. Cut and Copy go through execCommand (allowed in a
// click); Paste reads the clipboard (the browser may ask once) and types it in
// with insertText, so Undo takes it back like a typed paste.

import { showToast } from './toast.js';

const pasteKeys = () => (typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '') ? '⌘V' : 'Ctrl+V');

function fieldSelectionText(field) {
  if (!field) return '';
  if (typeof field.selectionStart === 'number' && typeof field.value === 'string') {
    try { return field.value.slice(field.selectionStart, field.selectionEnd); } catch { return ''; }
  }
  const selection = typeof window !== 'undefined' ? window.getSelection?.() : null;
  if (!selection || selection.isCollapsed || !selection.rangeCount) return '';
  const range = selection.getRangeAt(0);
  return field.contains?.(range.commonAncestorContainer) ? String(selection.toString()) : '';
}

function keepFocus(field) {
  if (field && typeof document !== 'undefined' && document.activeElement !== field && !field.contains?.(document.activeElement)) {
    try { field.focus({ preventScroll: true }); } catch { /* gone */ }
  }
}

function run(command, value) {
  try { return document.execCommand(command, false, value); } catch { return false; }
}

/** Copy text to the clipboard (with a hidden-field fallback for old webviews). */
export async function copyText(text) {
  const value = String(text ?? '');
  if (!value) return false;
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(value); return true; }
  } catch { /* fall back below */ }
  const scratch = document.createElement('textarea');
  scratch.value = value;
  scratch.setAttribute('readonly', '');
  scratch.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  const before = document.activeElement;
  document.body.appendChild(scratch);
  scratch.select();
  const ok = run('copy');
  scratch.remove();
  try { before?.focus?.({ preventScroll: true }); } catch { /* gone */ }
  return ok;
}

async function pasteInto(field) {
  let text = null;
  try { text = await navigator.clipboard?.readText?.(); } catch { text = null; }
  if (typeof text !== 'string') {
    showToast(`Press ${pasteKeys()} to paste here.`, 'info');
    return;
  }
  if (!field?.isConnected) return;
  keepFocus(field);
  // insertText keeps the field's own undo history and fires its input event.
  if (!run('insertText', text) && typeof field.setRangeText === 'function') {
    field.setRangeText(text, field.selectionStart, field.selectionEnd, 'end');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

/**
 * Spelling fixes (desktop app: Chromium's own, see electron-main.js
 * 'editable-context-menu'), then Cut / Copy / Paste / Select all.
 * `spelling`: { misspelledWord, suggestions } or null.
 */
export function spellingMenuItems(field, spelling, api = typeof window !== 'undefined' ? window.electronAPI : null) {
  const word = String(spelling?.misspelledWord || '');
  if (!word || !api) return [];
  const suggestions = (Array.isArray(spelling.suggestions) ? spelling.suggestions : []).filter(Boolean).slice(0, 5);
  return [
    ...(suggestions.length
      ? suggestions.map((fix) => ({ label: fix, icon: false, onClick: () => { keepFocus(field); api.replaceMisspelling?.(fix); } }))
      : [{ label: 'No spelling suggestions', icon: false, disabled: true }]),
    { label: 'Add to dictionary', icon: 'bookmark', onClick: () => { keepFocus(field); api.addWordToDictionary?.(word); } },
    { separator: true, key: 'spelling-separator' },
  ];
}

/** Cut / Copy / Paste / Select all for a text field (spelling fixes first when known). */
export function textFieldMenuItems(field, spelling = null) {
  if (!field) return [];
  const selected = fieldSelectionText(field);
  const secret = String(field.type || '').toLowerCase() === 'password';
  const value = typeof field.value === 'string' ? field.value : String(field.textContent || '');
  return [
    ...spellingMenuItems(field, spelling),
    { label: 'Cut', icon: 'scissors', disabled: !selected || secret, onClick: () => { keepFocus(field); run('cut'); } },
    { label: 'Copy', icon: 'copy', disabled: !selected || secret, onClick: () => { keepFocus(field); if (!run('copy')) copyText(selected); } },
    { label: 'Paste', icon: 'paste', onClick: () => { pasteInto(field); } },
    { label: 'Select all', icon: 'textSelect', disabled: !value, onClick: () => { keepFocus(field); if (typeof field.select === 'function') field.select(); else run('selectAll'); } },
  ];
}

/** Copy for text the person selected outside a field. */
export function selectionMenuItems(text) {
  const value = String(text || '');
  if (!value.trim()) return [];
  return [{ label: 'Copy', icon: 'copy', onClick: () => { copyText(value); } }];
}

/** Open / Copy for a link. */
export function linkMenuItems(href) {
  if (!href) return [];
  return [
    { label: 'Open link', icon: 'hyperlink', onClick: () => { window.open(href, '_blank', 'noopener,noreferrer'); } },
    { label: 'Copy link', icon: 'copy', onClick: () => { copyText(href).then((ok) => { if (ok) showToast('Link copied', 'success'); }); } },
  ];
}
