import { expect, test } from '@playwright/test';

const LESSON_A = 'Carolina Rosa - Beginner/07 - Turns in 15.mp4';
const LESSON_B = 'Carolina Rosa - Advanced/09 - 33 Steps.mp4';
const BOOKMARKS = {
  [LESSON_A]: [
    { t: 12, n: 'Relax the shoulders before turning.', ts: 1700000000000 },
    { t: 30, n: 'Spot before the second turn.', ts: 1700000001000 },
    { t: 45, n: '', ts: 1700000002000 }
  ],
  [LESSON_B]: [{ t: 24, n: 'Finish with a quiet weight transfer.', ts: 1700000010000 }]
};

async function seedAndOpen(page, { rawBookmarks = JSON.stringify(BOOKMARKS), desktop = false } = {}) {
  if (desktop) await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.route('https://fonts.gstatic.com/**', route => route.abort());
  await page.addInitScript(({ raw, paths }) => {
    // Seed once per test context: reload must exercise persisted app changes.
    if (localStorage.getItem('notebookRegressionSeeded')) return;
    localStorage.setItem('videoBookmarks', raw);
    localStorage.setItem('favoriteVideos', JSON.stringify(paths));
    localStorage.setItem('watchedVideos', JSON.stringify(paths));
    localStorage.setItem('videoPositions', JSON.stringify({ [paths[0]]: 12, [paths[1]]: 24 }));
    localStorage.setItem('videoLastWatched', JSON.stringify({ [paths[0]]: 1700000000000, [paths[1]]: 1700000010000 }));
    localStorage.setItem('notebookRegressionSeeded', 'true');
  }, { raw: rawBookmarks, paths: [LESSON_A, LESSON_B] });
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-app-ready', 'true');
}

async function openNotebook(page, desktop = false) {
  await page.locator(desktop ? '#nav-notebook' : '[data-workspace-view="notes"]').click();
  await expect(page.locator('#notes-view')).toBeVisible();
}

function noteRow(page, path = LESSON_A, time = 12) {
  return page.locator(`.notes-bookmark-item[data-path="${path}"][data-time="${time}"]`);
}

async function readBookmarks(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('videoBookmarks')));
}

async function assertNoHorizontalOverflow(page) {
  const sizes = await page.evaluate(() => {
    const modal = document.querySelector('.notes-modal-content');
    const content = document.querySelector('#notes-content');
    return {
      viewport: innerWidth,
      page: document.documentElement.scrollWidth,
      modalWidth: modal.clientWidth,
      modalScroll: modal.scrollWidth,
      contentWidth: content.clientWidth,
      contentScroll: content.scrollWidth
    };
  });
  expect(sizes.page).toBeLessThanOrEqual(sizes.viewport + 1);
  expect(sizes.modalScroll).toBeLessThanOrEqual(sizes.modalWidth + 1);
  expect(sizes.contentScroll).toBeLessThanOrEqual(sizes.contentWidth + 1);
}

test('mobile notebook saves a full-length multiline note only on explicit save and cancels edits', async ({ page }) => {
  await seedAndOpen(page);
  await openNotebook(page);
  const row = noteRow(page);
  await row.locator('.notes-item-edit').click();
  const editor = row.locator('textarea.notes-inline-edit');
  await expect(editor).toHaveAttribute('maxlength', '2000');
  const prefix = 'Keep the shoulders relaxed.\nSpot before the turn.\n';
  const note = prefix + 'x'.repeat(2000 - prefix.length);
  await editor.fill(note);
  await expect(editor).toHaveValue(note);
  await expect(row.getByRole('status')).toContainText('2000/2000');
  await assertNoHorizontalOverflow(page);
  // Leaving the field must not silently commit an unfinished edit.
  await row.getByRole('button', { name: 'Cancel', exact: true }).focus();
  expect((await readBookmarks(page))[LESSON_A][0].n).toBe(BOOKMARKS[LESSON_A][0].n);
  await row.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(row.locator('textarea')).toHaveCount(0);
  expect(await row.locator('.notes-bookmark-note').textContent()).toBe(note);
  expect((await readBookmarks(page))[LESSON_A][0].n).toBe(note);
  await assertNoHorizontalOverflow(page);

  await row.locator('.notes-item-edit').click();
  await row.locator('textarea').fill('This change should be discarded.');
  await row.getByRole('button', { name: 'Cancel', exact: true }).click();
  await row.locator('.notes-item-edit').click();
  await expect(row.locator('textarea')).toHaveValue(note);
  expect((await readBookmarks(page))[LESSON_A][0].n).toBe(note);
});

test('an unfinished note survives closing the notebook and reloading the page', async ({ page }) => {
  await seedAndOpen(page);
  await openNotebook(page);
  const draft = 'Practice tomorrow:\nKeep the final step small.';
  await noteRow(page).locator('.notes-item-edit').click();
  await noteRow(page).locator('textarea').fill(draft);
  await expect(noteRow(page).getByRole('status')).toContainText('Draft kept on this device');
  await page.locator('[data-workspace-view="home"]').click();
  await openNotebook(page);
  await noteRow(page).locator('.notes-item-edit').click();
  await expect(noteRow(page).locator('textarea')).toHaveValue(draft);
  expect((await readBookmarks(page))[LESSON_A][0].n).toBe(BOOKMARKS[LESSON_A][0].n);

  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-app-ready', 'true');
  await openNotebook(page);
  await noteRow(page).locator('.notes-item-edit').click();
  await expect(noteRow(page).locator('textarea')).toHaveValue(draft);
  await noteRow(page).getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(noteRow(page).locator('textarea')).toHaveCount(0);
  expect((await readBookmarks(page))[LESSON_A][0].n).toBe(draft);
});

test('notebook search filters individual notes and supports recent and lesson ordering', async ({ page }) => {
  await seedAndOpen(page);
  await openNotebook(page);
  await expect(page.locator('#notes-sort')).toHaveValue('recent');
  await expect(page.locator('.notes-video-title')).toHaveText(['09 - 3X3 Steps', '07 - Turns in 1/5']);
  await page.locator('#notes-sort').selectOption('lesson');
  await expect(page.locator('.notes-video-title')).toHaveText(['07 - Turns in 1/5', '09 - 3X3 Steps']);
  await page.locator('#notes-search-input').fill('shoulders');
  await expect(page.locator('.notes-bookmark-item')).toHaveCount(1);
  await expect(page.locator('.notes-bookmark-note')).toHaveText(BOOKMARKS[LESSON_A][0].n);
  await expect(page.locator('#notes-results')).toContainText('1 of 4 bookmarks');
  await page.locator('#notes-search-input').fill('carolina');
  await expect(page.locator('.notes-bookmark-item')).toHaveCount(4);
  await page.getByRole('button', { name: 'With notes', exact: true }).click();
  await expect(page.locator('.notes-bookmark-item')).toHaveCount(3);
  await page.locator('#notes-search-input').fill('no-such-practice-cue');
  await expect(page.locator('.notes-bookmark-item')).toHaveCount(0);
  await expect(page.locator('#notes-content')).toContainText('No notes match your search');
  await expect(page.locator('#notes-results')).toContainText('0 of 4 bookmarks');
});

test('deleting a bookmark can be undone after a reload without changing its note or timestamp', async ({ page }) => {
  await seedAndOpen(page);
  await openNotebook(page);
  await noteRow(page).locator('.notes-item-delete').click();
  await expect(noteRow(page)).toHaveCount(0);
  await expect(page.locator('#notes-undo-btn')).toBeVisible();
  expect((await readBookmarks(page))[LESSON_A]).toEqual(BOOKMARKS[LESSON_A].slice(1));
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-app-ready', 'true');
  await openNotebook(page);
  await page.locator('#notes-undo-btn').click();
  await expect(noteRow(page).locator('.notes-bookmark-note')).toHaveText(BOOKMARKS[LESSON_A][0].n);
  expect(await readBookmarks(page)).toEqual(BOOKMARKS);
  await expect(page.locator('#notes-undo-btn')).toBeHidden();
});

test('mixed corrupt bookmarks keep the original bytes and show recoverable valid notes', async ({ page }) => {
  const mixed = JSON.stringify({
    [LESSON_A]: [BOOKMARKS[LESSON_A][0], { t: -1, n: 'Invalid negative time' }, null, { t: 90, n: { wrong: 'shape' } }],
    [LESSON_B]: BOOKMARKS[LESSON_B],
    invalidLesson: 'This should be an array'
  }, null, 2);
  await seedAndOpen(page, { rawBookmarks: mixed });
  await openNotebook(page);
  await expect(page.locator('.notes-bookmark-item')).toHaveCount(2);
  await expect(noteRow(page).locator('.notes-bookmark-note')).toHaveText(BOOKMARKS[LESSON_A][0].n);
  expect(await page.evaluate(() => localStorage.getItem('videoBookmarks'))).toBe(mixed);
  await noteRow(page).locator('.notes-item-edit').click();
  await noteRow(page).locator('textarea').fill('Do not overwrite the damaged original.');
  await noteRow(page).getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(noteRow(page).locator('textarea')).toHaveValue('Do not overwrite the damaged original.');
  await expect(noteRow(page).getByRole('status')).toContainText('Not saved');
  expect(await page.evaluate(() => localStorage.getItem('videoBookmarks'))).toBe(mixed);
});

test('a failed bookmark write retains the editor and draft, then permits a successful retry', async ({ page }) => {
  await seedAndOpen(page);
  await openNotebook(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    globalThis.restoreNotebookStorage = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = function (key, value) {
      if (key === 'videoBookmarks') throw new DOMException('Test quota exhausted', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  const row = noteRow(page);
  const replacement = 'Keep this unsaved text available.\nRetry after storage is available.';
  await row.locator('.notes-item-edit').click();
  await row.locator('textarea').fill(replacement);
  await row.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(row.locator('textarea')).toHaveValue(replacement);
  await expect(row.getByRole('status')).toContainText('Not saved');
  expect((await readBookmarks(page))[LESSON_A][0].n).toBe(BOOKMARKS[LESSON_A][0].n);
  expect(await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('danceLibraryNoteDrafts'))).map(draft => draft.n))).toContain(replacement);
  await page.evaluate(() => globalThis.restoreNotebookStorage());
  await row.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(row.locator('textarea')).toHaveCount(0);
  expect((await readBookmarks(page))[LESSON_A][0].n).toBe(replacement);
});

test('desktop keyboard editing supports newlines, Ctrl+Enter save, and Escape cancel', async ({ page }) => {
  await seedAndOpen(page, { desktop: true });
  await openNotebook(page, true);
  const row = noteRow(page);
  await row.locator('.notes-item-edit').focus();
  await page.keyboard.press('Enter');
  await expect(row.locator('textarea')).toBeFocused();
  await row.locator('textarea').fill('First practice cue');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('Second practice cue');
  await expect(row.locator('textarea')).toHaveValue('First practice cue\nSecond practice cue');
  await page.keyboard.press('Control+Enter');
  await expect(row.locator('textarea')).toHaveCount(0);
  expect((await readBookmarks(page))[LESSON_A][0].n).toBe('First practice cue\nSecond practice cue');
  await row.locator('.notes-item-edit').focus();
  await page.keyboard.press('Enter');
  await row.locator('textarea').fill('Discard this keyboard draft');
  await page.keyboard.press('Escape');
  await expect(page.locator('#notes-view')).toBeVisible();
  await expect(row.locator('textarea')).toHaveCount(0);
  expect((await readBookmarks(page))[LESSON_A][0].n).toBe('First practice cue\nSecond practice cue');
});

test('desktop instructor search exposes all thirty Carolina lessons', async ({ page }) => {
  await seedAndOpen(page, { desktop: true });
  await page.locator('#library-search-launch').click();
  await page.locator('#spotlight-input').fill('carolina');
  const results = page.locator('#spotlight-results .spotlight-result');
  await expect(results).toHaveCount(30);
  expect(await results.locator('.spotlight-result-path').evaluateAll(labels => labels.every(label => label.textContent.includes('Carolina Rosa - ')))).toBe(true);
});

test('per-lesson JSON export excludes other lessons from every selected personal-data category', async ({ page }) => {
  await page.addInitScript(({ a, b }) => {
    localStorage.setItem('practiceData', JSON.stringify({
      version: 1, queue: [a, b], completed: { [a]: 1, [b]: 2 }, segments: [],
      reflections: { [a]: { text: 'Selected lesson', updatedAt: 1, label: 'retained' }, [b]: { text: 'Private other lesson', updatedAt: 2 } },
      opaqueExtension: { privateLesson: b }
    }));
  }, { a: LESSON_A, b: LESSON_B });
  // This test exercises export state, without contacting a streaming host or playing media.
  await page.addInitScript(() => {
    class InertHls {
      static Events = { MANIFEST_PARSED: 'manifestParsed', FRAG_LOADED: 'fragLoaded', ERROR: 'error' };
      static ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' };
      static isSupported() { return true; }
      on() {}
      loadSource() {}
      attachMedia() {}
      destroy() {}
    }
    globalThis.Hls = InertHls;
  });
  await seedAndOpen(page);
  await openNotebook(page);
  await page.locator(`.notes-video-title[data-path="${LESSON_A}"]`).click();
  await expect(page.locator('#video-view')).toBeVisible();
  await page.locator('#bookmarks-bar .open-export-modal-btn').click();
  await expect(page.locator('#export-modal')).toBeVisible();
  await expect(page.locator('#exp-entire-library')).not.toBeChecked();
  await page.locator('#exp-summaries').uncheck();
  await page.locator('#exp-favorites').check();
  await page.locator('#exp-watch-history').check();
  await page.locator('input[name="export-format"][value="json"]').check();
  const downloaded = page.waitForEvent('download');
  await page.locator('#do-export').click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toMatch(/^dance-library-.*\.json$/);
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const backup = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  expect(backup.videoBookmarks).toEqual({ [LESSON_A]: BOOKMARKS[LESSON_A] });
  expect(backup.favoriteVideos).toEqual([LESSON_A]);
  expect(backup.watchedVideos).toEqual([LESSON_A]);
  expect(Object.keys(backup.videoPositions)).toEqual([LESSON_A]);
  expect(Object.keys(backup.videoLastWatched)).toEqual([LESSON_A]);
  expect(backup.summaries).toBeUndefined();
  expect(backup.practiceData.opaqueExtension).toBeUndefined();
  expect(backup.practiceData.queue).toEqual([LESSON_A]);
  expect(backup.practiceData.completed).toEqual({ [LESSON_A]: 1 });
  expect(backup.practiceData.reflections).toEqual({ [LESSON_A]: { text: 'Selected lesson', updatedAt: 1, label: 'retained' } });
});

test('quota-blocked drafts survive sorting and remain available in recovery downloads', async ({ page }) => {
  await seedAndOpen(page);
  await openNotebook(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'danceLibraryNoteDrafts') throw new DOMException('Full', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await noteRow(page).locator('.notes-item-edit').click();
  await noteRow(page).locator('textarea').fill('A draft that cannot fit in storage.');
  await page.locator('#dismiss-storage-status').click();
  await page.locator('#notes-sort').selectOption('lesson');
  await noteRow(page).locator('.notes-item-edit').click();
  await expect(noteRow(page).locator('textarea')).toHaveValue('A draft that cannot fit in storage.');
  const downloaded = page.waitForEvent('download');
  await page.locator('#notes-recovery-btn').click();
  const stream = await (await downloaded).createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const recovery = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  expect(Object.values(recovery.inMemoryDrafts).map(draft => draft.n)).toContain('A draft that cannot fit in storage.');
  await noteRow(page).getByRole('button', { name: 'Cancel', exact: true }).click();
});

test('an old draft cannot silently replace a newer saved note', async ({ page }) => {
  await seedAndOpen(page);
  await openNotebook(page);
  await noteRow(page).locator('.notes-item-edit').click();
  await noteRow(page).locator('textarea').fill('Old unfinished thought');
  await page.locator('[data-workspace-view="home"]').click();
  await page.evaluate(path => {
    const notes = JSON.parse(localStorage.getItem('videoBookmarks'));
    notes[path][0].n = 'Newer note from another view';
    localStorage.setItem('videoBookmarks', JSON.stringify(notes));
  }, LESSON_A);
  await openNotebook(page);
  await noteRow(page).locator('.notes-item-edit').click();
  await expect(noteRow(page).locator('textarea')).toHaveValue('Newer note from another view');
  expect(await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('danceLibraryNoteDrafts'))).map(draft => draft.n))).toContain('Old unfinished thought');
});

test('a failed deletion preserves both the bookmark and the previous Undo record', async ({ page }) => {
  await seedAndOpen(page);
  await openNotebook(page);
  await noteRow(page).locator('.notes-item-delete').click();
  // The click dispatch finishes before the Web Locks transaction commits.
  await expect(noteRow(page)).toHaveCount(0);
  const previousUndo = await page.evaluate(() => localStorage.getItem('danceLibraryDeletedBookmark'));
  expect(previousUndo).not.toBeNull();
  const previousNotes = await readBookmarks(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'videoBookmarks') throw new DOMException('Full', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await noteRow(page, LESSON_A, 30).locator('.notes-item-delete').click();
  await expect(page.locator('#storage-status-copy')).toHaveText('Full');
  expect(await page.evaluate(() => localStorage.getItem('danceLibraryDeletedBookmark'))).toBe(previousUndo);
  expect(await readBookmarks(page)).toEqual(previousNotes);
});

test('a failed import rolls back every previous write and does not report success', async ({ page }) => {
  await seedAndOpen(page);
  const before = await page.evaluate(() => Object.fromEntries(['watchedVideos','favoriteVideos','videoBookmarks'].map(key => [key, localStorage.getItem(key)])));
  await openNotebook(page);
  await page.locator('#notes-view .open-export-modal-btn').click();
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'videoBookmarks') throw new DOMException('Full', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  const messages = [];
  page.on('dialog', async dialog => { messages.push(dialog.message()); await dialog.accept(); });
  await page.locator('#import-file-input').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ watchedVideos: ['imported'], favoriteVideos: ['imported'], videoBookmarks: { [LESSON_A]: [{ t: 70, n: 'New imported note' }] } })) });
  await expect.poll(() => messages.some(message => message.startsWith('Import failed.'))).toBe(true);
  expect(messages.some(message => message.startsWith('Import complete'))).toBe(false);
  expect(await page.evaluate(() => Object.fromEntries(['watchedVideos','favoriteVideos','videoBookmarks'].map(key => [key, localStorage.getItem(key)])))).toEqual(before);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('danceLibraryRestoreRecovery')).before)).toEqual(before);
});

test('legacy and current backup entries merge in the UI without losing unrelated notes', async ({ page }) => {
  await seedAndOpen(page);
  await openNotebook(page);
  await page.locator('#notes-view .open-export-modal-btn').click();
  page.on('dialog', async dialog => { await dialog.accept(); });
  await page.locator('#import-file-input').setInputFiles({ name: 'legacy.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ videoBookmarks: { [LESSON_A]: [7, { t: 12, n: 'Newer imported correction', ts: 1800000000000 }] } })) });
  await expect(page.locator('#export-modal')).toBeHidden();
  await expect(noteRow(page).locator('.notes-bookmark-note')).toHaveText('Newer imported correction');
  let notes = await readBookmarks(page);
  expect(notes[LESSON_A]).toHaveLength(4);
  expect(notes[LESSON_A][0]).toEqual({ t: 7, n: '' });
  expect(notes[LESSON_B]).toEqual(BOOKMARKS[LESSON_B]);
  await page.reload();
  await openNotebook(page);
  notes = await readBookmarks(page);
  expect(notes[LESSON_A]).toHaveLength(4);
  expect(notes[LESSON_B]).toEqual(BOOKMARKS[LESSON_B]);
});

test('player notes support multiline writing and explicitly clearing a saved note', async ({ page }) => {
  await page.addInitScript(() => {
    globalThis.Hls = class {
      static Events = { MANIFEST_PARSED: 'manifestParsed', FRAG_LOADED: 'fragLoaded', ERROR: 'error' };
      static ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' };
      static isSupported() { return true; }
      on() {} loadSource() {} attachMedia() {} destroy() {}
    };
  });
  await seedAndOpen(page);
  await openNotebook(page);
  await page.locator(`.notes-video-title[data-path="${LESSON_A}"]`).click();
  await page.locator('#bookmarks-list .bookmark-edit-icon').first().click();
  const editor = page.locator('#bookmark-edit-input');
  await editor.fill('First cue');
  await editor.press('End');
  await editor.press('Enter');
  await editor.pressSequentially('Second cue');
  await expect(editor).toHaveValue('First cue\nSecond cue');
  await page.locator('#bookmark-edit-save').click();
  await expect(editor).toBeHidden();
  expect((await readBookmarks(page))[LESSON_A][0].n).toBe('First cue\nSecond cue');
  await page.locator('#bookmarks-list .bookmark-edit-icon').first().click();
  await editor.fill('');
  await page.locator('#bookmark-edit-save').click();
  await expect(editor).toBeHidden();
  expect((await readBookmarks(page))[LESSON_A][0].n).toBe('');
});
