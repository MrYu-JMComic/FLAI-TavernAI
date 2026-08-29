const COLOR_BOX_COMMANDS = [
  { name: '\\fcolorbox', argumentCount: 3 },
  { name: '\\colorbox', argumentCount: 2 }
];
const KATEX_DARK_SURFACE_TEXT = { color: '#20241f', rgb: [32, 36, 31] };
const KATEX_LIGHT_SURFACE_TEXT = { color: '#f1f5ee', rgb: [241, 245, 238] };
const MIN_TEXT_CONTRAST = 4.5;

export function normalizeKatexSource(source) {
  return normalizeColorBoxContents(String(source ?? ''));
}

// Some providers escape TeX twice while serializing Markdown (for example,
// `\\\\fcolorbox` or `\\\\(`). Collapse only control-sequence-looking runs so
// ordinary LaTeX row breaks (`\\\\`) and prose backslashes remain untouched.
export function normalizeEscapedKatexSource(source) {
  const collapsed = collapseEscapedKatex(String(source ?? ''));
  const normalized = containsColorBoxCommand(collapsed)
    ? normalizeNestedDollarMath(collapsed)
    : collapsed;
  return normalizeKatexSource(normalized);
}

export function findColorBoxExpression(source, index = 0) {
  const text = String(source ?? '');
  const commandIndex = text.startsWith('\\\\', index) ? index + 1 : index;
  const command = matchColorBoxCommand(text, commandIndex, commandIndex !== index);
  if (!command) return null;

  const argumentsList = readBracedArguments(
    text,
    commandIndex + command.name.length,
    command.argumentCount
  );
  if (!argumentsList) return null;

  return {
    name: command.name,
    start: index,
    end: argumentsList.at(-1).contentEnd + 1
  };
}

export function selectKatexSurfaceTextColor(backgroundColor) {
  const backgroundRgb = parseOpaqueRgbColor(backgroundColor);
  if (!backgroundRgb) return '';

  const backgroundLuminance = relativeLuminance(backgroundRgb);
  const candidates = [KATEX_DARK_SURFACE_TEXT, KATEX_LIGHT_SURFACE_TEXT];
  const preferred = candidates
    .map((candidate) => ({
      ...candidate,
      contrast: contrastRatio(backgroundLuminance, relativeLuminance(candidate.rgb))
    }))
    .sort((left, right) => right.contrast - left.contrast)[0];

  if (preferred.contrast >= MIN_TEXT_CONTRAST) return preferred.color;

  const blackContrast = contrastRatio(backgroundLuminance, 0);
  const whiteContrast = contrastRatio(backgroundLuminance, 1);
  return blackContrast >= whiteContrast ? '#000000' : '#ffffff';
}

function parseOpaqueRgbColor(color) {
  const match = String(color ?? '').trim().match(/^rgba?\((.*)\)$/iu);
  if (!match) return null;

  const components = match[1]
    .trim()
    .split(/[,\s/]+/u)
    .filter(Boolean)
    .map(Number);
  if (components.length !== 3 && components.length !== 4) return null;
  if (components.some((component) => !Number.isFinite(component))) return null;

  const [red, green, blue, alpha = 1] = components;
  if ([red, green, blue].some((channel) => channel < 0 || channel > 255)) return null;
  if (alpha !== 1) return null;
  return [red, green, blue];
}

function relativeLuminance(rgb) {
  const [red, green, blue] = rgb.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
}

function contrastRatio(firstLuminance, secondLuminance) {
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function normalizeColorBoxContents(source) {
  let normalized = '';
  let cursor = 0;

  while (cursor < source.length) {
    const command = matchColorBoxCommand(source, cursor);
    if (!command) {
      normalized += source[cursor];
      cursor += 1;
      continue;
    }

    const argumentsList = readBracedArguments(
      source,
      cursor + command.name.length,
      command.argumentCount
    );
    if (!argumentsList) {
      normalized += source[cursor];
      cursor += 1;
      continue;
    }

    const contentArgument = argumentsList.at(-1);
    const content = source.slice(contentArgument.contentStart, contentArgument.contentEnd);
    const nestedContent = normalizeColorBoxContents(content);

    normalized += source.slice(cursor, contentArgument.contentStart);
    normalized += wrapDirectMathEnvironment(nestedContent);
    normalized += '}';
    cursor = contentArgument.contentEnd + 1;
  }

  return normalized;
}

function collapseEscapedKatex(source) {
  let normalized = '';
  let cursor = 0;

  while (cursor < source.length) {
    if (source[cursor] !== '\\') {
      normalized += source[cursor];
      cursor += 1;
      continue;
    }

    let runEnd = cursor + 1;
    while (runEnd < source.length && source[runEnd] === '\\') runEnd += 1;
    const runLength = runEnd - cursor;
    const nextCharacter = source[runEnd] || '';

    if (runLength >= 2 && runLength % 2 === 0 && isEscapedKatexControl(nextCharacter)) {
      normalized += '\\';
      cursor = runEnd;
      continue;
    }

    // A generated `\\\\` row break should become the normal TeX `\\` break.
    if (runLength >= 4 && runLength % 2 === 0 && /(?:\s|&|\[)/u.test(nextCharacter)) {
      normalized += '\\'.repeat(runLength / 2);
      cursor = runEnd;
      continue;
    }

    normalized += source.slice(cursor, runEnd);
    cursor = runEnd;
  }

  return normalized;
}

function normalizeNestedDollarMath(source) {
  let normalized = '';
  let cursor = 0;

  while (cursor < source.length) {
    if (
      source[cursor] !== '$'
      || source[cursor + 1] === '$'
      || isEscapedControlSequence(source, cursor)
    ) {
      normalized += source[cursor];
      cursor += 1;
      continue;
    }

    const close = findUnescapedDollar(source, cursor + 1);
    if (close === -1) {
      normalized += source[cursor];
      cursor += 1;
      continue;
    }

    // The complete color-box expression is already in math mode. Dollar
    // delimiters nested inside it would be interpreted as a second math shift,
    // so keep their contents and drop only the delimiters.
    normalized += source.slice(cursor + 1, close);
    cursor = close + 1;
  }

  return normalized;
}

function containsColorBoxCommand(source) {
  return COLOR_BOX_COMMANDS.some((command) => source.includes(command.name));
}

function findUnescapedDollar(source, start) {
  for (let cursor = start; cursor < source.length; cursor += 1) {
    if (
      source[cursor] === '$'
      && source[cursor - 1] !== '$'
      && source[cursor + 1] !== '$'
      && !isEscapedControlSequence(source, cursor)
    ) {
      return cursor;
    }
  }
  return -1;
}

function isEscapedKatexControl(character) {
  return /[A-Za-z(){};,:!%_]/u.test(character);
}

function matchColorBoxCommand(source, index, allowEscaped = false) {
  if (source[index] !== '\\') return null;
  if (!allowEscaped && isEscapedControlSequence(source, index)) return null;

  for (const command of COLOR_BOX_COMMANDS) {
    if (!source.startsWith(command.name, index)) continue;
    const nextCharacter = source[index + command.name.length] || '';
    if (!/[A-Za-z]/u.test(nextCharacter)) return command;
  }

  return null;
}

function isEscapedControlSequence(source, index) {
  let precedingBackslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) {
    precedingBackslashes += 1;
  }
  return precedingBackslashes % 2 === 1;
}

function readBracedArguments(source, startIndex, argumentCount) {
  const argumentsList = [];
  let cursor = startIndex;

  for (let index = 0; index < argumentCount; index += 1) {
    const argument = readBracedArgument(source, cursor);
    if (!argument) return null;
    argumentsList.push(argument);
    cursor = argument.contentEnd + 1;
  }

  return argumentsList;
}

function readBracedArgument(source, startIndex) {
  let cursor = startIndex;
  while (/\s/u.test(source[cursor] || '')) cursor += 1;
  if (source[cursor] !== '{') return null;

  const contentStart = cursor + 1;
  let depth = 1;
  for (cursor = contentStart; cursor < source.length; cursor += 1) {
    const character = source[cursor];
    if (character === '\\') {
      cursor += 1;
      continue;
    }
    if (character === '%') {
      while (cursor < source.length && source[cursor] !== '\n') cursor += 1;
      continue;
    }
    if (character === '{') {
      depth += 1;
      continue;
    }
    if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        return { contentStart, contentEnd: cursor };
      }
    }
  }

  return null;
}

function wrapDirectMathEnvironment(content) {
  const leadingWhitespace = content.match(/^\s*/u)?.[0] || '';
  const trailingWhitespace = content.match(/\s*$/u)?.[0] || '';
  const bodyEnd = content.length - trailingWhitespace.length;
  const body = content.slice(leadingWhitespace.length, bodyEnd);
  if (!/^\\begin\s*\{[^{}]+\}/u.test(body)) return content;

  return `${leadingWhitespace}\\(${body}\\)${trailingWhitespace}`;
}
