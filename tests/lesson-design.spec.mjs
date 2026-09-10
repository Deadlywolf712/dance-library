import { expect, test } from '@playwright/test';

const A = 'Carolina Rosa - Beginner/07 - Turns in 15.mp4';
const B = 'Carolina Rosa - Advanced/09 - 33 Steps.mp4';
const lessonHash = path => `#video=${encodeURIComponent(path)}`;
const emptyPractice = () => ({ version: 1, queue: [], segments: [], completed: {}, reflections: {} });

async function open(page, { hash = lessonHash(A), seed = {}, viewport, duration = 120 } = {}) {
  if (viewport) await page.setViewportSize(viewport);
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.route('https://fonts.gstatic.com/**', route => route.abort());
  await page.addInitScript(({ saved, duration }) => {
    if (!localStorage.getItem('lessonDesignSeeded')) {
      for (const [key, value] of Object.entries(saved)) localStorage.setItem(key, JSON.stringify(value));
      localStorage.setItem('lessonDesignSeeded', 'true');
    }
    // Deterministic media metadata for interaction/layout assertions. Real
    // streaming, seeking, and codec behavior remain covered by playback tests.
    const state = { time: 0, paused: true };
    const proto = HTMLMediaElement.prototype;
    Object.defineProperties(proto, {
      duration: { configurable: true, get: () => duration },
      readyState: { configurable: true, get: () => 4 },
      currentTime: { configurable: true, get: () => state.time, set: value => { state.time = Number(value); } },
      paused: { configurable: true, get: () => state.paused },
      ended: { configurable: true, get: () => false }
    });
    proto.play = function () { state.paused = false; this.dispatchEvent(new Event('play')); return Promise.resolve(); };
    proto.pause = function () { state.paused = true; this.dispatchEvent(new Event('pause')); };
    proto.load = function () {};
    class FixtureHls {
      static Events = { MANIFEST_PARSED: 'manifestParsed', FRAG_LOADED: 'fragLoaded', ERROR: 'error' };
      static ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' };
      static isSupported() { return true; }
      constructor() { this.handlers = new Map(); }
      on(name, callback) { this.handlers.set(name, [...(this.handlers.get(name) || []), callback]); }
      loadSource() {}
      attachMedia() { queueMicrotask(() => { for (const callback of this.handlers.get(FixtureHls.Events.MANIFEST_PARSED) || []) callback(); }); }
      destroy() {}
      startLoad() {}
      recoverMediaError() {}
    }
    globalThis.Hls = FixtureHls;
  }, { saved: seed, duration });
  await page.goto(`/${hash}`);
  await expect(page.locator('body')).toHaveAttribute('data-app-ready', 'true');
}

async function seek(page, time) {
  await page.locator('#video-player').evaluate((video, value) => {
    video.currentTime = value;
    video.dispatchEvent(new Event('timeupdate'));
  }, time);
}

test('phone puts video before management and captures a timestamped note directly from the player', async ({ page }) => {
  await open(page);
  const video = await page.locator('#video-player').boundingBox();
  const note = await page.locator('#quick-note-btn').boundingBox();
  const management = await page.locator('#lesson-footer-controls').boundingBox();
  expect(video.y).toBeLessThan(220);
  expect(note.y).toBeGreaterThanOrEqual(video.y + video.height);
  expect(note.y).toBeLessThan(video.y + video.height + 70);
  expect(management.y).toBeGreaterThan(note.y + note.height);
  await page.locator('#practice-tab-guide').click();
  await seek(page, 19.4);
  await expect(page.locator('#quick-note-btn')).toHaveText('Add note at 0:19');
  await page.locator('#quick-note-btn').click();
  await expect(page.locator('#practice-tab-notes')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#bookmark-edit-input')).toBeFocused();
  await page.locator('#bookmark-edit-input').fill('Keep the weight over the standing leg.');
  await page.locator('#bookmark-edit-save').click();
  await expect.poll(() => page.evaluate(path => JSON.parse(localStorage.getItem('videoBookmarks') || '{}')[path]?.[0], A))
    .toMatchObject({ t: 19.4, n: 'Keep the weight over the standing leg.' });
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-app-ready', 'true');
  await expect(page.locator('#bookmarks-list')).toContainText('Keep the weight over the standing leg.');
});

test('desktop gives video most of the lesson width and guide details expand on request', async ({ page }) => {
  await open(page, { viewport: { width: 1280, height: 900 } });
  const video = await page.locator('#video-player').boundingBox();
  const panel = await page.locator('#video-info-wrapper').boundingBox();
  expect(video.width).toBeGreaterThan(600);
  expect(panel.x).toBeGreaterThan(video.x + video.width);
  await page.locator('#practice-tab-guide').click();
  const chapters = page.locator('.chapter-details');
  await expect(chapters.first()).toBeVisible();
  await expect(page.locator('.chapter-details[open]')).toHaveCount(0);
  await chapters.first().locator('summary').click();
  await expect(chapters.first()).toHaveAttribute('open', '');
  await expect(chapters.first().locator('.chapter-description')).toBeVisible();
  await chapters.first().locator('summary').click();
  await expect(chapters.first().locator('.chapter-description')).toBeHidden();
});

test('home offers one next lesson and a compact route to the queued lessons', async ({ page }) => {
  await open(page, { hash: '', seed: {
    practiceData: { ...emptyPractice(), queue: [A, B] },
    videoLastWatched: { [A]: 1700000000000 }, videoPositions: { [A]: 25 }
  } });
  await expect(page.locator('.practice-overview-card')).toHaveCount(1);
  await expect(page.locator('#practice-overview [data-workspace-action="open"]')).toHaveCount(1);
  await expect(page.locator('#practice-overview .primary')).toHaveText('Resume at 0:25');
  await page.locator('#practice-overview [data-workspace-action="queue"]').click();
  await expect(page.locator('#queue-view')).toBeVisible();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#view=queue');
  await expect(page.locator('.queue-lesson')).toHaveCount(2);
});

test('queue options support keyboard ordering and preserve unrelated practice data', async ({ page }) => {
  const preserved = { text: 'A note worth keeping.', updatedAt: 1700000000000 };
  await open(page, { hash: '#view=queue', seed: { practiceData: { ...emptyPractice(), queue: [A, B], reflections: { [A]: preserved } } } });
  const first = page.locator(`.queue-lesson[data-path="${A}"]`);
  await expect(first.locator('[data-workspace-action="down"]')).toBeHidden();
  await first.locator('.queue-options > summary').focus();
  await page.keyboard.press('Enter');
  await first.locator('[data-workspace-action="down"]').click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('practiceData')).queue)).toEqual([B, A]);
  await expect(first.locator('[data-workspace-action="up"]')).toBeVisible();
  await first.locator('[data-workspace-action="remove"]').click();
  await expect(first).toHaveCount(0);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('practiceData')));
  expect(saved.queue).toEqual([B]);
  expect(saved.reflections[A]).toEqual(preserved);
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-app-ready', 'true');
  await expect(page.locator('.queue-lesson')).toHaveCount(1);
  await expect(page.locator('.queue-lesson')).toHaveAttribute('data-path', B);
});

test('small-phone queue options use the card width and keep management labels readable', async ({ page }) => {
  await open(page, { viewport: { width: 320, height: 740 }, hash: '#view=queue', seed: { practiceData: { ...emptyPractice(), queue: [A, B] } } });
  const first = page.locator('.queue-lesson').first();
  await first.locator('.queue-options > summary').click();
  const actions = await first.locator('.queue-actions').boundingBox();
  const options = await first.locator('.queue-options').boundingBox();
  expect(Math.abs(options.width - actions.width)).toBeLessThan(2);
  expect(Math.abs(options.x - actions.x)).toBeLessThan(2);
  const menu = await first.locator('.queue-management').boundingBox();
  expect(menu.height).toBeLessThan(130);
  for (const button of await first.locator('.queue-management button').all()) {
    expect(await button.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(44);
  }
  await first.locator('[data-workspace-action="down"]').click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('practiceData')).queue)).toEqual([B, A]);
});

test('segment start and end capture the current time and remain editable before saving', async ({ page }) => {
  await open(page);
  await page.locator('#practice-tab-segments').click();
  await seek(page, 10.2);
  await page.locator('#segment-start-now').click();
  await expect(page.locator('#segment-start')).toHaveValue('0:10.2');
  await seek(page, 24.7);
  await page.locator('#segment-end-now').click();
  await expect(page.locator('#segment-end')).toHaveValue('0:24.7');
  await page.locator('#segment-title').fill('Weight change and turn');
  await page.locator('#segment-end').fill('0:25');
  await page.locator('#segment-form button[type="submit"]').click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('practiceData') || '{}').segments?.[0]))
    .toMatchObject({ path: A, title: 'Weight change and turn', start: 10.2, end: 25 });
});

test('advanced practice settings remain available behind a disclosure', async ({ page }) => {
  await open(page);
  await expect(page.locator('#source-toggle-cb')).toBeHidden();
  await expect(page.locator('#speed-practice')).toBeHidden();
  await page.locator('.lesson-tools-disclosure > summary').click();
  await expect(page.locator('#source-toggle-cb')).toBeVisible();
  await page.locator('#speed-practice').click();
  await expect(page.locator('#current-speed-btn')).toHaveText('0.75x');
  await page.locator('.lesson-tools-disclosure > summary').click();
  await expect(page.locator('#source-toggle-cb')).toBeHidden();
  await expect(page.locator('#quick-note-btn')).toBeVisible();
});

for (const { duration, cursor } of [{ duration: 120.06, cursor: 120.06 }, { duration: 120.0604, cursor: 121 }]) {
  test(`capturing the fractional endpoint of a ${duration}s lesson produces a savable segment`, async ({ page }) => {
    await open(page, { duration });
    await page.locator('#practice-tab-segments').click();
    await seek(page, 119.5);
    await page.locator('#segment-start-now').click();
    await seek(page, cursor);
    await page.locator('#segment-end-now').click();
    await expect(page.locator('#segment-end')).toHaveValue('2:00.06');
    await page.locator('#segment-title').fill('The final weight change');
    await page.locator('#segment-form button[type="submit"]').click();
    await expect(page.locator('#segment-status')).toHaveText('Practice segment saved.');
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('practiceData') || '{}').segments?.[0]))
      .toMatchObject({ title: 'The final weight change', start: 119.5, end: 120.06 });
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('practiceData')).segments[0]);
    expect(saved.end).toBeLessThanOrEqual(duration);
  });
}
