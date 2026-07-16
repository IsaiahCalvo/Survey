const DEFAULT_WIDTH = 180;
const DEFAULT_HEIGHT = 52;
const DEFAULT_FONT_SIZE = 16;
const DEFAULT_PADDING = 5;

const finite = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

export function isTextboxAnnotation(annotation) {
  const type = String(annotation?.type || '').toLowerCase();
  return type === 'textbox' || type === 'freetext' || type === 'text' || type === 'i-text';
}

export function rectCommands(bounds) {
  const x = finite(bounds?.x);
  const y = finite(bounds?.y);
  const w = Math.max(1, finite(bounds?.w, 1));
  const h = Math.max(1, finite(bounds?.h, 1));
  return [
    ['M', x, y],
    ['L', x + w, y],
    ['L', x + w, y + h],
    ['L', x, y + h],
    ['Z'],
  ];
}

export function textboxBounds(annotation) {
  const stored = annotation?.bounds;
  if (stored && [stored.x, stored.y, stored.w, stored.h].every((value) => Number.isFinite(Number(value)))) {
    return {
      x: Number(stored.x),
      y: Number(stored.y),
      w: Math.max(1, Number(stored.w)),
      h: Math.max(1, Number(stored.h)),
    };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const command of annotation?.cmds || []) {
    for (let index = 1; index + 1 < command.length; index += 2) {
      minX = Math.min(minX, command[index]);
      minY = Math.min(minY, command[index + 1]);
      maxX = Math.max(maxX, command[index]);
      maxY = Math.max(maxY, command[index + 1]);
    }
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 1, h: 1 };
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}

export function createTextboxAnnotation(point, {
  id,
  pageWidth = Infinity,
  pageHeight = Infinity,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  color = '#111827',
  fontSize = DEFAULT_FONT_SIZE,
} = {}) {
  const boundedWidth = Math.max(24, Math.min(finite(width, DEFAULT_WIDTH), finite(pageWidth, Infinity)));
  const boundedHeight = Math.max(20, Math.min(finite(height, DEFAULT_HEIGHT), finite(pageHeight, Infinity)));
  const x = Math.max(0, Math.min(finite(point?.x), finite(pageWidth, Infinity) - boundedWidth));
  const y = Math.max(0, Math.min(finite(point?.y), finite(pageHeight, Infinity) - boundedHeight));
  const bounds = { x, y, w: boundedWidth, h: boundedHeight };
  return {
    id,
    type: 'textbox',
    source: 'drawn',
    text: '',
    cmds: rectCommands(bounds),
    bounds,
    textColor: color,
    backgroundColor: 'transparent',
    borderColor: null,
    borderWidth: 0,
    fontSize: Math.max(4, finite(fontSize, DEFAULT_FONT_SIZE)),
    fontFamily: 'Helvetica',
    lineHeight: 1.2,
    textAlign: 'left',
    padding: DEFAULT_PADDING,
    atomicErase: true,
    eraseByBounds: true,
  };
}

function wrappedTextRuns(context, text, maxWidth) {
  const source = String(text ?? '');
  const width = Math.max(1, finite(maxWidth, 1));
  const lines = [];

  const pushLine = (tokens, sourceStart, sourceEnd) => {
    let visibleCount = tokens.length;
    while (visibleCount > 0 && /^\s$/u.test(tokens[visibleCount - 1].value)) visibleCount -= 1;
    const visibleTokens = tokens.slice(0, visibleCount);
    lines.push({
      text: visibleTokens.map((token) => token.value).join(''),
      tokens: visibleTokens,
      sourceStart,
      sourceEnd,
    });
  };

  const pushParagraph = (paragraph, paragraphStart) => {
    if (!paragraph) {
      pushLine([], paragraphStart, paragraphStart);
      return;
    }
    let tokens = [];
    let lineStart = paragraphStart;
    let offset = 0;
    for (const character of paragraph) {
      const start = paragraphStart + offset;
      const end = start + character.length;
      const lineText = tokens.map((token) => token.value).join('');
      if (lineText && context.measureText(lineText + character).width > width) {
        pushLine(tokens, lineStart, start);
        if (/^\s$/u.test(character)) {
          tokens = [];
          lineStart = end;
        } else {
          tokens = [{ value: character, start, end }];
          lineStart = start;
        }
      } else {
        tokens.push({ value: character, start, end });
      }
      offset += character.length;
    }
    pushLine(tokens, lineStart, paragraphStart + paragraph.length);
  };

  let paragraphStart = 0;
  const newlines = /\r?\n/g;
  let match = newlines.exec(source);
  while (match) {
    pushParagraph(source.slice(paragraphStart, match.index), paragraphStart);
    paragraphStart = match.index + match[0].length;
    match = newlines.exec(source);
  }
  pushParagraph(source.slice(paragraphStart), paragraphStart);
  return lines;
}

export function wrapTextboxText(context, text, maxWidth) {
  return wrappedTextRuns(context, text, maxWidth).map((line) => line.text);
}

function visiblePaint(value) {
  if (!value) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized !== 'none' && normalized !== 'transparent' && normalized !== 'rgba(0,0,0,0)';
}

function canvasFont(annotation) {
  const family = String(annotation?.fontFamily || 'Helvetica').split(',')[0].replace(/["']/g, '').trim() || 'Helvetica';
  const style = String(annotation?.fontStyle || 'normal');
  const weight = String(annotation?.fontWeight || 'normal');
  const size = Math.max(1, finite(annotation?.fontSize, DEFAULT_FONT_SIZE));
  return `${style} ${weight} ${size}px "${family}"`;
}

function textboxTextLayout(context, annotation, x, y, padding) {
  const bounds = textboxBounds(annotation);
  const fontSize = Math.max(1, finite(annotation?.fontSize, DEFAULT_FONT_SIZE));
  const lineStep = fontSize * Math.max(1, finite(annotation?.lineHeight, 1.2));
  const innerWidth = Math.max(1, bounds.w - padding * 2);
  const textAlign = ['center', 'right'].includes(annotation?.textAlign) ? annotation.textAlign : 'left';
  const lines = wrappedTextRuns(context, annotation?.text, innerWidth).map((line, index) => {
    const width = context.measureText(line.text).width;
    const left = textAlign === 'center'
      ? x + bounds.w / 2 - width / 2
      : textAlign === 'right'
        ? x + bounds.w - padding - width
        : x + padding;
    return {
      ...line,
      left,
      width,
      y: y + padding + index * lineStep,
    };
  });
  return { fontSize, lineStep, innerWidth, lines };
}

function textBeforeOffset(line, offset) {
  return line.tokens
    .filter((token) => token.end <= offset)
    .map((token) => token.value)
    .join('');
}

function lineForOffset(lines, offset) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const next = lines[index + 1];
    if (!next || offset < next.sourceStart
      || (offset === line.sourceEnd && next.sourceStart > offset)) return line;
  }
  return lines[lines.length - 1];
}

function drawEditorSelection(context, layout, editor) {
  const sourceLength = String(editor?.text ?? '').length;
  const selectionStart = Math.max(0, Math.min(sourceLength, finite(editor?.selectionStart)));
  const selectionEnd = Math.max(selectionStart, Math.min(sourceLength, finite(editor?.selectionEnd, selectionStart)));
  const displayScale = Math.max(0.01, finite(editor?.displayScale, 1));

  context.save();
  context.globalAlpha = 1;
  if (selectionEnd > selectionStart) {
    context.fillStyle = 'rgba(10, 132, 255, 0.28)';
    for (const line of layout.lines) {
      const selectedTokens = line.tokens.filter((token) => (
        token.end > selectionStart && token.start < selectionEnd
      ));
      if (!selectedTokens.length) continue;
      const first = selectedTokens[0];
      const last = selectedTokens[selectedTokens.length - 1];
      const left = line.left + context.measureText(textBeforeOffset(line, first.start)).width;
      const right = line.left + context.measureText(textBeforeOffset(line, last.end)).width;
      context.fillRect(left, line.y, Math.max(1 / displayScale, right - left), layout.lineStep);
    }
  } else {
    const line = lineForOffset(layout.lines, selectionStart);
    if (line) {
      const caretX = line.left + context.measureText(textBeforeOffset(line, selectionStart)).width;
      context.fillStyle = editor?.caretColor || '#0a84ff';
      context.fillRect(caretX, line.y, Math.max(1 / displayScale, 0.75), layout.fontSize);
    }
  }
  context.restore();
}

export function drawTextboxAnnotation(context, annotation, dx = 0, dy = 0, editor = null) {
  const bounds = textboxBounds(annotation);
  const x = bounds.x + dx;
  const y = bounds.y + dy;
  const padding = Math.max(0, finite(annotation?.padding, DEFAULT_PADDING));
  const borderWidth = Math.max(0, finite(annotation?.borderWidth));
  const angle = finite(annotation?.angle);

  context.save();
  if (angle) {
    const centerX = x + bounds.w / 2;
    const centerY = y + bounds.h / 2;
    context.translate(centerX, centerY);
    context.rotate((angle * Math.PI) / 180);
    context.translate(-centerX, -centerY);
  }
  context.globalAlpha *= Math.max(0, Math.min(1, finite(annotation?.opacity, 1)));
  if (visiblePaint(annotation?.backgroundColor)) {
    context.fillStyle = annotation.backgroundColor;
    context.fillRect(x, y, bounds.w, bounds.h);
  }
  if (borderWidth > 0 && visiblePaint(annotation?.borderColor)) {
    context.strokeStyle = annotation.borderColor;
    context.lineWidth = borderWidth;
    context.strokeRect(x + borderWidth / 2, y + borderWidth / 2, bounds.w - borderWidth, bounds.h - borderWidth);
  }

  context.save();
  context.beginPath();
  context.rect(x, y, bounds.w, bounds.h);
  context.clip();
  context.font = canvasFont(annotation);
  context.textBaseline = 'top';
  context.textAlign = ['center', 'right'].includes(annotation?.textAlign) ? annotation.textAlign : 'left';
  context.fillStyle = annotation?.textColor || '#111827';
  const layout = textboxTextLayout(context, annotation, x, y, padding);
  if (editor) drawEditorSelection(context, layout, { ...editor, text: annotation?.text });
  const textX = annotation?.textAlign === 'center'
    ? x + bounds.w / 2
    : annotation?.textAlign === 'right'
      ? x + bounds.w - padding
      : x + padding;
  for (const line of layout.lines) {
    if (line.y + layout.fontSize > y + bounds.h + 0.5) break;
    context.fillText(line.text, textX, line.y, layout.innerWidth);
  }
  context.restore();
  if (editor) {
    const displayScale = Math.max(0.01, finite(editor.displayScale, 1));
    context.save();
    context.globalAlpha = 1;
    context.strokeStyle = '#0a84ff';
    context.lineWidth = 1.5 / displayScale;
    context.setLineDash([]);
    context.strokeRect(x, y, bounds.w, bounds.h);
    context.restore();
  }
  context.restore();
}
