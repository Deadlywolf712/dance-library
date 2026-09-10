import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'allow' });

test('the fully installed offline shell preserves legacy notes and supports editing across reloads', async ({ page, context, request }) => {
  const lessonA = 'Carolina Rosa - Beginner/07 - Turns in 15.mp4';
  const lessonB = 'Carolina Rosa - Advanced/09 - 33 Steps.mp4';
  const originalNote = 'Legacy shoulder cue retained offline.';
  const otherNote = 'Keep the final step small.\nFinish with a quiet weight transfer.';
  const editedNote = 'Edited offline.\nKeep both other legacy bookmarks.';
  const rawNotes = JSON.stringify({
    [lessonA]: [12, { t: 24, n: originalNote, ts: 1700000000000 }],
    [lessonB]: [{ t: 14.5, n: otherNote, ts: 1700000001000 }]
  }, null, 2);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.route('https://fonts.gstatic.com/**', route => route.abort());
  await page.addInitScript(raw => {
    // Reload must use the app's saved data, not reset the original fixture.
    if (localStorage.getItem('offlineNotebookSeeded')) return;
    localStorage.setItem('videoBookmarks', raw);
    localStorage.setItem('offlineNotebookSeeded', 'true');
  }, rawNotes);

  async function ready() {
    await expect(page.locator('body')).toHaveAttribute('data-app-ready', 'true');
    await expect(page.locator('#app-loader')).toBeHidden();
  }

  await page.goto('/');
  await ready();
  const workerUrl = new URL('sw.js', page.url()).href;
  const response = await request.get(workerUrl);
  expect(response.ok()).toBe(true);
  const source = await response.text();
  const version = source.match(/\bCACHE_VERSION\s*=\s*(\d+)/)?.[1];
  const manifest = source.match(/\bAPP_FILES\s*=\s*\[([\s\S]*?)\]/)?.[1];
  expect(version).toBeTruthy();
  expect(manifest).toBeTruthy();
  const precacheUrls = [...manifest.matchAll(/['"]([^'"]+)['"]/g)].map(([, file]) => new URL(file, workerUrl).href);
  expect(precacheUrls.length).toBeGreaterThan(0);
  const cacheName = `dance-library-v${version}`;

  // The cache name appears as soon as installation opens it. Wait for the
  // complete declared shell and an active controller before cutting the network.
  await page.waitForFunction(async ({ name, urls }) => {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!navigator.serviceWorker.controller || !registration?.active || registration.installing || registration.waiting) return false;
    if (!(await caches.keys()).includes(name)) return false;
    const cache = await caches.open(name);
    const entries = await Promise.all(urls.map(url => cache.match(url)));
    return entries.every(Boolean);
  }, { name: cacheName, urls: precacheUrls });
  await page.locator('[data-workspace-view="notes"]').click();
  await expect(page).toHaveURL(/#view=notes$/);
  await expect(page.locator('#notes-view')).toHaveAttribute('role', 'region');
  await expect(page.locator('.notes-bookmark-item')).toHaveCount(3);
  expect(await page.evaluate(() => localStorage.getItem('videoBookmarks'))).toBe(rawNotes);

  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await ready();
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);
    await expect(page.locator('#notes-view')).toBeVisible();
    await expect(page.locator('.notes-bookmark-item')).toHaveCount(3);
    expect(await page.evaluate(() => localStorage.getItem('videoBookmarks'))).toBe(rawNotes);
    await page.locator('#notes-search-input').fill('shoulder');
    await expect(page.locator('.notes-bookmark-item')).toHaveCount(1);
    await page.locator('.notes-item-edit').click();
    await page.locator('textarea.notes-inline-edit').fill(editedNote);
    await page.getByRole('button', { name: 'Save note', exact: true }).click();
    // Saving goes through an asynchronous repository transaction. Wait for the
    // durable result before reloading instead of interrupting the save itself.
    await expect.poll(() => page.evaluate(path => JSON.parse(localStorage.getItem('videoBookmarks'))[path].find(note => note.t === 24)?.n, lessonA)).toBe(editedNote);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await ready();
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);
    await expect(page.locator('#notes-view')).toBeVisible();
    await expect(page.locator('.notes-bookmark-item')).toHaveCount(3);
    await expect(page.locator(`.notes-bookmark-item[data-path="${lessonA}"][data-time="24"] .notes-bookmark-note`)).toHaveText(editedNote);
    await expect(page.locator(`.notes-bookmark-item[data-path="${lessonA}"][data-time="12"]`)).toContainText('Saved timestamp');
    await expect(page.locator(`.notes-bookmark-item[data-path="${lessonB}"][data-time="14.5"] .notes-bookmark-note`)).toHaveText(otherNote);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('videoBookmarks')));
    expect(saved[lessonA]).toHaveLength(2);
    expect(saved[lessonB]).toEqual([{ t: 14.5, n: otherNote, ts: 1700000001000 }]);
    expect(pageErrors).toEqual([]);
  } finally {
    await context.setOffline(false);
  }
});
