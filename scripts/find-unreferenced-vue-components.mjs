import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareDiagnosticText, escapeRegExp, getCliOptionValue, maskNonNewlineText, readJsonFile, readSmallTextFile, toPosixPath, walkFiles } from './diagnostic-file-utils.mjs';

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const defaultProjectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = path.resolve(getCliOptionValue(rawArgs, '--project-root') ?? defaultProjectRoot);
const reviewedFile = path.resolve(getCliOptionValue(rawArgs, '--reviewed-file') ?? path.join(projectRoot, 'automation', 'reviewed-unreferenced-vue-components.json'));
const frontendSrc = path.join(projectRoot, 'frontend', 'src');
const componentsDir = path.join(frontendSrc, 'components');
const sourceExtensions = new Set(['.js', '.mjs', '.ts', '.tsx', '.jsx', '.vue']);
const regexSpecialChars = new Set(['\\', '^', '$', '+', '?', '.', '(', ')', '|', '{', '}', '[', ']']);

function toKebabCase(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

function stripImportSuffix(value) {
  const text = String(value ?? '');
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '?' || char === '#') {
      return text.slice(0, index);
    }
  }
  return text;
}

function maskSourceComments(text) {
  let masked = '';
  let mode = 'code';
  let quote = '';
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (mode === 'lineComment') {
      if (char === '\r' || char === '\n') {
        masked += char;
        mode = 'code';
      } else {
        masked += ' ';
      }
      continue;
    }

    if (mode === 'blockComment') {
      if (char === '\r' || char === '\n') {
        masked += char;
      } else if (char === '*' && nextChar === '/') {
        masked += '  ';
        index += 1;
        mode = 'code';
      } else {
        masked += ' ';
      }
      continue;
    }

    if (mode === 'htmlComment') {
      if (char === '\r' || char === '\n') {
        masked += char;
      } else if (char === '-' && nextChar === '-' && text[index + 2] === '>') {
        masked += '   ';
        index += 2;
        mode = 'code';
      } else {
        masked += ' ';
      }
      continue;
    }

    if (mode === 'string') {
      masked += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        mode = 'code';
      }
      continue;
    }

    if (char === '<' && nextChar === '!' && text[index + 2] === '-' && text[index + 3] === '-') {
      masked += '    ';
      index += 3;
      mode = 'htmlComment';
      continue;
    }

    if (char === '/' && nextChar === '/') {
      masked += '  ';
      index += 1;
      mode = 'lineComment';
      continue;
    }

    if (char === '/' && nextChar === '*') {
      masked += '  ';
      index += 1;
      mode = 'blockComment';
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      masked += char;
      quote = char;
      escaped = false;
      mode = 'string';
      continue;
    }

    masked += char;
  }

  return masked;
}

function collectStringLiteralRanges(text) {
  const ranges = [];
  let quote = '';
  let escaped = false;
  let start = -1;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        ranges.push([start, index + 1]);
        quote = '';
        start = -1;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      escaped = false;
      start = index;
    }
  }

  if (quote) {
    ranges.push([start, text.length]);
  }

  return ranges;
}

function createRangeMembershipChecker(ranges) {
  let rangeIndex = 0;

  return (index) => {
    while (rangeIndex < ranges.length && ranges[rangeIndex][1] <= index) {
      rangeIndex += 1;
    }

    const range = ranges[rangeIndex];
    return Boolean(range && index >= range[0]);
  };
}

function collectRegexLiteralRanges(text, stringLiteralRanges = []) {
  const ranges = [];
  let stringRangeIndex = 0;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    while (stringRangeIndex < stringLiteralRanges.length && stringLiteralRanges[stringRangeIndex][1] <= index) {
      stringRangeIndex += 1;
    }

    const stringRange = stringLiteralRanges[stringRangeIndex];
    if (stringRange && index >= stringRange[0]) {
      index = stringRange[1] - 1;
      continue;
    }

    if (char !== '/' || nextChar === '/' || nextChar === '*' || !canStartRegexLiteral(text, index)) {
      continue;
    }

    const start = index;
    index += 1;
    let escaped = false;
    let inCharacterClass = false;
    for (; index < text.length; index += 1) {
      const regexChar = text[index];
      if (regexChar === '\r' || regexChar === '\n') {
        break;
      }
      if (escaped) {
        escaped = false;
        continue;
      }
      if (regexChar === '\\') {
        escaped = true;
        continue;
      }
      if (regexChar === '[') {
        inCharacterClass = true;
        continue;
      }
      if (regexChar === ']') {
        inCharacterClass = false;
        continue;
      }
      if (regexChar === '/' && !inCharacterClass) {
        while (/[a-z]/i.test(text[index + 1] || '')) {
          index += 1;
        }
        ranges.push([start, index + 1]);
        break;
      }
    }
  }

  return ranges;
}

function unescapeQuotedLiteral(literal) {
  return literal.replace(/\\([\\'"`])/g, '$1');
}

function maskStringLiterals(text) {
  let masked = '';
  let mode = 'code';
  let quote = '';
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (mode === 'string') {
      if (char === '\r' || char === '\n') {
        masked += char;
        continue;
      }
      masked += char === quote ? char : ' ';
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        mode = 'code';
      }
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      masked += char;
      quote = char;
      escaped = false;
      mode = 'string';
      continue;
    }

    masked += char;
  }

  return masked;
}

function previousCodeToken(text, index) {
  let end = index - 1;
  while (end >= 0 && /\s/.test(text[end])) {
    end -= 1;
  }
  if (end < 0) {
    return '';
  }

  let start = end;
  while (start >= 0 && !/\s/.test(text[start])) {
    start -= 1;
  }
  return text.slice(start + 1, end + 1);
}

function canStartRegexLiteral(text, index) {
  const token = previousCodeToken(text, index);
  if (!token) {
    return true;
  }

  if (/[({[=,:;!?&|+\-*%^~<>]$/.test(token)) {
    return true;
  }

  return /\b(?:return|throw|case|delete|typeof|void|new|in|of|yield|await)$/.test(token);
}

function maskRegexLiterals(text) {
  let masked = '';

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char !== '/' || nextChar === '/' || nextChar === '*' || !canStartRegexLiteral(masked, index)) {
      masked += char;
      continue;
    }

    masked += '/';
    index += 1;
    let escaped = false;
    let inCharacterClass = false;
    for (; index < text.length; index += 1) {
      const regexChar = text[index];
      if (regexChar === '\r' || regexChar === '\n') {
        masked += regexChar;
        break;
      }
      if (escaped) {
        masked += ' ';
        escaped = false;
        continue;
      }
      if (regexChar === '\\') {
        masked += ' ';
        escaped = true;
        continue;
      }
      if (regexChar === '[') {
        masked += ' ';
        inCharacterClass = true;
        continue;
      }
      if (regexChar === ']') {
        masked += ' ';
        inCharacterClass = false;
        continue;
      }
      if (regexChar === '/' && !inCharacterClass) {
        masked += '/';
        while (/[a-z]/i.test(text[index + 1] || '')) {
          index += 1;
          masked += ' ';
        }
        break;
      }
      masked += ' ';
    }
  }

  return masked;
}

function maskVueScriptAndStyleBlocks(text) {
  return text.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, (block) => maskNonNewlineText(block));
}

function isComponentIsAttributeName(name) {
  return ['is', ':is', 'v-bind:is'].includes(name.toLowerCase());
}

function maskVueAttributeValueNoise(text, { preserveComponentIsAttributes = false } = {}) {
  return text.replace(/([:@\w-]+)\s*=\s*(['"])((?:\\.|(?!\2)[\s\S])*?)\2/g, (match, name, quote, value) => {
    if (preserveComponentIsAttributes && isComponentIsAttributeName(name)) {
      return match;
    }

    const valueStart = match.indexOf(value, match.indexOf(quote) + 1);
    return `${match.slice(0, valueStart)}${maskNonNewlineText(value)}${match.slice(valueStart + value.length)}`;
  });
}

function maskComponentTokenSearchText(filePath, text) {
  if (path.extname(filePath).toLowerCase() === '.vue') {
    return maskVueAttributeValueNoise(maskVueScriptAndStyleBlocks(text));
  }
  return maskRegexLiterals(maskStringLiterals(text));
}

function maskComponentIsAttributeSearchText(filePath, text) {
  if (path.extname(filePath).toLowerCase() === '.vue') {
    return maskVueAttributeValueNoise(maskVueScriptAndStyleBlocks(text), {
      preserveComponentIsAttributes: true
    });
  }
  return maskRegexLiterals(maskStringLiterals(text));
}

function collectComponentReferenceLiterals(text) {
  const literals = [];
  const stringLiteralRanges = collectStringLiteralRanges(text);
  const regexLiteralRanges = collectRegexLiteralRanges(text, stringLiteralRanges);
  const referencePatterns = [
    /\bimport(?![\w$])\s+(?:[^'"`]*?\s+from\s*)?(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g,
    /\bexport(?![\w$])\s+[^'"`]*?\s+from\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g,
    /\bimport(?![\w$])\s*\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g,
    /\bimport\.meta\.glob(?:Eager)?\s*\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g
  ];

  for (const pattern of referencePatterns) {
    const isInsideStringLiteral = createRangeMembershipChecker(stringLiteralRanges);
    const isInsideRegexLiteral = createRangeMembershipChecker(regexLiteralRanges);
    let match;
    while ((match = pattern.exec(text))) {
      if (
        isInsideStringLiteral(match.index) ||
        isInsideRegexLiteral(match.index)
      ) {
        continue;
      }
      const [, quote, literal] = match;
      if (quote === '`' && literal.includes('${')) {
        continue;
      }
      literals.push(unescapeQuotedLiteral(literal));
    }
  }

  return literals;
}

function resolveSourcePath(reference, sourceFilePath) {
  const cleanReference = stripImportSuffix(reference).replaceAll('\\', '/');
  if (!cleanReference) {
    return null;
  }

  if (cleanReference.startsWith('@/')) {
    return path.join(frontendSrc, cleanReference.slice(2));
  }
  if (cleanReference.startsWith('/src/')) {
    return path.join(frontendSrc, cleanReference.slice('/src/'.length));
  }
  if (cleanReference.startsWith('src/')) {
    return path.join(projectRoot, 'frontend', cleanReference);
  }
  if (cleanReference.startsWith('./') || cleanReference.startsWith('../')) {
    return path.resolve(path.dirname(sourceFilePath), cleanReference);
  }

  return null;
}

function resolveComponentReference(reference, sourceFilePath) {
  const resolvedPath = resolveSourcePath(reference, sourceFilePath);
  if (!resolvedPath) {
    return null;
  }

  const extension = path.extname(resolvedPath).toLowerCase();
  if (extension === '.vue') {
    return path.resolve(resolvedPath);
  }
  if (!extension) {
    return path.resolve(`${resolvedPath}.vue`);
  }
  return null;
}

function escapeRegexChar(char) {
  return regexSpecialChars.has(char) ? `\\${char}` : char;
}

function globToRegExp(pattern) {
  let source = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '*') {
      if (pattern[index + 1] === '*') {
        if (pattern[index + 2] === '/') {
          source += '(?:.*/)?';
          index += 2;
        } else {
          source += '.*';
          index += 1;
        }
      } else {
        source += '[^/]*';
      }
      continue;
    }

    source += char === '?' ? '[^/]' : escapeRegexChar(char);
  }
  source += '$';
  return new RegExp(source);
}

function resolveComponentGlob(reference, sourceFilePath) {
  if (!reference.includes('*') || !reference.toLowerCase().includes('.vue')) {
    return null;
  }

  const resolvedPattern = resolveSourcePath(reference, sourceFilePath);
  return resolvedPattern ? globToRegExp(toPosixPath(path.resolve(resolvedPattern))) : null;
}

function collectComponentReferences(filePath, text) {
  const referencedComponentPaths = new Set();
  const referencedComponentGlobs = [];

  for (const literal of collectComponentReferenceLiterals(text)) {
    const resolvedReference = resolveComponentReference(literal, filePath);
    if (resolvedReference) {
      referencedComponentPaths.add(resolvedReference);
    }

    const resolvedGlob = resolveComponentGlob(literal, filePath);
    if (resolvedGlob) {
      referencedComponentGlobs.push(resolvedGlob);
    }
  }

  return { referencedComponentPaths, referencedComponentGlobs };
}

function buildSourceIndex() {
  const sources = [];

  for (const filePath of walkFiles(frontendSrc)) {
    if (!sourceExtensions.has(path.extname(filePath).toLowerCase())) {
      continue;
    }

    const text = readSmallTextFile(filePath);
    const searchText = maskSourceComments(text);
    const tokenSearchText = maskComponentTokenSearchText(filePath, searchText);
    sources.push({
      resolvedPath: path.resolve(filePath),
      relativePath: toPosixPath(path.relative(projectRoot, filePath)),
      searchText,
      tokenSearchText,
      isAttributeSearchText: maskComponentIsAttributeSearchText(filePath, searchText),
      ...collectComponentReferences(filePath, searchText)
    });
  }

  return sources;
}

function componentLookupNames(componentPath) {
  const basename = path.basename(componentPath, '.vue');
  const kebabName = toKebabCase(basename);
  return basename === kebabName ? [basename] : [basename, kebabName];
}

function componentTagPatterns(lookupNames) {
  const patterns = [];

  for (const name of lookupNames) {
    const escapedName = escapeRegExp(name);
    patterns.push(
      new RegExp(`<\\s*${escapedName}(?=$|[\\s>/])`),
      new RegExp(`<\\/\\s*${escapedName}(?=$|[\\s>])`)
    );
  }

  return patterns;
}

function componentIsAttributePatterns(lookupNames) {
  const patterns = [];

  for (const name of lookupNames) {
    const escapedName = escapeRegExp(name);
    const quotedName = `["']${escapedName}["']`;
    const staticValuePattern = `(?:${escapedName}|${quotedName}|"${quotedName}"|'${quotedName}')`;
    const boundStringValuePattern = `(?:"${quotedName}"|'${quotedName}')`;
    const componentTagPrefix = '<\\s*component(?=$|[\\s>/])[^>]*';
    patterns.push(
      new RegExp(`${componentTagPrefix}\\sis\\s*=\\s*${staticValuePattern}(?=$|[\\s>/])`),
      new RegExp(`${componentTagPrefix}\\s(?::is|v-bind:is)\\s*=\\s*${boundStringValuePattern}(?=$|[\\s>/])`)
    );
  }

  return patterns;
}

function findComponentReferences(componentPath, sourceIndex) {
  const ownPath = path.resolve(componentPath);
  const ownPosixPath = toPosixPath(ownPath);
  const lookupNames = componentLookupNames(componentPath);
  const tagPatterns = componentTagPatterns(lookupNames);
  const isAttributePatterns = componentIsAttributePatterns(lookupNames);

  const references = [];
  for (const source of sourceIndex) {
    if (source.resolvedPath === ownPath) {
      continue;
    }

    if (
      source.referencedComponentPaths.has(ownPath) ||
      source.referencedComponentGlobs.some((glob) => glob.test(ownPosixPath)) ||
      tagPatterns.some((pattern) => pattern.test(source.tokenSearchText)) ||
      isAttributePatterns.some((pattern) => pattern.test(source.isAttributeSearchText))
    ) {
      references.push(source.relativePath);
    }
  }

  return references;
}

function loadReviewedComponents() {
  const data = readJsonFile(reviewedFile, { reviewed: [] });
  const reviewed = Array.isArray(data.reviewed) ? data.reviewed : [];
  const reviewedComponents = new Map();

  for (const entry of reviewed) {
    if (typeof entry?.file !== 'string' || !entry.file.trim()) {
      continue;
    }

    const file = toPosixPath(entry.file.trim());
    reviewedComponents.set(file, {
      file,
      status: String(entry.status || 'reviewed').trim() || 'reviewed',
      reason: String(entry.reason || '').trim(),
      report: String(entry.report || '').trim()
    });
  }

  return reviewedComponents;
}

function collectUnreferencedComponents(sourceIndex) {
  const components = [];

  for (const filePath of walkFiles(componentsDir)) {
    if (path.extname(filePath).toLowerCase() !== '.vue') {
      continue;
    }

    const references = findComponentReferences(filePath, sourceIndex);
    if (references.length) {
      continue;
    }

    components.push({
      file: toPosixPath(path.relative(projectRoot, filePath)),
      name: path.basename(filePath, '.vue'),
      references
    });
  }

  return components.sort((a, b) => compareDiagnosticText(a.file, b.file));
}

function splitReviewedComponents(components, reviewedComponents) {
  const candidates = [];
  const reviewed = [];

  for (const component of components) {
    if (reviewedComponents.has(component.file)) {
      reviewed.push({
        ...component,
        review: reviewedComponents.get(component.file)
      });
      continue;
    }

    candidates.push(component);
  }

  return { candidates, reviewed };
}

const sourceIndex = buildSourceIndex();
const reviewedComponents = loadReviewedComponents();
const unreferencedComponents = collectUnreferencedComponents(sourceIndex);
const { candidates, reviewed } = splitReviewedComponents(unreferencedComponents, reviewedComponents);

if (args.has('--json')) {
  console.log(JSON.stringify({ candidates, reviewed }, null, 2));
} else if (candidates.length) {
  console.log(`Potentially unreferenced Vue components: ${candidates.length}`);
  for (const candidate of candidates) {
    console.log(`- ${candidate.file}`);
  }
  if (reviewed.length) {
    console.log(`\nReviewed dormant Vue components: ${reviewed.length}`);
    for (const component of reviewed) {
      console.log(`- ${component.file} (${component.review.status})`);
    }
  }
  console.log('\nReview these before deleting; dynamic imports or planned feature wiring may not be visible to this static scan.');
} else {
  console.log('No unreviewed potentially unreferenced Vue components found.');
  if (reviewed.length) {
    console.log(`Reviewed dormant Vue components: ${reviewed.length}`);
    for (const component of reviewed) {
      console.log(`- ${component.file} (${component.review.status})`);
    }
  }
}

if (args.has('--fail-on-candidates') && candidates.length) {
  process.exit(1);
}
