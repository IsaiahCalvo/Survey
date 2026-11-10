// Nightly 'typing-undo': Undo while typing in a text box or callout steps back
// a word (or a run of deletes, or a pause) at a time, as Drawboard does
// (t2-tools-deep.md gap 3). The browser's own undo for a contentEditable
// takes the whole typing session back in one press.
//
// A step closes when:
//   - a new word starts (a letter typed after a space or a new line),
//   - the kind of edit changes (typing, deleting, pasting),
//   - or the typist paused for PAUSE_MS.

export const TYPING_UNDO_PAUSE_MS = 1000;

const kindOf = (inputType) => {
  const t = String(inputType || '');
  if (t.startsWith('delete')) return 'delete';
  if (t === 'insertFromPaste' || t === 'insertFromDrop') return 'paste';
  if (t === 'insertParagraph' || t === 'insertLineBreak') return 'insert';
  return 'insert';
};

/**
 * Steps of {text, caret}. `record` takes the text and caret AFTER an edit.
 * `undo` / `redo` return the step to show, or null when there is none.
 */
export function createTypingHistory(text = '', caret = text.length, { pauseMs = TYPING_UNDO_PAUSE_MS } = {}) {
  const steps = [{ text, caret }];
  let index = 0;
  let open = false; // the top step can still take more of the same edit
  let lastKind = null;
  let lastAt = -Infinity;

  return {
    record(nextText, nextCaret, inputType, now = Date.now()) {
      const top = steps[index];
      if (nextText === top.text) { top.caret = nextCaret; return; }
      const kind = kindOf(inputType);
      // A letter after a space or line break starts a new word.
      const added = nextText.length > top.text.length && nextCaret > 0 ? nextText[nextCaret - 1] : '';
      const before = nextCaret > 1 ? nextText[nextCaret - 2] : '';
      const newWord = kind === 'insert' && added && !/\s/.test(added) && /\s/.test(before);
      const join = open && index === steps.length - 1 && kind === lastKind && kind !== 'paste'
        && now - lastAt < pauseMs && !newWord;
      if (join) {
        top.text = nextText;
        top.caret = nextCaret;
      } else {
        steps.length = index + 1;
        steps.push({ text: nextText, caret: nextCaret });
        index += 1;
      }
      open = true;
      lastKind = kind;
      lastAt = now;
    },
    undo() {
      if (index === 0) return null;
      index -= 1;
      open = false;
      return { ...steps[index] };
    },
    redo() {
      if (index >= steps.length - 1) return null;
      index += 1;
      open = false;
      return { ...steps[index] };
    },
    get canUndo() { return index > 0; },
    get canRedo() { return index < steps.length - 1; },
  };
}

/** Undo / redo key for a keydown, or null. Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z, Ctrl+Y. */
export function typingUndoKey(e) {
  if (!e || !(e.ctrlKey || e.metaKey) || e.altKey) return null;
  const k = String(e.key || '').toLowerCase();
  if (k === 'z') return e.shiftKey ? 'redo' : 'undo';
  if (k === 'y' && !e.shiftKey) return 'redo';
  return null;
}

/** Caret offset in a plain-text editable (0 when it has no caret). */
export function caretOffsetIn(el) {
  const sel = typeof window !== 'undefined' ? window.getSelection?.() : null;
  if (!el || !sel || sel.rangeCount === 0) return 0;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.endContainer)) return 0;
  const pre = range.cloneRange();
  pre.selectNodeContents(el);
  pre.setEnd(range.endContainer, range.endOffset);
  return pre.toString().length;
}

/** Put the caret at a text offset in a plain-text editable. */
export function placeCaretIn(el, offset) {
  const sel = typeof window !== 'undefined' ? window.getSelection?.() : null;
  if (!el || !sel) return;
  const doc = el.ownerDocument;
  const walker = doc.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
  let left = Math.max(0, offset);
  let node = walker.nextNode();
  const range = doc.createRange();
  while (node) {
    const len = node.nodeValue.length;
    if (left <= len) { range.setStart(node, left); range.collapse(true); sel.removeAllRanges(); sel.addRange(range); return; }
    left -= len;
    node = walker.nextNode();
  }
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}
