import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const defaultProjectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = path.resolve(getOptionValue('--project-root') ?? defaultProjectRoot);
const frontendSrc = path.join(projectRoot, 'frontend', 'src');
const vueExtension = '.vue';
const maxTextViolations = normalizeMaxViolations(getOptionValue('--max-output') ?? 30);

function getOptionValue(name) {
  const inlinePrefix = `${name}=`;
  const inlineValue = rawArgs.find((arg) => arg.startsWith(inlinePrefix));
  if (inlineValue) {
    return inlineValue.slice(inlinePrefix.length);
  }

  const valueIndex = rawArgs.indexOf(name);
  if (valueIndex === -1 || valueIndex === rawArgs.length - 1) {
    return null;
  }
  return rawArgs[valueIndex + 1];
}

function normalizeMaxViolations(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 30;
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(entryPath);
    } else if (entry.isFile()) {
      yield entryPath;
    }
  }
}

function readSmallTextFile(filePath) {
  const stats = statSync(filePath);
  if (stats.size > 1024 * 1024) {
    return '';
  }
  return readFileSync(filePath, 'utf8');
}

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function relativePath(filePath) {
  return toPosixPath(path.relative(projectRoot, filePath));
}

function maskHtmlComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, (match) => match.replace(/[^\r\n]/g, ' '));
}

function lineNumberAt(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function hasAttribute(attrs, names) {
  return names.some((name) => new RegExp(`(?:^|\\s)(?::|v-bind:)?${name}\\s*=`, 'i').test(attrs));
}

function getStaticAttribute(attrs, name) {
  const match = attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(['"])(.*?)\\1`, 'i'));
  return match ? match[2] : '';
}

function hasAccessibleNameAttribute(attrs) {
  return hasAttribute(attrs, ['aria-label', 'aria-labelledby']);
}

function findTagEnd(text, startIndex) {
  let quote = '';
  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === quote) {
        quote = '';
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === '>') {
      return index;
    }
  }

  return -1;
}

function stripTags(text) {
  return text
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ');
}

function hasVisibleButtonText(body) {
  return stripTags(body).replace(/\s+/g, '').length > 0;
}

function isHiddenInput(attrs) {
  return /^hidden$/i.test(getStaticAttribute(attrs, 'type').trim());
}

function isInsideLabel(text, index) {
  const before = text.slice(0, index);
  return before.lastIndexOf('<label') > before.lastIndexOf('</label>');
}

function hasAssociatedLabel(text, attrs, index) {
  if (isInsideLabel(text, index)) {
    return true;
  }

  const id = getStaticAttribute(attrs, 'id').trim();
  if (!id) {
    return false;
  }

  const escapedId = id.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  return new RegExp(`<label\\b[^>]*\\bfor\\s*=\\s*(['"])${escapedId}\\1`, 'i').test(text);
}

function findButtonViolations(fileLabel, text) {
  const violations = [];
  const buttonPattern = /<button\b/gi;
  let match;

  while ((match = buttonPattern.exec(text))) {
    const tagEnd = findTagEnd(text, buttonPattern.lastIndex);
    if (tagEnd === -1) {
      break;
    }
    const attrs = text.slice(buttonPattern.lastIndex, tagEnd);
    const closePattern = /<\/button\s*>/gi;
    closePattern.lastIndex = tagEnd + 1;
    const closeMatch = closePattern.exec(text);
    if (!closeMatch) {
      buttonPattern.lastIndex = tagEnd + 1;
      continue;
    }

    const body = text.slice(tagEnd + 1, closeMatch.index);
    buttonPattern.lastIndex = closePattern.lastIndex;
    if (hasAccessibleNameAttribute(attrs) || hasVisibleButtonText(body)) {
      continue;
    }

    violations.push({
      file: fileLabel,
      line: lineNumberAt(text, match.index),
      control: 'button',
      message: 'Icon-only button needs aria-label or aria-labelledby'
    });
  }

  return violations;
}

function findFormControlViolations(fileLabel, text) {
  const violations = [];
  const controlPattern = /<(input|textarea|select)\b/gi;
  let match;

  while ((match = controlPattern.exec(text))) {
    const [, control] = match;
    const tagEnd = findTagEnd(text, controlPattern.lastIndex);
    if (tagEnd === -1) {
      break;
    }

    const attrs = text.slice(controlPattern.lastIndex, tagEnd);
    controlPattern.lastIndex = tagEnd + 1;
    if (control.toLowerCase() === 'input' && isHiddenInput(attrs)) {
      continue;
    }
    if (hasAccessibleNameAttribute(attrs) || hasAttribute(attrs, ['title']) || hasAssociatedLabel(text, attrs, match.index)) {
      continue;
    }

    violations.push({
      file: fileLabel,
      line: lineNumberAt(text, match.index),
      control: control.toLowerCase(),
      message: 'Form control needs an accessible label'
    });
  }

  return violations;
}

function findViolations() {
  const violations = [];

  for (const filePath of walk(frontendSrc)) {
    if (path.extname(filePath).toLowerCase() !== vueExtension) {
      continue;
    }

    const text = maskHtmlComments(readSmallTextFile(filePath));
    const fileLabel = relativePath(filePath);
    violations.push(...findButtonViolations(fileLabel, text));
    violations.push(...findFormControlViolations(fileLabel, text));
  }

  return violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.control.localeCompare(b.control));
}

const violations = findViolations();

if (args.has('--json')) {
  console.log(JSON.stringify({ violations }, null, 2));
} else if (violations.length) {
  console.log(`Potentially inaccessible Vue controls: ${violations.length}`);
  const displayedViolations = maxTextViolations === 0 ? violations : violations.slice(0, maxTextViolations);
  for (const violation of displayedViolations) {
    console.log(`- ${violation.file}:${violation.line} ${violation.control}: ${violation.message}`);
  }
  if (displayedViolations.length < violations.length) {
    console.log(`... ${violations.length - displayedViolations.length} more violation(s) hidden; rerun with --json or --max-output=0 for the full list.`);
  }
  console.log('\nReview these controls before relying on the diagnostic as a blocking accessibility gate.');
} else {
  console.log('No inaccessible Vue controls found.');
}

if (args.has('--fail-on-violations') && violations.length) {
  process.exit(1);
}
