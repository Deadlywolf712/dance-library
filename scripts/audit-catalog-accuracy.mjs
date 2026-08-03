import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePaths = {
  webCatalog: path.join(root, 'data.js'),
  courseTaxonomy: path.join(root, 'course-taxonomy.js'),
  webApp: path.join(root, 'app.js'),
  androidExporter: path.join(root, 'scripts', 'export-android-catalog.mjs'),
  salsaCourse: path.join(root, 'salsa_course.js'),
  themeMarkup: path.join(root, 'index.html'),
  themeStyles: path.join(root, 'style.css'),
  summaryManifest: path.join(root, 'summaries', 'manifest.json'),
  androidCatalog: path.join(root, 'android', 'app', 'src', 'main', 'assets', 'catalog.json')
};

const cliReportIndex = process.argv.indexOf('--report');
const reportPath = cliReportIndex >= 0
  ? path.resolve(process.cwd(), process.argv[cliReportIndex + 1] || '')
  : path.join(root, 'audit', 'catalog-accuracy-static-report.json');
const writeReport = !process.argv.includes('--no-write');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE_STYLE = {
  salsa: 'salsa',
  'salsa-masterclass': 'salsa',
  bachata: 'bachata',
  zouk: 'zouk',
  kizomba: 'kizomba',
  'kizomba-masterclass': 'kizomba'
};

// These terms are deliberately narrow. A mismatch is confirmed only when the
// competing style has explicit, repeated evidence at course level. Generic
// movement words (turn, frame, basic, isolation) are intentionally excluded.
const STYLE_TERMS = {
  salsa: [
    ['salsa', 12], ['cross body lead', 4], ['suzy q', 4], ['pachanga', 4],
    ['salsa on1', 5], ['salsa on2', 5], ['mambo timing', 3], ['copa', 2]
  ],
  bachata: [
    ['bachata', 12], ['traditional bachata', 6], ['bachata sensual', 6],
    ['dominican bachata', 6], ['punta talon', 3]
  ],
  zouk: [
    ['zouk', 12], ['viradinha', 5], ['toalla', 5], ['balao', 4],
    ['despresada', 5], ['lambada', 4], ['boneca', 4]
  ],
  kizomba: [
    ['kizomba', 12], ['urban kiz', 6], ['tarraxa', 5], ['saida', 4],
    ['semba', 4], ['ginga', 3], ['virgula', 4], ['contratempo', 3]
  ]
};

const INSTRUCTOR_GROUPS = {
  adolfo: ['adolfo', 'indacochea', 'tania', 'cannarsa'],
  alex: ['alex', 'desiree'],
  arthur: ['arthur', 'oksana'],
  carolina: ['carolina'],
  fernando: ['fernando', 'sosa', 'tatiana', 'bonaguro'],
  isabelle: ['isabelle', 'felicien'],
  kike: ['kike', 'nahir'],
  korke: ['korke', 'judith'],
  marco: ['marco', 'espejo'],
  pablo: ['pablo', 'raquel']
};

// These display-only corrections were read directly from the on-screen source
// title cards. The legacy path remains stable for notes, bookmarks, and media.
const SOURCE_CONFIRMED_TITLE_OVERRIDES = {
  'Carolina Rosa - Advanced/09 - 33 Steps.mp4': '09 - 3X3 Steps',
  'Carolina Rosa - Beginner/02 - Punta Talón Point  Heel.mp4': '02 - Punta Talón (Point & Heel)',
  'Carolina Rosa - Beginner/05 - Engaño Trick.mp4': '05 - Engaño (Trick)',
  'Carolina Rosa - Beginner/07 - Turns in 15.mp4': '07 - Turns in 1/5',
  'Carolina Rosa - Beginner/08 - Diagonals in 1  Chachas in 3 4.mp4': '08 - Diagonals in 1 & Chachas in 3, 4',
  'Carolina Rosa - Intermediate/05 - Twist and Tikitiki.mp4': '05 - Twist & Tikitiki'
};

function relative(filename) {
  return path.relative(root, filename).replaceAll('\\', '/');
}

function normalizeText(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function countPhrase(haystack, phrase) {
  const normalizedPhrase = normalizeText(phrase);
  let count = 0;
  let cursor = 0;
  while ((cursor = haystack.indexOf(normalizedPhrase, cursor)) >= 0) {
    const before = haystack[cursor - 1];
    const after = haystack[cursor + normalizedPhrase.length];
    if ((!before || !/[a-z0-9]/.test(before)) && (!after || !/[a-z0-9]/.test(after))) count += 1;
    cursor += normalizedPhrase.length;
  }
  return count;
}

function styleEvidence(text) {
  const normalized = normalizeText(text);
  return Object.fromEntries(Object.entries(STYLE_TERMS).map(([style, terms]) => {
    const matches = terms
      .map(([term, weight]) => ({ term, count: countPhrase(normalized, term), weight }))
      .filter(match => match.count > 0);
    return [style, {
      score: matches.reduce((total, match) => total + match.count * match.weight, 0),
      // Count the base style token once. More-specific phrases contribute to
      // weighted confidence above, but must not double-count the same words.
      explicitMentions: countPhrase(normalized, style),
      matches
    }];
  }));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function groupBy(items, keyOf) {
  const groups = new Map();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key) || [];
    group.push(item);
    groups.set(key, group);
  }
  return groups;
}

function issue(code, severity, confidence, summary, evidence = {}) {
  return { code, severity, confidence, summary, evidence };
}

function parseWebCatalog() {
  const source = fs.readFileSync(sourcePaths.webCatalog, 'utf8');
  const hostMatch = source.match(/^const BUNNY_PULL_ZONE = ("(?:[^"\\]|\\.)*");\s*$/m);
  const marker = 'const videoData = ';
  const markerIndex = source.indexOf(marker);
  if (!hostMatch || markerIndex < 0) throw new Error('data.js does not have the expected generated structure.');
  const tail = source.slice(markerIndex + marker.length).trim();
  if (!tail.endsWith(';')) throw new Error('data.js videoData assignment is not terminated.');
  return {
    pullZoneHost: JSON.parse(hostMatch[1]),
    lessons: JSON.parse(tail.slice(0, -1)),
    source
  };
}

function parseSummaryChunk(filename, expectedChunkId) {
  const source = fs.readFileSync(filename, 'utf8');
  const assignment = source.match(
    /globalThis\.DanceLibrarySummaries\[("(?:[^"\\]|\\.)*")\]\s*=\s*([\s\S]+);\s*$/
  );
  if (!assignment) throw new Error(`${relative(filename)} is not a generated summary chunk.`);
  const chunkId = JSON.parse(assignment[1]);
  if (chunkId !== expectedChunkId) throw new Error(`${relative(filename)} registers ${chunkId}, not ${expectedChunkId}.`);
  return { source, summaries: JSON.parse(assignment[2]) };
}

function parseSalsaCourse() {
  const source = fs.readFileSync(sourcePaths.salsaCourse, 'utf8');
  const serialized = vm.runInNewContext(
    `${source}\n;JSON.stringify(salsaCourseData);`,
    Object.create(null),
    {
      filename: relative(sourcePaths.salsaCourse),
      timeout: 1_000,
      contextCodeGeneration: { strings: false, wasm: false }
    }
  );
  return JSON.parse(serialized);
}

function parseWebTaxonomy() {
  const source = fs.readFileSync(sourcePaths.courseTaxonomy, 'utf8');
  const serialized = vm.runInNewContext(
    `${source}\n;JSON.stringify(COURSE_TAXONOMY);`,
    Object.create(null),
    {
      filename: relative(sourcePaths.courseTaxonomy),
      timeout: 1_000,
      contextCodeGeneration: { strings: false, wasm: false }
    }
  );
  const taxonomy = JSON.parse(serialized);
  if (!Array.isArray(taxonomy.categoryOrder)
    || !taxonomy.courseCategoryByFolder
    || typeof taxonomy.courseCategoryByFolder !== 'object'
    || Array.isArray(taxonomy.courseCategoryByFolder)) {
    throw new Error('course-taxonomy.js does not contain the expected exact taxonomy structure.');
  }
  return taxonomy;
}

function sourceLine(filename, needle) {
  const lines = fs.readFileSync(filename, 'utf8').split(/\r?\n/);
  const index = lines.findIndex(line => line.includes(needle));
  return index < 0 ? null : { path: relative(filename), line: index + 1, text: lines[index].trim() };
}

const web = parseWebCatalog();
const manifest = JSON.parse(fs.readFileSync(sourcePaths.summaryManifest, 'utf8'));
const android = JSON.parse(fs.readFileSync(sourcePaths.androidCatalog, 'utf8'));
const salsaCourse = parseSalsaCourse();
const webTaxonomy = parseWebTaxonomy();

const summaries = new Map();
const summaryChunkSources = new Map();
const summaryChunkSourceHashes = {};
const structuralIssues = [];
for (const chunk of manifest.chunks || []) {
  const filename = path.join(root, 'summaries', chunk.file);
  if (!fs.existsSync(filename)) {
    structuralIssues.push(issue('missing-summary-chunk', 'error', 'confirmed', `Missing ${relative(filename)}.`, { chunk }));
    continue;
  }
  const parsed = parseSummaryChunk(filename, chunk.id);
  summaryChunkSources.set(chunk.id, parsed.source);
  summaryChunkSourceHashes[chunk.id] = sha256(parsed.source.replace(/\r\n?/g, '\n'));
  const entries = Object.entries(parsed.summaries);
  if (entries.length !== chunk.lessons) {
    structuralIssues.push(issue(
      'summary-chunk-count-mismatch', 'error', 'confirmed',
      `${chunk.id} declares ${chunk.lessons} lessons but contains ${entries.length}.`,
      { path: relative(filename), declared: chunk.lessons, actual: entries.length }
    ));
  }
  for (const [legacyPath, rawSummary] of entries) {
    if (summaries.has(legacyPath)) {
      structuralIssues.push(issue(
        'duplicate-summary-path', 'error', 'confirmed',
        `Summary path is registered more than once: ${legacyPath}`,
        { path: legacyPath, chunks: [summaries.get(legacyPath).chunkId, chunk.id] }
      ));
    }
    summaries.set(legacyPath, { chunkId: chunk.id, rawSummary });
  }
}

const canonicalSource = value => value.replace(/\r\n?/g, '\n');
const androidSourceHasher = crypto.createHash('sha256');
androidSourceHasher
  .update('data.js\0')
  .update(canonicalSource(web.source))
  .update('\0summaries/manifest.json\0')
  .update(canonicalSource(fs.readFileSync(sourcePaths.summaryManifest, 'utf8')))
  .update('\0course-taxonomy.js\0')
  .update(canonicalSource(fs.readFileSync(sourcePaths.courseTaxonomy, 'utf8')))
  .update('\0salsa_course.js\0')
  .update(canonicalSource(fs.readFileSync(sourcePaths.salsaCourse, 'utf8')))
  .update('\0index.html\0')
  .update(canonicalSource(fs.readFileSync(sourcePaths.themeMarkup, 'utf8')))
  .update('\0style.css\0')
  .update(canonicalSource(fs.readFileSync(sourcePaths.themeStyles, 'utf8')));
for (const chunk of [...(manifest.chunks || [])].sort((left, right) => left.id === right.id ? 0 : left.id < right.id ? -1 : 1)) {
  const source = summaryChunkSources.get(chunk.id);
  if (source) androidSourceHasher.update(`\0summaries/${chunk.file}\0`).update(canonicalSource(source));
}
const computedAndroidSourceSha256 = androidSourceHasher.digest('hex');
if (computedAndroidSourceSha256 !== android.sourceSha256) {
  structuralIssues.push(issue(
    'stale-android-catalog', 'error', 'confirmed',
    'Android catalog sourceSha256 does not match the current web catalog inputs.',
    { expected: computedAndroidSourceSha256, actual: android.sourceSha256 }
  ));
}

const webEntries = Object.entries(web.lessons).map(([legacyPath, metadata]) => ({ legacyPath, ...metadata }));
const androidByPath = new Map(android.lessons.map(lesson => [lesson.legacyPath, lesson]));
const androidByBunnyId = groupBy(android.lessons, lesson => lesson.bunnyId);
const webByBunnyId = groupBy(webEntries, lesson => lesson.bunny_id);
const courseById = new Map(android.courses.map(course => [course.id, course]));
const lessonsByCourse = groupBy(android.lessons, lesson => lesson.courseId);
const categoryIdByTitle = new Map(android.categories.map(category => [category.title, category.id]));
const webCourseFolders = new Set(webEntries.map(lesson => lesson.legacyPath.split('/')[0]));
const taxonomyCourseFolders = new Set(Object.keys(webTaxonomy.courseCategoryByFolder));

const missingTaxonomyCourses = [...webCourseFolders].filter(course => !taxonomyCourseFolders.has(course));
const orphanTaxonomyCourses = [...taxonomyCourseFolders].filter(course => !webCourseFolders.has(course));
if (missingTaxonomyCourses.length || orphanTaxonomyCourses.length) {
  structuralIssues.push(issue(
    'taxonomy-course-coverage-mismatch', 'error', 'confirmed',
    'The authoritative course taxonomy does not exactly cover the web catalog.',
    { missingTaxonomyCourses, orphanTaxonomyCourses }
  ));
}
const usedTaxonomyCategories = new Set(Object.values(webTaxonomy.courseCategoryByFolder));
const expectedAndroidCategoryOrder = webTaxonomy.categoryOrder.filter(title => usedTaxonomyCategories.has(title));
const actualAndroidCategoryOrder = android.categories.map(category => category.title);
if (canonicalJson(expectedAndroidCategoryOrder) !== canonicalJson(actualAndroidCategoryOrder)) {
  structuralIssues.push(issue(
    'taxonomy-category-order-mismatch', 'error', 'confirmed',
    'The web taxonomy category order differs from the Android catalog.',
    { webActiveCategories: expectedAndroidCategoryOrder, android: actualAndroidCategoryOrder }
  ));
}

if (webEntries.length !== manifest.lessonCount || webEntries.length !== manifest.summaryCount) {
  structuralIssues.push(issue(
    'manifest-count-mismatch', 'error', 'confirmed',
    'data.js and the summary manifest disagree on lesson totals.',
    { dataLessons: webEntries.length, manifestLessons: manifest.lessonCount, manifestSummaries: manifest.summaryCount }
  ));
}
if (android.lessonCount !== android.lessons.length || android.lessonCount !== webEntries.length) {
  structuralIssues.push(issue(
    'android-count-mismatch', 'error', 'confirmed',
    'The Android catalog lesson totals do not match data.js.',
    { dataLessons: webEntries.length, androidDeclared: android.lessonCount, androidLessons: android.lessons.length }
  ));
}

for (const [legacyPath, sourceTitle] of Object.entries(SOURCE_CONFIRMED_TITLE_OVERRIDES)) {
  const catalogLesson = web.lessons[legacyPath];
  if (!catalogLesson || catalogLesson.title !== sourceTitle) {
    structuralIssues.push(issue(
      'source-confirmed-title-regression', 'error', 'confirmed',
      `The display title no longer matches its inspected source card: ${legacyPath}`,
      { path: legacyPath, expected: sourceTitle, actual: catalogLesson?.title || null }
    ));
  }
}

for (const webLesson of webEntries) {
  const summary = summaries.get(webLesson.legacyPath);
  const androidLesson = androidByPath.get(webLesson.legacyPath);
  if (Object.hasOwn(webLesson, 'title')
    && (typeof webLesson.title !== 'string' || !webLesson.title.trim())) {
    structuralIssues.push(issue(
      'invalid-display-title-override', 'error', 'confirmed',
      `Display title override is not a non-empty string: ${webLesson.legacyPath}`,
      { path: webLesson.legacyPath, title: webLesson.title }
    ));
  }
  if (!summary) {
    structuralIssues.push(issue('missing-summary', 'error', 'confirmed', `Missing summary: ${webLesson.legacyPath}`, { path: webLesson.legacyPath }));
  } else if (summary.chunkId !== webLesson.summary_chunk) {
    structuralIssues.push(issue(
      'summary-course-mismatch', 'error', 'confirmed',
      `Summary chunk does not match data.js for ${webLesson.legacyPath}.`,
      { path: webLesson.legacyPath, dataChunk: webLesson.summary_chunk, summaryChunk: summary.chunkId }
    ));
  }
  if (!androidLesson) {
    structuralIssues.push(issue('missing-android-lesson', 'error', 'confirmed', `Android catalog omits ${webLesson.legacyPath}.`, { path: webLesson.legacyPath }));
    continue;
  }
  const topFolder = webLesson.legacyPath.split('/')[0];
  const matchedWebCategoryTitle = webTaxonomy.courseCategoryByFolder[topFolder] || 'Other';
  const expectedWebCategoryId = categoryIdByTitle.get(matchedWebCategoryTitle) || 'other';
  if (androidLesson.categoryId !== expectedWebCategoryId) {
    structuralIssues.push(issue(
      'web-android-category-divergence', 'error', 'confirmed',
      `Android category differs from the active web taxonomy for ${webLesson.legacyPath}.`,
      {
        path: webLesson.legacyPath,
        activeWebCategoryTitle: matchedWebCategoryTitle,
        activeWebCategoryId: expectedWebCategoryId,
        androidCategoryId: androidLesson.categoryId
      }
    ));
  }
  const differences = {};
  const parityFields = [
    ['bunnyId', webLesson.bunny_id],
    ['collectionId', webLesson.collection_id],
    ['courseId', webLesson.summary_chunk],
    ['title', webLesson.title || webLesson.legacyPath.split('/').at(-1).replace(/\.[^.]+$/, '')],
    ['rawSummary', summary?.rawSummary]
  ];
  for (const [field, expected] of parityFields) {
    if (androidLesson[field] !== expected) differences[field] = { web: expected, android: androidLesson[field] };
  }
  if (Object.keys(differences).length) {
    structuralIssues.push(issue(
      'web-android-lesson-divergence', 'error', 'confirmed',
      `Web and Android metadata diverge for ${webLesson.legacyPath}.`,
      { path: webLesson.legacyPath, differences }
    ));
  }
}

for (const legacyPath of summaries.keys()) {
  if (!(legacyPath in web.lessons)) {
    structuralIssues.push(issue('orphan-summary', 'error', 'confirmed', `Summary has no data.js lesson: ${legacyPath}`, { path: legacyPath }));
  }
}
for (const androidLesson of android.lessons) {
  if (!(androidLesson.legacyPath in web.lessons)) {
    structuralIssues.push(issue('orphan-android-lesson', 'error', 'confirmed', `Android lesson has no data.js entry: ${androidLesson.legacyPath}`, { path: androidLesson.legacyPath }));
  }
  if (!UUID_RE.test(androidLesson.bunnyId) || !UUID_RE.test(androidLesson.collectionId)) {
    structuralIssues.push(issue(
      'invalid-bunny-identifier', 'error', 'confirmed',
      `Lesson has an invalid Bunny identifier: ${androidLesson.legacyPath}`,
      { path: androidLesson.legacyPath, bunnyId: androidLesson.bunnyId, collectionId: androidLesson.collectionId }
    ));
  }
  const expectedHlsUrl = `https://${web.pullZoneHost}/${androidLesson.bunnyId}/playlist.m3u8`;
  if (androidLesson.hlsUrl !== expectedHlsUrl) {
    structuralIssues.push(issue(
      'android-hls-url-mismatch', 'error', 'confirmed',
      `Android HLS URL is inconsistent for ${androidLesson.legacyPath}.`,
      { path: androidLesson.legacyPath, expected: expectedHlsUrl, actual: androidLesson.hlsUrl }
    ));
  }
}

const duplicateBunnyMappings = [...webByBunnyId.entries()]
  .filter(([bunnyId, lessons]) => bunnyId && lessons.length > 1)
  .map(([bunnyId, lessons]) => ({ bunnyId, paths: lessons.map(lesson => lesson.legacyPath) }));
const duplicateAndroidBunnyMappings = [...androidByBunnyId.entries()]
  .filter(([bunnyId, lessons]) => bunnyId && lessons.length > 1)
  .map(([bunnyId, lessons]) => ({ bunnyId, paths: lessons.map(lesson => lesson.legacyPath) }));
const summaryDigestGroups = groupBy(
  android.lessons,
  lesson => sha256(normalizeText(lesson.rawSummary).replace(/\*\*\[\d{1,3}:\d{2}\]\*\*/g, '').replace(/[^a-z0-9]+/g, ' ').trim())
);
const duplicateSummaryContent = [...summaryDigestGroups.entries()]
  .filter(([, lessons]) => lessons.length > 1)
  .map(([digest, lessons]) => ({ digest, paths: lessons.map(lesson => lesson.legacyPath) }));
const collectionCrossCourseReuse = [...groupBy(android.lessons, lesson => lesson.collectionId).entries()]
  .map(([collectionId, lessons]) => ({
    collectionId,
    courseIds: [...new Set(lessons.map(lesson => lesson.courseId))],
    paths: lessons.map(lesson => lesson.legacyPath)
  }))
  .filter(group => group.courseIds.length > 1);

if (duplicateBunnyMappings.length || duplicateAndroidBunnyMappings.length) {
  structuralIssues.push(issue(
    'duplicate-bunny-id', 'error', 'confirmed',
    'One or more Bunny video IDs map to multiple lesson paths.',
    { web: duplicateBunnyMappings, android: duplicateAndroidBunnyMappings }
  ));
}
if (duplicateSummaryContent.length) {
  structuralIssues.push(issue(
    'duplicate-summary-content', 'warning', 'confirmed',
    'Multiple lesson paths have byte-equivalent normalized summaries.',
    { groups: duplicateSummaryContent }
  ));
}
if (collectionCrossCourseReuse.length) {
  structuralIssues.push(issue(
    'cross-course-collection-reuse', 'warning', 'suspected',
    'A Bunny collection ID is reused across courses.',
    { groups: collectionCrossCourseReuse }
  ));
}

const lessonEvidence = android.lessons.map(lesson => {
  const evidence = styleEvidence(`${lesson.title}\n${lesson.rawSummary}`);
  const assignedStyle = BASE_STYLE[lesson.categoryId] || lesson.categoryId;
  const alternatives = Object.entries(evidence)
    .filter(([style]) => style !== assignedStyle)
    .sort((left, right) => right[1].score - left[1].score);
  const strongestAlternative = alternatives[0];
  return {
    legacyPath: lesson.legacyPath,
    bunnyId: lesson.bunnyId,
    courseId: lesson.courseId,
    assignedCategoryId: lesson.categoryId,
    assignedStyle,
    evidence,
    strongestAlternative: strongestAlternative && strongestAlternative[1].score > 0
      ? { style: strongestAlternative[0], ...strongestAlternative[1] }
      : null
  };
});
const sourceConfirmedDisplayTitleOverrides = webEntries
  .filter(lesson => Object.hasOwn(lesson, 'title'))
  .map(lesson => ({
    legacyPath: lesson.legacyPath,
    displayTitle: lesson.title,
    androidTitle: androidByPath.get(lesson.legacyPath)?.title || null
  }));
const lessonEvidenceByCourse = groupBy(lessonEvidence, lesson => lesson.courseId);
const courseTaxonomy = [];
const taxonomyIssues = [];

for (const course of android.courses) {
  const lessons = lessonEvidenceByCourse.get(course.id) || [];
  const assignedStyle = BASE_STYLE[course.categoryId] || course.categoryId;
  const assignedCategoryTitle = android.categories.find(category => category.id === course.categoryId)?.title
    || course.categoryId;
  const aggregate = Object.fromEntries(Object.keys(STYLE_TERMS).map(style => [style, {
    score: lessons.reduce((total, lesson) => total + lesson.evidence[style].score, 0),
    explicitMentions: lessons.reduce((total, lesson) => total + lesson.evidence[style].explicitMentions, 0),
    lessonsWithEvidence: lessons.filter(lesson => lesson.evidence[style].score > 0).length,
    matchedTerms: [...new Set(lessons.flatMap(lesson => lesson.evidence[style].matches.map(match => match.term)))]
  }]));
  const ranked = Object.entries(aggregate).sort((left, right) => right[1].score - left[1].score);
  const inferred = ranked[0];
  const assigned = aggregate[assignedStyle] || { score: 0, explicitMentions: 0, lessonsWithEvidence: 0, matchedTerms: [] };
  const contradictionPaths = lessons
    .filter(lesson => lesson.evidence[inferred[0]].score > lesson.evidence[assignedStyle].score)
    .map(lesson => lesson.legacyPath);
  const confirmedMismatch = inferred[0] !== assignedStyle
    && inferred[1].explicitMentions >= 3
    && inferred[1].score >= Math.max(36, assigned.score * 3)
    && inferred[1].lessonsWithEvidence >= 3;

  const audit = {
    courseId: course.id,
    courseTitle: course.title,
    assignedCategoryId: course.categoryId,
    assignedStyle,
    inferredStyle: confirmedMismatch ? inferred[0] : null,
    confidence: confirmedMismatch ? 'high' : 'not-established',
    lessonCount: lessons.length,
    aggregateEvidence: aggregate,
    contradictoryLessonPaths: confirmedMismatch ? contradictionPaths : []
  };
  courseTaxonomy.push(audit);

  if (confirmedMismatch) {
    const affectedPaths = lessons.map(lesson => lesson.legacyPath);
    const representative = lessons
      .filter(lesson => lesson.evidence[inferred[0]].score > 0)
      .slice(0, 5)
      .map(lesson => ({
        path: lesson.legacyPath,
        bunnyId: lesson.bunnyId,
        matches: lesson.evidence[inferred[0]].matches
      }));
    taxonomyIssues.push(issue(
      'course-category-mismatch', 'error', 'confirmed',
      `${course.title} is assigned to ${assignedCategoryTitle}, but repeated lesson evidence identifies ${inferred[0]}.`,
      {
        courseId: course.id,
        assignedCategoryId: course.categoryId,
        inferredStyle: inferred[0],
        lessonCount: lessons.length,
        affectedPaths,
        representativeEvidence: representative,
        taxonomyRuleLocations: [
          sourceLine(sourcePaths.courseTaxonomy, `'${course.title}':`)
        ].filter(Boolean)
      }
    ));
  }
}

const instructorIssues = [];
for (const lesson of android.lessons) {
  const courseText = normalizeText(lesson.course);
  const summaryText = normalizeText(lesson.rawSummary);
  const expectedGroups = Object.entries(INSTRUCTOR_GROUPS)
    .filter(([, aliases]) => aliases.some(alias => countPhrase(courseText, alias) > 0))
    .map(([group]) => group);
  if (!expectedGroups.length) continue;
  const unexpectedGroups = Object.entries(INSTRUCTOR_GROUPS)
    .filter(([group, aliases]) => !expectedGroups.includes(group) && aliases.some(alias => countPhrase(summaryText, alias) > 0))
    .map(([group]) => group);
  if (unexpectedGroups.length) {
    instructorIssues.push(issue(
      'unexpected-instructor-reference', 'warning', 'suspected',
      `Summary references another catalog instructor group: ${lesson.legacyPath}`,
      { path: lesson.legacyPath, expectedGroups, unexpectedGroups }
    ));
  }
}

const titleAndLevelIssues = [];
for (const course of android.courses) {
  const courseLessons = lessonsByCourse.get(course.id) || [];
  const webCourseTitles = [...new Set(courseLessons.map(lesson => lesson.legacyPath.split('/')[0]))];
  if (webCourseTitles.length !== 1 || webCourseTitles[0] !== course.title) {
    titleAndLevelIssues.push(issue(
      'course-title-divergence', 'error', 'confirmed',
      `Course title is inconsistent across source catalogs: ${course.id}`,
      { courseId: course.id, androidTitle: course.title, webCourseTitles }
    ));
  }
  const flatLessons = courseLessons.filter(lesson => lesson.legacyPath.split('/').length === 2);
  if (flatLessons.length !== courseLessons.length || flatLessons.length === 0) continue;
  const numbered = flatLessons.map(lesson => ({ lesson, match: lesson.filename.match(/^(\d+)\s*-\s*/)}));
  if (numbered.some(entry => !entry.match)) continue;
  const numbers = numbered.map(entry => Number(entry.match[1])).sort((a, b) => a - b);
  const expected = Array.from({ length: numbers.length }, (_, index) => index + 1);
  if (JSON.stringify(numbers) !== JSON.stringify(expected)) {
    titleAndLevelIssues.push(issue(
      'flat-course-numbering-anomaly', 'warning', 'suspected',
      `Flat course numbering has a gap or duplicate: ${course.title}`,
      { courseId: course.id, numbers, expected }
    ));
  }
}

const summaryManifestFolders = new Map((manifest.chunks || []).map(chunk => [chunk.id, chunk.folder]));
for (const course of android.courses) {
  const manifestFolder = summaryManifestFolders.get(course.id);
  if (manifestFolder !== course.title) {
    titleAndLevelIssues.push(issue(
      'manifest-course-title-divergence', 'error', 'confirmed',
      `Summary manifest folder does not match Android course title: ${course.id}`,
      { courseId: course.id, manifestFolder, androidTitle: course.title }
    ));
  }
}

const salsaFolderPaths = new Set(android.folders
  .filter(folder => folder.courseId === 'salsa-masterclass-53016ced')
  .map(folder => folder.pathSegments.join('/')));
const salsaCourseIssues = [];
const salsaAndroidCourse = android.courses.find(course => course.id === 'salsa-masterclass-53016ced');
const expectedSalsaCoursePresentation = {
  title: salsaCourse.title,
  subtitle: salsaCourse.subtitle,
  intro: salsaCourse.intro
};
if (!salsaAndroidCourse || canonicalJson(salsaAndroidCourse.presentation) !== canonicalJson(expectedSalsaCoursePresentation)) {
  salsaCourseIssues.push(issue(
    'salsa-course-presentation-divergence', 'error', 'confirmed',
    'salsa_course.js course presentation does not exactly match the Android catalog.',
    { expected: expectedSalsaCoursePresentation, actual: salsaAndroidCourse?.presentation || null }
  ));
}

const expectedSalsaFolderPresentations = new Map();
for (const [weekName, presentation] of Object.entries(salsaCourse.weeks || {})) {
  expectedSalsaFolderPresentations.set(`Salsa Masterclass/${weekName}`, { kind: 'week', ...presentation });
}
for (const [folderPath, presentation] of Object.entries(salsaCourse.folders || {})) {
  expectedSalsaFolderPresentations.set(folderPath, { kind: 'lesson-group', ...presentation });
}
const actualSalsaFolderPresentations = new Map(android.folders
  .filter(folder => folder.courseId === 'salsa-masterclass-53016ced' && folder.presentation)
  .map(folder => [folder.pathSegments.join('/'), folder.presentation]));

for (const folderPath of Object.keys(salsaCourse.folders || {})) {
  if (!salsaFolderPaths.has(folderPath)) {
    salsaCourseIssues.push(issue(
      'orphan-salsa-course-presentation', 'error', 'confirmed',
      `salsa_course.js describes a folder absent from the catalog: ${folderPath}`,
      { path: folderPath }
    ));
  }
}
for (const [folderPath, expectedPresentation] of expectedSalsaFolderPresentations) {
  const actualPresentation = actualSalsaFolderPresentations.get(folderPath);
  if (canonicalJson(actualPresentation) !== canonicalJson(expectedPresentation)) {
    salsaCourseIssues.push(issue(
      'salsa-folder-presentation-divergence', 'error', 'confirmed',
      `salsa_course.js presentation does not exactly match Android: ${folderPath}`,
      { path: folderPath, expected: expectedPresentation, actual: actualPresentation || null }
    ));
  }
}
for (const [folderPath, actualPresentation] of actualSalsaFolderPresentations) {
  if (!expectedSalsaFolderPresentations.has(folderPath)) {
    salsaCourseIssues.push(issue(
      'orphan-android-salsa-presentation', 'error', 'confirmed',
      `Android has Salsa presentation metadata absent from salsa_course.js: ${folderPath}`,
      { path: folderPath, actual: actualPresentation }
    ));
  }
}
for (const weekName of Object.keys(salsaCourse.weeks || {})) {
  const folderPath = `Salsa Masterclass/${weekName}`;
  if (!salsaFolderPaths.has(folderPath)) {
    salsaCourseIssues.push(issue(
      'missing-salsa-course-week', 'error', 'confirmed',
      `salsa_course.js week is absent from the catalog: ${folderPath}`,
      { weekName, path: folderPath }
    ));
  }
}

const confirmedIssues = [
  ...structuralIssues.filter(item => item.confidence === 'confirmed'),
  ...taxonomyIssues,
  ...instructorIssues.filter(item => item.confidence === 'confirmed'),
  ...titleAndLevelIssues.filter(item => item.confidence === 'confirmed'),
  ...salsaCourseIssues
];
const suspectedIssues = [
  ...structuralIssues.filter(item => item.confidence !== 'confirmed'),
  ...instructorIssues.filter(item => item.confidence !== 'confirmed'),
  ...titleAndLevelIssues.filter(item => item.confidence !== 'confirmed')
];

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  claim: 'Static catalog metadata is internally consistent and course taxonomy agrees with explicit lesson-summary evidence.',
  successCondition: 'All 795 lessons have one unique Bunny ID, one matching summary, exact web/Android parity, coherent titles/course hierarchy, and no high-confidence style contradiction.',
  scope: {
    lessonCountAudited: android.lessons.length,
    courseCountAudited: android.courses.length,
    summaryChunkCountAudited: (manifest.chunks || []).length,
    salsaCourseWeeksAudited: Object.keys(salsaCourse.weeks || {}).length,
    salsaCourseFolderPresentationsAudited: Object.keys(salsaCourse.folders || {}).length,
    sources: Object.values(sourcePaths).map(relative),
    method: 'Static cross-source parity, uniqueness, hierarchy, numbering, instructor-reference, and conservative style-lexicon analysis.'
  },
  conclusion: confirmedIssues.length
    ? 'The catalog is not fully accurate: confirmed issues require production taxonomy correction.'
    : 'No static catalog accuracy defect was confirmed.',
  counts: {
    webLessons: webEntries.length,
    sourceSummaries: summaries.size,
    androidLessons: android.lessons.length,
    confirmedIssues: confirmedIssues.length,
    suspectedIssues: suspectedIssues.length,
    highConfidenceMislabeledCourses: taxonomyIssues.length,
    highConfidenceAffectedLessons: taxonomyIssues.reduce((total, item) => total + item.evidence.lessonCount, 0),
    sourceConfirmedDisplayTitleOverrides: sourceConfirmedDisplayTitleOverrides.length,
    duplicateBunnyIdGroups: duplicateBunnyMappings.length,
    duplicateNormalizedSummaryGroups: duplicateSummaryContent.length,
    crossCourseCollectionReuseGroups: collectionCrossCourseReuse.length
  },
  sourceParity: {
    webAndSummaryPathSetsMatch: webEntries.length === summaries.size
      && webEntries.every(lesson => summaries.has(lesson.legacyPath))
      && [...summaries.keys()].every(legacyPath => legacyPath in web.lessons),
    webAndAndroidPathSetsMatch: webEntries.length === android.lessons.length
      && webEntries.every(lesson => androidByPath.has(lesson.legacyPath))
      && android.lessons.every(lesson => lesson.legacyPath in web.lessons),
    duplicateBunnyMappings,
    duplicateAndroidBunnyMappings,
    duplicateSummaryContent,
    collectionCrossCourseReuse,
    pullZoneHosts: { web: web.pullZoneHost, android: android.pullZoneHost },
    androidSourceSha256: android.sourceSha256,
    computedAndroidSourceSha256,
    androidCatalogMatchesCurrentInputs: android.sourceSha256 === computedAndroidSourceSha256,
    summaryChunkSourceHashes
  },
  activeWebTaxonomy: webTaxonomy,
  sourceConfirmedDisplayTitleOverrides,
  courseTaxonomyAudit: courseTaxonomy,
  confirmedIssues,
  suspectedIssues,
  limitations: [
    'Static metadata can prove duplicate/mismatched IDs and taxonomy contradictions, but it cannot prove that a Bunny ID serves the intended visual lesson.',
    'A media-content audit (duration plus sampled frames/audio/transcript) is required to validate every Bunny asset against its title and instructor.',
    'A style word used for comparison inside one lesson is not treated as a category mismatch; course-level repeated explicit evidence is required.'
  ]
};

if (writeReport) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

console.log(`Audited ${report.scope.lessonCountAudited} lessons across ${report.scope.courseCountAudited} courses.`);
console.log(`Confirmed issues: ${confirmedIssues.length}; suspected issues: ${suspectedIssues.length}.`);
console.log(`High-confidence mislabeled courses: ${taxonomyIssues.length} (${report.counts.highConfidenceAffectedLessons} lessons).`);
console.log(`Duplicate Bunny IDs: ${duplicateBunnyMappings.length}; duplicate normalized summaries: ${duplicateSummaryContent.length}.`);
for (const item of [...confirmedIssues, ...suspectedIssues]) {
  console.log(`${item.confidence === 'confirmed' ? 'CONFIRMED' : 'REVIEW'} ${item.code}: ${item.summary}`);
}
if (writeReport) console.log(`Report: ${relative(reportPath)}`);

process.exitCode = confirmedIssues.some(item => item.severity === 'error') ? 1 : 0;
