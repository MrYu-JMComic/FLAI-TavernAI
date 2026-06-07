#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportsDir = path.join(projectRoot, 'automation', 'reports');
const archiveDir = path.join(reportsDir, 'archive');
const reportNamePattern = /^(\d{4}-\d{2}-\d{2})-.+\.md$/;

function usage() {
  return [
    'Usage: node scripts/archive-markdown-reports.mjs [--date YYYY-MM-DD] [--all] [--dry-run] [--exclude FILE]',
    '',
    'Archives top-level automation/reports/YYYY-MM-DD-*.md files into',
    'automation/reports/archive/daily-reports-YYYY-MM-DD.md.',
    '',
    'Options:',
    '  --date YYYY-MM-DD  Archive only one date. Can be repeated.',
    '  --all              Archive every dated top-level report.',
    '  --dry-run          Print candidates without writing or deleting files.',
    '  --exclude FILE     Leave this top-level report untouched. Can be repeated.'
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    all: false,
    dates: new Set(),
    dryRun: false,
    excludes: new Set()
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--all') {
      options.all = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--date') {
      const value = argv[index + 1];
      if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new Error('--date requires a YYYY-MM-DD value');
      }
      options.dates.add(value);
      index += 1;
    } else if (arg === '--exclude') {
      const value = argv[index + 1];
      if (!value || value.includes('/') || value.includes('\\')) {
        throw new Error('--exclude requires a top-level report filename');
      }
      options.excludes.add(value);
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.all && options.dates.size === 0) {
    throw new Error('Pass --all or at least one --date value');
  }

  return options;
}

function assertInside(parent, child) {
  const relative = path.relative(parent, child);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing path outside ${parent}: ${child}`);
  }
}

function getCreatedDate() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en', {
      day: '2-digit',
      month: '2-digit',
      timeZone: 'Asia/Shanghai',
      year: 'numeric'
    }).formatToParts(new Date()).map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function readArchiveText(date) {
  const archivePath = path.join(archiveDir, `daily-reports-${date}.md`);
  if (existsSync(archivePath)) {
    return readFileSync(archivePath, 'utf8').replace(/\r\n/g, '\n');
  }

  return [
    `# Daily Report Archive - ${date}`,
    '',
    `Created: ${getCreatedDate()}`,
    '',
    'This archive consolidates 0 top-level Markdown reports from `automation/reports` into one dated file. Original report content is preserved below so the top-level report directory can stay readable.',
    '',
    '## Archived Files',
    '',
    '## Contents',
    ''
  ].join('\n');
}

function getArchiveList(text) {
  const match = text.match(/## Archived Files\n\n([\s\S]*?)\n## Contents/);
  if (!match) {
    throw new Error('Could not find archive file list');
  }

  return [...match[1].matchAll(/^- `([^`]+)`$/gm)].map((item) => item[1]);
}

function getArchivedSections(text) {
  const sections = new Map();
  const sectionPattern = /(?:^|\n)---\n\n### `([^`]+)`\n\n([\s\S]*?)(?=\n\n---\n\n### `|\s*$)/g;

  for (const match of text.matchAll(sectionPattern)) {
    sections.set(match[1], match[2].trimEnd());
  }

  return sections;
}

function replaceArchiveList(text, names) {
  const list = names.map((name) => `- \`${name}\``).join('\n');
  const withList = text.replace(
    /(## Archived Files\n\n)([\s\S]*?)(\n## Contents)/,
    (_match, start, _oldList, end) => `${start}${list}\n${end}`
  );
  return withList.replace(
    /consolidates \d+ top-level Markdown reports/,
    `consolidates ${names.length} top-level Markdown reports`
  );
}

function getCandidates(options) {
  const candidates = [];
  for (const entry of readdirSync(reportsDir, { withFileTypes: true })) {
    if (!entry.isFile() || options.excludes.has(entry.name)) {
      continue;
    }

    const match = entry.name.match(reportNamePattern);
    if (!match) {
      continue;
    }

    const date = match[1];
    if (!options.all && !options.dates.has(date)) {
      continue;
    }

    const filePath = path.join(reportsDir, entry.name);
    assertInside(reportsDir, filePath);
    if (statSync(filePath).size > 1024 * 1024) {
      throw new Error(`Report is unexpectedly large: ${entry.name}`);
    }

    candidates.push({
      date,
      name: entry.name,
      path: filePath
    });
  }

  return candidates.sort((left, right) => left.name.localeCompare(right.name));
}

function groupByDate(candidates) {
  const groups = new Map();
  for (const candidate of candidates) {
    if (!groups.has(candidate.date)) {
      groups.set(candidate.date, []);
    }
    groups.get(candidate.date).push(candidate);
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function archiveGroup(date, files) {
  const archivePath = path.join(archiveDir, `daily-reports-${date}.md`);
  assertInside(reportsDir, archivePath);

  const archiveText = readArchiveText(date);
  const existingNames = new Set(getArchiveList(archiveText));
  const existingSections = getArchivedSections(archiveText);
  const newSections = [];
  const deleted = [];

  for (const file of files) {
    const text = readFileSync(file.path, 'utf8').replace(/\r\n/g, '\n').trimEnd();
    if (existingNames.has(file.name)) {
      const existingText = existingSections.get(file.name);
      if (existingText !== text) {
        throw new Error(`Archive already contains different content for ${file.name}`);
      }
      deleted.push(file);
      continue;
    }

    existingNames.add(file.name);
    newSections.push({ name: file.name, text });
    deleted.push(file);
  }

  const names = [...existingNames].sort((left, right) => left.localeCompare(right));
  let nextText = replaceArchiveList(archiveText, names);
  for (const section of newSections) {
    nextText += `\n\n---\n\n### \`${section.name}\`\n\n${section.text}\n`;
  }

  mkdirSync(archiveDir, { recursive: true });
  writeFileSync(archivePath, nextText, 'utf8');
  for (const file of deleted) {
    rmSync(file.path);
  }

  return {
    archive: path.relative(projectRoot, archivePath).replaceAll(path.sep, '/'),
    archived: newSections.map((section) => section.name),
    removedDuplicateTopLevel: deleted.length - newSections.length,
    totalArchivedForDate: names.length
  };
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const candidates = getCandidates(options);
    const groups = groupByDate(candidates);

    if (options.dryRun) {
      console.log(JSON.stringify({
        dryRun: true,
        candidates: Object.fromEntries(groups.map(([date, files]) => [date, files.map((file) => file.name)]))
      }, null, 2));
      return;
    }

    const results = groups.map(([date, files]) => archiveGroup(date, files));
    console.log(JSON.stringify({ archivedDates: results }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error('');
    console.error(usage());
    process.exit(1);
  }
}

main();
