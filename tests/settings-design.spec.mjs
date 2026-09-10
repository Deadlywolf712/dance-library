import { expect, test } from '@playwright/test';

const LESSON_A = 'Carolina Rosa - Beginner/07 - Turns in 15.mp4';
const LESSON_B = 'Carolina Rosa - Advanced/09 - 33 Steps.mp4';

async function prepare(page, { width = 390, height = 844, hash = '' } = {}) {
  await page.setViewportSize({ width, height });
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.route('https://fonts.gstatic.com/**', route => route.abort());
  await page.addInitScript(() => {
    // These checks exercise Settings and data export; actual playback has its
    // own suite and is kept independent of external media here.
    class SettingsHls {
      static Events = { MANIFEST_PARSED: 'manifestParsed', FRAG_LOADED: 'fragLoaded', ERROR: 'error' };
      static ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' };
      static isSupported() { return true; }
      on() {}
      loadSource() {}
      attachMedia() {}
      destroy() {}
    }
    globalThis.Hls = SettingsHls;
  });
  await page.goto(`/${hash}`);
  await expect(page.locator('body')).toHaveAttribute('data-app-ready', 'true');
}

async function openSettings(page) {
  const mobile = page.locator('#mobile-settings-btn');
  if (await mobile.isVisible()) {
    await mobile.click();
  } else {
    const menu = page.locator('#menu-toggle-btn');
    if (await menu.isVisible()) await menu.click();
    await page.locator('#open-settings').click();
  }
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible();
}

test('phone Settings leads with backup and keeps close actions reachable with all sections expanded', async ({ page }) => {
  await prepare(page, { width: 320, height: 568 });
  await openSettings(page);
  const backup = page.getByRole('button', { name: 'Back up or restore', exact: true });
  await expect(backup).toBeInViewport();
  await expect(page.locator('#save-settings')).toBeInViewport();
  await expect(page.locator('#close-settings')).toBeInViewport();
  await expect(page.locator('#theme-select')).toBeHidden();
  await expect(page.locator('#bunny-lib-id')).toBeHidden();
  await expect(page.locator('#reset-all')).toBeHidden();

  for (const id of ['settings-all-themes', 'settings-streaming', 'settings-reset']) {
    await page.locator(`#${id} > summary`).click();
  }
  await page.locator('#reset-all').scrollIntoViewIfNeeded();
  await expect(page.locator('#reset-all')).toBeInViewport();
  await expect(page.locator('#save-settings')).toBeInViewport();
  await expect(page.locator('#close-settings')).toBeInViewport();
  const panel = await page.locator('.settings-panel').boundingBox();
  expect(panel.x).toBeGreaterThanOrEqual(0);
  expect(panel.x + panel.width).toBeLessThanOrEqual(320);
  expect(panel.y).toBeGreaterThanOrEqual(0);
  expect(panel.y + panel.height).toBeLessThanOrEqual(568);
  await page.locator('#close-settings').click();
  await expect(page.locator('#settings-modal')).toBeHidden();
});

test('theme shortcuts and all-theme controls share persisted state and favorites', async ({ page }) => {
  await prepare(page, { width: 1280, height: 900 });
  await openSettings(page);
  const paper = page.getByRole('button', { name: 'Paper', exact: true });
  await paper.click();
  await expect(page.locator('body')).toHaveAttribute('data-theme', 'paper');
  await expect(paper).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#settings-current-theme')).toHaveText('Paper');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('theme'))).toBe('paper');
  await page.locator('#settings-all-themes > summary').click();
  await expect(page.locator('#theme-select option')).toHaveCount(103);
  await page.locator('#theme-select').selectOption('dracula');
  await expect(page.locator('#settings-current-theme')).toHaveText('Dracula');
  await expect(paper).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#theme-fav-btn').click();
  await expect(page.locator('#theme-fav-btn')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#theme-next').click();
  await expect(page.locator('body')).toHaveAttribute('data-theme', 'monokai');
  await expect(page.locator('#settings-current-theme')).toHaveText('Monokai');
  await page.locator('#theme-prev').click();
  await expect(page.locator('#settings-current-theme')).toHaveText('Dracula');
  await paper.click();
  await page.locator('#fav-themes-row .fav-theme-apply[data-theme="dracula"]').click();
  await expect(page.locator('#settings-current-theme')).toHaveText('Dracula');
  await page.locator('#close-settings').click();
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-app-ready', 'true');
  await openSettings(page);
  await expect(page.locator('#settings-current-theme')).toHaveText('Dracula');
  await expect(page.locator('#fav-themes-row .fav-theme-apply[data-theme="dracula"]')).toBeVisible();
});

test('backup opened from Settings during a lesson includes the entire library', async ({ page }) => {
  await page.addInitScript(paths => {
    localStorage.setItem('favoriteVideos', JSON.stringify(paths));
    Object.defineProperty(HTMLMediaElement.prototype, 'duration', { configurable: true, get: () => 120 });
  }, [LESSON_A, LESSON_B]);
  await prepare(page, { hash: `#video=${encodeURIComponent(LESSON_A)}` });
  await openSettings(page);
  await page.locator('#settings-all-themes > summary').press('Space');
  await expect(page.locator('#settings-all-themes')).toHaveAttribute('open', '');
  await page.locator('#settings-all-themes > summary').press('Space');
  await page.getByRole('button', { name: 'Back up or restore', exact: true }).click();
  await expect(page.locator('#export-scope-label')).toHaveText('Exporting entire library:');
  await expect(page.locator('input[name="export-format"][value="json"]')).toBeChecked();
  await expect(page.locator('#exp-favorites')).toBeChecked();
  await expect(page.locator('#exp-watch-history')).toBeChecked();
  await expect(page.locator('#exp-practice')).toBeChecked();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#do-export').click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const backup = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  expect(backup.favoriteVideos).toEqual([LESSON_A, LESSON_B]);
  expect(backup.schemaVersion).toBe(2);
});

test('landscape Settings keeps actions visible and cancelling a reset preserves data', async ({ page }) => {
  await page.addInitScript(path => localStorage.setItem('favoriteVideos', JSON.stringify([path])), LESSON_B);
  await prepare(page, { width: 844, height: 390 });
  await openSettings(page);
  await page.locator('#settings-reset > summary').click();
  await page.locator('#reset-favorites').scrollIntoViewIfNeeded();
  await expect(page.locator('#save-settings')).toBeInViewport();
  await expect(page.locator('#close-settings')).toBeInViewport();
  let dialogType;
  page.once('dialog', async dialog => {
    dialogType = dialog.type();
    await dialog.dismiss();
  });
  await page.locator('#reset-favorites').click();
  expect(dialogType).toBe('confirm');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('favoriteVideos')))).toEqual([LESSON_B]);
  await page.locator('#close-settings').click();
  await expect(page.locator('#settings-modal')).toBeHidden();
});
