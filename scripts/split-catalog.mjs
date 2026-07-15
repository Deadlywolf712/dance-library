import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalogPath = path.join(root, 'data.js');
const summariesDirectory = path.join(root, 'summaries');

function evaluateCatalog(source) {
  const context = {};
  vm.createContext(context);
  vm.runInContext(
    `${source}\n;globalThis.__catalog = videoData; globalThis.__pullZone = BUNNY_PULL_ZONE;`,
    context,
    { filename: catalogPath }
  );
  return { catalog: context.__catalog, pullZone: context.__pullZone };
}

function evaluateSummaryChunk(filename) {
  const context = {};
  vm.createContext(context);
  vm.runInContext(
    `${fs.readFileSync(filename, 'utf8')}\n;globalThis.__summaries = globalThis.DanceLibrarySummaries;`,
    context,
    { filename }
  );
  return context.__summaries || {};
}

function chunkIdFor(folderName) {
  const readable = folderName
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 52) || 'lessons';
  const hash = crypto.createHash('sha256').update(folderName).digest('hex').slice(0, 8);
  return `${readable}-${hash}`;
}

if (!fs.existsSync(catalogPath)) throw new Error(`Missing catalog: ${catalogPath}`);

const originalSource = fs.readFileSync(catalogPath, 'utf8');
const { catalog, pullZone } = evaluateCatalog(originalSource);
const entries = Object.entries(catalog);
const summaries = new Map();

for (const [lessonPath, info] of entries) {
  if (typeof info.summary === 'string') summaries.set(lessonPath, info.summary);
}

// A second run starts from the compact catalog. Recover its summaries from the
// generated chunks so the command remains deterministic and safe to repeat.
if (summaries.size !== entries.length && fs.existsSync(summariesDirectory)) {
  const chunkIds = new Set(entries.map(([, info]) => info.summary_chunk).filter(Boolean));
  for (const chunkId of chunkIds) {
    const chunkPath = path.join(summariesDirectory, `${chunkId}.js`);
    if (!fs.existsSync(chunkPath)) continue;
    const registry = evaluateSummaryChunk(chunkPath);
    const chunk = registry[chunkId] || {};
    for (const [lessonPath, summary] of Object.entries(chunk)) {
      if (typeof summary === 'string') summaries.set(lessonPath, summary);
    }
  }
}

const missing = entries.map(([lessonPath]) => lessonPath).filter(lessonPath => !summaries.has(lessonPath));
if (missing.length) {
  throw new Error(`Refusing to split an incomplete catalog; ${missing.length} summaries are missing. First: ${missing[0]}`);
}

const groups = new Map();
for (const [lessonPath, info] of entries) {
  const folderName = lessonPath.split('/')[0] || 'Other';
  const chunkId = chunkIdFor(folderName);
  if (!groups.has(chunkId)) groups.set(chunkId, { chunkId, folderName, lessons: [] });
  groups.get(chunkId).lessons.push([lessonPath, info]);
}

fs.mkdirSync(summariesDirectory, { recursive: true });
const compactCatalog = {};
const manifest = { version: 1, lessonCount: entries.length, summaryCount: 0, chunks: [] };

for (const group of [...groups.values()].sort((a, b) => a.chunkId.localeCompare(b.chunkId))) {
  const chunk = {};
  for (const [lessonPath, info] of group.lessons.sort(([a], [b]) => a.localeCompare(b))) {
    chunk[lessonPath] = summaries.get(lessonPath);
    const { summary: _summary, summary_chunk: _oldChunk, ...metadata } = info;
    compactCatalog[lessonPath] = { ...metadata, summary_chunk: group.chunkId };
  }

  const chunkSource = [
    'globalThis.DanceLibrarySummaries = globalThis.DanceLibrarySummaries || {};',
    `globalThis.DanceLibrarySummaries[${JSON.stringify(group.chunkId)}] = ${JSON.stringify(chunk, null, 2)};`,
    ''
  ].join('\n');
  fs.writeFileSync(path.join(summariesDirectory, `${group.chunkId}.js`), chunkSource, 'utf8');
  manifest.summaryCount += group.lessons.length;
  manifest.chunks.push({
    id: group.chunkId,
    folder: group.folderName,
    lessons: group.lessons.length,
    file: `${group.chunkId}.js`
  });
}

const compactSource = [
  `const BUNNY_PULL_ZONE = ${JSON.stringify(pullZone)};`,
  `const videoData = ${JSON.stringify(compactCatalog, null, 2)};`,
  ''
].join('\n');
fs.writeFileSync(catalogPath, compactSource, 'utf8');
fs.writeFileSync(path.join(summariesDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

const compactBytes = Buffer.byteLength(compactSource);
const summaryBytes = manifest.chunks.reduce((total, chunk) => {
  return total + fs.statSync(path.join(summariesDirectory, chunk.file)).size;
}, 0);

console.log(`Split ${entries.length} lessons into ${manifest.chunks.length} lazy summary chunks.`);
console.log(`Initial catalog: ${compactBytes.toLocaleString()} bytes; lazy summaries: ${summaryBytes.toLocaleString()} bytes.`);
