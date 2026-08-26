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

function matchColorBoxCommand(source, index) {
  if (source[index] !== '\\') return null;
  if (isEscapedControlSequence(source, index)) return null;

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
