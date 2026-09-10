import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.route('https://fonts.gstatic.com/**', route => route.abort());
});

test('course presentation separates metadata, orders levels, and preserves exact folder links', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-app-ready', 'true');
  await page.locator('[data-style-name="Salsa"]').click();
  const courses = page.locator('#course-grid .folder-tile');
  const adolfo = courses.filter({ has: page.locator('.course-teacher', { hasText: 'Adolfo Indacochea & Tania Cannarsa' }) });
  await expect(adolfo.locator('.course-level')).toHaveText(['Beginner', 'Intermediate', 'Advanced']);
  await expect(adolfo.first().locator('h3')).toHaveText('Salsa On2');
  const folder = ['Salsa', 'Adolfo Indacochea  Tania Cannarsa - Salsa On2 Beginner'];
  await adolfo.first().click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#folder=${encodeURIComponent(JSON.stringify(folder))}`);
  await expect(page.locator('#home-title')).toHaveText('Salsa On2');
  await expect(page.locator('#course-context')).toContainText('Adolfo Indacochea & Tania Cannarsa');
  await expect(page.locator('#course-context .course-level')).toHaveText('Beginner');
  await expect(page.locator('#practice-overview')).toBeHidden();
  const rows = page.locator('#course-grid .lesson-tile');
  expect(await rows.count()).toBeGreaterThan(5);
  const fifth = await rows.nth(4).boundingBox();
  expect(fifth.y + fifth.height).toBeLessThan(720);
  await page.reload();
  await expect(page.locator('#course-context .course-level')).toHaveText('Beginner');
});

test('desktop search and utility navigation stay accessible without a duplicate directory', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-app-ready', 'true');
  await expect(page.locator('#course-directory')).toBeHidden();
  await expect(page.locator('#course-directory')).toHaveAttribute('inert', '');
  await expect(page.locator('#home-search-btn')).toBeHidden();
  await expect(page.locator('#search-input')).toBeHidden();
  await page.locator('#library-search-launch').click();
  await page.locator('#spotlight-input').fill('Carolina turns beginner');
  await expect(page.locator('.spotlight-result-title')).toContainText(['07 - Turns in 1/5']);
  await page.keyboard.press('Escape');
  await expect(page.locator('#library-search-launch')).toBeFocused();
  const settings = await page.locator('#open-settings').boundingBox();
  expect(settings.y + settings.height).toBeLessThanOrEqual(720);
  await page.locator('#open-settings').click();
  await expect(page.locator('#settings-modal')).toBeVisible();
});

test('small-screen course labels remain readable and ordinary navigation reaches every style', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-app-ready', 'true');
  await page.getByRole('button', { name: 'Open Bachata, 319 lessons', exact: true }).click();
  await expect(page.locator('#home-title')).toHaveText('Bachata');
  const course = page.getByRole('button', { name: 'Open Carolina Rosa - Beginner, 10 lessons', exact: true });
  await course.click();
  await expect(page.locator('#course-context')).toContainText('Carolina Rosa');
  await expect(page.locator('#course-context .course-level')).toHaveText('Beginner');
  const overflow = await page.locator('#main-content').evaluate(element => element.scrollWidth > element.clientWidth + 1);
  expect(overflow).toBe(false);
  await page.locator('#menu-toggle-btn').click();
  await page.locator('[data-style-name="Zouk"]').click();
  await expect(page.locator('#home-title')).toHaveText('Zouk');
  await expect(page.locator('#sidebar')).not.toHaveClass(/mobile-open/);
});
