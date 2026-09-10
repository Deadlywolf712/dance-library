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
  for (const courseFolder of [
    'Carolina Rosa - Advanced',
    'Carolina Rosa - Beginner',
    'Carolina Rosa - Intermediate',
    'Marco Espejo - Marco Espejo Style'
  ]) {
    await expect(page.getByRole('button', { name: new RegExp(`^Open ${courseFolder}, \\d+ lessons$`) })).toBeVisible();
  }

  await page.getByRole('link', { name: 'Library Home', exact: true }).click();
  await page.getByRole('button', { name: /^Open Salsa, \d+ lessons$/ }).click();
  const salsaCourseNames = await page.locator('#course-grid > .folder-tile .course-teacher').allTextContents();
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

  await page.locator('[data-workspace-view="notes"]').click();
  await page.locator('#notes-search-input').fill('3x3');
  await expect(page.locator('.notes-video-title')).toHaveText('09 - 3X3 Steps');
  await expect(page.locator('.notes-video-title')).toHaveAttribute('data-path', legacyPath);
});

test('audited lesson titles and course aliases remain searchable with stable source paths', async ({ page }) => {
  const legacyPath = 'Adolfo Indacochea  Tania Cannarsa - Salsa On2 Advanced/06 - Mixing Hook Step  Rotation.mp4';
  await page.locator('#home-search-btn').click();
  await page.locator('#spotlight-input').fill('Mixing Hook Step & Rotation');
  await expect(page.locator('.spotlight-result')).toHaveCount(1);
  await expect(page.locator('.spotlight-result-title')).toHaveText('06 - Mixing Hook Step & Rotation');
  await page.locator('.spotlight-result').click();
  await expect.poll(() => page.evaluate(() => decodeURIComponent(location.hash.split('&')[0].slice('#video='.length)))).toBe(legacyPath);
  await expect(page.locator('#video-title')).toHaveText('06 - Mixing Hook Step & Rotation');

  await page.goto('/');
  await page.locator('#home-search-btn').click();
  await page.locator('#spotlight-input').fill('Isabelle & Felicien — Kizomba Beginner');
  await expect(page.locator('.spotlight-result').first()).toContainText('Isabelle & Felicien — Kizomba Beginner');
});

test('quarantined source cannot play or leak its guide through lesson and full-library exports', async ({ page }) => {
  const legacyPath = 'Salsa Masterclass/Week 3/Spot Overturn/Spot Overturn - Explanation On2.mp4';
  const availablePath = 'Adolfo Indacochea  Tania Cannarsa - Salsa On2 Advanced/01 - Syncopation.mp4';
  let bunnyRequests = 0;
  await page.route('https://*.b-cdn.net/**', route => { bunnyRequests += 1; return route.abort(); });
  await page.goto(`/#video=${encodeURIComponent(legacyPath)}`);
  await expect(page.locator('body')).toHaveAttribute('data-app-ready', 'true');
  await expect(page.locator('#video-title')).toHaveText('Spot Overturn - Explanation On2');
  await expect(page.locator('#video-unavailable')).toBeVisible();
  await expect(page.locator('#video-unavailable-reason')).toContainText('exact duplicate');
  await expect(page.locator('#video-player')).toBeHidden();
  await expect(page.locator('.video-controls-bar')).toBeHidden();
  await page.locator('#practice-tab-guide').click();
  await expect(page.locator('#video-summary')).toContainText('guide is withheld');
  expect(bunnyRequests).toBe(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('watchedVideos') || '[]'))).not.toContain(legacyPath);
  await page.evaluate(path => { videoData[path].summary = 'SENTINEL INCORRECT DUPLICATE SUMMARY'; }, legacyPath);

  const openExport = page.locator('#video-view .open-export-modal-btn');
  for (const entireLibrary of [false, true]) {
    for (const format of ['json', 'markdown']) {
      await openExport.evaluate(button => button.click());
      await page.locator('#exp-entire-library').setChecked(entireLibrary);
      await page.locator('#exp-summaries').check();
      await page.locator(`input[name="export-format"][value="${format}"]`).check();
      const downloadPromise = page.waitForEvent('download');
      await page.locator('#do-export').click();
      const exported = await readFile(await (await downloadPromise).path(), 'utf8');
      expect(exported).not.toContain('SENTINEL INCORRECT DUPLICATE SUMMARY');
      if (format === 'json') {
        const data = JSON.parse(exported);
        expect(Object.keys(data.summaries)).toHaveLength(entireLibrary ? 794 : 0);
        expect(data.summaries).not.toHaveProperty(legacyPath);
        if (entireLibrary) expect(data.summaries[availablePath]).toBeTruthy();
      } else if (entireLibrary) {
        expect(exported).toContain('## Video Summaries');
        expect(exported).toContain('### 01 - Syncopation');
      } else expect(exported).not.toContain('## Video Summaries');
    }
  }
  expect(bunnyRequests).toBe(0);
});
