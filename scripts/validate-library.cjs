'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { DanceLibraryCatalog: Catalog, DanceLibraryRoutes: Routes } = require('../library-core.js');

const taxonomy = {
    categoryOrder: ['Salsa', 'Bachata', 'Other'],
    courseCategoryByFolder: { 'Alex & Desirée': 'Bachata', 'Salsa Course': 'Salsa' }
};
const lessonPath = 'Alex & Desirée/Week 1/02 - Turns in 15.mp4';
const source = {
    [lessonPath]: { title: '02 - Turns in 1/5', bunny_id: 'keep-original-id' },
    'Alex & Desirée/Week 1/10 - Engaño.mov': {},
    'Alex & Desirée/Week 1/03 - Básico.M4V': {},
    'Salsa Course/02 - Timing.mp4': {},
    'Unknown/01 - Other.mp4': {}
};

test('catalog preserves exact legacy identity, corrected titles, and source metadata without modifying input', () => {
    const before = JSON.stringify(source);
    const catalog = Catalog.createCatalog(source, taxonomy);
    assert.equal(JSON.stringify(source), before);
    assert.deepEqual(catalog.find(lessonPath), {
        title: '02 - Turns in 1/5', bunny_id: 'keep-original-id', path: lessonPath,
        category: 'Bachata', folderPath: 'Alex & Desirée/Week 1',
        folderSegments: ['Alex & Desirée', 'Week 1']
    });
    assert.equal(catalog.find('Alex & Desirée/Week 1/03 - Básico.M4V').title, '03 - Básico');
    assert.equal(catalog.find('unknown'), null);
    assert.notEqual(catalog.find(lessonPath), source[lessonPath]);
});

test('search requires every token, ignores case/diacritics, and includes category and legacy path', () => {
    const catalog = Catalog.createCatalog(source, taxonomy);
    assert.equal(catalog.search('desiree BACHATA').length, 3);
    assert.deepEqual(catalog.search('basico alex').map(entry => entry.title), ['03 - Básico']);
    assert.equal(catalog.search('turns 15').at(0).path, lessonPath);
    assert.equal(catalog.search('turns 1/5').at(0).path, lessonPath);
    assert.equal(catalog.search('desiree salsa').length, 0);
    assert.equal(catalog.search('  \t ').length, 5);
});

test('audited course aliases are searchable without replacing legacy folder identity', () => {
    const aliased = { ...taxonomy, courseDisplayNameByFolder: { 'Alex & Desirée': 'Alex & Desirée — Smooth Bachata' } };
    const catalog = Catalog.createCatalog(source, aliased);
    assert.equal(catalog.search('Smooth Bachata').length, 3);
    assert.equal(catalog.search('Alex & Desirée — Smooth Bachata').length, 3);
    assert.equal(catalog.find(lessonPath).folderPath, 'Alex & Desirée/Week 1');
    assert.equal(catalog.folder(['Bachata', 'Alex & Desirée', 'Week 1']).count, 3);
    assert.equal(catalog.folder(['Bachata', 'Alex & Desirée — Smooth Bachata']), null);
});

test('search filters category/favorite membership before applying a valid limit', () => {
    const catalog = Catalog.createCatalog(source, taxonomy);
    assert.equal(catalog.search('', { category: 'bachata' }).length, 3);
    assert.equal(catalog.search('', { favorites: new Set() }).length, 0);
    assert.deepEqual(catalog.search('', { favorites: [lessonPath, 'missing'] }).map(entry => entry.path), [lessonPath]);
    assert.equal(catalog.search('', { favorites: new Set([lessonPath]), category: 'Salsa' }).length, 0);
    assert.equal(catalog.search('desiree', { limit: 1 }).length, 1);
    assert.equal(catalog.search('', { limit: 0 }).length, 0);
    for (const limit of [-1, NaN, Infinity, 1.2, '2']) {
        assert.throws(() => catalog.search('', { limit }), /limit/);
    }
    assert.throws(() => catalog.search('', { favorites: true }), /Favorites/);
});

test('natural ordering is deterministic across source insertion order and equal normalized titles', () => {
    const forward = Catalog.createCatalog(source, taxonomy);
    const reverse = Catalog.createCatalog(Object.fromEntries(Object.entries(source).reverse()), taxonomy);
    assert.deepEqual(forward.all.map(entry => entry.path), reverse.all.map(entry => entry.path));
    assert.deepEqual(forward.search('desiree').map(entry => entry.title), [
        '02 - Turns in 1/5', '03 - Básico', '10 - Engaño'
    ]);
    const ties = Catalog.createCatalog({ 'B/z.mp4': { title: 'Same' }, 'A/a.mp4': { title: 'same' } });
    assert.deepEqual(ties.all.map(entry => entry.path), ['A/a.mp4', 'B/z.mp4']);
});

test('folder traversal preserves category/course boundaries and direct versus descendant lessons', () => {
    const catalog = Catalog.createCatalog(source, taxonomy);
    assert.deepEqual(catalog.categories, ['Salsa', 'Bachata', 'Other']);
    assert.equal(catalog.folder([]).count, 5);
    const category = catalog.folder(['Bachata']);
    assert.equal(category.videos.length, 0);
    assert.equal(category.count, 3);
    const leaf = catalog.folder(['Bachata', 'Alex & Desirée', 'Week 1']);
    assert.equal(leaf.videos.length, 3);
    assert.deepEqual(leaf.path, ['Bachata', 'Alex & Desirée', 'Week 1']);
    assert.equal(catalog.folder(['Alex & Desirée']), null);
    assert.equal(catalog.folder(['Bachata', 'missing']), null);
    assert.equal(catalog.folder('Bachata'), null);
});

test('catalog supports literal prototype-like folder names without prototype traversal', () => {
    const data = JSON.parse('{"__proto__/constructor/02.mp4":{}}');
    const catalog = Catalog.createCatalog(data);
    assert.equal(catalog.folder(['Other', '__proto__', 'constructor']).videos[0].path, '__proto__/constructor/02.mp4');
    assert.equal(catalog.folder(['toString']), null);
    assert.equal(Object.getPrototypeOf(catalog.folder([]).subfolders), null);
});

test('empty catalogs and missing taxonomy are safe; invalid source structure is explicit', () => {
    const catalog = Catalog.createCatalog({});
    assert.deepEqual(catalog.categories, []);
    assert.deepEqual(catalog.all, []);
    assert.equal(catalog.folder([]).count, 0);
    assert.equal(Catalog.createCatalog({ 'Lesson.mp4': {} }).find('Lesson.mp4').category, 'Other');
    assert.throws(() => Catalog.createCatalog(null), /catalog/i);
    assert.throws(() => Catalog.createCatalog({ 'Course/': {} }), /path/);
});

test('legacy video hashes preserve exact path encoding and add optional timestamp support', () => {
    const route = { view: 'video', path: lessonPath };
    assert.equal(Routes.format(route), `#video=${encodeURIComponent(lessonPath)}`);
    assert.deepEqual(Routes.parse(Routes.format(route)), route);
    assert.deepEqual(Routes.parse(`video=${encodeURIComponent(lessonPath)}&t=12.5`), { ...route, time: 12.5 });
    for (const time of [0, 12.5, 1e-7, Number.MAX_SAFE_INTEGER]) {
        assert.deepEqual(Routes.parse(Routes.format({ ...route, time })), { ...route, time });
    }
});

test('route round trips preserve special characters, literal percent sequences, and folder segment slashes', () => {
    const routes = [
        { view: 'home' }, { view: 'notes' }, { view: 'queue' },
        { view: 'video', path: 'Course & + # %/Literal %2F café?=.mp4', time: 3 },
        { view: 'folder', path: ['Bachata', 'A/B & C + D', 'Question? #50%'] }
    ];
    for (const route of routes) assert.deepEqual(Routes.parse(Routes.format(route)), route);
    assert.deepEqual(Routes.parse('#notes'), { view: 'notes' });
    assert.deepEqual(Routes.parse('#queue'), { view: 'queue' });
    assert.deepEqual(Routes.parse('#'), { view: 'home' });
});

test('malformed URI, ambiguous selectors, invalid folder JSON, and invalid times fail safely', () => {
    const malformed = [
        '#video=%', '#video=%GG', '#video=%C3%28', '#video=%E0%A4%A', '#video=%00',
        '#video=', '#video=A&video=B', '#video=A&view=notes', '#t=1', '#view=nope',
        '#view=notes&t=1', '#unknown=A', '#folder=no-json', '#folder=%7B%7D',
        '#folder=%5B%5D', '#folder=%5B%22%22%5D', '#folder=%5B1%5D',
        ...['', '-1', 'NaN', 'Infinity', '1x', '0x10', '1e309', '9007199254740992'].map(t => `#video=A&t=${t}`)
    ];
    for (const hash of malformed) assert.deepEqual(Routes.parse(hash), { view: 'home', invalid: true }, hash);
    assert.deepEqual(Routes.parse(null), { view: 'home', invalid: true });
    for (const time of [-1, NaN, Infinity, '12', null, Number.MAX_SAFE_INTEGER + 1]) {
        assert.equal(Routes.format({ view: 'video', path: 'A', time }), '');
    }
    assert.equal(Routes.format({ view: 'folder', path: [] }), '');
    assert.equal(Routes.format({ view: 'video', path: '\ud800' }), '');
});

test('browser globals load without CommonJS, DOM, storage, or network', () => {
    const browser = { URLSearchParams };
    vm.createContext(browser);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../library-core.js'), 'utf8'), browser);
    assert.equal(typeof browser.DanceLibraryCatalog.createCatalog, 'function');
    assert.equal(browser.DanceLibraryRoutes.parse('#view=notes').view, 'notes');
    assert.equal(browser.DanceLibraryCatalog.createCatalog(source, taxonomy).all.length, 5);
});

test('actual 795-lesson catalog keeps all legacy paths and exact course taxonomy', () => {
    const root = path.resolve(__dirname, '..');
    const context = {};
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(root, 'data.js'), 'utf8')
        + '\n' + fs.readFileSync(path.join(root, 'course-taxonomy.js'), 'utf8')
        + '\nglobalThis.data = videoData; globalThis.taxonomy = COURSE_TAXONOMY;', context);
    const catalog = Catalog.createCatalog(context.data, context.taxonomy);
    assert.equal(catalog.all.length, 795);
    assert.equal(catalog.search('carolina').length, 30);
    assert.equal(catalog.search('carolina bachata').length, 30);
    assert.equal(catalog.search('carolina salsa').length, 0);
    assert.equal(catalog.find('Carolina Rosa - Beginner/07 - Turns in 15.mp4').title, '07 - Turns in 1/5');
    for (const originalPath of Object.keys(context.data)) {
        const entry = catalog.find(originalPath);
        assert.equal(entry.path, originalPath);
        assert.equal(entry.bunny_id, context.data[originalPath].bunny_id);
        assert.deepEqual(Routes.parse(Routes.format({ view: 'video', path: originalPath })), { view: 'video', path: originalPath });
        assert.ok(catalog.folder([entry.category, ...entry.folderSegments]).videos.includes(entry));
    }
});
