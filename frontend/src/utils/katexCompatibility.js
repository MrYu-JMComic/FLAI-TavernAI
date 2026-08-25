const COLOR_BOX_COMMANDS = [
  { name: '\\fcolorbox', argumentCount: 3 },
  { name: '\\colorbox', argumentCount: 2 }
];

export function normalizeKatexSource(source) {
  return normalizeColorBoxContents(String(source ?? ''));
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
