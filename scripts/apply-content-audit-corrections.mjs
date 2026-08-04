import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const write = process.argv.includes('--write');
const catalogPath = path.join(root, 'data.js');
const reportPaths = [
  path.join(root, 'audit', 'full-content', 'bachata_remaining.json'),
  path.join(root, 'audit', 'full-content', 'salsa_and_masterclass.json'),
  path.join(root, 'audit', 'full-content', 'zouk_kizomba.json')
];

function fail(message) {
  throw new Error(message);
}

function readCatalog() {
  const source = fs.readFileSync(catalogPath, 'utf8');
  const pullZoneMatch = source.match(/^const BUNNY_PULL_ZONE = ("[^"]+");\r?\n/);
  const marker = 'const videoData = ';
  const start = source.indexOf(marker);
  if (!pullZoneMatch || start < 0) fail('data.js does not match the expected generated format.');
  const serialized = source.slice(start + marker.length).trim();
  if (!serialized.endsWith(';')) fail('data.js videoData assignment is not terminated.');
  return { pullZoneLiteral: pullZoneMatch[1], catalog: JSON.parse(serialized.slice(0, -1)) };
}

function recordsFromReport(filename) {
  if (!fs.existsSync(filename)) fail(`Missing audit partition: ${path.relative(root, filename)}`);
  const parsed = JSON.parse(fs.readFileSync(filename, 'utf8'));
  const records = Array.isArray(parsed) ? parsed : parsed.records;
  if (!Array.isArray(records)) fail(`Audit partition has no records array: ${path.relative(root, filename)}`);
  return records;
}

function filenameTitle(legacyPath) {
  return path.posix.basename(legacyPath).replace(/\.(?:mp4|mov|m4v)$/i, '');
}

function isWrongMedia(record) {
  const type = `${record.mismatchType || ''} ${record.confirmedMismatch?.type || ''}`.toLowerCase();
  return type.includes('media') || type.includes('asset') || type.includes('duplicate');
}

const { pullZoneLiteral, catalog } = readCatalog();
const allRecords = reportPaths.flatMap(recordsFromReport);
const recordByPath = new Map();
for (const record of allRecords) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) fail('Audit contains a non-object record.');
  if (typeof record.legacyPath !== 'string' || !record.legacyPath) fail('Audit record has no legacyPath.');
  if (recordByPath.has(record.legacyPath)) fail(`Duplicate audited path: ${record.legacyPath}`);
  recordByPath.set(record.legacyPath, record);
}

const catalogPaths = Object.keys(catalog);
const missing = catalogPaths.filter(legacyPath => !recordByPath.has(legacyPath));
const extra = [...recordByPath.keys()].filter(legacyPath => !Object.hasOwn(catalog, legacyPath));
if (missing.length || extra.length || recordByPath.size !== catalogPaths.length) {
  fail(`Audit coverage mismatch: ${recordByPath.size}/${catalogPaths.length}; missing ${missing.length}; extra ${extra.length}.`);
}

const changes = [];
const skippedWrongMedia = [];
for (const legacyPath of catalogPaths) {
  const metadata = catalog[legacyPath];
  const record = recordByPath.get(legacyPath);
  const recommendation = typeof record.recommendedDisplayTitle === 'string'
    ? record.recommendedDisplayTitle.trim()
    : '';
  if (!recommendation) continue;
  if (/[\r\n]/.test(recommendation)) fail(`Recommended title contains a line break: ${legacyPath}`);
  if (isWrongMedia(record)) {
    skippedWrongMedia.push(legacyPath);
    continue;
  }
  if (record.identityStatus !== 'confirmed' && record.mismatchType !== 'course-level-label') continue;

  const before = typeof metadata.title === 'string' && metadata.title.trim()
    ? metadata.title
    : filenameTitle(legacyPath);
  if (before === recommendation) continue;
  if (recommendation === filenameTitle(legacyPath)) delete metadata.title;
  else metadata.title = recommendation;
  changes.push({ legacyPath, before, after: recommendation, differenceClass: record.differenceClass || null });
}

const displayTitlesByFolder = new Map();
for (const [legacyPath, metadata] of Object.entries(catalog)) {
  const folder = legacyPath.slice(0, legacyPath.lastIndexOf('/'));
  const displayTitle = metadata.title || filenameTitle(legacyPath);
  const normalized = displayTitle.toLocaleLowerCase('en-US');
  const key = `${folder}\0${normalized}`;
  const existing = displayTitlesByFolder.get(key);
  if (existing) fail(`Display-title collision after correction: ${existing} and ${legacyPath}`);
  displayTitlesByFolder.set(key, legacyPath);
}

console.log(`Audit coverage: ${recordByPath.size}/${catalogPaths.length} lessons.`);
console.log(`Display-title changes: ${changes.length}.`);
console.log(`Wrong-media records deliberately not relabeled: ${skippedWrongMedia.length}.`);
for (const change of changes) console.log(`${change.legacyPath}: ${JSON.stringify(change.before)} -> ${JSON.stringify(change.after)}`);

if (write) {
  const output = `const BUNNY_PULL_ZONE = ${pullZoneLiteral};\nconst videoData = ${JSON.stringify(catalog, null, 2)};\n`;
  fs.writeFileSync(catalogPath, output, 'utf8');
  console.log('Updated data.js.');
} else {
  console.log('Dry run only. Pass --write to update data.js.');
}
