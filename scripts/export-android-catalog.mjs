import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalogPath = path.join(root, 'data.js');
const manifestPath = path.join(root, 'summaries', 'manifest.json');
const outputPath = path.join(root, 'android', 'app', 'src', 'main', 'assets', 'catalog.json');

const EXPECTED_LESSONS = 795;
const EXPECTED_CHUNKS = 34;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VIDEO_EXTENSION_RE = /\.(mp4|mov|m4v)$/i;
const SUMMARY_CHUNK_RE = /^[a-z0-9-]+$/;
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

const CATEGORY_ORDER = [
  { id: 'salsa', title: 'Salsa' },
  { id: 'bachata', title: 'Bachata' },
  { id: 'zouk', title: 'Zouk' },
  { id: 'kizomba', title: 'Kizomba' },
  { id: 'salsa-masterclass', title: 'Salsa Masterclass' },
  { id: 'kizomba-masterclass', title: 'Kizomba Masterclass' },
  { id: 'other', title: 'Other' }
];

// Keep this evaluation order aligned with parseDataToTree() in app.js.
const CATEGORY_RULES = [
  ['salsa-masterclass', ['salsa masterclass']],
  ['kizomba-masterclass', ['kizomba masterclass']],
  ['salsa', ['adolfo', 'fernando', 'carolina', 'marco']],
  ['bachata', ['alex', 'desiree', 'korke', 'pablo', 'kike']],
  ['zouk', ['arthur', 'oksana']],
  ['kizomba', ['isabelle']]
];

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function findEncodingHazard(value) {
  if (value.includes('\uFFFD')) return 'Unicode replacement character (U+FFFD)';

  // Common forms of UTF-8 text decoded once as Latin-1 or Windows-1252.
  const mojibake = value.match(
    /(?:\u00c3[\u0080-\u00bf]|\u00c2[\u0080-\u00bf]|\u00e2(?:\u0080[\u0080-\u00bf]|\u20ac[\u0080-\u00ff\u2018-\u2026]))/u
  );
  return mojibake ? `probable mojibake near ${JSON.stringify(mojibake[0])}` : '';
}

function readUtf8Strict(filename) {
  let source;
  try {
    source = utf8Decoder.decode(fs.readFileSync(filename));
  } catch (error) {
    fail(`${path.relative(root, filename)} is not valid UTF-8: ${error.message}`);
  }

  const hazard = findEncodingHazard(source);
  if (hazard) fail(`${path.relative(root, filename)} contains ${hazard}.`);
  return source;
}

function canonicalSourceForHash(source) {
  return source.replace(/\r\n?/g, '\n');
}

function parseJson(filename) {
  const source = readUtf8Strict(filename);
  try {
    return JSON.parse(source);
  } catch (error) {
    fail(`${path.relative(root, filename)} is not valid JSON: ${error.message}`);
  }
}

function parseWebCatalog(source) {
  const hostMatch = source.match(/^const BUNNY_PULL_ZONE = ("(?:[^"\\]|\\.)*");\s*$/m);
  assert(hostMatch, 'data.js does not contain a JSON-string BUNNY_PULL_ZONE assignment.');

  const marker = 'const videoData = ';
  const markerIndex = source.indexOf(marker);
  assert(markerIndex >= 0, 'data.js does not contain videoData.');
  assert(source.indexOf(marker, markerIndex + marker.length) < 0, 'data.js contains multiple videoData assignments.');

  const tail = source.slice(markerIndex + marker.length).trim();
  assert(tail.endsWith(';'), 'data.js videoData assignment must end with a semicolon.');
  const jsonText = tail.slice(0, -1).trim();

  let pullZoneHost;
  let lessons;
  try {
    pullZoneHost = JSON.parse(hostMatch[1]);
    lessons = JSON.parse(jsonText);
  } catch (error) {
    fail(`data.js generated JSON could not be parsed: ${error.message}`);
  }

  assert(/^[a-z0-9.-]+$/i.test(pullZoneHost), `Unsafe Bunny pull-zone host: ${pullZoneHost}`);
  assert(lessons && typeof lessons === 'object' && !Array.isArray(lessons), 'videoData must be an object.');
  return { pullZoneHost, lessons };
}

function parseSummaryChunk(filename, expectedChunkId) {
  const source = readUtf8Strict(filename);
  const assignment = source.match(
    /globalThis\.DanceLibrarySummaries\[("(?:[^"\\]|\\.)*")\]\s*=\s*([\s\S]+);\s*$/
  );
  assert(assignment, `${path.relative(root, filename)} is not a generated summary chunk.`);

  let chunkId;
  let summaries;
  try {
    chunkId = JSON.parse(assignment[1]);
    summaries = JSON.parse(assignment[2]);
  } catch (error) {
    fail(`${path.relative(root, filename)} contains invalid generated JSON: ${error.message}`);
  }

  assert(chunkId === expectedChunkId, `${path.relative(root, filename)} registered ${chunkId}, expected ${expectedChunkId}.`);
  assert(summaries && typeof summaries === 'object' && !Array.isArray(summaries), `${chunkId} must contain a summary object.`);
  return { source, summaries };
}

function normalizedSearchText(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function deriveCategoryId(topFolder) {
  const normalized = normalizedSearchText(topFolder);
  for (const [categoryId, keywords] of CATEGORY_RULES) {
    if (keywords.some(keyword => normalized.includes(keyword))) return categoryId;
  }
  return 'other';
}

function naturalTokens(value) {
  return normalizedSearchText(value).match(/\d+|\D+/g) || [];
}

function compareCodePoints(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareNatural(left, right) {
  const leftTokens = naturalTokens(left);
  const rightTokens = naturalTokens(right);
  const count = Math.min(leftTokens.length, rightTokens.length);

  for (let index = 0; index < count; index += 1) {
    const a = leftTokens[index];
    const b = rightTokens[index];
    const aNumber = /^\d+$/.test(a);
    const bNumber = /^\d+$/.test(b);

    if (aNumber && bNumber) {
      const numericDifference = BigInt(a) - BigInt(b);
      if (numericDifference !== 0n) return numericDifference < 0n ? -1 : 1;
      if (a.length !== b.length) return a.length - b.length;
    } else {
      const lexical = compareCodePoints(a, b);
      if (lexical) return lexical;
    }
  }

  if (leftTokens.length !== rightTokens.length) return leftTokens.length - rightTokens.length;
  return compareCodePoints(String(left), String(right));
}

function parseSummary(rawMarkdown, legacyPath) {
  assert(typeof rawMarkdown === 'string' && rawMarkdown.trim(), `Summary is empty: ${legacyPath}`);
  const introParagraphs = [];
  const chapters = [];
  const lines = rawMarkdown.split(/\r?\n/).map(line => line.trim()).filter(Boolean);

  for (const rawLine of lines) {
    const timestamp = rawLine.match(/\[(\d{1,2}):(\d{2})\]/);
    const timestampLike = rawLine.match(/\[(\d+):(\d+)\]/);

    if (!timestamp) {
      if (timestampLike) fail(`Unsupported timestamp ${timestampLike[0]} in ${legacyPath}.`);
      introParagraphs.push(rawLine.replace(/^\s*-\s*/, ''));
      continue;
    }

    const minutes = Number(timestamp[1]);
    const seconds = Number(timestamp[2]);
    assert(Number.isInteger(minutes) && Number.isInteger(seconds) && seconds <= 59, `Invalid timestamp ${timestamp[0]} in ${legacyPath}.`);

    let remainder = rawLine.slice(timestamp.index + timestamp[0].length)
      .replace(/^\*{0,2}\s*-?\s*/, '')
      .replace(/\*\*/g, '')
      .trim();
    const separator = remainder.indexOf(':');
    const title = (separator >= 0 ? remainder.slice(0, separator) : remainder).trim() || 'Lesson note';
    const description = (separator >= 0 ? remainder.slice(separator + 1) : '').trim();
    const totalSeconds = (minutes * 60) + seconds;

    if (chapters.length) {
      const previous = chapters.at(-1).seconds;
      assert(totalSeconds > previous, `Chapter timestamps are duplicate or out of order in ${legacyPath}.`);
    }

    chapters.push({
      seconds: totalSeconds,
      label: `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`,
      title,
      description
    });
  }

  assert(chapters.length > 0 || introParagraphs.length > 0, `Summary has no usable content: ${legacyPath}`);
  return { introParagraphs, chapters };
}

function playlistId(courseId, breadcrumbs) {
  const digest = crypto.createHash('sha256')
    .update(courseId)
    .update('\0')
    .update(breadcrumbs.join('/'))
    .digest('hex')
    .slice(0, 16);
  return `${courseId}-${digest}`;
}

const dataSource = readUtf8Strict(catalogPath);
const { pullZoneHost, lessons: webLessons } = parseWebCatalog(dataSource);
const manifest = parseJson(manifestPath);
const webEntries = Object.entries(webLessons);

assert(manifest.version === 1, `Unsupported summary manifest version: ${manifest.version}`);
assert(webEntries.length === EXPECTED_LESSONS, `Expected ${EXPECTED_LESSONS} lessons, found ${webEntries.length}.`);
assert(manifest.lessonCount === EXPECTED_LESSONS, `Summary manifest lessonCount is ${manifest.lessonCount}, expected ${EXPECTED_LESSONS}.`);
assert(manifest.summaryCount === EXPECTED_LESSONS, `Summary manifest summaryCount is ${manifest.summaryCount}, expected ${EXPECTED_LESSONS}.`);
assert(Array.isArray(manifest.chunks) && manifest.chunks.length === EXPECTED_CHUNKS, `Expected ${EXPECTED_CHUNKS} summary chunks.`);

const inputHasher = crypto.createHash('sha256');
inputHasher
  .update('data.js\0')
  .update(canonicalSourceForHash(dataSource))
  .update('\0summaries/manifest.json\0')
  .update(canonicalSourceForHash(readUtf8Strict(manifestPath)));
const summaries = new Map();

for (const chunk of [...manifest.chunks].sort((a, b) => compareCodePoints(a.id, b.id))) {
  assert(chunk && typeof chunk === 'object', 'Summary manifest contains a non-object chunk.');
  assert(SUMMARY_CHUNK_RE.test(chunk.id), `Unsafe summary chunk id: ${chunk.id}`);
  assert(chunk.file === `${chunk.id}.js`, `Summary chunk filename does not match id: ${chunk.id}`);
  const filename = path.join(root, 'summaries', chunk.file);
  assert(fs.existsSync(filename), `Missing summary chunk: ${chunk.file}`);
  const parsed = parseSummaryChunk(filename, chunk.id);
  const chunkEntries = Object.entries(parsed.summaries);
  assert(chunkEntries.length === chunk.lessons, `${chunk.id} contains ${chunkEntries.length} summaries, expected ${chunk.lessons}.`);
  inputHasher
    .update(`\0summaries/${chunk.file}\0`)
    .update(canonicalSourceForHash(parsed.source));

  for (const [legacyPath, rawMarkdown] of chunkEntries) {
    assert(!summaries.has(legacyPath), `Duplicate summary: ${legacyPath}`);
    summaries.set(legacyPath, { chunkId: chunk.id, rawMarkdown });
  }
}

assert(summaries.size === EXPECTED_LESSONS, `Loaded ${summaries.size} summaries, expected ${EXPECTED_LESSONS}.`);

const categoryRank = new Map(CATEGORY_ORDER.map((category, index) => [category.id, index]));
const seenLessonIds = new Set();
const seenLegacyPaths = new Set();
const courseMap = new Map();
const draftLessons = [];
let chapterCount = 0;
let introParagraphCount = 0;

for (const [legacyPath, metadata] of webEntries) {
  assert(typeof legacyPath === 'string' && legacyPath.length > 0, 'Catalog contains an empty lesson path.');
  assert(!legacyPath.includes('\\'), `Lesson path contains a backslash: ${legacyPath}`);
  assert(!seenLegacyPaths.has(legacyPath), `Duplicate lesson path: ${legacyPath}`);
  seenLegacyPaths.add(legacyPath);

  assert(metadata && typeof metadata === 'object' && !Array.isArray(metadata), `Invalid lesson metadata: ${legacyPath}`);
  assert(UUID_RE.test(metadata.bunny_id || ''), `Invalid Bunny video UUID: ${legacyPath}`);
  assert(UUID_RE.test(metadata.collection_id || ''), `Invalid Bunny collection UUID: ${legacyPath}`);
  assert(SUMMARY_CHUNK_RE.test(metadata.summary_chunk || ''), `Invalid summary chunk reference: ${legacyPath}`);
  assert(!seenLessonIds.has(metadata.bunny_id), `Duplicate Bunny video UUID: ${metadata.bunny_id}`);
  seenLessonIds.add(metadata.bunny_id);

  const pathParts = legacyPath.split('/');
  assert(pathParts.length >= 2 && pathParts.every(Boolean), `Invalid lesson hierarchy: ${legacyPath}`);
  const filename = pathParts.at(-1);
  assert(VIDEO_EXTENSION_RE.test(filename), `Unsupported catalog extension: ${legacyPath}`);
  const directoryParts = pathParts.slice(0, -1);
  const courseTitle = directoryParts[0];
  const breadcrumbs = directoryParts.slice(1);
  const categoryId = deriveCategoryId(courseTitle);
  const courseId = metadata.summary_chunk;
  const summary = summaries.get(legacyPath);

  assert(summary, `Missing summary: ${legacyPath}`);
  assert(summary.chunkId === courseId, `Summary chunk mismatch: ${legacyPath}`);
  const parsedSummary = parseSummary(summary.rawMarkdown, legacyPath);
  chapterCount += parsedSummary.chapters.length;
  introParagraphCount += parsedSummary.introParagraphs.length;

  const existingCourse = courseMap.get(courseId);
  if (existingCourse) {
    assert(existingCourse.title === courseTitle, `Course ${courseId} maps to multiple top folders.`);
    assert(existingCourse.categoryId === categoryId, `Course ${courseId} maps to multiple categories.`);
    existingCourse.lessonCount += 1;
  } else {
    courseMap.set(courseId, { id: courseId, categoryId, title: courseTitle, lessonCount: 1 });
  }

  draftLessons.push({
    id: metadata.bunny_id,
    legacyPath,
    categoryId,
    courseId,
    course: courseTitle,
    breadcrumbs,
    playlistId: playlistId(courseId, breadcrumbs),
    filename,
    title: filename.replace(VIDEO_EXTENSION_RE, ''),
    sortOrdinal: -1,
    catalogOrdinal: -1,
    bunnyId: metadata.bunny_id,
    collectionId: metadata.collection_id,
    hlsUrl: `https://${pullZoneHost}/${metadata.bunny_id}/playlist.m3u8`,
    rawSummary: summary.rawMarkdown,
    introParagraphs: parsedSummary.introParagraphs,
    chapters: parsedSummary.chapters
  });
}

for (const legacyPath of summaries.keys()) {
  assert(seenLegacyPaths.has(legacyPath), `Orphan summary: ${legacyPath}`);
}

const playlistMap = new Map();
for (const lesson of draftLessons) {
  if (!playlistMap.has(lesson.playlistId)) playlistMap.set(lesson.playlistId, []);
  playlistMap.get(lesson.playlistId).push(lesson);
}
for (const playlist of playlistMap.values()) {
  playlist.sort((a, b) => compareNatural(a.title, b.title) || compareCodePoints(a.legacyPath, b.legacyPath));
  playlist.forEach((lesson, index) => { lesson.sortOrdinal = index; });
}

const courses = [...courseMap.values()].sort((a, b) => {
  return categoryRank.get(a.categoryId) - categoryRank.get(b.categoryId)
    || compareNatural(a.title, b.title)
    || compareCodePoints(a.id, b.id);
});
const courseRank = new Map();
const categoryCourseOrdinals = new Map();
for (const course of courses) {
  const ordinal = categoryCourseOrdinals.get(course.categoryId) || 0;
  course.sortOrdinal = ordinal;
  categoryCourseOrdinals.set(course.categoryId, ordinal + 1);
  courseRank.set(course.id, courseRank.size);
}

draftLessons.sort((a, b) => {
  const categoryDifference = categoryRank.get(a.categoryId) - categoryRank.get(b.categoryId);
  if (categoryDifference) return categoryDifference;
  const courseDifference = courseRank.get(a.courseId) - courseRank.get(b.courseId);
  if (courseDifference) return courseDifference;
  const breadcrumbDifference = compareNatural(a.breadcrumbs.join('/'), b.breadcrumbs.join('/'));
  if (breadcrumbDifference) return breadcrumbDifference;
  return a.sortOrdinal - b.sortOrdinal || compareCodePoints(a.legacyPath, b.legacyPath);
});
draftLessons.forEach((lesson, index) => { lesson.catalogOrdinal = index; });

const categoryLessonCounts = new Map();
for (const lesson of draftLessons) {
  categoryLessonCounts.set(lesson.categoryId, (categoryLessonCounts.get(lesson.categoryId) || 0) + 1);
}
const categories = CATEGORY_ORDER
  .filter(category => categoryLessonCounts.has(category.id))
  .map((category, sortOrdinal) => ({
    ...category,
    sortOrdinal,
    lessonCount: categoryLessonCounts.get(category.id),
    courseCount: courses.filter(course => course.categoryId === category.id).length
  }));

assert(categories.every(category => category.id !== 'other'), 'At least one course could not be categorized.');
assert(courses.length === EXPECTED_CHUNKS, `Expected ${EXPECTED_CHUNKS} courses, found ${courses.length}.`);
assert(draftLessons.length === EXPECTED_LESSONS, `Expected ${EXPECTED_LESSONS} exported lessons.`);
assert(chapterCount === 10441, `Expected 10441 parsed chapters, found ${chapterCount}.`);
assert(introParagraphCount === 13, `Expected 13 intro paragraphs, found ${introParagraphCount}.`);

const exportDocument = {
  schemaVersion: 1,
  sourceSha256: inputHasher.digest('hex'),
  pullZoneHost,
  lessonCount: draftLessons.length,
  summaryCount: summaries.size,
  chapterCount,
  introParagraphCount,
  categories,
  courses,
  lessons: draftLessons
};

const output = `${JSON.stringify(exportDocument, null, 2)}\n`;
const outputHazard = findEncodingHazard(output);
assert(!outputHazard, `Generated catalog contains ${outputHazard}.`);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, output, 'utf8');

const written = readUtf8Strict(outputPath);
assert(written === output, 'Generated catalog changed while being written.');
const roundTrip = JSON.parse(written);
assert(roundTrip.lessonCount === EXPECTED_LESSONS, 'Generated catalog failed its JSON round-trip validation.');

const digest = crypto.createHash('sha256').update(written).digest('hex');
console.log(`Exported ${roundTrip.lessonCount} lessons, ${roundTrip.chapterCount} chapters, and ${roundTrip.introParagraphCount} intro paragraphs.`);
console.log(`Android catalog: ${path.relative(root, outputPath)} (${Buffer.byteLength(written).toLocaleString()} bytes)`);
console.log(`SHA-256: ${digest}`);
