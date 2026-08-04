import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = filename => fs.readFileSync(path.join(root, filename), 'utf8');
const fail = message => { throw new Error(message); };

for (const filename of [
  'index.html', 'style.css', 'app.js', 'course-taxonomy.js', 'playback-core.js', 'data.js', 'salsa_course.js',
  'manifest.json', 'sw.js', 'icon.svg', 'icon-192.png', 'icon-512.png'
]) {
  if (!fs.existsSync(path.join(root, filename))) fail(`Missing required asset: ${filename}`);
}

const index = read('index.html');
const ids = [...index.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
if (duplicateIds.length) fail(`Duplicate HTML IDs: ${duplicateIds.join(', ')}`);

const androidApkUrl = 'https://github.com/Deadlywolf712/dance-library/releases/latest/download/Dance-Library-Android.apk';
if (!index.includes('id="android-download-link"') || !index.includes(`href="${androidApkUrl}"`)) {
  fail('The home page must expose the durable Android APK download link.');
}
if (!index.includes('target="_blank"') || !index.includes('rel="noopener noreferrer"')) {
  fail('The external Android download must preserve the library tab safely.');
}

for (const match of index.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const reference = match[1];
  if (/^(?:https?:|#|mailto:)/.test(reference)) continue;
  if (reference.startsWith('/')) fail(`Root-absolute asset is unsafe for project Pages: ${reference}`);
  const filename = reference.replace(/^\.\//, '').split(/[?#]/)[0];
  if (filename && !fs.existsSync(path.join(root, filename))) fail(`HTML references missing asset: ${reference}`);
}

const manifest = JSON.parse(read('manifest.json'));
if (manifest.start_url !== './' || manifest.scope !== './') {
  fail('manifest.json must keep start_url and scope relative to the GitHub Pages project path.');
}

const css = read('style.css');
const themeBlocks = [...css.matchAll(/\[data-theme="([^"]+)"\][^{]*\{([^}]+)\}/g)];
if (themeBlocks.length < 100) fail(`Expected the full theme library, found only ${themeBlocks.length} themes.`);

const rgbFromHex = value => {
  let hex = value.replace('#', '');
  if (hex.length === 3) hex = [...hex].map(character => character + character).join('');
  return [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16));
};
const luminance = rgb => rgb.map(value => {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}).reduce((total, channel, index) => total + (channel * [0.2126, 0.7152, 0.0722][index]), 0);
const contrast = (first, second) => {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

for (const [, themeName, body] of themeBlocks) {
  const variables = Object.fromEntries(
    [...body.matchAll(/--([\w-]+)\s*:\s*(#[0-9a-f]{3,6})/gi)].map(match => [match[1], match[2]])
  );
  const required = ['bg-base', 'bg-surface', 'text-main', 'text-muted', 'accent', 'pill-text'];
  if (required.some(name => !variables[name])) fail(`Theme ${themeName} is missing required color tokens.`);
  const base = rgbFromHex(variables['bg-base']);
  const surface = rgbFromHex(variables['bg-surface']);
  const main = rgbFromHex(variables['text-main']);
  let muted = rgbFromHex(variables['text-muted']);
  const accent = rgbFromHex(variables.accent);
  let pill = rgbFromHex(variables['pill-text']);
  const readable = [main, [0, 0, 0], [255, 255, 255]].sort((a, b) =>
    Math.min(contrast(b, base), contrast(b, surface)) - Math.min(contrast(a, base), contrast(a, surface))
  )[0];
  if (Math.min(contrast(muted, base), contrast(muted, surface)) < 4.5) muted = readable;
  const focus = Math.min(contrast(accent, base), contrast(accent, surface)) >= 3 ? accent : readable;
  if (contrast(accent, pill) < 4.5) {
    pill = contrast(accent, [255, 255, 255]) >= contrast(accent, [0, 0, 0]) ? [255, 255, 255] : [0, 0, 0];
  }
  if (Math.min(contrast(muted, base), contrast(muted, surface)) < 4.5) fail(`Theme ${themeName} has unreadable muted text.`);
  if (Math.min(contrast(focus, base), contrast(focus, surface)) < 3) fail(`Theme ${themeName} has an invisible focus ring.`);
  if (contrast(accent, pill) < 4.5) fail(`Theme ${themeName} has unreadable accent buttons.`);
}

const catalogContext = {};
vm.createContext(catalogContext);
vm.runInContext(`${read('data.js')}\n;globalThis.__catalog = videoData;`, catalogContext, { filename: 'data.js' });
const catalog = catalogContext.__catalog;
const lessonPaths = Object.keys(catalog);
if (lessonPaths.length !== 795) fail(`Expected 795 lessons, found ${lessonPaths.length}.`);

const taxonomyContext = {};
vm.createContext(taxonomyContext);
vm.runInContext(
  `${read('course-taxonomy.js')}\n;globalThis.__taxonomy = COURSE_TAXONOMY;`,
  taxonomyContext,
  { filename: 'course-taxonomy.js' }
);
const taxonomy = taxonomyContext.__taxonomy;
const categoryOrder = [...taxonomy.categoryOrder];
const courseCategoryEntries = Object.entries(taxonomy.courseCategoryByFolder);
const courseFolders = [...new Set(lessonPaths.map(lessonPath => lessonPath.split('/')[0]))].sort();
const mappedCourseFolders = courseCategoryEntries.map(([courseFolder]) => courseFolder).sort();
if (courseCategoryEntries.length !== 34) {
  fail(`Expected an exact taxonomy for 34 course folders, found ${courseCategoryEntries.length}.`);
}
if (JSON.stringify(mappedCourseFolders) !== JSON.stringify(courseFolders)) {
  const missing = courseFolders.filter(courseFolder => !mappedCourseFolders.includes(courseFolder));
  const unexpected = mappedCourseFolders.filter(courseFolder => !courseFolders.includes(courseFolder));
  fail(`Course taxonomy mismatch. Missing: ${missing.join(', ') || 'none'}. Unexpected: ${unexpected.join(', ') || 'none'}.`);
}
const expectedCourseDisplayNames = {
  'Adolfo Indacochea  Tania Cannarsa - Salsa On2 Advanced': 'Adolfo Indacochea & Tania Cannarsa - Salsa On2 Advanced',
  'Adolfo Indacochea  Tania Cannarsa - Salsa On2 Beginner': 'Adolfo Indacochea & Tania Cannarsa - Salsa On2 Beginner',
  'Adolfo Indacochea  Tania Cannarsa - Salsa On2 Intermediate': 'Adolfo Indacochea & Tania Cannarsa - Salsa On2 Intermediate',
  'Fernando Sosa  Tatiana Bonaguro - Sosa Style Advanced': 'Fernando Sosa & Tatiana Bonaguro - Sosa Style Advanced',
  'Fernando Sosa  Tatiana Bonaguro - Sosa Style Beginner': 'Fernando Sosa & Tatiana Bonaguro - Sosa Style Beginner',
  'Fernando Sosa  Tatiana Bonaguro - Sosa Style Intermediate': 'Fernando Sosa & Tatiana Bonaguro - Sosa Style Intermediate',
  'Fernando Sosa  Tatiana Bonaguro - Sosa Style On 2': 'Fernando Sosa & Tatiana Bonaguro - Sosa Style On 2',
  'Fernando Sosa  Tatiana Bonaguro - Sosa Style Upgrade': 'Fernando Sosa & Tatiana Bonaguro - Sosa Style Upgrade',
  'Alex  Desirée - Advanced': 'Alex & Desirée — Advanced',
  'Alex  Desirée - Beginner': 'Alex & Desirée — Beginner',
  'Alex  Desirée - Intermediate': 'Alex & Desirée — Intermediate',
  'Kike  Nahir - Kike  Nahir Combinations': 'Kike & Nahir — Bachata Sensual Combinations',
  'Korke  Judith - Advanced': 'Korke & Judith — Advanced',
  'Korke  Judith - Bachata Sensual 2025 New Techniques and Cadences': 'Korke & Judith — Bachata Sensual 2025: New Techniques and Cadences (Intermediate/Advanced)',
  'Korke  Judith - BeginnerIntermediate': 'Korke & Judith — Beginner/Intermediate',
  'Korke  Judith - Fundamentals of Bachata Sensual': 'Korke & Judith — Fundamentals of Bachata Sensual (Beginner)',
  'Korke  Judith - Intermediate  Advanced': 'Korke & Judith — Intermediate/Advanced',
  'Marco Espejo - Marco Espejo Style': 'Marco Espejo — Marco Espejo Style (Open Level)',
  'Pablo  Raquel - Advanced': 'Pablo & Raquel — Advanced',
  'Pablo  Raquel - Intermediate': 'Pablo & Raquel — Intermediate/Advanced',
  'Pablo  Raquel - IntermediateAdvanced': 'Pablo & Raquel — Smooth Bachata Intermediate/Advanced',
  'Arthur  Oksana - Zouk Advanced': 'Arthur & Oksana — Zouk Advanced',
  'Arthur  Oksana - Zouk Beginner': 'Arthur & Oksana — Zouk Beginner',
  'Arthur  Oksana - Zouk Beginner-Intermediate': 'Arthur & Oksana — Zouk Beginner–Intermediate',
  'Arthur  Oksana - Zouk Intermediate': 'Arthur & Oksana — Zouk Intermediate',
  'Arthur  Oksana - Zouk Intermediate-Advanced': 'Arthur & Oksana — Zouk Intermediate–Advanced',
  'Isabelle  Felicien - Advanced': 'Isabelle & Felicien — Kizomba Advanced',
  'Isabelle  Felicien - Beginner': 'Isabelle & Felicien — Kizomba Beginner',
  'Isabelle  Felicien - Intermediate': 'Isabelle & Felicien — Kizomba Intermediate'
};
const courseDisplayNames = taxonomy.courseDisplayNameByFolder;
if (!courseDisplayNames || typeof courseDisplayNames !== 'object' || Array.isArray(courseDisplayNames)) {
  fail('Course taxonomy display-name aliases must be an object.');
}
const courseDisplayNameEntries = Object.entries(courseDisplayNames);
if (courseDisplayNameEntries.length !== Object.keys(expectedCourseDisplayNames).length) {
  fail(`Expected exactly ${Object.keys(expectedCourseDisplayNames).length} course display-name aliases.`);
}
for (const [courseFolder, displayName] of courseDisplayNameEntries) {
  if (!courseFolders.includes(courseFolder)) fail(`Course display-name alias has an unknown folder: ${courseFolder}.`);
  if (typeof displayName !== 'string' || !displayName.trim() || displayName.trim() !== displayName) {
    fail(`Course display-name alias must be a non-empty trimmed string: ${courseFolder}.`);
  }
  if (expectedCourseDisplayNames[courseFolder] !== displayName) {
    fail(`Course display-name alias is not source-confirmed: ${courseFolder}.`);
  }
}
for (const [courseFolder, displayName] of Object.entries(expectedCourseDisplayNames)) {
  if (courseDisplayNames[courseFolder] !== displayName) {
    fail(`Course display-name alias is missing or incorrect: ${courseFolder}.`);
  }
}
if (new Set(categoryOrder).size !== categoryOrder.length || categoryOrder.at(-1) !== 'Other') {
  fail('Course taxonomy category order must contain unique categories and finish with Other.');
}
for (const [courseFolder, category] of courseCategoryEntries) {
  if (!categoryOrder.includes(category) || category === 'Other') {
    fail(`Course taxonomy has an invalid category for ${courseFolder}: ${category}.`);
  }
}
for (const courseFolder of [
  'Carolina Rosa - Advanced',
  'Carolina Rosa - Beginner',
  'Carolina Rosa - Intermediate',
  'Marco Espejo - Marco Espejo Style'
]) {
  if (taxonomy.courseCategoryByFolder[courseFolder] !== 'Bachata') {
    fail(`${courseFolder} must be categorized as Bachata.`);
  }
}

const summaryManifest = JSON.parse(read('summaries/manifest.json'));
if (summaryManifest.lessonCount !== lessonPaths.length || summaryManifest.summaryCount !== lessonPaths.length) {
  fail('Summary manifest counts do not match the lesson catalog.');
}

const summaries = new Map();
for (const chunk of summaryManifest.chunks) {
  const filename = path.join('summaries', chunk.file);
  if (!fs.existsSync(path.join(root, filename))) fail(`Missing summary chunk: ${filename}`);
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${read(filename)}\n;globalThis.__registry = globalThis.DanceLibrarySummaries;`, context, { filename });
  const entries = context.__registry?.[chunk.id];
  if (!entries || typeof entries !== 'object') fail(`Summary chunk did not register: ${chunk.id}`);
  if (Object.keys(entries).length !== chunk.lessons) fail(`Summary count mismatch in ${chunk.id}.`);
  for (const [lessonPath, summary] of Object.entries(entries)) {
    if (typeof summary !== 'string' || !summary.trim()) fail(`Empty summary: ${lessonPath}`);
    if (summaries.has(lessonPath)) fail(`Duplicate summary: ${lessonPath}`);
    summaries.set(lessonPath, summary);
  }
}

for (const lessonPath of lessonPaths) {
  const info = catalog[lessonPath];
  if (!info.bunny_id) fail(`Lesson is missing bunny_id: ${lessonPath}`);
  if (!info.summary_chunk) fail(`Lesson is missing summary_chunk: ${lessonPath}`);
  if (Object.hasOwn(info, 'title') && (typeof info.title !== 'string' || !info.title.trim())) {
    fail(`Lesson title override must be a non-empty string: ${lessonPath}`);
  }
  if (Object.hasOwn(info, 'availability')) {
    if (info.availability !== 'unavailable') fail(`Unknown lesson availability state: ${lessonPath}`);
    if (typeof info.availability_reason !== 'string' || !info.availability_reason.trim()) {
      fail(`Unavailable lesson is missing a reason: ${lessonPath}`);
    }
  } else if (Object.hasOwn(info, 'availability_reason')) {
    fail(`Available lesson unexpectedly has an availability reason: ${lessonPath}`);
  }
  if (!summaries.has(lessonPath)) fail(`Lesson is missing its lazy summary: ${lessonPath}`);
}
const unavailableLessons = lessonPaths.filter(lessonPath => catalog[lessonPath].availability === 'unavailable');
const expectedUnavailableLesson = 'Salsa Masterclass/Week 3/Spot Overturn/Spot Overturn - Explanation On2.mp4';
if (unavailableLessons.length !== 1 || unavailableLessons[0] !== expectedUnavailableLesson) {
  fail(`Unexpected unavailable-lesson set: ${unavailableLessons.join(', ') || 'none'}.`);
}

const sw = read('sw.js');
const app = read('app.js');
const appVersion = index.match(/app\.js\?v=(\d+)/)?.[1];
const swVersion = sw.match(/CACHE_VERSION\s*=\s*(\d+)/)?.[1];
if (!appVersion || appVersion !== swVersion) fail('HTML asset version and service-worker cache version differ.');
const summaryVersion = app.match(/SUMMARY_ASSET_VERSION\s*=\s*(\d+)/)?.[1];
if (summaryVersion !== swVersion) fail('Summary asset version and service-worker cache version differ.');
if (!/m4v\|apk/.test(sw)) fail('The service worker must never cache Android installer downloads.');
for (const asset of ['style.css', 'app.js', 'course-taxonomy.js', 'data.js', 'salsa_course.js', 'playback-core.js']) {
  if (!index.includes(`${asset}?v=${swVersion}`) || !sw.includes(`./${asset}?v=${swVersion}`)) {
    fail(`${asset} must use the current HTML and service-worker asset version.`);
  }
}
if (index.indexOf('course-taxonomy.js') > index.indexOf('app.js')) {
  fail('The course taxonomy must load before the application.');
}
if (!app.includes('hls.js@1.6.16/dist/hls.min.js') || !/sha384-[A-Za-z0-9+/=]{64}/.test(app)) {
  fail('The lazy HLS runtime must remain pinned and protected by an integrity hash.');
}

console.log(`Validated ${lessonPaths.length} lessons, ${summaryManifest.chunks.length} lazy summary chunks, ${themeBlocks.length} themes, ${ids.length} unique IDs, and GitHub Pages-relative assets.`);
