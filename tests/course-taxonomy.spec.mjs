import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.beforeEach(async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.route('https://fonts.gstatic.com/**', route => route.abort());
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-app-ready', 'true');
});

test('Carolina Rosa and Marco Espejo are listed only under Bachata', async ({ page }) => {
  const rootCategoryHeadings = page.locator('#course-grid > .folder-tile h3');
  await expect(rootCategoryHeadings).toHaveText([
    'Salsa',
    'Bachata',
    'Zouk',
    'Kizomba',
    'Salsa Masterclass',
    'Kizomba Masterclass'
  ]);

  await page.getByRole('button', { name: /^Open Bachata, \d+ lessons$/ }).click();
  const bachataCourseHeadings = page.locator('#course-grid > .folder-tile h3');
  for (const courseFolder of [
    'Carolina Rosa - Advanced',
    'Carolina Rosa - Beginner',
    'Carolina Rosa - Intermediate',
    'Marco Espejo — Marco Espejo Style (Open Level)'
  ]) {
    await expect(bachataCourseHeadings.filter({ hasText: courseFolder })).toHaveText(courseFolder);
  }

  await page.getByRole('link', { name: 'Library Home', exact: true }).click();
  await page.getByRole('button', { name: /^Open Salsa, \d+ lessons$/ }).click();
  const salsaCourseNames = await page.locator('#course-grid > .folder-tile h3').allTextContents();
  expect(salsaCourseNames.some(name => name.startsWith('Carolina Rosa'))).toBe(false);
  expect(salsaCourseNames.some(name => name.startsWith('Marco Espejo'))).toBe(false);
});

test('source-confirmed course aliases display while stable folder paths remain unchanged', async ({ page }) => {
  const arthurStableName = 'Arthur  Oksana - Zouk Beginner';
  const arthurDisplayName = 'Arthur & Oksana — Zouk Beginner';
  const isabelleDisplayName = 'Isabelle & Felicien — Kizomba Beginner';
  const pabloDisplayName = 'Pablo & Raquel — Intermediate/Advanced';

  await page.getByRole('button', { name: /^Open Zouk, \d+ lessons$/ }).click();
  const arthurTile = page.locator('#course-grid > .folder-tile').filter({
    has: page.getByRole('heading', { name: arthurDisplayName, exact: true })
  });
  await expect(arthurTile.locator('h3')).toHaveText(arthurDisplayName);
  await expect(arthurTile).toHaveAttribute('aria-label', new RegExp(`^Open ${arthurDisplayName}, \\d+ lessons$`));
  await arthurTile.click();

  await expect(page.locator('#home-breadcrumbs')).toContainText(arthurDisplayName);
  await expect(page.locator('#course-grid .tile-star-btn').first()).toHaveAttribute(
    'data-path',
    new RegExp(`^${arthurStableName}/`)
  );

  await page.getByRole('link', { name: 'Library Home', exact: true }).click();
  await page.getByRole('button', { name: /^Open Bachata, \d+ lessons$/ }).click();
  await expect(page.getByRole('heading', { name: pabloDisplayName, exact: true })).toBeVisible();

  await page.locator('#home-search-btn').click();
  await page.locator('#spotlight-input').fill(isabelleDisplayName);
  const isabelleResult = page.locator('.spotlight-result').first();
  await expect(isabelleResult).toContainText(isabelleDisplayName);
});

test('a corrected lesson title keeps its stable legacy catalog path', async ({ page }) => {
  const legacyPath = 'Carolina Rosa - Beginner/07 - Turns in 15.mp4';

  await page.getByRole('button', { name: /^Open Bachata, \d+ lessons$/ }).click();
  await page.getByRole('button', { name: 'Open Carolina Rosa - Beginner, 10 lessons' }).click();

  const lessonTile = page.locator('#course-grid > .lesson-tile').filter({
    has: page.locator('.video-tile-title', { hasText: '07 - Turns in 1/5' })
  });
  await expect(lessonTile.locator('.video-tile-title')).toHaveText('07 - Turns in 1/5');
  await expect(lessonTile.locator('.tile-star-btn')).toHaveAttribute('data-path', legacyPath);
});

test('history and notes search use corrected display titles as well as stable paths', async ({ page }) => {
  const legacyPath = 'Carolina Rosa - Advanced/09 - 33 Steps.mp4';

  await page.evaluate(path => {
    localStorage.setItem('watchedVideos', JSON.stringify([path]));
    localStorage.setItem('videoLastWatched', JSON.stringify({ [path]: Date.now() }));
    localStorage.setItem('videoBookmarks', JSON.stringify({
      [path]: [{ t: 12, n: '', ts: Date.now() }]
    }));
  }, legacyPath);
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-app-ready', 'true');

  await page.locator('#mobile-history-btn').evaluate(button => button.click());
  await page.locator('#history-search-input').fill('3x3');
  await expect(page.locator('.history-item')).toContainText('09 - 3X3 Steps');
  await expect(page.locator('.history-item')).toHaveAttribute('data-path', legacyPath);
  await page.locator('#close-history-modal').click();

  await page.locator('#mobile-notes-btn').evaluate(button => button.click());
  await page.locator('#notes-search-input').fill('3x3');
  await expect(page.locator('.notes-video-title')).toHaveText('09 - 3X3 Steps');
  await expect(page.locator('.notes-video-title')).toHaveAttribute('data-path', legacyPath);
});

test('the confirmed duplicate asset is quarantined without losing its stable lesson identity', async ({ page }) => {
  const legacyPath = 'Salsa Masterclass/Week 3/Spot Overturn/Spot Overturn - Explanation On2.mp4';
  const availablePath = 'Adolfo Indacochea  Tania Cannarsa - Salsa On2 Advanced/01 - Syncopation.mp4';
  let bunnyRequests = 0;
  await page.route('https://*.b-cdn.net/**', route => {
    bunnyRequests += 1;
    return route.abort();
  });

  await page.goto(`/#video=${encodeURIComponent(legacyPath)}`);
  await expect(page.locator('body')).toHaveAttribute('data-app-ready', 'true');
  await expect(page.locator('#video-title')).toHaveText('Spot Overturn - Explanation On2');
  await expect(page.locator('#video-unavailable')).toBeVisible();
  await expect(page.locator('#video-unavailable')).toContainText('Correct source unavailable');
  await expect(page.locator('#video-unavailable-reason')).toContainText('exact duplicate');
  await expect(page.locator('#video-player')).toBeHidden();
  await expect(page.locator('.video-controls-bar')).toBeHidden();
  await expect(page.locator('#video-summary')).toContainText('Why this lesson is unavailable');
  expect(bunnyRequests).toBe(0);
  const watched = await page.evaluate(() => JSON.parse(localStorage.getItem('watchedVideos') || '[]'));
  expect(watched).not.toContain(legacyPath);

  await page.evaluate(path => {
    videoData[path].summary = 'SENTINEL INCORRECT DUPLICATE SUMMARY';
  }, legacyPath);
  const openExport = page.locator('#video-view .open-export-modal-btn').first();
  await openExport.evaluate(button => button.click());
  await expect(page.locator('#exp-summaries')).toBeDisabled();
  await expect(page.locator('#exp-summaries-label')).toContainText('Summary unavailable');

  await page.evaluate(() => {
    const summaries = document.getElementById('exp-summaries');
    summaries.disabled = false;
    summaries.checked = true;
    document.querySelector('input[name="export-format"][value="json"]').checked = true;
  });
  const jsonDownloadPromise = page.waitForEvent('download');
  await page.locator('#do-export').click();
  const jsonDownload = await jsonDownloadPromise;
  const jsonExport = JSON.parse(await readFile(await jsonDownload.path(), 'utf8'));
  expect(jsonExport.summaries).toEqual({});

  await openExport.evaluate(button => button.click());
  await page.evaluate(() => {
    const summaries = document.getElementById('exp-summaries');
    summaries.disabled = false;
    summaries.checked = true;
    document.querySelector('input[name="export-format"][value="markdown"]').checked = true;
  });
  const markdownDownloadPromise = page.waitForEvent('download');
  await page.locator('#do-export').click();
  const markdownDownload = await markdownDownloadPromise;
  const markdownExport = await readFile(await markdownDownload.path(), 'utf8');
  expect(markdownExport).not.toContain('SENTINEL INCORRECT DUPLICATE SUMMARY');
  expect(markdownExport).not.toContain('## Video Summaries');

  await openExport.evaluate(button => button.click());
  await page.locator('#exp-entire-library').check();
  await expect(page.locator('#exp-summaries')).toBeEnabled();
  await expect(page.locator('#exp-summaries')).toBeChecked();
  await expect(page.locator('#exp-summaries-label')).toContainText('All available video summaries');
  await page.locator('input[name="export-format"][value="json"]').check();
  const libraryJsonDownloadPromise = page.waitForEvent('download');
  await page.locator('#do-export').click();
  const libraryJsonDownload = await libraryJsonDownloadPromise;
  const libraryJson = JSON.parse(await readFile(await libraryJsonDownload.path(), 'utf8'));
  expect(Object.keys(libraryJson.summaries)).toHaveLength(794);
  expect(libraryJson.summaries[availablePath]).toBeTruthy();
  expect(libraryJson.summaries).not.toHaveProperty(legacyPath);

  await openExport.evaluate(button => button.click());
  await page.locator('#exp-entire-library').check();
  await page.locator('input[name="export-format"][value="markdown"]').check();
  const libraryMarkdownDownloadPromise = page.waitForEvent('download');
  await page.locator('#do-export').click();
  const libraryMarkdownDownload = await libraryMarkdownDownloadPromise;
  const libraryMarkdown = await readFile(await libraryMarkdownDownload.path(), 'utf8');
  expect(libraryMarkdown).toContain('## Video Summaries');
  expect(libraryMarkdown).toContain('### 01 - Syncopation');
  expect(libraryMarkdown).not.toContain('SENTINEL INCORRECT DUPLICATE SUMMARY');
  expect(bunnyRequests).toBe(0);
});
