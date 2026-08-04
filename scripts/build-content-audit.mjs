import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.join(root, 'audit', 'full-content', 'catalog-content-audit.json');
const partitionPaths = [
  path.join(root, 'audit', 'full-content', 'bachata_remaining.json'),
  path.join(root, 'audit', 'full-content', 'salsa_and_masterclass.json'),
  path.join(root, 'audit', 'full-content', 'zouk_kizomba.json')
];
const parityPath = path.join(root, 'audit', 'bunny-frame-parity-local.json');
const duplicatePath = path.join(root, 'audit', 'source-duplicate-audit-local.json');

function fail(message) {
  throw new Error(message);
}

function readJson(filename) {
  if (!fs.existsSync(filename)) fail(`Missing required audit input: ${path.relative(root, filename)}`);
  return JSON.parse(fs.readFileSync(filename, 'utf8'));
}

function readCatalog() {
  const source = fs.readFileSync(path.join(root, 'data.js'), 'utf8');
  const marker = 'const videoData = ';
  const start = source.indexOf(marker);
  if (start < 0) fail('data.js does not define videoData in the expected generated format.');
  const serialized = source.slice(start + marker.length).trim();
  if (!serialized.endsWith(';')) fail('data.js videoData assignment is not terminated.');
  return JSON.parse(serialized.slice(0, -1));
}

function readTaxonomy() {
  const filename = path.join(root, 'course-taxonomy.js');
  const source = fs.readFileSync(filename, 'utf8');
  const serialized = vm.runInNewContext(
    `${source}\n;JSON.stringify(COURSE_TAXONOMY);`,
    Object.create(null),
    {
      filename,
      timeout: 1_000,
      contextCodeGeneration: { strings: false, wasm: false }
    }
  );
  return JSON.parse(serialized);
}

function recordsFromPartition(filename) {
  const parsed = readJson(filename);
  const records = Array.isArray(parsed) ? parsed : parsed.records;
  if (!Array.isArray(records)) fail(`Audit partition has no records: ${path.relative(root, filename)}`);
  return records;
}

function displayTitle(legacyPath, metadata) {
  return typeof metadata.title === 'string' && metadata.title.trim()
    ? metadata.title
    : path.posix.basename(legacyPath).replace(/\.[^.]+$/, '');
}

function normalizedConfidence(value) {
  if (['high', 'medium', 'low'].includes(value)) return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value >= 0.9) return 'high';
    if (value >= 0.7) return 'medium';
    return 'low';
  }
  return 'medium';
}

function isWrongMedia(record) {
  const type = `${record.mismatchType || ''} ${record.confirmedMismatch?.type || ''}`.toLowerCase();
  return type.includes('media') || type.includes('asset') || type.includes('duplicate');
}

function resolutionFor(record) {
  if (isWrongMedia(record)) {
    return {
      status: 'quarantined',
      action: 'playback-disabled',
      details: 'The stable lesson record is preserved, but its duplicate media is unavailable until the correct source is recovered.'
    };
  }
  if (record.mismatchType === 'course-level-label') {
    return {
      status: 'corrected',
      action: 'course-display-alias',
      details: 'The source-confirmed level is presented through a display-only course alias; stable paths and IDs remain unchanged.'
    };
  }
  if (record.identityStatus === 'ambiguous') {
    return {
      status: 'documented',
      action: 'source-filename-retained',
      details: 'Course, instructor family, dance style, and distributed content were confirmed; no reliable exact title card was visible, so the source filename remains the display basis.'
    };
  }
  return { status: 'verified', action: 'none' };
}

const catalog = readCatalog();
const taxonomy = readTaxonomy();
const partitionRecords = partitionPaths.flatMap(recordsFromPartition);
const parity = readJson(parityPath);
const duplicates = readJson(duplicatePath);
const partitionByPath = new Map();
for (const record of partitionRecords) {
  if (!record?.legacyPath) fail('Partition record is missing legacyPath.');
  if (partitionByPath.has(record.legacyPath)) fail(`Duplicate partition path: ${record.legacyPath}`);
  partitionByPath.set(record.legacyPath, record);
}
const parityByPath = new Map((parity.records || []).map(record => [record.legacyPath, record]));

const catalogPaths = Object.keys(catalog);
if (partitionByPath.size !== catalogPaths.length || parityByPath.size !== catalogPaths.length) {
  fail(`Coverage mismatch: catalog ${catalogPaths.length}, content partitions ${partitionByPath.size}, Bunny parity ${parityByPath.size}.`);
}
if (parity.counts?.aligned !== catalogPaths.length || parity.counts?.review || parity.counts?.failed) {
  fail('Bunny frame parity is not a clean all-lesson alignment result.');
}
if (duplicates.counts?.fingerprinted !== catalogPaths.length || duplicates.counts?.failed) {
  fail('Source duplicate audit is incomplete or contains decode failures.');
}

const records = [];
for (const legacyPath of catalogPaths) {
  const metadata = catalog[legacyPath];
  const sourceRecord = partitionByPath.get(legacyPath);
  const parityRecord = parityByPath.get(legacyPath);
  if (!sourceRecord) fail(`Missing content record: ${legacyPath}`);
  if (!parityRecord || parityRecord.status !== 'aligned') fail(`Missing aligned Bunny evidence: ${legacyPath}`);
  const courseFolder = legacyPath.split('/')[0];
  const assignedCategory = taxonomy.courseCategoryByFolder[courseFolder];
  if (!assignedCategory) fail(`Missing course taxonomy: ${courseFolder}`);
  const evidence = Array.isArray(sourceRecord.evidence) ? structuredClone(sourceRecord.evidence) : [];
  evidence.push({
    method: 'direct-bunny-offline-frame-sequence-alignment',
    sampleTimeSeconds: parityRecord.best.sampleTimeSeconds,
    frameCount: parityRecord.best.comparedFrames,
    correlation: parityRecord.best.correlation,
    perceptualHashSimilarity: parityRecord.best.hashSimilarity,
    meanAbsoluteError: parityRecord.best.meanAbsoluteError,
    details: 'The Bunny 480p HLS segment and authoritative offline source aligned at the same media timestamp.'
  });

  const issues = Array.isArray(sourceRecord.issues)
    ? sourceRecord.issues.map(issue => typeof issue === 'string' ? issue : JSON.stringify(issue))
    : [];
  const expectedTitle = displayTitle(legacyPath, metadata);
  records.push({
    legacyPath,
    expectedTitle,
    previousDisplayTitle: sourceRecord.expectedTitle ?? null,
    recommendedDisplayTitle: sourceRecord.recommendedDisplayTitle ?? expectedTitle,
    assignedCategory,
    observedTitle: sourceRecord.observedTitle ?? null,
    observedCategory: sourceRecord.observedCategory ?? null,
    identityStatus: sourceRecord.identityStatus,
    confidence: normalizedConfidence(sourceRecord.confidence),
    differenceClass: sourceRecord.differenceClass || 'none',
    evidence,
    issues,
    resolution: resolutionFor(sourceRecord)
  });
}

const statusCounts = { confirmed: 0, mismatch: 0, ambiguous: 0 };
const resolutionCounts = {};
const categoryCounts = {};
const differenceClassCounts = {};
for (const record of records) {
  if (!Object.hasOwn(statusCounts, record.identityStatus)) fail(`Invalid identity status: ${record.identityStatus}`);
  statusCounts[record.identityStatus] += 1;
  resolutionCounts[record.resolution.status] = (resolutionCounts[record.resolution.status] || 0) + 1;
  categoryCounts[record.assignedCategory] = (categoryCounts[record.assignedCategory] || 0) + 1;
  differenceClassCounts[record.differenceClass] = (differenceClassCounts[record.differenceClass] || 0) + 1;
}

const titleCorrectionCount = records.filter(record => record.previousDisplayTitle !== record.expectedTitle).length;
const courseDisplayAliasCount = Object.keys(taxonomy.courseDisplayNameByFolder || {}).length;
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  totalLessons: records.length,
  claim: 'Every catalog lesson received direct perceptual source inspection and direct Bunny/offline frame-sequence alignment.',
  methodBoundary: 'This is a distributed identifying/content-frame audit, not an end-to-end watch of every minute or a spoken-word transcript.',
  summary: {
    identityStatusCounts: statusCounts,
    resolutionStatusCounts: resolutionCounts,
    assignedCategoryCounts: categoryCounts,
    differenceClassCounts,
    bunnyAligned: parity.counts.aligned,
    sourceVideosFingerprinted: duplicates.counts.fingerprinted,
    exactDuplicateGroups: duplicates.counts.exactDuplicateGroups,
    perceptualReviewPairs: duplicates.counts.perceptualReviewPairs,
    displayTitleCorrectionsApplied: titleCorrectionCount,
    courseDisplayAliasesApplied: courseDisplayAliasCount
  },
  records
};

const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (/[A-Za-z]:[\\/]/.test(serialized)) fail('Canonical content audit contains an absolute machine path.');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, serialized, 'utf8');
console.log(`Built ${path.relative(root, outputPath).replaceAll('\\', '/')} with ${records.length} records.`);
console.log(`Identity: ${Object.entries(statusCounts).map(([key, value]) => `${key} ${value}`).join(', ')}.`);
console.log(`Resolved: ${Object.entries(resolutionCounts).map(([key, value]) => `${key} ${value}`).join(', ')}.`);
console.log(`Applied display corrections: ${titleCorrectionCount} lesson titles and ${courseDisplayAliasCount} course aliases.`);
