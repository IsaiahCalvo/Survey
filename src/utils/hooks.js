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
 * useKeyPress - Detect when a key is pressed
 * @param {string} targetKey - Key to detect (e.g., 'Escape', 'Enter')
 * @param {function} callback - Callback to run when key is pressed
 * @param {object} options - Options { preventDefault: boolean }
 */
export function useKeyPress(targetKey, callback, options = {}) {
  const { preventDefault = false } = options;

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === targetKey) {
        if (preventDefault) {
          event.preventDefault();
        }
        callback(event);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [targetKey, callback, preventDefault]);
}
