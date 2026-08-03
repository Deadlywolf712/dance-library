import { expect, test } from '@playwright/test';

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
    'Marco Espejo - Marco Espejo Style'
  ]) {
    await expect(bachataCourseHeadings.filter({ hasText: courseFolder })).toHaveText(courseFolder);
  }

  await page.getByRole('link', { name: 'Library Home', exact: true }).click();
  await page.getByRole('button', { name: /^Open Salsa, \d+ lessons$/ }).click();
  const salsaCourseNames = await page.locator('#course-grid > .folder-tile h3').allTextContents();
  expect(salsaCourseNames.some(name => name.startsWith('Carolina Rosa'))).toBe(false);
  expect(salsaCourseNames.some(name => name.startsWith('Marco Espejo'))).toBe(false);
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
