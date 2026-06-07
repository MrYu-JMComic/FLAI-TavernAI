import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const defaultProjectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = path.resolve(getOptionValue('--project-root') ?? defaultProjectRoot);
const reviewedFile = path.resolve(getOptionValue('--reviewed-file') ?? path.join(projectRoot, 'automation', 'reviewed-unreferenced-vue-components.json'));
const frontendSrc = path.join(projectRoot, 'frontend', 'src');
const componentsDir = path.join(frontendSrc, 'components');
const sourceExtensions = new Set(['.js', '.mjs', '.ts', '.tsx', '.jsx', '.vue']);
const regexSpecialChars = new Set(['\\', '^', '$', '+', '?', '.', '(', ')', '|', '{', '}', '[', ']']);

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

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(entryPath);
      continue;
    }
    if (entry.isFile()) {
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

function readJsonFile(filePath, fallback) {
  if (!existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function toKebabCase(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

function stripImportSuffix(value) {
  return value.split(/[?#]/, 1)[0];
}

function collectStringLiterals(text) {
  const literals = [];
  const literalPattern = /(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
  let match;
  while ((match = literalPattern.exec(text))) {
    const [, quote, literal] = match;
    if (quote === '`' && literal.includes('${')) {
      continue;
    }
    literals.push(literal.replace(/\\([\\'"`])/g, '$1'));
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

  for (const literal of collectStringLiterals(text)) {
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
  return [...walk(frontendSrc)]
    .filter((filePath) => sourceExtensions.has(path.extname(filePath).toLowerCase()))
    .map((filePath) => {
      const text = readSmallTextFile(filePath);
      return {
        filePath,
        relativePath: toPosixPath(path.relative(projectRoot, filePath)),
        text,
        ...collectComponentReferences(filePath, text)
      };
    });
}

function componentTokens(componentPath) {
  const basename = path.basename(componentPath, '.vue');
  const kebabName = toKebabCase(basename);
  const frontendRelative = toPosixPath(path.relative(frontendSrc, componentPath));
  const frontendRelativeWithoutExtension = frontendRelative.replace(/\.vue$/i, '');
  return [
    basename,
    `<${kebabName}`,
    `</${kebabName}`,
    `is="${kebabName}"`,
    `is='${kebabName}'`,
    `.component('${kebabName}'`,
    `.component("${kebabName}"`,
    frontendRelative,
    frontendRelativeWithoutExtension,
    `src/${frontendRelative}`,
    `src/${frontendRelativeWithoutExtension}`,
    `@/${frontendRelative}`,
    `@/${frontendRelativeWithoutExtension}`,
    `/src/${frontendRelative}`,
    `/src/${frontendRelativeWithoutExtension}`,
    `/${frontendRelative}`,
    `/${frontendRelativeWithoutExtension}`,
    `./${frontendRelative}`,
    `./${frontendRelativeWithoutExtension}`,
    `../${frontendRelative}`,
    `../${frontendRelativeWithoutExtension}`
  ];
}

function findComponentReferences(componentPath, sourceIndex) {
  const ownPath = path.resolve(componentPath);
  const ownPosixPath = toPosixPath(ownPath);
  const tokens = componentTokens(componentPath);
  return sourceIndex
    .filter((source) => path.resolve(source.filePath) !== ownPath)
    .filter((source) => (
      source.referencedComponentPaths.has(ownPath) ||
      source.referencedComponentGlobs.some((glob) => glob.test(ownPosixPath)) ||
      tokens.some((token) => source.text.includes(token))
    ))
    .map((source) => source.relativePath);
}

function loadReviewedComponents() {
  const data = readJsonFile(reviewedFile, { reviewed: [] });
  const reviewed = Array.isArray(data.reviewed) ? data.reviewed : [];
  return new Map(
    reviewed
      .filter((entry) => typeof entry?.file === 'string' && entry.file.trim())
      .map((entry) => [toPosixPath(entry.file.trim()), {
        file: toPosixPath(entry.file.trim()),
        status: String(entry.status || 'reviewed').trim() || 'reviewed',
        reason: String(entry.reason || '').trim(),
        report: String(entry.report || '').trim()
      }])
  );
}

const sourceIndex = buildSourceIndex();
const reviewedComponents = loadReviewedComponents();
const unreferencedComponents = [...walk(componentsDir)]
  .filter((filePath) => path.extname(filePath).toLowerCase() === '.vue')
  .map((filePath) => ({
    file: toPosixPath(path.relative(projectRoot, filePath)),
    name: path.basename(filePath, '.vue'),
    references: findComponentReferences(filePath, sourceIndex)
  }))
  .filter((component) => component.references.length === 0)
  .sort((a, b) => a.file.localeCompare(b.file));
const candidates = unreferencedComponents
  .filter((component) => !reviewedComponents.has(component.file));
const reviewed = unreferencedComponents
  .filter((component) => reviewedComponents.has(component.file))
  .map((component) => ({
    ...component,
    review: reviewedComponents.get(component.file)
  }));

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
