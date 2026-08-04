import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const auditPath = path.join(root, 'audit', 'full-content', 'catalog-content-audit.json');
const allowFindings = process.argv.includes('--allow-findings');

function fail(message) {
  throw new Error(message);
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
      filename: 'course-taxonomy.js',
      timeout: 1_000,
      contextCodeGeneration: { strings: false, wasm: false }
    }
  );
  return JSON.parse(serialized);
}

function displayTitle(legacyPath, metadata) {
  if (typeof metadata.title === 'string' && metadata.title.trim()) return metadata.title;
  return path.posix.basename(legacyPath).replace(/\.[^.]+$/, '');
}

function baseStyle(category) {
  if (category === 'Salsa Masterclass') return 'Salsa';
  if (category === 'Kizomba Masterclass') return 'Kizomba';
  return category;
}

if (!fs.existsSync(auditPath)) {
  fail('Missing audit/full-content/catalog-content-audit.json.');
}

const catalog = readCatalog();
const taxonomy = readTaxonomy();
const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
const records = audit.records;

if (audit.schemaVersion !== 1) fail('Content audit schemaVersion must be 1.');
if (!Array.isArray(records)) fail('Content audit records must be an array.');
if (audit.totalLessons !== records.length) {
  fail(`Content audit declares ${audit.totalLessons} lessons but contains ${records.length} records.`);
}

const expected = new Map(Object.entries(catalog).map(([legacyPath, metadata]) => {
  const courseFolder = legacyPath.split('/')[0];
  const assignedCategory = taxonomy.courseCategoryByFolder[courseFolder];
  if (!assignedCategory) fail(`Catalog course has no taxonomy entry: ${courseFolder}`);
  return [legacyPath, {
    expectedTitle: displayTitle(legacyPath, metadata),
    assignedCategory,
    courseFolder
  }];
}));

const seen = new Set();
const statuses = { confirmed: 0, mismatch: 0, ambiguous: 0 };
const resolutionStatuses = { verified: 0, corrected: 0, documented: 0, quarantined: 0 };
const categoryCounts = {};
const unresolved = [];

for (const [index, record] of records.entries()) {
  const where = `records[${index}]`;
  if (!record || typeof record !== 'object' || Array.isArray(record)) fail(`${where} must be an object.`);
  if (typeof record.legacyPath !== 'string' || !record.legacyPath) fail(`${where}.legacyPath must be a non-empty string.`);
  if (/^[A-Za-z]:[\\/]/.test(record.legacyPath) || record.legacyPath.startsWith('/')) {
    fail(`${where}.legacyPath must be catalog-relative, not an absolute machine path.`);
  }
  if (seen.has(record.legacyPath)) fail(`Duplicate content-audit record: ${record.legacyPath}`);
  seen.add(record.legacyPath);

  const catalogRecord = expected.get(record.legacyPath);
  if (!catalogRecord) fail(`Content audit contains an unknown path: ${record.legacyPath}`);
  if (record.expectedTitle !== catalogRecord.expectedTitle) {
    fail(`Expected title is stale for ${record.legacyPath}: ${JSON.stringify(record.expectedTitle)} != ${JSON.stringify(catalogRecord.expectedTitle)}`);
  }
  if (record.assignedCategory !== catalogRecord.assignedCategory) {
    fail(`Assigned category is stale for ${record.legacyPath}: ${record.assignedCategory} != ${catalogRecord.assignedCategory}`);
  }
  if (!Object.hasOwn(statuses, record.identityStatus)) {
    fail(`${where}.identityStatus must be confirmed, mismatch, or ambiguous.`);
  }
  statuses[record.identityStatus] += 1;

  if (!['high', 'medium', 'low'].includes(record.confidence)) {
    fail(`${where}.confidence must be high, medium, or low.`);
  }
  if (record.observedTitle !== null && (typeof record.observedTitle !== 'string' || !record.observedTitle.trim())) {
    fail(`${where}.observedTitle must be a non-empty string or null.`);
  }
  if (record.observedCategory !== null && (typeof record.observedCategory !== 'string' || !record.observedCategory.trim())) {
    fail(`${where}.observedCategory must be a non-empty string or null.`);
  }
  if (record.identityStatus === 'confirmed'
      && record.observedCategory
      && baseStyle(record.observedCategory) !== baseStyle(record.assignedCategory)) {
    fail(`Confirmed record has conflicting visual category evidence: ${record.legacyPath}`);
  }
  if (!Array.isArray(record.evidence) || record.evidence.length === 0) {
    fail(`${where}.evidence must contain at least one evidence item.`);
  }
  for (const [evidenceIndex, evidence] of record.evidence.entries()) {
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
      fail(`${where}.evidence[${evidenceIndex}] must be an object.`);
    }
    if (typeof evidence.method !== 'string' || !evidence.method.trim()) {
      fail(`${where}.evidence[${evidenceIndex}].method must be a non-empty string.`);
    }
    const serializedEvidence = JSON.stringify(evidence);
    if (/[A-Za-z]:[\\/]/.test(serializedEvidence)) {
      fail(`${where}.evidence[${evidenceIndex}] contains an absolute machine path.`);
    }
  }
  if (!Array.isArray(record.issues)) fail(`${where}.issues must be an array.`);
  if (!record.resolution || typeof record.resolution !== 'object' || Array.isArray(record.resolution)) {
    fail(`${where}.resolution must be an object.`);
  }
  if (!Object.hasOwn(resolutionStatuses, record.resolution.status)) {
    fail(`${where}.resolution.status must be verified, corrected, documented, or quarantined.`);
  }
  resolutionStatuses[record.resolution.status] += 1;
  if (typeof record.resolution.action !== 'string' || !record.resolution.action.trim()) {
    fail(`${where}.resolution.action must be a non-empty string.`);
  }
  if (record.identityStatus === 'confirmed' && record.resolution.status !== 'verified') {
    fail(`Confirmed record must have verified resolution: ${record.legacyPath}`);
  }
  if (record.identityStatus === 'ambiguous' && record.resolution.status !== 'documented') {
    unresolved.push(record.legacyPath);
  }
  if (record.identityStatus === 'mismatch' && !['corrected', 'quarantined'].includes(record.resolution.status)) {
    unresolved.push(record.legacyPath);
  }
  if (!record.evidence.some(evidence => evidence.method === 'direct-bunny-offline-frame-sequence-alignment')) {
    fail(`${where}.evidence does not include direct Bunny/offline frame-sequence alignment.`);
  }

  categoryCounts[record.assignedCategory] = (categoryCounts[record.assignedCategory] || 0) + 1;
}

const missing = [...expected.keys()].filter(legacyPath => !seen.has(legacyPath));
if (missing.length) fail(`Content audit is missing ${missing.length} catalog path(s), beginning with: ${missing.slice(0, 5).join(', ')}`);
if (seen.size !== expected.size) fail(`Content audit covers ${seen.size} paths; catalog contains ${expected.size}.`);

if (!allowFindings && unresolved.length) {
  fail(`Content audit has ${unresolved.length} unresolved finding(s), beginning with: ${unresolved.slice(0, 5).join(', ')}`);
}

console.log(`Content audit validated: ${seen.size}/${expected.size} lessons.`);
console.log(`Identity status: ${statuses.confirmed} confirmed, ${statuses.mismatch} mismatch, ${statuses.ambiguous} ambiguous.`);
console.log(`Resolution status: ${Object.entries(resolutionStatuses).map(([status, count]) => `${status} ${count}`).join(', ')}.`);
console.log(`Category coverage: ${Object.entries(categoryCounts).map(([category, count]) => `${category} ${count}`).join(' | ')}`);
