import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareDiagnosticText, escapeRegExp, getCliOptionValue, maskNonNewlineText, readSmallTextFile, toPosixPath, walkFiles } from './diagnostic-file-utils.mjs';

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const defaultProjectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = path.resolve(getCliOptionValue(rawArgs, '--project-root') ?? defaultProjectRoot);
const frontendSrc = path.join(projectRoot, 'frontend', 'src');
const vueExtension = '.vue';
const maxTextViolations = normalizeMaxViolations(getCliOptionValue(rawArgs, '--max-output') ?? 30);
const boundAttributePatternCache = new Map();
const staticAttributePatternCache = new Map();
const closingTagPatternCache = new Map();
const scannableControlPattern = /<(?:button|input|textarea|select)\b/i;
const ariaHiddenTruePattern = /^true$/i;
const hiddenInputTypePattern = /^hidden$/i;
const nonWhitespaceTextPattern = /\S/;
const staticTokenSeparatorPattern = /\s/;

function normalizeMaxViolations(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 30;
}

function relativePath(filePath) {
  return toPosixPath(path.relative(projectRoot, filePath));
}

function maskHtmlComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, maskNonNewlineText);
}

function maskSfcScriptAndStyleBlocks(text) {
  return text.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, maskNonNewlineText);
}

function maskQuotedAttributeMarkup(text) {
  return text.replace(/([:@\w-]+)\s*=\s*(['"])((?:\\.|(?!\2)[\s\S])*?)\2/g, (match, _name, quote, value) => {
    const valueStart = match.indexOf(value, match.indexOf(quote) + 1);
    const maskedValue = value.replace(/[<>]/g, ' ');
    return `${match.slice(0, valueStart)}${maskedValue}${match.slice(valueStart + value.length)}`;
  });
}

function maskNonTemplateNoise(text) {
  return maskQuotedAttributeMarkup(maskHtmlComments(maskSfcScriptAndStyleBlocks(text)));
}

function hasScannableControl(text) {
  return scannableControlPattern.test(text);
}

function buildLineStarts(text) {
  const lineStarts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') {
      lineStarts.push(index + 1);
    }
  }
  return lineStarts;
}

function lineNumberAt(lineStarts, index) {
  const limit = Math.max(index, 0);
  let low = 0;
  let high = lineStarts.length;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (lineStarts[middle] <= limit) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}

function getBoundAttributePattern(name) {
  const key = name.toLowerCase();
  if (!boundAttributePatternCache.has(key)) {
    boundAttributePatternCache.set(key, new RegExp(`(?:^|\\s)(?::|v-bind:)${escapeRegExp(key)}\\s*=`, 'i'));
  }
  return boundAttributePatternCache.get(key);
}

function getStaticAttributePattern(name) {
  const key = name.toLowerCase();
  if (!staticAttributePatternCache.has(key)) {
    staticAttributePatternCache.set(key, new RegExp(`(?:^|\\s)${escapeRegExp(key)}\\s*=\\s*(?:(['"])(.*?)\\1|([^\\s>]+))`, 'i'));
  }
  return staticAttributePatternCache.get(key);
}

function getClosingTagPattern(tagName) {
  const key = tagName.toLowerCase();
  if (!closingTagPatternCache.has(key)) {
    closingTagPatternCache.set(key, new RegExp(`</${escapeRegExp(key)}\\s*>`, 'gi'));
  }
  return closingTagPatternCache.get(key);
}

function hasBoundAttribute(attrs, names) {
  for (const name of names) {
    if (getBoundAttributePattern(name).test(attrs)) {
      return true;
    }
  }
  return false;
}

function getStaticAttribute(attrs, name) {
  const match = attrs.match(getStaticAttributePattern(name));
  return match ? (match[2] ?? match[3] ?? '') : '';
}

function forEachStaticToken(value, callback) {
  let tokenStart = -1;

  for (let index = 0; index <= value.length; index += 1) {
    if (index < value.length && !staticTokenSeparatorPattern.test(value[index])) {
      if (tokenStart === -1) {
        tokenStart = index;
      }
      continue;
    }

    if (tokenStart === -1) {
      continue;
    }

    if (callback(value.slice(tokenStart, index)) === false) {
      return false;
    }
    tokenStart = -1;
  }

  return true;
}

function hasNonEmptyStaticAttribute(attrs, names) {
  for (const name of names) {
    if (getStaticAttribute(attrs, name).trim().length > 0) {
      return true;
    }
  }
  return false;
}

function hasProvidedAttribute(attrs, names) {
  return hasBoundAttribute(attrs, names) || hasNonEmptyStaticAttribute(attrs, names);
}

function findElementBodyRange(text, tagName, tagEnd) {
  if (text[tagEnd - 1] === '/') {
    return {
      bodyStart: tagEnd + 1,
      bodyEnd: tagEnd + 1,
      nextIndex: tagEnd + 1
    };
  }

  const closePattern = getClosingTagPattern(tagName);
  closePattern.lastIndex = tagEnd + 1;
  const closeMatch = closePattern.exec(text);
  if (!closeMatch) {
    return null;
  }

  return {
    bodyStart: tagEnd + 1,
    bodyEnd: closeMatch.index,
    nextIndex: closePattern.lastIndex
  };
}

function getElementBody(text, tagName, tagEnd) {
  const bodyRange = findElementBodyRange(text, tagName, tagEnd);
  return bodyRange ? text.slice(bodyRange.bodyStart, bodyRange.bodyEnd) : '';
}

function elementProvidesName(attrs, body) {
  return hasProvidedAttribute(attrs, ['aria-label', 'title']) || hasLabelTextContent(body);
}

function collectStaticAriaLabelledByIds(text) {
  const referencedIds = new Set();
  const tagPattern = /<([a-z][\w:-]*)\b/gi;
  let match;

  while ((match = tagPattern.exec(text))) {
    const tagEnd = findTagEnd(text, tagPattern.lastIndex);
    if (tagEnd === -1) {
      break;
    }

    const attrs = text.slice(tagPattern.lastIndex, tagEnd);
    const labelledBy = getStaticAttribute(attrs, 'aria-labelledby');
    if (labelledBy) {
      forEachStaticToken(labelledBy, (id) => {
        referencedIds.add(id);
      });
    }
    tagPattern.lastIndex = tagEnd + 1;
  }

  return referencedIds;
}

function buildReferencedNameIndex(text) {
  const referencedNameIndex = new Map();
  const referencedIds = collectStaticAriaLabelledByIds(text);
  if (!referencedIds.size) {
    return referencedNameIndex;
  }

  const tagPattern = /<([a-z][\w:-]*)\b/gi;
  let match;

  while ((match = tagPattern.exec(text))) {
    const tagEnd = findTagEnd(text, tagPattern.lastIndex);
    if (tagEnd === -1) {
      break;
    }

    const attrs = text.slice(tagPattern.lastIndex, tagEnd);
    const id = getStaticAttribute(attrs, 'id').trim();
    if (!referencedIds.has(id) || referencedNameIndex.has(id)) {
      tagPattern.lastIndex = tagEnd + 1;
      continue;
    }

    const body = getElementBody(text, match[1], tagEnd);
    referencedNameIndex.set(id, elementProvidesName(attrs, body));
    if (referencedNameIndex.size === referencedIds.size) {
      break;
    }
    tagPattern.lastIndex = tagEnd + 1;
  }

  return referencedNameIndex;
}

function hasStaticAriaLabelledByReference(attrs, referencedNameIndex) {
  const labelledBy = getStaticAttribute(attrs, 'aria-labelledby');
  if (!labelledBy || !referencedNameIndex) {
    return false;
  }

  let hasReferencedName = false;
  forEachStaticToken(labelledBy, (id) => {
    if (referencedNameIndex.get(id) === true) {
      hasReferencedName = true;
      return false;
    }
    return true;
  });
  return hasReferencedName;
}

function hasAccessibleNameAttribute(attrs, referencedNameIndex) {
  return (
    hasProvidedAttribute(attrs, ['aria-label']) ||
    hasBoundAttribute(attrs, ['aria-labelledby']) ||
    hasStaticAriaLabelledByReference(attrs, referencedNameIndex)
  );
}

function hasTitleAttribute(attrs) {
  return hasProvidedAttribute(attrs, ['title']);
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

function isAriaHidden(attrs) {
  return ariaHiddenTruePattern.test(getStaticAttribute(attrs, 'aria-hidden').trim());
}

function stripAriaHiddenContent(text) {
  return text
    .replace(/<([a-z][\w:-]*)\b(?=[^>]*\baria-hidden\s*=)([^>]*)>[\s\S]*?<\/\1\s*>/gi, (match, _tag, attrs) => (isAriaHidden(attrs) ? ' ' : match))
    .replace(/<([a-z][\w:-]*)\b(?=[^>]*\baria-hidden\s*=)([^>]*)\/?>/gi, (match, _tag, attrs) => (isAriaHidden(attrs) ? ' ' : match));
}

function stripTags(text) {
  return stripAriaHiddenContent(text)
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ');
}

function hasNonWhitespaceText(text) {
  return nonWhitespaceTextPattern.test(text);
}

function hasVisibleButtonText(body) {
  return hasNonWhitespaceText(stripTags(body));
}

function isHiddenInput(attrs) {
  return hiddenInputTypePattern.test(getStaticAttribute(attrs, 'type').trim());
}

function inputHasNativeAccessibleName(attrs) {
  const type = getStaticAttribute(attrs, 'type').trim().toLowerCase();
  if (['button', 'reset', 'submit'].includes(type)) {
    return hasProvidedAttribute(attrs, ['value']);
  }
  if (type === 'image') {
    return hasProvidedAttribute(attrs, ['alt']);
  }
  return false;
}

function stripLabelControlContent(text) {
  return text
    .replace(/<textarea\b[\s\S]*?<\/textarea>/gi, ' ')
    .replace(/<select\b[\s\S]*?<\/select>/gi, ' ')
    .replace(/<input\b[^>]*>/gi, ' ');
}

function hasLabelTextContent(text) {
  return hasNonWhitespaceText(stripTags(stripLabelControlContent(text)));
}

function labelProvidesName(attrs, body, referencedNameIndex) {
  return hasAccessibleNameAttribute(attrs, referencedNameIndex) || hasLabelTextContent(body);
}

function buildExternalLabelNameIndex(text, referencedNameIndex) {
  const labelNameIndex = new Set();
  const labelPattern = /<label\b([^>]*)>([\s\S]*?)<\/label\s*>/gi;
  let match;

  while ((match = labelPattern.exec(text))) {
    const id = getStaticAttribute(match[1], 'for').trim();
    if (id && labelProvidesName(match[1], match[2], referencedNameIndex)) {
      labelNameIndex.add(id);
    }
  }

  return labelNameIndex;
}

function findWrappingLabel(text, index) {
  const labelStart = text.lastIndexOf('<label', index);
  if (labelStart <= text.lastIndexOf('</label>', index)) {
    return null;
  }

  const labelStartEnd = findTagEnd(text, labelStart + '<label'.length);
  if (labelStartEnd === -1 || labelStartEnd >= index) {
    return null;
  }

  const labelClosePattern = getClosingTagPattern('label');
  labelClosePattern.lastIndex = index;
  const labelClose = labelClosePattern.exec(text);
  if (!labelClose) {
    return null;
  }

  return {
    attrs: text.slice(labelStart + '<label'.length, labelStartEnd),
    body: text.slice(labelStartEnd + 1, labelClose.index)
  };
}

function hasAssociatedLabel(text, attrs, index, externalLabelNameIndex, referencedNameIndex) {
  const wrappingLabel = findWrappingLabel(text, index);
  if (wrappingLabel) {
    return labelProvidesName(wrappingLabel.attrs, wrappingLabel.body, referencedNameIndex);
  }

  const id = getStaticAttribute(attrs, 'id').trim();
  if (!id) {
    return false;
  }

  return externalLabelNameIndex.has(id);
}

function findButtonViolations(fileLabel, text, lineStarts, referencedNameIndex) {
  const violations = [];
  const buttonPattern = /<button\b/gi;
  let match;

  while ((match = buttonPattern.exec(text))) {
    const tagEnd = findTagEnd(text, buttonPattern.lastIndex);
    if (tagEnd === -1) {
      break;
    }
    const attrs = text.slice(buttonPattern.lastIndex, tagEnd);
    const bodyRange = findElementBodyRange(text, 'button', tagEnd);
    if (!bodyRange) {
      buttonPattern.lastIndex = tagEnd + 1;
      continue;
    }

    const body = text.slice(bodyRange.bodyStart, bodyRange.bodyEnd);
    buttonPattern.lastIndex = bodyRange.nextIndex;
    if (hasAccessibleNameAttribute(attrs, referencedNameIndex) || hasVisibleButtonText(body)) {
      continue;
    }

    violations.push({
      file: fileLabel,
      line: lineNumberAt(lineStarts, match.index),
      control: 'button',
      message: 'Icon-only button needs aria-label or aria-labelledby'
    });
  }

  return violations;
}

function findFormControlViolations(fileLabel, text, lineStarts, externalLabelNameIndex, referencedNameIndex) {
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
    const controlName = control.toLowerCase();
    const isInput = controlName === 'input';
    controlPattern.lastIndex = tagEnd + 1;
    if (isInput && (isHiddenInput(attrs) || inputHasNativeAccessibleName(attrs))) {
      continue;
    }
    if (hasAccessibleNameAttribute(attrs, referencedNameIndex) || hasTitleAttribute(attrs) || hasAssociatedLabel(text, attrs, match.index, externalLabelNameIndex, referencedNameIndex)) {
      continue;
    }

    violations.push({
      file: fileLabel,
      line: lineNumberAt(lineStarts, match.index),
      control: controlName,
      message: 'Form control needs an accessible label'
    });
  }

  return violations;
}

function findViolations() {
  const violations = [];

  for (const filePath of walkFiles(frontendSrc)) {
    if (path.extname(filePath).toLowerCase() !== vueExtension) {
      continue;
    }

    const text = maskNonTemplateNoise(readSmallTextFile(filePath));
    if (!hasScannableControl(text)) {
      continue;
    }

    const lineStarts = buildLineStarts(text);
    const referencedNameIndex = buildReferencedNameIndex(text);
    const externalLabelNameIndex = buildExternalLabelNameIndex(text, referencedNameIndex);
    const fileLabel = relativePath(filePath);
    violations.push(...findButtonViolations(fileLabel, text, lineStarts, referencedNameIndex));
    violations.push(...findFormControlViolations(fileLabel, text, lineStarts, externalLabelNameIndex, referencedNameIndex));
  }

  return violations.sort((a, b) => compareDiagnosticText(a.file, b.file) || a.line - b.line || compareDiagnosticText(a.control, b.control));
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
