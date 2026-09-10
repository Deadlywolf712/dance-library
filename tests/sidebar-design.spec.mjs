import { expect, test } from '@playwright/test';

const LESSON = 'Carolina Rosa - Beginner/07 - Turns in 15.mp4';
const FOLDER = ['Salsa', 'Adolfo Indacochea  Tania Cannarsa - Salsa On2 Beginner'];
const sidebarCurrent = '#sidebar .workspace-navigation [aria-current="page"], #style-navigation [aria-current="page"]';

async function open(page, { width = 1280, height = 720, hash = '' } = {}) {
  await page.setViewportSize({ width, height });
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.route('https://fonts.gstatic.com/**', route => route.abort());
  await page.addInitScript(() => {
    class SidebarHls {
      static Events = { MANIFEST_PARSED: 'manifestParsed', FRAG_LOADED: 'fragLoaded', ERROR: 'error' };
      static ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' };
      static isSupported() { return true; }
      on() {}
      loadSource() {}
      attachMedia() {}
      destroy() {}
    }
    globalThis.Hls = SidebarHls;
  });
  await page.goto(`/${hash}`);
  await expect(page.locator('body')).toHaveAttribute('data-app-ready', 'true');
}

test('sidebar has one browsing list and keyboard navigation skips the retained hidden tree', async ({ page }) => {
  await open(page);
  await expect(page.locator('#course-directory')).toBeHidden();
  await expect(page.locator('#course-directory')).toHaveAttribute('inert', '');
  await expect(page.locator('#course-directory')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('#course-directory summary')).toHaveCount(0);
  await expect(page.locator('#style-navigation button')).toHaveCount(6);
  const styleVisibility = await page.locator('.sidebar-browse').evaluate(container => {
    const bounds = container.getBoundingClientRect();
    return [...container.querySelectorAll('#style-navigation button')].map(button => {
      const row = button.getBoundingClientRect();
      return { name: button.dataset.styleName, fits: row.top >= bounds.top && row.bottom <= bounds.bottom + 1 };
    });
  });
  for (const style of styleVisibility) expect(style.fits, `${style.name} should fit without scrolling at 1280×720`).toBe(true);
  await expect(page.locator('#nav-note-count')).toBeHidden();
  await expect(page.locator('#nav-queue-count')).toBeHidden();

  await page.locator('#library-search-launch').focus();
  for (const selector of [
    '#browse-courses-btn', '#nav-library', '#nav-notebook', '#nav-queue',
    '[data-style-name="Salsa"]', '[data-style-name="Bachata"]', '[data-style-name="Zouk"]',
    '[data-style-name="Kizomba"]', '[data-style-name="Salsa Masterclass"]', '[data-style-name="Kizomba Masterclass"]',
    '#favs-sidebar-btn', '#history-sidebar-btn', '#help-btn', '#open-settings'
  ]) {
    await page.keyboard.press('Tab');
    await expect(page.locator(selector)).toBeFocused();
  }
  await page.keyboard.press('Enter');
  await expect(page.locator('#settings-modal')).toBeVisible();
});

test('exactly one sidebar destination is selected through styles, courses, lessons, and workspace pages', async ({ page }) => {
  await open(page);
  await expect(page.locator(sidebarCurrent)).toHaveCount(1);
  await expect(page.locator('#nav-library')).toHaveAttribute('aria-current', 'page');
  await page.locator('[data-style-name="Salsa"]').click();
  await expect(page.locator('#home-title')).toHaveText('Salsa');
  await expect(page.locator(sidebarCurrent)).toHaveCount(1);
  await expect(page.locator('[data-style-name="Salsa"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#nav-library')).not.toHaveAttribute('aria-current');
  await page.getByRole('button', { name: `Open ${FOLDER[1]}, 20 lessons`, exact: true }).click();
  await expect(page.locator('#home-title')).toHaveText('Salsa On2');
  await expect(page.locator(sidebarCurrent)).toHaveCount(1);
  await page.locator('#course-grid .lesson-tile .tile-main-btn').first().click();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'video');
  await expect(page.locator(sidebarCurrent)).toHaveCount(1);
  await expect(page.locator('[data-style-name="Salsa"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#course-directory')).toBeHidden();
  await page.locator('#nav-notebook').click();
  await expect(page.locator(sidebarCurrent)).toHaveCount(1);
  await expect(page.locator('#nav-notebook')).toHaveAttribute('aria-current', 'page');
  await page.locator('#nav-library').click();
  await expect(page.locator(sidebarCurrent)).toHaveCount(1);
  await expect(page.locator('#nav-library')).toHaveAttribute('aria-current', 'page');
});

test('global search still opens lessons and sidebar favorites still opens saved lessons', async ({ page }) => {
  await page.addInitScript(path => localStorage.setItem('favoriteVideos', JSON.stringify([path])), LESSON);
  await open(page);
  await page.locator('#library-search-launch').click();
  await page.locator('#spotlight-input').fill('Carolina turns beginner');
  await expect(page.locator('.spotlight-result-title')).toContainText(['07 - Turns in 1/5']);
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#video=${encodeURIComponent(LESSON)}`);
  await expect(page.locator('[data-style-name="Bachata"]')).toHaveAttribute('aria-current', 'page');
  await page.locator('#favs-sidebar-btn').click();
  await expect(page.locator('#favorites-modal')).toBeVisible();
  await expect(page.locator('#favorites-modal')).toContainText('07 - Turns in 1/5');
  await page.keyboard.press('Escape');
  await expect(page.locator('#favs-sidebar-btn')).toBeFocused();
});

test('phone sidebar fits full style names and short landscape keeps keyboard access to Settings', async ({ page }) => {
  await open(page, { width: 390, height: 844 });
  await page.locator('#menu-toggle-btn').click();
  for (const style of ['Salsa', 'Bachata', 'Zouk', 'Kizomba', 'Salsa Masterclass', 'Kizomba Masterclass']) {
    const item = page.locator(`[data-style-name="${style}"]`);
    await expect(item).toBeVisible();
    expect(await item.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expect(item.locator('.style-navigation-name')).toHaveText(style);
  }
  await page.locator('[data-style-name="Zouk"]').click();
  await expect(page.locator('#home-title')).toHaveText('Zouk');
  await expect(page.locator('#sidebar')).toHaveAttribute('aria-hidden', 'true');

  await page.setViewportSize({ width: 844, height: 390 });
  await page.locator('#menu-toggle-btn').click();
  await expect(page.locator('#close-sidebar-btn')).toBeFocused();
  for (let index = 0; index < 15; index++) await page.keyboard.press('Tab');
  await expect(page.locator('#open-settings')).toBeFocused();
  await expect(page.locator('#open-settings')).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(page.locator('#settings-modal')).toBeVisible();
});
