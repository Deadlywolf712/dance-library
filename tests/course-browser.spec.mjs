import { expect, test } from '@playwright/test';

const LESSON = 'Fernando Sosa  Tatiana Bonaguro - Sosa Style Beginner/03 - Susie Q y Tres-Tres.mp4';
const CURRENT_COURSE = ['Salsa', 'Fernando Sosa  Tatiana Bonaguro - Sosa Style Beginner'];
const ADOLFO_COURSE = ['Salsa', 'Adolfo Indacochea  Tania Cannarsa - Salsa On2 Beginner'];
const LONG_COURSE = ['Bachata', 'Korke  Judith - Bachata Sensual 2025 New Techniques and Cadences'];
const videoHash = path => `#video=${encodeURIComponent(path)}`;
const folderHash = path => `#folder=${encodeURIComponent(JSON.stringify(path))}`;
const rows = page => page.locator('#course-browser-results .course-browser-row');

async function open(page, { width = 1280, height = 900, hash = '' } = {}) {
  await page.setViewportSize({ width, height });
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.route('https://fonts.gstatic.com/**', route => route.abort());
  await page.addInitScript(() => {
    // Keep navigation checks independent of streaming availability while still
    // detecting a player replacement, reload, seek, or playback-state change.
    const state = { time: 0, paused: true };
    const proto = HTMLMediaElement.prototype;
    Object.defineProperties(proto, {
      duration: { configurable: true, get: () => 742 },
      readyState: { configurable: true, get: () => 4 },
      currentTime: { configurable: true, get: () => state.time, set: value => { state.time = Number(value); } },
      paused: { configurable: true, get: () => state.paused },
      ended: { configurable: true, get: () => false }
    });
    proto.play = function () { state.paused = false; this.dispatchEvent(new Event('play')); return Promise.resolve(); };
    proto.pause = function () { state.paused = true; this.dispatchEvent(new Event('pause')); };
    proto.load = function () {};
    class CourseBrowserHls {
      static Events = { MANIFEST_PARSED: 'manifestParsed', FRAG_LOADED: 'fragLoaded', ERROR: 'error' };
      static ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' };
      static isSupported() { return true; }
      constructor() { this.handlers = new Map(); }
      on(name, callback) { this.handlers.set(name, [...(this.handlers.get(name) || []), callback]); }
      loadSource() {}
      attachMedia() { queueMicrotask(() => { for (const callback of this.handlers.get(CourseBrowserHls.Events.MANIFEST_PARSED) || []) callback(); }); }
      destroy() {}
      startLoad() {}
      recoverMediaError() {}
    }
    globalThis.Hls = CourseBrowserHls;
  });
  await page.goto(`/${hash}`);
  await expect(page.locator('body')).toHaveAttribute('data-app-ready', 'true');
}

async function browse(page, { mobile = false } = {}) {
  if (mobile) await page.locator('#menu-toggle-btn').click();
  await page.locator('#browse-courses-btn').click();
  await expect(page.locator('#course-browser-modal')).toBeVisible();
  await expect(page.locator('#course-browser-search')).toBeFocused();
}

async function paths(page) {
  return rows(page).evaluateAll(elements => elements.map(element => JSON.parse(element.dataset.path)));
}

async function rowFor(page, path) {
  const index = (await paths(page)).findIndex(candidate => JSON.stringify(candidate) === JSON.stringify(path));
  expect(index, `Course missing from browser: ${JSON.stringify(path)}`).toBeGreaterThanOrEqual(0);
  return rows(page).nth(index);
}

test('Browse courses opens an accessible wide panel with every course grouped by its exact style', async ({ page }) => {
  await open(page);
  const trigger = page.locator('#browse-courses-btn');
  await expect(trigger).toHaveAccessibleName('Browse courses');
  await expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
  await expect(trigger).toHaveAttribute('aria-controls', 'course-browser-modal');
  await browse(page);
  const modal = page.locator('#course-browser-modal');
  await expect(modal).toHaveAttribute('role', 'dialog');
  await expect(modal).toHaveAttribute('aria-modal', 'true');
  await expect(modal).toHaveAccessibleName('Browse courses');
  await expect(page.locator('#course-browser-search')).toHaveAccessibleName(/.+/);
  await expect(rows(page)).toHaveCount(34);
  const listed = await paths(page);
  expect(new Set(listed.map(path => JSON.stringify(path))).size).toBe(34);
  expect(listed.every(path => path.length === 2)).toBe(true);
  expect(listed.reduce((counts, [style]) => ({ ...counts, [style]: (counts[style] || 0) + 1 }), {})).toEqual({
    Salsa: 8, Bachata: 16, Zouk: 5, Kizomba: 3, 'Salsa Masterclass': 1, 'Kizomba Masterclass': 1
  });
  await expect(page.locator('#course-browser-count')).toHaveAttribute('role', 'status');
  await expect(page.locator('#course-browser-count')).toContainText('34');
  expect(await page.locator('#main-content').evaluate(element => element.inert)).toBe(true);
  expect(await page.locator('#sidebar').evaluate(element => element.inert)).toBe(true);
  const panel = await page.locator('.course-browser-panel').boundingBox();
  expect(panel.width).toBeGreaterThanOrEqual(600);
  expect(panel.width).toBeLessThanOrEqual(1000);
});

test('course search matches teacher, title, level, case, accents and every token, with a clearable empty state', async ({ page }) => {
  await open(page);
  await browse(page);
  const search = page.locator('#course-browser-search');
  const clear = page.locator('#course-browser-clear');
  await expect(clear).toBeHidden();
  for (const query of ['desiree beginner', 'BEGINNER   DÉSIRÉE', 'beginner alex bachata']) {
    await search.fill(query);
    await expect(rows(page)).toHaveCount(1);
    expect(await paths(page)).toEqual([['Bachata', 'Alex  Desirée - Beginner']]);
  }
  await search.fill('on2 tania beginner');
  await expect(rows(page)).toHaveCount(1);
  expect(await paths(page)).toEqual([ADOLFO_COURSE]);
  await search.fill('Korke cadences 2025');
  await expect(rows(page)).toHaveCount(1);
  expect(await paths(page)).toEqual([LONG_COURSE]);
  await search.fill('desiree salsa');
  await expect(rows(page)).toHaveCount(0);
  await expect(page.locator('#course-browser-count')).toContainText('0');
  await expect(page.locator('#course-browser-results')).toContainText(/no (?:matching )?courses/i);
  await expect(clear).toBeVisible();
  await clear.click();
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();
  await expect(clear).toBeHidden();
  await expect(rows(page)).toHaveCount(34);
});

test('style filtering combines with course search, and clearing the query preserves the chosen style', async ({ page }) => {
  await open(page);
  await browse(page);
  const style = page.locator('#course-browser-style');
  const search = page.locator('#course-browser-search');
  await expect(style).toHaveAccessibleName(/.+/);
  await expect(style.locator('option')).toHaveCount(7);
  await style.selectOption({ label: 'Salsa' });
  await expect(rows(page)).toHaveCount(8);
  expect((await paths(page)).every(([category]) => category === 'Salsa')).toBe(true);
  await search.fill('tania');
  await expect(rows(page)).toHaveCount(3);
  await page.locator('#course-browser-clear').click();
  await expect(search).toHaveValue('');
  await expect(style).toHaveValue('Salsa');
  await expect(rows(page)).toHaveCount(8);
  await style.selectOption({ label: 'Zouk' });
  await expect(rows(page)).toHaveCount(5);
  await search.fill('carolina');
  await expect(rows(page)).toHaveCount(0);
  await style.selectOption({ index: 0 });
  await expect(rows(page)).toHaveCount(3);
  expect((await paths(page)).every(([category]) => category === 'Bachata')).toBe(true);
});

test('audited course names retain title, teacher and level while navigating with original identities', async ({ page }) => {
  await open(page);
  await browse(page);
  const search = page.locator('#course-browser-search');
  const cases = [
    { query: 'Pablo & Raquel — Smooth Bachata Intermediate/Advanced', path: ['Bachata', 'Pablo  Raquel - IntermediateAdvanced'], title: 'Smooth Bachata', teacher: 'Pablo & Raquel', level: 'Intermediate–Advanced' },
    { query: 'Korke Fundamentals', path: ['Bachata', 'Korke  Judith - Fundamentals of Bachata Sensual'], title: 'Fundamentals of Bachata Sensual', teacher: 'Korke & Judith', level: 'Beginner' },
    { query: 'Marco Open Level', path: ['Bachata', 'Marco Espejo - Marco Espejo Style'], title: 'Marco Espejo Style', teacher: 'Marco Espejo', level: 'Open Level' },
    { query: 'Isabelle & Felicien — Kizomba Beginner', path: ['Kizomba', 'Isabelle  Felicien - Beginner'], title: 'Kizomba', teacher: 'Isabelle & Felicien', level: 'Beginner' }
  ];
  for (const entry of cases) {
    await search.fill(entry.query);
    await expect(rows(page)).toHaveCount(1);
    const row = await rowFor(page, entry.path);
    await expect(row.locator('.course-browser-title')).toHaveText(entry.title);
    await expect(row.locator('.course-browser-teacher')).toHaveText(entry.teacher);
    await expect(row.locator('.course-level')).toHaveText(entry.level);
  }
  await rows(page).click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe(folderHash(cases.at(-1).path));
  await expect(page.locator('#home-title')).toHaveText('Kizomba');
  await expect(page.locator('#course-context')).toContainText('Isabelle & Felicien');
  await expect(page.locator('#course-context')).toContainText('Beginner');
});

test('canceling Browse courses preserves the exact lesson, player node and time without resuming playback', async ({ page }) => {
  await open(page, { hash: videoHash(LESSON) });
  const player = await page.locator('#video-player').elementHandle();
  await player.evaluate(async video => {
    video.currentTime = 48.25;
    video.dispatchEvent(new Event('timeupdate'));
    await video.play();
  });
  for (const closeMethod of ['Escape', 'button']) {
    await browse(page);
    await page.locator('#course-browser-search').fill('');
    // Current state belongs to the actionable row, not only a decorative badge.
    await expect(page.locator('.course-browser-row[aria-current="true"]')).toHaveCount(1);
    expect(JSON.parse(await page.locator('.course-browser-row[aria-current="true"]').getAttribute('data-path'))).toEqual(CURRENT_COURSE);
    await page.locator('#course-browser-search').fill('Arthur');
    if (closeMethod === 'Escape') await page.keyboard.press('Escape');
    else await page.locator('#close-course-browser-btn').click();
    await expect(page.locator('#course-browser-modal')).toBeHidden();
    await expect(page.locator('#browse-courses-btn')).toBeFocused();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe(videoHash(LESSON));
    expect(await player.evaluate(video => ({
      sameNode: video === document.querySelector('#video-player'),
      connected: video.isConnected,
      time: video.currentTime,
      paused: video.paused
    }))).toEqual({ sameNode: true, connected: true, time: 48.25, paused: true });
    expect(await page.locator('#main-content').evaluate(element => element.inert)).toBe(false);
  }
  await player.dispose();
});

test('choosing a course closes the panel and navigates to its exact preserved folder path', async ({ page }) => {
  await open(page, { hash: videoHash(LESSON) });
  await browse(page);
  await page.locator('#course-browser-search').fill('tania on2 beginner');
  await (await rowFor(page, ADOLFO_COURSE)).click();
  await expect(page.locator('#course-browser-modal')).toBeHidden();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe(folderHash(ADOLFO_COURSE));
  await expect(page.locator('#home-title')).toHaveText('Salsa On2');
  await expect(page.locator('#home-title')).toBeFocused();
  await expect(page.locator('#course-context')).toContainText('Adolfo Indacochea & Tania Cannarsa');
  await expect(page.locator('#course-grid .lesson-tile')).toHaveCount(20);
  await browse(page);
  await page.locator('#course-browser-search').fill('');
  await expect(page.locator('.course-browser-row[aria-current="true"]')).toHaveCount(1);
  await expect(await rowFor(page, ADOLFO_COURSE)).toHaveAttribute('aria-current', 'true');
});

test('phone Browse courses traps keyboard focus, dismisses safely, and reaches courses through normal navigation', async ({ page }) => {
  await open(page, { width: 390, height: 844 });
  await browse(page, { mobile: true });
  await page.locator('#course-browser-search').fill('carolina beginner');
  await expect(rows(page)).toHaveCount(1);
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let index = 0; index < 8; index++) {
      await page.keyboard.press(key);
      expect(await page.evaluate(() => Boolean(document.activeElement.closest('#course-browser-modal')))).toBe(true);
    }
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('#course-browser-modal')).toBeHidden();
  // Cancel returns to the course launcher in the still-open sidebar.
  await expect(page.locator('#browse-courses-btn')).toBeFocused();
  await expect(page.locator('#sidebar')).toHaveAttribute('aria-hidden', 'false');
  await browse(page);
  await page.locator('#course-browser-search').fill('carolina beginner');
  await rows(page).first().click();
  await expect(page.locator('#course-browser-modal')).toBeHidden();
  await expect(page.locator('#sidebar')).toHaveAttribute('aria-hidden', 'true');
  await expect.poll(() => page.evaluate(() => location.hash)).toBe(folderHash(['Bachata', 'Carolina Rosa - Beginner']));
  await expect(page.locator('#home-title')).toHaveText('Bachata');
  await page.locator('#course-grid .lesson-tile .tile-main-btn').first().click();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'video');
  await expect(page.locator('#video-player')).toBeVisible();
});

test('phone taps and every click-based dismissal preserve the sidebar and return focus to Browse courses', async ({ page }) => {
  await open(page, { width: 390, height: 844 });
  await page.locator('#menu-toggle-btn').click();
  for (const method of ['button', 'Enter', 'backdrop']) {
    await browse(page);
    const search = page.locator('#course-browser-search');
    await search.click();
    await search.fill('tania');
    await page.locator('#course-browser-clear').click();
    await expect(page.locator('#sidebar')).toHaveClass(/\bopen\b/);
    if (method === 'Enter') {
      await page.locator('#close-course-browser-btn').focus();
      await page.keyboard.press('Enter');
    } else if (method === 'backdrop') {
      await page.locator('#course-browser-modal').click({ position: { x: 4, y: 4 } });
    } else await page.locator('#close-course-browser-btn').click();
    await expect(page.locator('#course-browser-modal')).toBeHidden();
    await expect(page.locator('#sidebar')).toHaveClass(/\bopen\b/);
    await expect(page.locator('#sidebar')).toHaveAttribute('aria-hidden', 'false');
    await expect(page.locator('#browse-courses-btn')).toBeFocused();
  }
});

test('long course names remain readable without horizontal overflow on a 320px phone', async ({ page }) => {
  await open(page, { width: 320, height: 740 });
  await browse(page, { mobile: true });
  await page.locator('#course-browser-search').fill('Korke cadences');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('Bachata Sensual 2025: New Techniques and Cadences');
  await expect(rows(page).first()).toBeInViewport();
  const sizing = await page.evaluate(() => {
    const selectors = ['#course-browser-modal', '.course-browser-panel', '#course-browser-results', '.course-browser-row'];
    return {
      viewport: innerWidth,
      pageWidth: document.documentElement.scrollWidth,
      elements: selectors.map(selector => {
        const element = document.querySelector(selector);
        const box = element.getBoundingClientRect();
        return { selector, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, x: box.x, right: box.right };
      })
    };
  });
  expect(sizing.pageWidth).toBeLessThanOrEqual(sizing.viewport + 1);
  for (const element of sizing.elements) {
    expect(element.scrollWidth, element.selector).toBeLessThanOrEqual(element.clientWidth + 1);
    expect(element.x, element.selector).toBeGreaterThanOrEqual(0);
    expect(element.right, element.selector).toBeLessThanOrEqual(sizing.viewport + 1);
  }
  await rows(page).first().click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe(folderHash(LONG_COURSE));
});
