// Actions must use the bookmark revision rendered on screen, even while an
// unfinished editor deliberately prevents a cross-tab refresh of nearby rows.
import { expect, test } from '@playwright/test';

const PATH = 'Carolina Rosa - Beginner/07 - Turns in 15.mp4';
const A = { t: 12, n: 'Keep the first note.', ts: 1700000000000 };
const B = { t: 30, n: 'Act on this second note.', ts: 1700000001000 };
const C = { t: 45, n: 'Keep the third note.', ts: 1700000002000 };
const row = (page, time, surface = 'notebook') => page.locator(surface === 'player'
    ? `#bookmarks-list .bookmark-pill[data-time="${time}"]`
    : `.notes-bookmark-item[data-path="${PATH}"][data-time="${time}"]`);

async function prepareStaleNotebook(page, context, surface = 'notebook') {
    await context.route('https://fonts.googleapis.com/**', route => route.abort());
    await context.route('https://fonts.gstatic.com/**', route => route.abort());
    await page.addInitScript(({ path, notes }) => {
        globalThis.Hls = class {
            static isSupported() { return true; }
            static Events = { MANIFEST_PARSED: 'manifest', FRAG_LOADED: 'fragment', ERROR: 'error' };
            static ErrorTypes = { NETWORK_ERROR: 'network', MEDIA_ERROR: 'media' };
            on() {} loadSource() {} attachMedia() {} destroy() {}
        };
        if (!localStorage.getItem('staleRowRegressionSeeded')) {
            localStorage.setItem('videoBookmarks', JSON.stringify({ [path]: notes }));
            localStorage.setItem('staleRowRegressionSeeded', 'true');
        }
    }, { path: PATH, notes: [A, B, C] });
    await page.goto(surface === 'player' ? `/#video=${encodeURIComponent(PATH)}` : '/');
    await expect(page.locator('body')).toHaveAttribute('data-app-ready', 'true');
    if (surface === 'notebook') {
        await page.locator('[data-workspace-view="notes"]').click();
        await row(page, A.t).locator('.notes-item-edit').click();
        await row(page, A.t).locator('textarea').fill('An unfinished draft keeps this row open.');
        await expect(row(page, A.t).getByRole('status')).toContainText('Draft kept on this device');
    } else {
        await row(page, A.t, surface).locator('.bookmark-edit-icon').click();
        await page.locator('#bookmark-edit-input').fill('An unfinished player draft keeps these rows open.');
        await expect(page.locator('#bookmark-edit-status')).toContainText('Draft kept on this device');
    }
    await expect(row(page, B.t, surface)).toHaveAttribute(surface === 'player' ? 'data-index' : 'data-bk-idx', '1');
    await page.evaluate(() => {
        globalThis.staleRowStorageEventSeen = false;
        addEventListener('storage', event => {
            if (event.key === 'videoBookmarks') globalThis.staleRowStorageEventSeen = true;
        });
    });

    const other = await context.newPage();
    await other.goto('/');
    await expect(other.locator('body')).toHaveAttribute('data-app-ready', 'true');
    await other.evaluate(async path => {
        const repo = globalThis.DanceLibraryStore.createRepository();
        const result = await repo.update('videoBookmarks', {}, current => ({
            ...current,
            [path]: [{ t: 5, n: 'Inserted in the second tab.', ts: 1700000003000 }, ...current[path]],
        }), value => globalThis.DanceLibraryNotes.normalizeBookmarks(value).invalid === 0);
        if (!result.ok) throw result.error;
    }, PATH);
    await expect.poll(() => page.evaluate(() => globalThis.staleRowStorageEventSeen)).toBe(true);
    await expect(surface === 'player' ? page.locator('#bookmark-edit-input') : row(page, A.t).locator('textarea')).toBeVisible();
    await expect(row(page, B.t, surface)).toHaveAttribute(surface === 'player' ? 'data-index' : 'data-bk-idx', '1');
    await expect(row(page, 5, surface)).toHaveCount(0);
    return other;
}

test('deleting a stale rendered row targets its displayed bookmark after another tab inserts a note', async ({ page, context }) => {
    const other = await prepareStaleNotebook(page, context);
    await row(page, B.t).locator('.notes-item-delete').click();
    await expect.poll(() => page.evaluate(path => JSON.parse(localStorage.getItem('videoBookmarks'))[path].map(note => note.t), PATH)).toEqual([5, 12, 45]);
    const kept = await page.evaluate(path => JSON.parse(localStorage.getItem('videoBookmarks'))[path].find(note => note.t === 12), PATH);
    expect(kept.n).toBe(A.n);
    await other.close();
});

test('editing a stale rendered row loads and saves its displayed bookmark after another tab inserts a note', async ({ page, context }) => {
    const other = await prepareStaleNotebook(page, context);
    await row(page, B.t).locator('.notes-item-edit').click();
    const editor = row(page, B.t).locator('textarea');
    await expect(editor).toHaveValue(B.n);
    await editor.fill('A revision specifically for the second note.');
    await row(page, B.t).getByRole('button', { name: 'Save note', exact: true }).click();
    await expect.poll(() => page.evaluate(path => JSON.parse(localStorage.getItem('videoBookmarks'))[path].find(note => note.t === 30).n, PATH)).toBe('A revision specifically for the second note.');
    const kept = await page.evaluate(path => JSON.parse(localStorage.getItem('videoBookmarks'))[path].find(note => note.t === 12), PATH);
    expect(kept.n).toBe(A.n);
    await other.close();
});

test('player deletion keeps the displayed bookmark identity when another tab inserts before it', async ({ page, context }) => {
    const other = await prepareStaleNotebook(page, context, 'player');
    await row(page, B.t, 'player').locator('.bookmark-delete').click();
    await expect.poll(() => page.evaluate(path => JSON.parse(localStorage.getItem('videoBookmarks'))[path].map(note => note.t), PATH)).toEqual([5, 12, 45]);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('danceLibraryDeletedBookmark')).bookmark)).toEqual(B);
    await other.close();
});

test('player editing keeps the displayed bookmark identity when another tab inserts before it', async ({ page, context }) => {
    const other = await prepareStaleNotebook(page, context, 'player');
    await row(page, B.t, 'player').locator('.bookmark-edit-icon').click();
    await expect(page.locator('#bookmark-edit-input')).toHaveValue(B.n);
    await expect(page.locator('#bookmark-edit-label')).toHaveText('Note at 0:30');
    await page.locator('#bookmark-edit-input').fill('Revised second player note.');
    await page.locator('#bookmark-edit-save').click();
    await expect.poll(() => page.evaluate(path => JSON.parse(localStorage.getItem('videoBookmarks'))[path].find(note => note.t === 30).n, PATH)).toBe('Revised second player note.');
    expect(await page.evaluate(path => JSON.parse(localStorage.getItem('videoBookmarks'))[path].find(note => note.t === 12).n, PATH)).toBe(A.n);
    await other.close();
});

test('editing a future-dated imported note survives reimporting its older backup', async ({ page }) => {
    const imported = { ...B, ts: 4102444800000 };
    const backup = { videoBookmarks: { [PATH]: [imported] } };
    await page.addInitScript(backup => localStorage.setItem('videoBookmarks', JSON.stringify(backup.videoBookmarks)), backup);
    await page.goto('/#view=notes');
    await expect(page.locator('body')).toHaveAttribute('data-app-ready', 'true');
    await row(page, B.t).locator('.notes-item-edit').click();
    await row(page, B.t).locator('textarea').fill('My newer edit must survive the original backup.');
    await row(page, B.t).getByRole('button', { name: 'Save note', exact: true }).click();
    await expect(row(page, B.t).locator('.notes-bookmark-note')).toHaveText('My newer edit must survive the original backup.');
    expect(await page.evaluate(path => JSON.parse(localStorage.getItem('videoBookmarks'))[path][0].ts, PATH)).toBeGreaterThan(imported.ts);
    await page.locator('#notes-view .open-export-modal-btn').click();
    page.on('dialog', dialog => dialog.accept());
    await page.locator('#import-file-input').setInputFiles({ name: 'original-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
    await expect(page.locator('#export-modal')).toBeHidden();
    await expect(row(page, B.t).locator('.notes-bookmark-note')).toHaveText('My newer edit must survive the original backup.');
});
