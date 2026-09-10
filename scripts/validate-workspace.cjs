'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, before, after } = require('node:test');
const { chromium } = require('playwright');
const workspace = require('../practice-workspace.js');

test('time parser accepts seconds, minute/second, hour/minute/second and rejects ambiguous ranges', () => {
    for (const [text, expected] of [['0', 0], ['12.5', 12.5], [' 1:02 ', 62], ['99:59', 5999], ['2:03:04.5', 7384.5]]) {
        assert.equal(workspace.parseTime(text), expected, text);
    }
    for (const text of ['', ' ', '-1', 'NaN', 'Infinity', '1:60', '1:60:00', '1::2', '1:2:3:4', '1.5:20', ':20', '0x20', '1e3']) {
        assert.equal(workspace.parseTime(text), null, text);
    }
    for (const seconds of [0, 9.25, 10.5, 59.999, 60, 3599, 3600, 7384.5]) {
        assert.equal(workspace.parseTime(workspace.formatTime(seconds)), seconds);
    }
});

let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function setup(seed = {}) {
    const context = await browser.newContext({ bypassCSP: true, viewport: { width: 1400, height: 1000 } });
    const page = await context.newPage();
    await page.route('**/*', route => route.abort());
    const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
    await page.evaluate(source => {
        // Parse the repository fixture without executing its application scripts.
        // Mount only its markup; each controller under test is loaded explicitly below.
        const fixture = new DOMParser().parseFromString(source, 'text/html');
        for (const script of fixture.querySelectorAll('script')) script.remove();
        document.replaceChild(document.adoptNode(fixture.documentElement), document.documentElement);
    }, html);
    assert.equal(await page.locator('script').count(), 0);
    for (const name of ['practice-store.js', 'library-core.js', 'practice-workspace.js']) {
        await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '..', name), 'utf8') });
    }
    await page.evaluate(seed => {
        document.querySelector('#app-loader')?.remove();
        document.querySelector('#video-view').style.display = 'block';
        document.querySelector('#bookmarks-bar').style.display = 'block';
        document.querySelector('.lesson-reflection').open = true;
        document.querySelector('#queue-view').hidden = false;
        const records = new Map(Object.entries(seed).map(([key, value]) => [key, JSON.stringify(value)]));
        globalThis.__failWrites = false;
        globalThis.__storage = {
            getItem: key => records.get(key) ?? null,
            setItem: (key, value) => { if (globalThis.__failWrites) throw new DOMException('Quota full', 'QuotaExceededError'); records.set(key, value); },
            removeItem: key => { records.delete(key); }
        };
        const catalog = DanceLibraryCatalog.createCatalog({
            'Course/A.mp4': { title: 'Alpha lesson' }, 'Course/B.mp4': { title: 'Beta lesson' }
        }, { categoryOrder: ['Salsa'], courseCategoryByFolder: { Course: 'Salsa' } });
        globalThis.__repository = DanceLibraryStore.createRepository({ storage: __storage, locks: null });
        globalThis.__otherRepository = DanceLibraryStore.createRepository({ storage: __storage, locks: null });
        globalThis.__current = catalog.find('Course/A.mp4');
        globalThis.__video = { duration: 120 };
        globalThis.__calls = [];
        globalThis.__createWorkspace = () => DanceLibraryWorkspace.create({
            repository: __repository, catalog, getCurrentVideo: () => __current, getVideoElement: () => __video,
            openVideo: (path, options) => __calls.push({ action: 'open', path, options }),
            showHome: () => __calls.push({ action: 'home' }), showNotes: () => {},
            setLoop: segment => __calls.push({ action: 'loop', segment }),
            getLoop: () => ({ start: 10, end: 20 }), getSpeed: () => 0.75,
            showToast: text => __calls.push({ action: 'toast', text }), onPracticeChange: () => {}
        });
        globalThis.__workspace = __createWorkspace();
        globalThis.__switchLesson = path => { __current = catalog.find(path); __workspace.lessonChanged(); };
    }, seed);
    return { page, close: () => context.close() };
}

async function eventually(page, expression) {
    await page.waitForFunction(expression);
}

test('queue/completion use fresh state, retain unknown metadata, and stay separate from watched history', async () => {
    const app = await setup({ practiceData: { version: 1, queue: [], segments: [], completed: {}, reflections: {}, future: { keep: true } } });
    try {
        await app.page.locator('#lesson-queue-toggle').click();
        await eventually(app.page, () => __workspace.readPractice().queue.length === 1);
        await app.page.evaluate(async () => {
            await __otherRepository.update('practiceData', DanceLibraryStore.emptyPracticeData(), data => ({ ...data, queue: [...data.queue, 'Course/B.mp4'] }), DanceLibraryStore.validatePracticeData);
        });
        await app.page.locator('#queue-list .queue-lesson[data-path="Course/A.mp4"] .queue-options > summary').click();
        await app.page.locator('#queue-list [data-workspace-action="down"][data-path="Course/A.mp4"]').click();
        await eventually(app.page, () => __workspace.readPractice().queue[0] === 'Course/B.mp4');
        await app.page.locator('#lesson-complete-toggle').click();
        await eventually(app.page, () => Object.hasOwn(__workspace.readPractice().completed, 'Course/A.mp4'));
        const data = await app.page.evaluate(() => ({ practice: __workspace.readPractice(), watched: __storage.getItem('watchedVideos') }));
        assert.deepEqual(data.practice.future, { keep: true });
        assert.equal(data.watched, null);
        assert.equal(await app.page.locator('#nav-queue-count').textContent(), '2');
        assert.equal(await app.page.locator('#nav-queue-count').getAttribute('aria-label'), '2 lessons in queue');
        await app.page.locator('#queue-list [data-workspace-action="remove"][data-path="Course/A.mp4"]').click();
        await eventually(app.page, () => __workspace.readPractice().queue.length === 1);
        assert.equal(await app.page.locator('#lesson-queue-toggle').getAttribute('aria-pressed'), 'false');
    } finally { await app.close(); }
});

test('tabs support roving keyboard focus and saved segment validation, play, delete, and undo', async () => {
    const app = await setup();
    try {
        await app.page.locator('#practice-tab-notes').focus();
        await app.page.keyboard.press('End');
        assert.equal(await app.page.locator('#practice-tab-segments').getAttribute('aria-selected'), 'true');
        assert.equal(await app.page.locator('#bookmarks-bar').evaluate(element => element.hidden), true);
        await app.page.locator('#segment-title').fill('A useful <transition>');
        await app.page.locator('#segment-start').fill('0:20');
        await app.page.locator('#segment-end').fill('2:30');
        await app.page.locator('#segment-form button[type="submit"]').click();
        assert.match(await app.page.locator('#segment-status').textContent(), /within/);
        assert.equal(await app.page.evaluate(() => __workspace.readPractice().segments.length), 0);
        await app.page.locator('#segment-use-loop').click();
        await app.page.locator('#segment-form button[type="submit"]').click();
        await eventually(app.page, () => __workspace.readPractice().segments.length === 1);
        assert.equal(await app.page.locator('.saved-segment strong').textContent(), 'A useful <transition>');
        assert.equal(await app.page.locator('.saved-segment transition').count(), 0);
        await app.page.locator('[data-workspace-action="play-segment"]').click();
        const call = await app.page.evaluate(() => __calls.find(call => call.action === 'loop'));
        assert.equal(call.segment.start, 10);
        assert.equal(call.segment.end, 20);
        assert.equal(call.segment.speed, 0.75);
        await app.page.locator('[data-workspace-action="delete-segment"]').click();
        await eventually(app.page, () => __workspace.readPractice().segments.length === 0);
        await app.page.locator('#segment-undo-delete').click();
        await eventually(app.page, () => __workspace.readPractice().segments.length === 1);
    } finally { await app.close(); }
});

test('reflection draft survives navigation and controller recreation, then saves without losing metadata', async () => {
    const app = await setup({ practiceData: { version: 1, queue: [], segments: [], completed: {}, reflections: {
        'Course/A.mp4': { text: 'Old reflection', updatedAt: 10, extra: 'preserved' }
    } } });
    try {
        await app.page.locator('#lesson-reflection-input').fill('First line\nSecond line <safe>');
        await eventually(app.page, () => Object.keys(JSON.parse(__storage.getItem('danceLibraryReflectionDrafts')).entries).length === 1);
        await app.page.evaluate(() => __switchLesson('Course/B.mp4'));
        assert.equal(await app.page.locator('#lesson-reflection-input').inputValue(), '');
        await app.page.evaluate(() => __switchLesson('Course/A.mp4'));
        assert.equal(await app.page.locator('#lesson-reflection-input').inputValue(), 'First line\nSecond line <safe>');
        await app.page.evaluate(() => { __workspace.destroy(); __workspace = __createWorkspace(); });
        assert.equal(await app.page.locator('#lesson-reflection-input').inputValue(), 'First line\nSecond line <safe>');
        await app.page.locator('#save-reflection').click();
        await eventually(app.page, () => __workspace.readPractice().reflections['Course/A.mp4'].text.startsWith('First line'));
        const saved = await app.page.evaluate(() => __workspace.readPractice().reflections['Course/A.mp4']);
        assert.equal(saved.extra, 'preserved');
        assert.equal(saved.text, 'First line\nSecond line <safe>');
        assert.equal(await app.page.evaluate(() => Object.keys(JSON.parse(__storage.getItem('danceLibraryReflectionDrafts')).entries).length), 0);
    } finally { await app.close(); }
});

test('a changed reflection in another tab never overwrites a dirty editor or receives a blind save', async () => {
    const app = await setup();
    try {
        await app.page.locator('#lesson-reflection-input').fill('My unsaved changes');
        await app.page.evaluate(async () => {
            await __otherRepository.update('practiceData', DanceLibraryStore.emptyPracticeData(), data => ({ ...data,
                reflections: { ...data.reflections, 'Course/A.mp4': { text: 'Other tab saved', updatedAt: 50 } }
            }), DanceLibraryStore.validatePracticeData);
        });
        assert.equal(await app.page.locator('#lesson-reflection-input').inputValue(), 'My unsaved changes');
        await app.page.locator('#save-reflection').click();
        await eventually(app.page, () => document.querySelector('#reflection-status').textContent.includes('changed in another tab'));
        assert.equal(await app.page.evaluate(() => __workspace.readPractice().reflections['Course/A.mp4'].text), 'Other tab saved');
        assert.equal(await app.page.locator('#reflection-load-saved').isVisible(), true);
        await app.page.locator('#reflection-load-saved').click();
        await eventually(app.page, () => document.querySelector('#lesson-reflection-input').value === 'Other tab saved');
        assert.equal(await app.page.evaluate(() => Object.values(JSON.parse(__storage.getItem('danceLibraryReflectionDrafts')).entries).some(draft => draft.text === 'My unsaved changes')), true);
    } finally { await app.close(); }
});

test('quota failures retain the reflection in memory across navigation and provide a recovery download', async () => {
    const app = await setup();
    try {
        await app.page.evaluate(() => { __failWrites = true; });
        await app.page.locator('#lesson-reflection-input').fill('Keep this text when storage is full');
        await app.page.locator('#save-reflection').click();
        await eventually(app.page, () => document.querySelector('#reflection-status').textContent.includes('could not be saved'));
        await app.page.evaluate(() => { __switchLesson('Course/B.mp4'); __switchLesson('Course/A.mp4'); });
        assert.equal(await app.page.locator('#lesson-reflection-input').inputValue(), 'Keep this text when storage is full');
        const pendingDownload = app.page.waitForEvent('download');
        await app.page.locator('#reflection-download-drafts').click();
        const download = await pendingDownload;
        const downloadPath = await download.path();
        const payload = JSON.parse(fs.readFileSync(downloadPath, 'utf8'));
        assert.ok(Object.values(payload.drafts).some(draft => draft.text === 'Keep this text when storage is full'));
        assert.equal(await app.page.evaluate(() => __storage.getItem('practiceData')), null);
    } finally { await app.close(); }
});

test('corrupt practice data does not prevent startup or draft capture, and recovery exposes memory without overwriting storage', async () => {
    const app = await setup({ practiceData: { broken: 'leave intact' } });
    try {
        assert.match(await app.page.locator('#reflection-status').textContent(), /could not be read/);
        await app.page.locator('#lesson-reflection-input').fill('A recoverable note despite corruption');
        await app.page.locator('#save-reflection').click();
        await eventually(app.page, () => document.querySelector('#reflection-status').textContent.includes('could not be saved'));
        const state = await app.page.evaluate(() => ({ raw: JSON.parse(__storage.getItem('practiceData')), recovery: __workspace.getRecoveryDrafts() }));
        assert.deepEqual(state.raw, { broken: 'leave intact' });
        assert.ok(Object.values(state.recovery.drafts).some(draft => draft.text === 'A recoverable note despite corruption'));
        assert.equal(typeof state.recovery.originalStoredDrafts, 'string');
    } finally { await app.close(); }
});
