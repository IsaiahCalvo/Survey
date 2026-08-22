/**
 * hooks.js — small general-purpose React hooks shared across the app.
 *
 * Exports useDebounce (debounced value), useDebouncedCallback (debounced fn with
 * cleanup), useLocalStorage (state persisted to window.localStorage), and
 * useKeyPress (global keydown listener for a target key). Plain utility hooks
 * with no app-specific or annotation-pipeline coupling.
 */
import { useEffect, useRef, useState, useCallback } from 'react';




/**
 * True when a keydown is aimed at a typing surface. `?` (and any other
 * useKeyPress chord) must not steal the character from INPUT / TEXTAREA /
 * contentEditable — the field keeps the key, the shortcut does not fire.
 */
export function isTypingTarget(target) {
  if (!target || typeof target !== 'object') return false;
  const tag = String(target.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
  if (target.isContentEditable === true) return true;
  if (target.contentEditable === 'true' || target.contentEditable === 'plaintext-only') return true;
  return false;
}

/**
 * useKeyPress - Detect when a key is pressed
 * @param {string} targetKey - Key to detect (e.g., 'Escape', 'Enter')
 * @param {function} callback - Callback to run when key is pressed
 * @param {object} options - Options { preventDefault: boolean, ignoreWhenTyping: boolean }
 */
export function useKeyPress(targetKey, callback, options = {}) {
  const { preventDefault = false, ignoreWhenTyping = true } = options;

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key !== targetKey) return;
      if (ignoreWhenTyping) {
        const active = typeof document !== 'undefined' ? document.activeElement : null;
        if (isTypingTarget(event.target) || isTypingTarget(active)) return;
      }
      if (preventDefault) {
        event.preventDefault();
      }
      callback(event);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [targetKey, callback, preventDefault, ignoreWhenTyping]);
}
