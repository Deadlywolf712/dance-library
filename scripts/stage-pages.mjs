import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OUTPUT = path.join(ROOT, '_site');

export const PUBLIC_FILES = Object.freeze([
  'index.html',
  'app.js',
  'data.js',
  'style.css',
  'playback-core.js',
  'salsa_course.js',
  'sw.js',
  'manifest.json',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  'og.png'
]);

const toPosix = value => value.split(path.sep).join('/');

export const listPublicFiles = () => {
  const manifestPath = path.join(ROOT, 'summaries', 'manifest.json');
  assertRegularFile(manifestPath, 'summaries/manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!Array.isArray(manifest.chunks) || !manifest.chunks.length) {
    throw new Error('Summary manifest must list at least one public chunk.');
  }

  const chunkFiles = manifest.chunks.map(chunk => {
    if (typeof chunk.file !== 'string' || path.basename(chunk.file) !== chunk.file || !/\.js$/i.test(chunk.file)) {
      throw new Error(`Unsafe summary chunk filename: ${String(chunk.file)}`);
    }
    return `summaries/${chunk.file}`;
  });
  if (new Set(chunkFiles).size !== chunkFiles.length) throw new Error('Summary manifest contains duplicate chunk files.');
  return [...PUBLIC_FILES, 'summaries/manifest.json', ...chunkFiles].sort();
};

const assertRegularFile = (absolutePath, relativePath) => {
  if (!fs.existsSync(absolutePath)) throw new Error(`Missing public asset: ${relativePath}`);
  const stat = fs.lstatSync(absolutePath);
  if (stat.isSymbolicLink()) throw new Error(`Public assets cannot be symbolic links: ${relativePath}`);
  if (!stat.isFile()) throw new Error(`Expected a regular public file: ${relativePath}`);
};

const copyFile = (relativePath, outputRoot) => {
  const source = path.join(ROOT, relativePath);
  const destination = path.join(outputRoot, relativePath);
  assertRegularFile(source, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
};

export const listFiles = directory => {
  const files = [];
  const visit = relativePath => {
    const absolutePath = path.join(directory, relativePath);
    const entries = fs.readdirSync(absolutePath, { withFileTypes: true })
      .sort((first, second) => first.name.localeCompare(second.name, 'en'));
    for (const entry of entries) {
      const child = path.join(relativePath, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Staged Pages output contains a symbolic link: ${toPosix(child)}`);
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile()) files.push(toPosix(child));
      else throw new Error(`Staged Pages output contains an unsupported entry: ${toPosix(child)}`);
    }
  };
  visit('');
  return files;
};

export const stagePages = () => {
  if (path.resolve(OUTPUT) !== path.join(ROOT, '_site')) {
    throw new Error('Refusing to stage Pages outside the repository _site directory.');
  }

  fs.rmSync(OUTPUT, { recursive: true, force: true });
  fs.mkdirSync(OUTPUT, { recursive: true });

  for (const relativePath of listPublicFiles()) copyFile(relativePath, OUTPUT);

  const stagedFiles = listFiles(OUTPUT);
  const digest = crypto.createHash('sha256');
  let bytes = 0;
  for (const relativePath of stagedFiles) {
    const content = fs.readFileSync(path.join(OUTPUT, relativePath));
    bytes += content.length;
    digest.update(relativePath);
    digest.update('\0');
    digest.update(content);
  }

  const sha256 = digest.digest('hex');
  console.log(`Staged ${stagedFiles.length} Pages files (${bytes} bytes, sha256 ${sha256}).`);
  return { bytes, files: stagedFiles, output: OUTPUT, sha256 };
};

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) stagePages();
