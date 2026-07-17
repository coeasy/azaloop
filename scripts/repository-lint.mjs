#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const issues = [];
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs', '.cjs']);
const javascriptExtensions = new Set(['.js', '.mjs', '.cjs']);
const ignoredDirectories = new Set(['node_modules', 'dist', '.git', '.aza', 'coverage']);

function relative(file) {
  return path.relative(root, file).replaceAll(path.sep, '/');
}

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(target));
    else files.push(target);
  }
  return files;
}

const packageSourceRoots = fs.existsSync(path.join(root, 'packages'))
  ? fs
      .readdirSync(path.join(root, 'packages'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, 'packages', entry.name, 'src'))
  : [];

const files = [
  ...packageSourceRoots.flatMap(walk),
  ...walk(path.join(root, 'tests')),
  ...walk(path.join(root, 'scripts')),
  ...walk(path.join(root, 'docs')),
  ...walk(path.join(root, '.github')),
  ...['README.md', 'README.en.md', 'package.json', 'pnpm-workspace.yaml']
    .map((file) => path.join(root, file))
    .filter((file) => fs.existsSync(file)),
];
const sourceFiles = files.filter((file) =>
  sourceExtensions.has(path.extname(file).toLowerCase()),
);

for (const file of files) {
  const extension = path.extname(file).toLowerCase();
  const content = fs.readFileSync(file, 'utf8');
  if (/^(<{7}|={7}|>{7})(?:\s|$)/m.test(content)) {
    issues.push(`${relative(file)}: unresolved merge-conflict marker`);
  }
  if (sourceFiles.includes(file) && javascriptExtensions.has(extension)) {
    const check = spawnSync(process.execPath, ['--check', file], {
      encoding: 'utf8',
      windowsHide: true,
    });
    if (check.status !== 0) {
      const detail = (check.stderr || check.stdout || 'syntax check failed')
        .trim()
        .split(/\r?\n/)
        .slice(-1)[0];
      issues.push(`${relative(file)}: ${detail}`);
    }
  }
}

const jsonFiles = [
  path.join(root, 'package.json'),
  path.join(root, 'tsconfig.base.json'),
  ...walk(path.join(root, 'packages')).filter(
    (file) =>
      !file.includes(`${path.sep}node_modules${path.sep}`) &&
      !file.includes(`${path.sep}dist${path.sep}`) &&
      (path.basename(file) === 'package.json' || path.basename(file) === 'tsconfig.json'),
  ),
];

for (const file of jsonFiles) {
  if (!fs.existsSync(file)) continue;
  try {
    JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    issues.push(`${relative(file)}: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
  }
}

if (issues.length > 0) {
  console.error(`Repository lint failed with ${issues.length} issue(s):`);
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log(
  `Repository lint passed: ${files.length} repository files (${sourceFiles.length} code files) and ${jsonFiles.length} JSON manifests checked.`,
);
