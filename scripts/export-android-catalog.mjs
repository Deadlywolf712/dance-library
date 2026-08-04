import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalogPath = path.join(root, 'data.js');
const manifestPath = path.join(root, 'summaries', 'manifest.json');
const courseTaxonomyPath = path.join(root, 'course-taxonomy.js');
const salsaCoursePath = path.join(root, 'salsa_course.js');
const themeMarkupPath = path.join(root, 'index.html');
const themeStylesPath = path.join(root, 'style.css');
const outputPath = path.join(root, 'android', 'app', 'src', 'main', 'assets', 'catalog.json');

const EXPECTED_LESSONS = 795;
const EXPECTED_CHUNKS = 34;
const EXPECTED_CATEGORIES = 6;
const EXPECTED_FOLDERS = 97;
const EXPECTED_EXACT_LESSON_FOLDERS = 88;
const EXPECTED_THEMES = 103;
const EXPECTED_SALSA_WEEKS = 6;
const EXPECTED_SALSA_FOLDER_PRESENTATIONS = 47;
const DEFAULT_THEME_ID = 'arctic';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VIDEO_EXTENSION_RE = /\.(mp4|mov|m4v)$/i;
const SUMMARY_CHUNK_RE = /^[a-z0-9-]+$/;
const THEME_ID_RE = /^[a-z0-9-]+$/;
const CSS_COLOR_RE = /^(?:#[0-9a-f]{3,8}|rgba?\([^\r\n()]+\))$/i;
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

const THEME_VARIABLES = [
  '--bg-base',
  '--bg-surface',
  '--bg-surface-hover',
  '--text-main',
  '--text-muted',
  '--accent',
  '--border-light',
  '--pill-text'
];

const CATEGORY_ORDER = [
  { id: 'salsa', title: 'Salsa' },
  { id: 'bachata', title: 'Bachata' },
  { id: 'zouk', title: 'Zouk' },
  { id: 'kizomba', title: 'Kizomba' },
  { id: 'salsa-masterclass', title: 'Salsa Masterclass' },
  { id: 'kizomba-masterclass', title: 'Kizomba Masterclass' },
  { id: 'other', title: 'Other' }
];

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function parseCourseTaxonomy(source) {
  assert(source.includes('const COURSE_TAXONOMY ='), 'course-taxonomy.js does not define COURSE_TAXONOMY.');

  let serialized;
  try {
    serialized = vm.runInNewContext(
      `${source}\n;JSON.stringify(COURSE_TAXONOMY);`,
      Object.create(null),
      {
        filename: path.relative(root, courseTaxonomyPath),
        timeout: 1_000,
        contextCodeGeneration: { strings: false, wasm: false }
      }
    );
  } catch (error) {
    fail(`course-taxonomy.js could not be evaluated as static taxonomy data: ${error.message}`);
  }

  let taxonomy;
  try {
    taxonomy = JSON.parse(serialized);
  } catch (error) {
    fail(`course-taxonomy.js did not serialize to JSON: ${error.message}`);
  }

  assert(taxonomy && typeof taxonomy === 'object' && !Array.isArray(taxonomy), 'COURSE_TAXONOMY must be an object.');
  assert(Array.isArray(taxonomy.categoryOrder), 'COURSE_TAXONOMY.categoryOrder must be an array.');
  assert(
    taxonomy.courseCategoryByFolder &&
      typeof taxonomy.courseCategoryByFolder === 'object' &&
      !Array.isArray(taxonomy.courseCategoryByFolder),
    'COURSE_TAXONOMY.courseCategoryByFolder must be an object.'
  );
  assert(
    taxonomy.courseDisplayNameByFolder &&
      typeof taxonomy.courseDisplayNameByFolder === 'object' &&
      !Array.isArray(taxonomy.courseDisplayNameByFolder),
    'COURSE_TAXONOMY.courseDisplayNameByFolder must be an object.'
  );

  const expectedCategoryTitles = CATEGORY_ORDER.map(category => category.title);
  assert(
    JSON.stringify(taxonomy.categoryOrder) === JSON.stringify(expectedCategoryTitles),
    `COURSE_TAXONOMY.categoryOrder must be exactly ${expectedCategoryTitles.join(', ')}.`
  );

  const allowedCategoryTitles = new Set(expectedCategoryTitles);
  for (const [courseFolder, categoryTitle] of Object.entries(taxonomy.courseCategoryByFolder)) {
    assert(typeof courseFolder === 'string' && courseFolder.trim() === courseFolder && courseFolder, 'Taxonomy course folders must be non-empty trimmed strings.');
    assert(
      typeof categoryTitle === 'string' && allowedCategoryTitles.has(categoryTitle),
      `Taxonomy course ${courseFolder} has unsupported category title: ${categoryTitle}`
    );
  }
  for (const [courseFolder, displayName] of Object.entries(taxonomy.courseDisplayNameByFolder)) {
    assert(
      typeof courseFolder === 'string' && courseFolder.trim() === courseFolder && courseFolder,
      'Course display-name keys must be non-empty trimmed strings.'
    );
    assert(
      typeof displayName === 'string' && displayName.trim() === displayName && displayName,
      `Course display name must be a non-empty trimmed string: ${courseFolder}`
    );
  }

  return taxonomy;
}

function buildCategoryIdByCourse(taxonomy, webEntries) {
  const catalogCourses = new Set();
  for (const [legacyPath] of webEntries) {
    const [courseFolder, filenameOrFolder] = legacyPath.split('/');
    assert(courseFolder && filenameOrFolder, `Invalid lesson hierarchy: ${legacyPath}`);
    catalogCourses.add(courseFolder);
  }
  assert(catalogCourses.size === EXPECTED_CHUNKS, `Expected ${EXPECTED_CHUNKS} course folders, found ${catalogCourses.size}.`);

  const taxonomyCourses = Object.keys(taxonomy.courseCategoryByFolder);
  const missingCourses = [...catalogCourses].filter(course => !Object.hasOwn(taxonomy.courseCategoryByFolder, course));
  const unexpectedCourses = taxonomyCourses.filter(course => !catalogCourses.has(course));
  const unexpectedDisplayNames = Object.keys(taxonomy.courseDisplayNameByFolder)
    .filter(course => !catalogCourses.has(course));
  assert(missingCourses.length === 0, `Course taxonomy is missing: ${missingCourses.join(', ')}`);
  assert(unexpectedCourses.length === 0, `Course taxonomy has unknown folders: ${unexpectedCourses.join(', ')}`);
  assert(
    unexpectedDisplayNames.length === 0,
    `Course display-name aliases have unknown folders: ${unexpectedDisplayNames.join(', ')}`
  );
  assert(
    taxonomyCourses.length === EXPECTED_CHUNKS,
    `Expected ${EXPECTED_CHUNKS} exact course taxonomy entries, found ${taxonomyCourses.length}.`
  );

  const categoryIdByTitle = new Map(CATEGORY_ORDER.map(category => [category.title, category.id]));
  return new Map(taxonomyCourses.map(course => {
    const categoryTitle = taxonomy.courseCategoryByFolder[course];
    const categoryId = categoryIdByTitle.get(categoryTitle);
    assert(categoryId, `Taxonomy category has no allowed id: ${categoryTitle}`);
    return [course, categoryId];
  }));
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

function decodeHtmlText(value) {
  return value.replace(/&(?:#(\d+)|#x([0-9a-f]+)|amp|apos|quot|lt|gt);/gi, (entity, decimal, hexadecimal) => {
    if (decimal) return String.fromCodePoint(Number(decimal));
    if (hexadecimal) return String.fromCodePoint(Number.parseInt(hexadecimal, 16));
    return {
      '&amp;': '&',
      '&apos;': "'",
      '&quot;': '"',
      '&lt;': '<',
      '&gt;': '>'
    }[entity.toLowerCase()];
  });
}

function parseThemeOptions(source) {
  const selectMatches = [...source.matchAll(/<select\b[^>]*\bid="theme-select"[^>]*>([\s\S]*?)<\/select>/gi)];
  assert(selectMatches.length === 1, `Expected one theme-select element, found ${selectMatches.length}.`);

  const options = [...selectMatches[0][1].matchAll(/<option\s+value="([^"]+)"[^>]*>([^<]+)<\/option>/gi)]
    .map((match, sortOrdinal) => ({
      id: match[1],
      name: decodeHtmlText(match[2].trim()),
      sortOrdinal
    }));
  assert(options.length === EXPECTED_THEMES, `Expected ${EXPECTED_THEMES} theme options, found ${options.length}.`);

  const ids = new Set();
  for (const theme of options) {
    assert(THEME_ID_RE.test(theme.id), `Invalid theme id: ${theme.id}`);
    assert(theme.name.length > 0, `Theme ${theme.id} has no display name.`);
    assert(!ids.has(theme.id), `Duplicate theme option: ${theme.id}`);
    ids.add(theme.id);
  }
  assert(ids.has(DEFAULT_THEME_ID), `Default theme ${DEFAULT_THEME_ID} is not in theme-select.`);
  return options;
}

function parseThemeStyles(source) {
  const styles = new Map();
  const blockPattern = /\[data-theme="([^"]+)"\]\s*,\s*body\[data-theme="\1"\]\s*\{([^}]*)\}/g;

  for (const match of source.matchAll(blockPattern)) {
    const [, id, body] = match;
    assert(!styles.has(id), `Duplicate CSS theme block: ${id}`);
    const variables = {};
    for (const variable of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
      assert(!(variable[1] in variables), `Duplicate ${variable[1]} in theme ${id}.`);
      variables[variable[1]] = variable[2].trim();
    }

    const actualNames = Object.keys(variables).sort(compareCodePoints);
    const expectedNames = [...THEME_VARIABLES].sort(compareCodePoints);
    assert(
      JSON.stringify(actualNames) === JSON.stringify(expectedNames),
      `Theme ${id} must define exactly ${THEME_VARIABLES.join(', ')}.`
    );
    for (const [name, value] of Object.entries(variables)) {
      assert(CSS_COLOR_RE.test(value), `Theme ${id} has unsupported ${name} value: ${value}`);
    }
    styles.set(id, variables);
  }

  assert(styles.size === EXPECTED_THEMES, `Expected ${EXPECTED_THEMES} CSS theme blocks, found ${styles.size}.`);
  return styles;
}

function parseThemes(markupSource, stylesSource) {
  const options = parseThemeOptions(markupSource);
  const styles = parseThemeStyles(stylesSource);
  const optionIds = new Set(options.map(theme => theme.id));

  for (const id of styles.keys()) {
    assert(optionIds.has(id), `CSS theme ${id} is missing from theme-select.`);
  }

  return options.map(theme => {
    const cssVariables = styles.get(theme.id);
    assert(cssVariables, `Theme option ${theme.id} has no CSS block.`);
    return { ...theme, cssVariables };
  });
}

function parseSalsaCourse(source) {
  assert(source.includes('const salsaCourseData ='), 'salsa_course.js does not define salsaCourseData.');
  let serialized;
  try {
    serialized = vm.runInNewContext(
      `${source}\n;JSON.stringify(salsaCourseData);`,
      Object.create(null),
      {
        filename: path.relative(root, salsaCoursePath),
        timeout: 1_000,
        contextCodeGeneration: { strings: false, wasm: false }
      }
    );
  } catch (error) {
    fail(`salsa_course.js could not be evaluated as static course data: ${error.message}`);
  }

  let course;
  try {
    course = JSON.parse(serialized);
  } catch (error) {
    fail(`salsa_course.js did not serialize to JSON: ${error.message}`);
  }
  assert(course && typeof course === 'object' && !Array.isArray(course), 'salsaCourseData must be an object.');
  assert(typeof course.title === 'string' && course.title.trim(), 'salsaCourseData.title is required.');
  assert(typeof course.subtitle === 'string' && course.subtitle.trim(), 'salsaCourseData.subtitle is required.');
  assert(typeof course.intro === 'string' && course.intro.trim(), 'salsaCourseData.intro is required.');
  assert(course.weeks && typeof course.weeks === 'object' && !Array.isArray(course.weeks), 'salsaCourseData.weeks must be an object.');
  assert(course.folders && typeof course.folders === 'object' && !Array.isArray(course.folders), 'salsaCourseData.folders must be an object.');
  return course;
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

function folderId(pathSegments) {
  const digest = crypto.createHash('sha256')
    .update(pathSegments.join('/'))
    .digest('hex')
    .slice(0, 20);
  return `folder-${digest}`;
}

function requiredString(value, label) {
  assert(typeof value === 'string' && value.trim(), `${label} must be a non-empty string.`);
  return value.trim();
}

function optionalString(value, label) {
  if (value === undefined) return undefined;
  return requiredString(value, label);
}

function normalizePrerequisites(value, label) {
  if (value === undefined) return undefined;
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object.`);
  const on1 = value.on1 ?? [];
  const on2 = value.on2 ?? [];
  assert(Array.isArray(on1) && on1.every(item => typeof item === 'string' && item.trim()), `${label}.on1 must contain strings.`);
  assert(Array.isArray(on2) && on2.every(item => typeof item === 'string' && item.trim()), `${label}.on2 must contain strings.`);
  assert(on1.length + on2.length > 0, `${label} is empty.`);
  return { on1: on1.map(item => item.trim()), on2: on2.map(item => item.trim()) };
}

function attachSalsaPresentations(salsaCourse, courseMap, folderByPath, draftLessons) {
  const salsaCourseRecord = [...courseMap.values()].find(course => course.title === 'Salsa Masterclass');
  assert(salsaCourseRecord, 'The Salsa Masterclass course is missing from data.js.');
  salsaCourseRecord.presentation = {
    title: requiredString(salsaCourse.title, 'salsaCourseData.title'),
    subtitle: requiredString(salsaCourse.subtitle, 'salsaCourseData.subtitle'),
    intro: requiredString(salsaCourse.intro, 'salsaCourseData.intro')
  };

  const weeks = Object.entries(salsaCourse.weeks);
  assert(weeks.length === EXPECTED_SALSA_WEEKS, `Expected ${EXPECTED_SALSA_WEEKS} Salsa Masterclass weeks, found ${weeks.length}.`);
  for (const [weekName, value] of weeks) {
    assert(value && typeof value === 'object' && !Array.isArray(value), `Salsa week ${weekName} must be an object.`);
    const folderPath = `${salsaCourseRecord.title}/${weekName}`;
    const folder = folderByPath.get(folderPath);
    assert(folder && folder.courseId === salsaCourseRecord.id, `Salsa week folder is missing: ${folderPath}`);
    folder.presentation = {
      kind: 'week',
      title: requiredString(value.title, `${folderPath}.title`),
      number: requiredString(value.number, `${folderPath}.number`),
      color: requiredString(value.color, `${folderPath}.color`),
      description: requiredString(value.description, `${folderPath}.description`)
    };
    assert(CSS_COLOR_RE.test(folder.presentation.color), `Salsa week ${weekName} has an unsupported color.`);
  }

  const folderEntries = Object.entries(salsaCourse.folders);
  assert(
    folderEntries.length === EXPECTED_SALSA_FOLDER_PRESENTATIONS,
    `Expected ${EXPECTED_SALSA_FOLDER_PRESENTATIONS} Salsa folder presentations, found ${folderEntries.length}.`
  );
  for (const [folderPath, value] of folderEntries) {
    assert(value && typeof value === 'object' && !Array.isArray(value), `Salsa folder ${folderPath} must be an object.`);
    const folder = folderByPath.get(folderPath);
    assert(folder && folder.courseId === salsaCourseRecord.id, `Salsa presentation does not match a catalog folder: ${folderPath}`);
    assert(!folder.presentation, `Salsa folder has duplicate week and lesson-group presentation: ${folderPath}`);
    folder.presentation = {
      kind: 'lesson-group',
      description: requiredString(value.description, `${folderPath}.description`),
      ...(value.tips === undefined ? {} : { tips: optionalString(value.tips, `${folderPath}.tips`) }),
      ...(value.song === undefined ? {} : { song: optionalString(value.song, `${folderPath}.song`) }),
      ...(value.prerequisites === undefined ? {} : {
        prerequisites: normalizePrerequisites(value.prerequisites, `${folderPath}.prerequisites`)
      })
    };
  }

  const salsaLessons = draftLessons.filter(lesson => lesson.courseId === salsaCourseRecord.id);
  assert(salsaLessons.length === 127, `Expected 127 Salsa Masterclass lessons, found ${salsaLessons.length}.`);
  assert(
    salsaLessons.every(lesson => folderByPath.get([lesson.course, ...lesson.breadcrumbs].join('/'))?.presentation?.kind === 'lesson-group'),
    'Every Salsa Masterclass lesson must belong to a presented lesson-group folder.'
  );
}

const dataSource = readUtf8Strict(catalogPath);
const { pullZoneHost, lessons: webLessons } = parseWebCatalog(dataSource);
const manifest = parseJson(manifestPath);
const courseTaxonomySource = readUtf8Strict(courseTaxonomyPath);
const courseTaxonomy = parseCourseTaxonomy(courseTaxonomySource);
const salsaCourseSource = readUtf8Strict(salsaCoursePath);
const salsaCourse = parseSalsaCourse(salsaCourseSource);
const themeMarkupSource = readUtf8Strict(themeMarkupPath);
const themeStylesSource = readUtf8Strict(themeStylesPath);
const themes = parseThemes(themeMarkupSource, themeStylesSource);
const webEntries = Object.entries(webLessons);
const categoryIdByCourse = buildCategoryIdByCourse(courseTaxonomy, webEntries);
const displayNameForCourse = courseTitle => courseTaxonomy.courseDisplayNameByFolder[courseTitle] || courseTitle;

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
  .update(canonicalSourceForHash(readUtf8Strict(manifestPath)))
  .update('\0course-taxonomy.js\0')
  .update(canonicalSourceForHash(courseTaxonomySource))
  .update('\0salsa_course.js\0')
  .update(canonicalSourceForHash(salsaCourseSource))
  .update('\0index.html\0')
  .update(canonicalSourceForHash(themeMarkupSource))
  .update('\0style.css\0')
  .update(canonicalSourceForHash(themeStylesSource));
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
const folderMap = new Map();
const folderByPath = new Map();
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
  const sourceDisplayTitle = optionalString(metadata.title, `${legacyPath}.title`);
  assert(!sourceDisplayTitle?.match(/[\r\n]/), `Lesson display title contains a line break: ${legacyPath}`);
  const displayTitle = sourceDisplayTitle ?? filename.replace(VIDEO_EXTENSION_RE, '');
  const availability = metadata.availability === undefined
    ? 'available'
    : requiredString(metadata.availability, `${legacyPath}.availability`);
  assert(['available', 'unavailable'].includes(availability), `Unsupported lesson availability: ${legacyPath}`);
  const availabilityReason = metadata.availability_reason === undefined
    ? null
    : requiredString(metadata.availability_reason, `${legacyPath}.availability_reason`);
  assert(
    (availability === 'unavailable') === Boolean(availabilityReason),
    `Lesson availability and reason disagree: ${legacyPath}`
  );
  const directoryParts = pathParts.slice(0, -1);
  const courseTitle = directoryParts[0];
  const courseDisplayName = displayNameForCourse(courseTitle);
  const breadcrumbs = directoryParts.slice(1);
  const categoryId = categoryIdByCourse.get(courseTitle);
  assert(categoryId, `Course is missing from the authoritative taxonomy: ${courseTitle}`);
  const categoryTitle = CATEGORY_ORDER.find(category => category.id === categoryId)?.title;
  assert(categoryTitle, `Category title is missing: ${categoryId}`);
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
    assert(existingCourse.displayName === courseDisplayName, `Course ${courseId} maps to multiple display names.`);
    assert(existingCourse.categoryId === categoryId, `Course ${courseId} maps to multiple categories.`);
    existingCourse.lessonCount += 1;
  } else {
    courseMap.set(courseId, {
      id: courseId,
      categoryId,
      rootFolderId: folderId([courseTitle]),
      title: courseTitle,
      displayName: courseDisplayName,
      sortOrdinal: -1,
      lessonCount: 1,
      folderCount: -1
    });
  }

  let parentId = null;
  for (let depth = 0; depth < directoryParts.length; depth += 1) {
    const pathSegments = directoryParts.slice(0, depth + 1);
    const pathKey = pathSegments.join('/');
    const id = folderId(pathSegments);
    const byId = folderMap.get(id);
    const byPath = folderByPath.get(pathKey);
    if (byId || byPath) {
      assert(byId === byPath, `Folder id collision for ${pathKey}.`);
      assert(byId.parentId === parentId, `Folder ${pathKey} maps to multiple parents.`);
      assert(byId.categoryId === categoryId, `Folder ${pathKey} maps to multiple categories.`);
      assert(byId.courseId === courseId, `Folder ${pathKey} maps to multiple courses.`);
    } else {
      const folder = {
        id,
        parentId,
        categoryId,
        courseId,
        name: pathSegments.at(-1),
        displayName: depth === 0 ? courseDisplayName : pathSegments.at(-1),
        pathSegments,
        sortOrdinal: -1,
        directLessonCount: 0,
        lessonCount: 0,
        childFolderCount: 0
      };
      folderMap.set(id, folder);
      folderByPath.set(pathKey, folder);
    }
    parentId = id;
  }
  const exactFolder = folderMap.get(parentId);
  assert(exactFolder, `Lesson folder was not created: ${legacyPath}`);
  exactFolder.directLessonCount += 1;

  draftLessons.push({
    id: metadata.bunny_id,
    legacyPath,
    categoryId,
    categoryTitle,
    courseId,
    folderId: exactFolder.id,
    course: courseTitle,
    courseDisplayName,
    breadcrumbs,
    playlistId: playlistId(courseId, breadcrumbs),
    filename,
    title: displayTitle,
    availability,
    availabilityReason,
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
const playlistFolders = new Set();
for (const playlist of playlistMap.values()) {
  const folderIds = new Set(playlist.map(lesson => lesson.folderId));
  assert(folderIds.size === 1, `Playlist ${playlist[0].playlistId} spans multiple folders.`);
  const [playlistFolderId] = folderIds;
  assert(!playlistFolders.has(playlistFolderId), `Folder ${playlistFolderId} maps to multiple playlists.`);
  playlistFolders.add(playlistFolderId);
  playlist.sort((a, b) => compareNatural(a.title, b.title) || compareCodePoints(a.legacyPath, b.legacyPath));
  playlist.forEach((lesson, index) => { lesson.sortOrdinal = index; });
}

attachSalsaPresentations(salsaCourse, courseMap, folderByPath, draftLessons);

const siblingGroups = new Map();
for (const folder of folderMap.values()) {
  const siblingKey = folder.parentId ? `folder:${folder.parentId}` : `category:${folder.categoryId}`;
  if (!siblingGroups.has(siblingKey)) siblingGroups.set(siblingKey, []);
  siblingGroups.get(siblingKey).push(folder);
}
for (const siblings of siblingGroups.values()) {
  siblings.sort((a, b) => compareCodePoints(a.name, b.name) || compareCodePoints(a.id, b.id));
  siblings.forEach((folder, sortOrdinal) => { folder.sortOrdinal = sortOrdinal; });
}

const childrenByParent = new Map();
const rootFoldersByCategory = new Map();
for (const folder of folderMap.values()) {
  const targetMap = folder.parentId ? childrenByParent : rootFoldersByCategory;
  const key = folder.parentId || folder.categoryId;
  if (!targetMap.has(key)) targetMap.set(key, []);
  targetMap.get(key).push(folder);
}
for (const folders of [...childrenByParent.values(), ...rootFoldersByCategory.values()]) {
  folders.sort((a, b) => a.sortOrdinal - b.sortOrdinal || compareCodePoints(a.id, b.id));
}

const lessonsByFolder = new Map();
for (const lesson of draftLessons) {
  if (!lessonsByFolder.has(lesson.folderId)) lessonsByFolder.set(lesson.folderId, []);
  lessonsByFolder.get(lesson.folderId).push(lesson);
}
for (const lessons of lessonsByFolder.values()) {
  lessons.sort((a, b) => a.sortOrdinal - b.sortOrdinal || compareCodePoints(a.legacyPath, b.legacyPath));
}

function populateFolderRollups(folder) {
  const children = childrenByParent.get(folder.id) || [];
  folder.childFolderCount = children.length;
  let lessonCount = (lessonsByFolder.get(folder.id) || []).length;
  let folderCount = 1;
  for (const child of children) {
    const childRollup = populateFolderRollups(child);
    lessonCount += childRollup.lessonCount;
    folderCount += childRollup.folderCount;
  }
  folder.lessonCount = lessonCount;
  assert(folder.directLessonCount === (lessonsByFolder.get(folder.id) || []).length, `Direct lesson count mismatch: ${folder.id}`);
  return { lessonCount, folderCount };
}

for (const roots of rootFoldersByCategory.values()) {
  for (const rootFolder of roots) populateFolderRollups(rootFolder);
}

const courses = [...courseMap.values()].sort((a, b) => {
  const categoryDifference = categoryRank.get(a.categoryId) - categoryRank.get(b.categoryId);
  if (categoryDifference) return categoryDifference;
  const aRoot = folderMap.get(a.rootFolderId);
  const bRoot = folderMap.get(b.rootFolderId);
  assert(aRoot && bRoot, 'A course is missing its root folder.');
  return aRoot.sortOrdinal - bRoot.sortOrdinal || compareCodePoints(a.id, b.id);
});
for (const course of courses) {
  const rootFolder = folderMap.get(course.rootFolderId);
  assert(rootFolder && rootFolder.parentId === null, `Course ${course.id} has an invalid root folder.`);
  assert(rootFolder.courseId === course.id, `Course ${course.id} root folder belongs to another course.`);
  course.sortOrdinal = rootFolder.sortOrdinal;
  course.lessonCount = rootFolder.lessonCount;
  course.folderCount = [...folderMap.values()].filter(folder => folder.courseId === course.id).length;
}

const orderedFolders = [];
const orderedLessons = [];
function appendFolderDepthFirst(folder) {
  orderedFolders.push(folder);
  const children = childrenByParent.get(folder.id) || [];
  for (const child of children) appendFolderDepthFirst(child);
  orderedLessons.push(...(lessonsByFolder.get(folder.id) || []));
}
for (const category of CATEGORY_ORDER) {
  for (const rootFolder of rootFoldersByCategory.get(category.id) || []) appendFolderDepthFirst(rootFolder);
}
assert(orderedFolders.length === folderMap.size, 'Folder traversal did not visit every folder.');
assert(orderedLessons.length === draftLessons.length, 'Folder traversal did not visit every lesson.');
orderedLessons.forEach((lesson, index) => { lesson.catalogOrdinal = index; });
draftLessons.splice(0, draftLessons.length, ...orderedLessons);

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
    courseCount: courses.filter(course => course.categoryId === category.id).length,
    folderCount: orderedFolders.filter(folder => folder.categoryId === category.id).length
  }));

assert(categories.every(category => category.id !== 'other'), 'At least one course could not be categorized.');
assert(categories.length === EXPECTED_CATEGORIES, `Expected ${EXPECTED_CATEGORIES} categories, found ${categories.length}.`);
assert(courses.length === EXPECTED_CHUNKS, `Expected ${EXPECTED_CHUNKS} courses, found ${courses.length}.`);
assert(orderedFolders.length === EXPECTED_FOLDERS, `Expected ${EXPECTED_FOLDERS} folders, found ${orderedFolders.length}.`);
assert(
  orderedFolders.filter(folder => folder.directLessonCount > 0).length === EXPECTED_EXACT_LESSON_FOLDERS,
  `Expected ${EXPECTED_EXACT_LESSON_FOLDERS} exact lesson folders.`
);
assert(draftLessons.length === EXPECTED_LESSONS, `Expected ${EXPECTED_LESSONS} exported lessons.`);
assert(chapterCount === 10441, `Expected 10441 parsed chapters, found ${chapterCount}.`);
assert(introParagraphCount === 13, `Expected 13 intro paragraphs, found ${introParagraphCount}.`);

const exportDocument = {
  schemaVersion: 3,
  sourceSha256: inputHasher.digest('hex'),
  pullZoneHost,
  lessonCount: draftLessons.length,
  summaryCount: summaries.size,
  chapterCount,
  introParagraphCount,
  defaultThemeId: DEFAULT_THEME_ID,
  themes,
  categories,
  courses,
  folders: orderedFolders,
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
assert(roundTrip.schemaVersion === 3, 'Generated catalog schema version changed during its JSON round trip.');
assert(roundTrip.lessonCount === EXPECTED_LESSONS, 'Generated catalog failed its JSON round-trip validation.');
assert(roundTrip.folders.length === EXPECTED_FOLDERS, 'Generated folders failed their JSON round-trip validation.');
assert(roundTrip.themes.length === EXPECTED_THEMES, 'Generated themes failed their JSON round-trip validation.');

const digest = crypto.createHash('sha256').update(written).digest('hex');
console.log(`Exported ${roundTrip.lessonCount} lessons, ${roundTrip.chapterCount} chapters, and ${roundTrip.introParagraphCount} intro paragraphs.`);
console.log(`Hierarchy: ${roundTrip.categories.length} categories, ${roundTrip.courses.length} courses, and ${roundTrip.folders.length} folders.`);
console.log(`Themes: ${roundTrip.themes.length} website themes; default ${roundTrip.defaultThemeId}.`);
console.log(`Android catalog: ${path.relative(root, outputPath)} (${Buffer.byteLength(written).toLocaleString()} bytes)`);
console.log(`SHA-256: ${digest}`);
