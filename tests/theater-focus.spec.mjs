import { expect, test } from '@playwright/test';
const lesson = 'Carolina Rosa - Beginner/07 - Turns in 15.mp4';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route('https://**/*', route => route.abort());
  await page.goto(`/#video=${encodeURIComponent(lesson)}`);
  await expect(page.locator('body')).toHaveAttribute('data-app-ready', 'true');
});

async function expectTheaterFocus(page) {
  const focus = await page.evaluate(() => {
    const active = document.activeElement;
    return { allowed: Boolean(active.closest('.player-container, .player-overlay-controls')), id: active.id };
  });
  expect(focus, `Focus escaped the theater: ${JSON.stringify(focus)}`).toMatchObject({ allowed: true });
}

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`theater keeps forward and reverse focus within visible tools at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.locator('#theater-btn').click();
    await expect(page.locator('#theater-btn')).toBeFocused();
    for (const selector of ['#video-info-wrapper', '.source-toggle', '#workspace-lesson-header', '#sidebar']) {
      expect(await page.locator(selector).evaluate(element => element.inert)).toBe(true);
    }
    for (let index = 0; index < 16; index++) {
      await page.keyboard.press('Tab');
      await expectTheaterFocus(page);
    }
    for (let index = 0; index < 16; index++) {
      await page.keyboard.press('Shift+Tab');
      await expectTheaterFocus(page);
    }
    await page.locator('#current-speed-btn').focus();
    await page.keyboard.press('Escape');
    await expect(page.locator('#theater-btn')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#theater-btn')).toBeFocused();
    expect(await page.locator('#video-info-wrapper').evaluate(element => element.inert)).toBe(false);
    expect(await page.locator('#sidebar').evaluate(element => element.inert)).toBe(viewport.width <= 900);
  });
}

test('theater yields to Spotlight and its dialog focus owner, and restores normal focus on exit', async ({ page }) => {
  await page.locator('#video-title').focus();
  await page.keyboard.press('t');
  await expect(page.locator('#theater-btn')).toBeFocused();
  await page.keyboard.press('Control+k');
  await expect(page.locator('#spotlight-input')).toBeFocused();
  await page.locator('#spotlight-input').fill('Carolina');
  await expect(page.locator('.spotlight-result')).not.toHaveCount(0);
  for (let index = 0; index < 5; index++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => Boolean(document.activeElement.closest('#spotlight-overlay')))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('#spotlight-overlay')).toBeHidden();
  await expect(page.locator('#theater-btn')).toBeFocused();
  expect(await page.locator('#sidebar').evaluate(element => element.inert)).toBe(true);
  expect(await page.locator('#main-content').evaluate(element => element.inert)).toBe(false);
  await page.locator('#theater-btn').click();
  await expect(page.locator('#video-title')).toBeFocused();
  expect(await page.locator('#sidebar').evaluate(element => element.inert)).toBe(false);
});

test('a speed menu consumes its own Escape before theater exits, and leaving the route releases covered content', async ({ page }) => {
  await page.locator('#theater-btn').click();
  await page.locator('#current-speed-btn').click();
  await expect(page.locator('#speed-dropdown')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#speed-dropdown')).toBeHidden();
  await expect(page.locator('#theater-btn')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#current-speed-btn')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#theater-btn')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#theater-btn').click();
  await page.evaluate(() => { location.hash = '#view=queue'; });
  await expect(page.locator('body')).toHaveAttribute('data-view', 'queue');
  await expect(page.locator('#theater-btn')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.locator('#sidebar').evaluate(element => element.inert)).toBe(false);
  expect(await page.locator('#video-info-wrapper').evaluate(element => element.inert)).toBe(false);
});

test('choosing a lesson in Spotlight and adding a note keep keyboard focus visible', async ({ page }) => {
  await page.locator('#theater-btn').click();
  await page.keyboard.press('Control+k');
  await page.locator('#spotlight-input').fill('Carolina');
  await page.locator('.spotlight-result').first().click();
  await expect(page.locator('#spotlight-overlay')).toBeHidden();
  await expect(page.locator('#theater-btn')).toBeFocused();
  await page.locator('#video-player').evaluate(video => {
    Object.defineProperty(video, 'duration', { configurable: true, value: 120 });
    video.focus();
  });
  await page.keyboard.press('b');
  await expect(page.locator('#theater-btn')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#bookmark-edit-input')).toBeVisible();
  await expect(page.locator('#bookmark-edit-input')).toBeFocused();
});
