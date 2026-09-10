import { expect, test } from '@playwright/test';

const A = 'Carolina Rosa - Beginner/07 - Turns in 15.mp4';
const B = 'Carolina Rosa - Advanced/09 - 33 Steps.mp4';
const UNAVAILABLE = 'Salsa Masterclass/Week 3/Spot Overturn/Spot Overturn - Explanation On2.mp4';
const lessonHash = path => `#video=${encodeURIComponent(path)}`;
const emptyPractice = () => ({ version: 1, queue: [], segments: [], completed: {}, reflections: {} });
const segment = (path = A, id = 'practice-fixture') => ({
  id, path, title: 'Quiet turn transition', start: 10, end: 20, speed: 0.75, createdAt: 1700000000000
});

async function setup(page, { seed = {}, ready = true, viewport } = {}) {
  if (viewport) await page.setViewportSize(viewport);
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.route('https://fonts.gstatic.com/**', route => route.abort());
  await page.addInitScript(({ saved, metadataReady }) => {
    if (Object.keys(saved).length && !localStorage.getItem('practiceFeaturesSeeded')) {
      for (const [key, value] of Object.entries(saved)) localStorage.setItem(key, JSON.stringify(value));
      localStorage.setItem('practiceFeaturesSeeded', 'true');
    }
    // Deterministic media fixture: the existing playback suite verifies actual
    // progression. Here metadata, seek position, and play requests are controlled
    // so DOM integration never depends on external video or codec availability.
    const mediaState = { ready: metadataReady, time: 0, paused: true, plays: 0 };
    globalThis.__practiceMedia = mediaState;
    const proto = HTMLMediaElement.prototype;
    Object.defineProperties(proto, {
      duration: { configurable: true, get: () => mediaState.ready ? 120 : NaN },
      readyState: { configurable: true, get: () => mediaState.ready ? 4 : 0 },
      currentTime: { configurable: true, get: () => mediaState.time, set: value => { mediaState.time = Number(value); } },
      paused: { configurable: true, get: () => mediaState.paused },
      ended: { configurable: true, get: () => false }
    });
    proto.play = function () { mediaState.paused = false; mediaState.plays++; this.dispatchEvent(new Event('play')); return Promise.resolve(); };
    proto.pause = function () { mediaState.paused = true; this.dispatchEvent(new Event('pause')); };
    proto.load = function () {};
    class FixtureHls {
      static Events = { MANIFEST_PARSED: 'manifestParsed', FRAG_LOADED: 'fragLoaded', ERROR: 'error' };
      static ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' };
      static isSupported() { return true; }
      constructor() { this.handlers = new Map(); }
      on(name, callback) { this.handlers.set(name, [...(this.handlers.get(name) || []), callback]); }
      loadSource() {}
      attachMedia(media) {
        this.media = media;
        queueMicrotask(() => {
          for (const callback of this.handlers.get(FixtureHls.Events.MANIFEST_PARSED) || []) callback();
        });
      }
      destroy() {}
      startLoad() {}
      recoverMediaError() {}
    }
    globalThis.Hls = FixtureHls;
  }, { saved: seed, metadataReady: ready });
}

async function open(page, options = {}) {
  await setup(page, options);
  await page.goto(`/${options.hash ?? lessonHash(A)}`);
  await expect(page.locator('body')).toHaveAttribute('data-app-ready', 'true');
}

async function reloadReady(page) {
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-app-ready', 'true');
}

async function practice(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('practiceData') || 'null'));
}

async function openReflection(page) {
  await page.locator('#practice-tab-notes').click();
  if (!await page.locator('.lesson-reflection').evaluate(details => details.open)) {
    await page.locator('.lesson-reflection > summary').click();
  }
  await expect(page.locator('#lesson-reflection-input')).toBeVisible();
}

async function downloadJson(page, trigger) {
  const pending = page.waitForEvent('download');
  await trigger();
  const file = await pending;
  const stream = await file.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

test('unavailable recording keeps personal notes, blocks playback and history, and restores controls for another lesson', async ({ page }) => {
  const note = { t: 12, n: 'Keep this personal note.', ts: 1700000000000 };
  await open(page, { hash: lessonHash(UNAVAILABLE) + '&t=12', seed: {
    videoBookmarks: { [UNAVAILABLE]: [note] },
    favoriteVideos: [UNAVAILABLE],
    practiceData: { ...emptyPractice(), segments: [segment(UNAVAILABLE)], reflections: { [UNAVAILABLE]: { text: 'Keep this reflection.', updatedAt: 1 } } }
  } });
  await expect(page.locator('#video-unavailable')).toBeVisible();
  await expect(page.locator('#video-unavailable-reason')).toContainText('exact duplicate');
  await expect(page.locator('#video-player')).toBeHidden();
  await expect(page.locator('.video-controls-bar')).toBeHidden();
  await expect(page.locator('#add-bookmark-btn')).toBeDisabled();
  await page.locator('#practice-tab-notes').click();
  await expect(page.locator('#bookmarks-list')).toContainText(note.n);
  await page.locator('#practice-tab-guide').click();
  await expect(page.locator('#video-summary')).toContainText('guide is withheld');
  await page.locator('#practice-tab-segments').click();
  await page.getByRole('button', { name: 'Practice Quiet turn transition', exact: true }).click();
  expect(await page.evaluate(() => __practiceMedia.plays)).toBe(0);
  const saved = await page.evaluate(() => ({ viewed: JSON.parse(localStorage.getItem('watchedVideos') || '[]'), notes: JSON.parse(localStorage.getItem('videoBookmarks')), favorites: JSON.parse(localStorage.getItem('favoriteVideos')) }));
  expect(saved.viewed).not.toContain(UNAVAILABLE);
  expect(saved.notes[UNAVAILABLE]).toEqual([note]);
  expect(saved.favorites).toContain(UNAVAILABLE);
  await page.locator('#practice-tab-notes').click();
  await page.locator('#video-view .open-export-modal-btn').click();
  await page.locator('#exp-summaries').check();
  await page.locator('input[name="export-format"][value="json"]').check();
  const backup = await downloadJson(page, () => page.locator('#do-export').click());
  expect(backup.summaries[UNAVAILABLE]).toBeUndefined();
  expect(backup.videoBookmarks[UNAVAILABLE]).toEqual([note]);
  expect(backup.practiceData.reflections[UNAVAILABLE].text).toBe('Keep this reflection.');
  await page.evaluate(hash => { location.hash = hash; }, lessonHash(A));
  await expect(page.locator('#video-unavailable')).toBeHidden();
  await expect(page.locator('#video-player')).toBeVisible();
  await expect(page.locator('.video-controls-bar')).toBeVisible();
  await expect(page.locator('#add-bookmark-btn')).toBeEnabled();
});

test('saved segments validate bounds, restore speed and loop, and support delete with undo', async ({ page }) => {
  await open(page);
  await page.locator('#practice-tab-segments').click();
  await page.locator('#segment-title').fill('Quiet turn transition');
  await page.locator('#segment-start').fill('0:10');
  await page.locator('#segment-end').fill('2:01');
  await page.locator('#segment-form [type="submit"]').click();
  await expect(page.locator('#segment-status')).toContainText('within this 2:00 lesson');
  await expect(page.locator('#saved-segments-list .saved-segment')).toHaveCount(0);
  await page.locator('#segment-end').fill('0:20');
  await page.locator('.lesson-tools-disclosure > summary').click();
  await page.locator('#speed-practice').click();
  await page.locator('#segment-form [type="submit"]').click();
  await expect(page.locator('#saved-segments-list .saved-segment')).toHaveCount(1);
  const saved = (await practice(page)).segments[0];
  expect(saved).toMatchObject({ path: A, title: 'Quiet turn transition', start: 10, end: 20, speed: 0.75 });
  await page.locator('#speed-full').click();
  const previousPlays = await page.evaluate(() => __practiceMedia.plays);
  await page.getByRole('button', { name: 'Practice Quiet turn transition', exact: true }).click();
  await expect(page.locator('#ab-loop-btn')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#ab-loop-btn')).toContainText('0:10 → 0:20');
  expect(await page.locator('#video-player').evaluate(video => ({ time: video.currentTime, speed: video.playbackRate }))).toEqual({ time: 10, speed: 0.75 });
  expect(await page.evaluate(() => __practiceMedia.plays)).toBeGreaterThan(previousPlays);
  await page.locator('#segment-use-loop').click();
  await expect(page.locator('#segment-start')).toHaveValue('0:10');
  await expect(page.locator('#segment-end')).toHaveValue('0:20');
  await page.getByRole('button', { name: 'Delete Quiet turn transition', exact: true }).click();
  await expect(page.locator('#saved-segments-list .saved-segment')).toHaveCount(0);
  await page.locator('#segment-undo-delete').click();
  await expect(page.locator('#saved-segments-list .saved-segment')).toHaveCount(1);
  expect((await practice(page)).segments).toEqual([saved]);
  await reloadReady(page);
  await page.locator('#practice-tab-segments').click();
  await expect(page.locator('#saved-segments-list .saved-segment')).toContainText('Quiet turn transition');
});

test('a new timestamp route cancels a saved loop waiting for video metadata', async ({ page }) => {
  await open(page, { ready: false, seed: { practiceData: { ...emptyPractice(), segments: [segment()] } } });
  await page.locator('#practice-tab-segments').click();
  await page.getByRole('button', { name: 'Practice Quiet turn transition', exact: true }).click();
  await expect(page.locator('#ab-loop-btn')).toHaveAttribute('aria-pressed', 'false');
  await page.evaluate(hash => { location.hash = hash; }, `${lessonHash(A)}&t=40`);
  await expect(page).toHaveURL(new RegExp('&t=40$'));
  // Wait for route handling before making the delayed metadata available.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.locator('#video-player').evaluate(video => {
    __practiceMedia.ready = true;
    video.dispatchEvent(new Event('loadedmetadata'));
  });
  await expect.poll(() => page.locator('#video-player').evaluate(video => video.currentTime)).toBe(40);
  await expect(page.locator('#ab-loop-btn')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#video-player').evaluate(video => video.dispatchEvent(new Event('timeupdate')));
  expect(await page.locator('#video-player').evaluate(video => video.currentTime)).toBe(40);
});

test('reflection drafts recover after reload and saved reflections are searchable notebook entries', async ({ page }) => {
  await open(page, { seed: { practiceData: { ...emptyPractice(), reflections: { [B]: { text: '', updatedAt: 1 } } } } });
  await openReflection(page);
  const text = 'Practice goal:\nKeep the shoulder blade quiet during the transition.';
  await page.locator('#lesson-reflection-input').fill(text);
  await expect(page.locator('#reflection-status')).toContainText('draft saved on this device');
  expect((await practice(page)).reflections[A]).toBeUndefined();
  await reloadReady(page);
  await expect(page.locator('#lesson-reflection-input')).toBeVisible();
  await expect(page.locator('#lesson-reflection-input')).toHaveValue(text);
  await page.locator('#save-reflection').click();
  await expect(page.locator('#reflection-status')).toHaveText('Reflection saved.');
  expect((await practice(page)).reflections[A].text).toBe(text);
  await page.locator('[data-workspace-view="notes"]').click();
  await expect(page.locator('#notes-view .notebook-reflection')).toHaveCount(1);
  await expect(page.locator('#nav-note-count')).toContainText('1');
  await page.locator('#notes-search-input').fill('shoulder blade');
  await expect(page.locator('#notes-view .notebook-reflection')).toHaveCount(1);
  await expect(page.locator('.notebook-reflection p')).toHaveText(text);
  await page.locator('#notes-search-input').fill('this phrase is absent');
  await expect(page.locator('.notebook-reflection')).toHaveCount(0);
  await page.locator('#notes-search-input').fill('shoulder blade');
  await page.getByRole('button', { name: 'Open reflection', exact: true }).click();
  await expect(page.locator('#lesson-reflection-input')).toBeVisible();
  await expect(page.locator('#lesson-reflection-input')).toBeFocused();
  await expect(page.locator('#lesson-reflection-input')).toHaveValue(text);
});

test('conflicting reflection edits preserve the losing draft and expose both saved and recovery versions', async ({ page, context }) => {
  const original = { ...emptyPractice(), reflections: { [A]: { text: 'Initial cue', updatedAt: 1700000000000 } } };
  await open(page, { seed: { practiceData: original } });
  const other = await context.newPage();
  try {
    await open(other);
    await openReflection(page);
    await openReflection(other);
    await page.locator('#lesson-reflection-input').fill('First tab: soften the knees.');
    await other.locator('#lesson-reflection-input').fill('Second tab: keep a smaller step.');
    await expect(other.locator('#reflection-status')).toContainText('draft saved on this device');
    await page.locator('#save-reflection').click();
    await expect(page.locator('#reflection-status')).toHaveText('Reflection saved.');
    await other.locator('#save-reflection').click();
    await expect(other.locator('#reflection-status')).toContainText('changed in another tab');
    await expect(other.locator('#lesson-reflection-input')).toHaveValue('Second tab: keep a smaller step.');
    expect((await practice(other)).reflections[A].text).toBe('First tab: soften the knees.');
    const recovery = await downloadJson(other, () => other.locator('#reflection-download-drafts').click());
    expect(recovery.format).toBe('dance-library-reflection-drafts');
    expect(Object.values(recovery.drafts).map(value => value.text)).toContain('Second tab: keep a smaller step.');
    await other.locator('#reflection-load-saved').click();
    await expect(other.locator('#lesson-reflection-input')).toHaveValue('First tab: soften the knees.');
    const afterLoading = await downloadJson(other, () => other.locator('#reflection-download-drafts').click());
    expect(Object.values(afterLoading.drafts).map(value => value.text)).toContain('Second tab: keep a smaller step.');
  } finally { await other.close(); }
});

test('schema-v2 JSON backup round-trips practice data and merges without losing legacy notes or progress', async ({ page }) => {
  const initialPractice = { ...emptyPractice(), queue: [A], segments: [segment()], completed: { [A]: 1700000000000 }, reflections: { [A]: { text: 'Saved lesson cue', updatedAt: 1700000000000 } } };
  const seed = {
    practiceData: initialPractice,
    videoBookmarks: { [A]: [{ t: 12, n: 'Legacy note stays', ts: 1700000000000 }] },
    favoriteVideos: [A], watchedVideos: [A], videoPositions: { [A]: 25 }, videoLastWatched: { [A]: 1700000000000 }
  };
  await open(page, { hash: '#view=notes', seed });
  await page.locator('#notes-view .open-export-modal-btn').click();
  await expect(page.locator('#exp-practice')).toBeChecked();
  await page.locator('input[name="export-format"][value="json"]').check();
  const backup = await downloadJson(page, () => page.locator('#do-export').click());
  expect(backup.schemaVersion).toBe(2);
  for (const [key, value] of Object.entries(seed)) expect(backup[key]).toEqual(value);
  const incoming = {
    schemaVersion: 2,
    practiceData: {
      ...emptyPractice(), queue: [A, B], segments: [segment(), segment(B, 'second-segment')],
      completed: { [B]: 1700000001000 }, reflections: { [B]: { text: 'Imported reflection', updatedAt: 1700000001000 } }
    },
    videoBookmarks: { [B]: [{ t: 24, n: 'Imported note', ts: 1700000001000 }] },
    favoriteVideos: [B], watchedVideos: [B], videoPositions: { [B]: 30 }, videoLastWatched: { [B]: 1700000001000 }
  };
  const unexpectedDialogs = [];
  page.on('dialog', async dialog => {
    if (dialog.type() === 'confirm') await dialog.accept();
    else { unexpectedDialogs.push(dialog.message()); await dialog.dismiss(); }
  });
  async function importIncoming() {
    await page.locator('#import-file-input').setInputFiles({ name: 'practice-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(incoming)) });
    await expect.poll(async () => (await practice(page)).queue).toEqual([A, B]);
    await expect(page.locator('#export-modal')).toBeHidden();
  }
  await importIncoming();
  let merged = await practice(page);
  expect(merged.segments).toEqual([segment(), segment(B, 'second-segment')]);
  expect(merged.completed).toEqual({ [A]: 1700000000000, [B]: 1700000001000 });
  expect(merged.reflections).toEqual({ ...initialPractice.reflections, ...incoming.practiceData.reflections });
  const legacy = await page.evaluate(() => Object.fromEntries(['videoBookmarks', 'favoriteVideos', 'watchedVideos', 'videoPositions', 'videoLastWatched'].map(key => [key, JSON.parse(localStorage.getItem(key))])));
  expect(legacy.videoBookmarks).toEqual({ ...seed.videoBookmarks, ...incoming.videoBookmarks });
  expect(legacy.favoriteVideos).toEqual([A, B]);
  expect(legacy.watchedVideos).toEqual([A, B]);
  expect(legacy.videoPositions).toEqual({ [A]: 25, [B]: 30 });
  expect(legacy.videoLastWatched).toEqual({ [A]: 1700000000000, [B]: 1700000001000 });
  await page.locator('#notes-view .open-export-modal-btn').click();
  await importIncoming();
  merged = await practice(page);
  expect(merged.segments).toHaveLength(2);
  expect(merged.queue).toEqual([A, B]);
  expect(unexpectedDialogs).toEqual([]);
  await expect(page.locator('#notes-view .notebook-reflection')).toHaveCount(2);
  expect(await page.evaluate(() => localStorage.getItem('danceLibraryRestoreRecovery'))).not.toBeNull();
});

test('the library and routed notebook remain usable when the localStorage getter throws', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('Storage denied by browser policy', 'SecurityError'); } });
  });
  await open(page, { hash: '' });
  await expect(page.locator('#course-grid > .folder-tile')).toHaveCount(6);
  await expect(page.locator('#app-loader')).toBeHidden();
  await page.locator('[data-workspace-view="notes"]').click();
  await expect(page.locator('#notes-view')).toBeVisible();
  await expect(page.locator('#notes-view')).toHaveAttribute('role', 'region');
  await expect(page.locator('#storage-status')).toBeVisible();
  expect(errors).toEqual([]);
});

test('practice layout stays compact without horizontal overflow on desktop, phone, and landscape', async ({ page }, testInfo) => {
  await open(page, { viewport: { width: 1440, height: 1000 } });
  await openReflection(page);
  await page.locator('#lesson-reflection-input').fill('A clear cue to carry into your next practice session.\nKeep the movement relaxed.');
  await page.locator('#save-reflection').click();
  await expect(page.locator('#reflection-status')).toHaveText('Reflection saved.');
  for (const viewport of [{ width: 1440, height: 1000, name: 'desktop' }, { width: 390, height: 844, name: 'phone' }, { width: 844, height: 390, name: 'landscape' }]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    if (viewport.width <= 900) await expect.poll(() => page.locator('#sidebar').evaluate(node => node.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
    if (viewport.name === 'desktop') {
      await page.locator('#save-reflection').hover();
      const contrast = await page.locator('#save-reflection').evaluate(node => {
        const css = getComputedStyle(node);
        const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
          const channel = value / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
        const a = luminance(css.color), b = luminance(css.backgroundColor);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      });
      expect(contrast).toBeGreaterThanOrEqual(4.5);
    }
    await page.locator('#workspace-lesson-header').scrollIntoViewIfNeeded();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const screenshotPath = testInfo.outputPath(`practice-${viewport.name}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await testInfo.attach(`practice-${viewport.name}`, { path: screenshotPath, contentType: 'image/png' });
    const geometry = await page.evaluate(() => {
      const rect = selector => {
        const item = document.querySelector(selector);
        const bounds = item.getBoundingClientRect();
        return { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom, height: bounds.height, width: bounds.width, clientWidth: item.clientWidth, scrollWidth: item.scrollWidth };
      };
      return { width: innerWidth, pageWidth: document.documentElement.scrollWidth, main: rect('#main-content'), player: rect('#video-sticky-wrapper'), panel: rect('#video-info-wrapper'), controls: rect('.video-controls-bar'), media: rect('.player-container') };
    });
    expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.width + 1);
    for (const area of [geometry.main, geometry.panel, geometry.controls]) expect(area.scrollWidth).toBeLessThanOrEqual(area.clientWidth + 1);
    expect(geometry.controls.height).toBeGreaterThan(0);
    expect(geometry.controls.height).toBeLessThan(240);
    expect(geometry.controls.top).toBeGreaterThanOrEqual(geometry.media.bottom - 1);
    if (viewport.name === 'desktop') {
      expect(geometry.panel.left).toBeGreaterThanOrEqual(geometry.player.right);
      expect(Math.abs(geometry.panel.top - geometry.player.top)).toBeLessThan(5);
    } else if (viewport.name === 'phone') {
      expect(geometry.panel.top).toBeGreaterThanOrEqual(geometry.player.bottom - 1);
      expect(Math.abs(geometry.panel.left - geometry.player.left)).toBeLessThan(5);
    }
  }
});
