import { expect, test } from '@playwright/test';

const maliciousFolder = `Folder "><svg data-xss-payload onload="globalThis.__xssTriggered = true"></svg> & 'quotes'`;
const maliciousTitle = `Lesson "><img data-xss-payload src=x onerror="globalThis.__xssTriggered = true"> & 'quotes'`;
const maliciousPath = `${maliciousFolder}/${maliciousTitle}.mp4`;
const maliciousNote = `Practice "><img data-xss-payload src=x onerror="globalThis.__xssTriggered = true"> & 'exact note'`;
const expectedFolderDisplay = maliciousPath.split('/').slice(0, -1).join(' / ');

async function openMaliciousLibrary(page) {
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.route('https://fonts.gstatic.com/**', route => route.abort());
  await page.route('**/data.js*', route => route.fulfill({
    contentType: 'text/javascript; charset=utf-8',
    body: `const BUNNY_PULL_ZONE = "media.example.test"; const videoData = ${JSON.stringify({
      [maliciousPath]: {
        bunny_id: '11111111-1111-4111-8111-111111111111',
        collection_id: '22222222-2222-4222-8222-222222222222'
      }
    })};`
  }));

  await page.addInitScript(({ path, note }) => {
    globalThis.__xssTriggered = false;
    localStorage.setItem('favoriteVideos', JSON.stringify([path]));
    localStorage.setItem('watchedVideos', JSON.stringify([path]));
    localStorage.setItem('videoPositions', JSON.stringify({ [path]: 12 }));
    localStorage.setItem('videoLastWatched', JSON.stringify({ [path]: Date.now() }));
    localStorage.setItem('videoBookmarks', JSON.stringify({
      [path]: [{ t: 4, n: note, ts: Date.now() }]
    }));
  }, { path: maliciousPath, note: maliciousNote });

  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'home');
  await expect(page.locator('body')).toHaveAttribute('data-app-ready', 'true');
  await expect(page.locator('.fav-tile .video-tile-title')).toHaveText(maliciousTitle);
}

async function expectPayloadStayedText(page) {
  expect(await page.evaluate(() => globalThis.__xssTriggered)).toBe(false);
  await expect(page.locator('[data-xss-payload]')).toHaveCount(0);
}

test('catalog paths, titles, and imported notes stay inert while preserving exact values', async ({ page }) => {
  await openMaliciousLibrary(page);

  await expect(page.locator('.fav-tile .tile-fav-toggle')).toHaveAttribute('data-path', maliciousPath);
  await expect(page.locator('.recent-notes-video-title')).toHaveText(maliciousTitle);
  await expect(page.locator('.recent-notes-video-title')).toHaveAttribute('data-path', maliciousPath);
  await expect(page.locator('.recent-note-entry span').last()).toContainText(maliciousNote);
  await expectPayloadStayedText(page);

  await page.locator('#home-search-btn').click({ force: true });
  await page.locator('#spotlight-input').fill('Lesson');
  await expect(page.locator('.spotlight-result-title')).toHaveText(maliciousTitle);
  await expect(page.locator('.spotlight-result-path')).toHaveText(expectedFolderDisplay);
  await expectPayloadStayedText(page);
  await page.locator('#close-spotlight').click();

  await page.locator('#mobile-notes-btn').click();
  await expect(page.locator('.notes-video-title')).toHaveText(maliciousTitle);
  await expect(page.locator('.notes-video-title')).toHaveAttribute('data-path', maliciousPath);
  await expect(page.locator('.notes-bookmark-note')).toHaveText(maliciousNote);
  await expect(page.locator('.notes-item-edit')).toHaveAttribute('data-note', maliciousNote);
  await expectPayloadStayedText(page);
  await page.locator('#close-notes-modal').click();

  await page.locator('#mobile-favs-btn').click();
  await expect(page.locator('.notes-fav-title')).toHaveText(maliciousTitle);
  await expect(page.locator('.notes-fav-open')).toHaveAttribute('data-path', maliciousPath);
  await expectPayloadStayedText(page);
  await page.locator('#close-favorites-modal').click();

  await page.locator('#mobile-history-btn').evaluate(button => button.click());
  await expect(page.locator('.history-item')).toHaveAttribute('data-path', maliciousPath);
  await expect(page.locator('.history-item')).toContainText(maliciousTitle);
  await expectPayloadStayedText(page);
});
