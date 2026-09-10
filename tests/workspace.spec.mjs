import { expect, test } from '@playwright/test';

const LESSON_A = 'Carolina Rosa - Beginner/07 - Turns in 15.mp4';
const LESSON_B = 'Carolina Rosa - Advanced/09 - 33 Steps.mp4';
const FOLDER_A = ['Bachata', 'Carolina Rosa - Beginner'];
const FOLDER_B = ['Bachata', 'Carolina Rosa - Advanced'];
const folderHash = path => `#folder=${encodeURIComponent(JSON.stringify(path))}`;
const videoHash = path => `#video=${encodeURIComponent(path)}`;

async function preparePage(page, { desktop = false } = {}) {
  if (desktop) await page.setViewportSize({ width: 1280, height: 900 });
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.route('https://fonts.gstatic.com/**', route => route.abort());
  // Playback is independently covered by mobile-playback.spec.mjs. These tests
  // use real lesson routes and UI without fetching or playing external media.
  await page.addInitScript(() => {
    class WorkspaceHls {
      static Events = { MANIFEST_PARSED: 'manifestParsed', FRAG_LOADED: 'fragLoaded', ERROR: 'error' };
      static ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' };
      static isSupported() { return true; }
      on() {}
      loadSource() {}
      attachMedia() {}
      destroy() {}
    }
    globalThis.Hls = WorkspaceHls;
  });
}

async function openPage(page, hash = '', options = {}) {
  await preparePage(page, options);
  await page.goto(`/${hash}`);
  await expect(page.locator('body')).toHaveAttribute('data-app-ready', 'true');
}

async function expectHash(page, hash) {
  await expect.poll(() => page.evaluate(() => location.hash)).toBe(hash);
}

async function readPractice(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('practiceData')));
}

async function reloadReady(page) {
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-app-ready', 'true');
}

test('folder navigation has durable URLs and reload preserves browser Back and Forward', async ({ page }) => {
  await openPage(page);
  await page.getByRole('button', { name: /^Open Bachata, \d+ lessons$/ }).click();
  await expectHash(page, folderHash(['Bachata']));
  await page.getByRole('button', { name: 'Open Carolina Rosa - Beginner, 10 lessons' }).click();
  await expectHash(page, folderHash(FOLDER_A));
  await expect(page.locator('#course-grid > .lesson-tile')).toHaveCount(10);
  await reloadReady(page);
  await expectHash(page, folderHash(FOLDER_A));
  await expect(page.locator('#course-grid > .lesson-tile')).toHaveCount(10);
  await expect(page.locator(`.tile-star-btn[data-path="${LESSON_A}"]`)).toBeVisible();

  await page.goBack();
  await expectHash(page, folderHash(['Bachata']));
  await expect(page.getByRole('button', { name: 'Open Carolina Rosa - Beginner, 10 lessons' })).toBeVisible();
  await page.goForward();
  await expectHash(page, folderHash(FOLDER_A));
  await expect(page.locator('#course-grid > .lesson-tile')).toHaveCount(10);
});

test('the notebook is a routed page region and Back returns to the previous course', async ({ page }) => {
  await openPage(page, folderHash(FOLDER_A));
  await page.locator('[data-workspace-view="notes"]').click();
  await expectHash(page, '#view=notes');
  await expect(page.locator('#notes-view')).toBeVisible();
  await expect(page.locator('#notes-view')).toHaveAttribute('role', 'region');
  await expect(page.locator('#notes-view')).not.toHaveAttribute('aria-modal', 'true');
  await expect(page.locator('[data-workspace-view="notes"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#home-view')).toBeHidden();
  await reloadReady(page);
  await expect(page.locator('#notes-view')).toBeVisible();
  await expectHash(page, '#view=notes');
  await page.goBack();
  await expectHash(page, folderHash(FOLDER_A));
  await expect(page.locator('#notes-view')).toBeHidden();
  await expect(page.locator('#course-grid > .lesson-tile')).toHaveCount(10);
});

test('mobile queue navigation and a lesson queue toggle persist one entry across reloads', async ({ page }) => {
  await openPage(page, videoHash(LESSON_A));
  const toggle = page.locator('#lesson-queue-toggle');
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => readPractice(page)).toEqual({
    version: 1, queue: [LESSON_A], segments: [], completed: {}, reflections: {}
  });
  await page.locator('[data-workspace-view="queue"]').click();
  await expectHash(page, '#view=queue');
  await expect(page.locator('#queue-view')).toBeVisible();
  await expect(page.locator('#queue-list')).toContainText('07 - Turns in 1/5');
  await expect(page.locator('[data-workspace-view="queue"]')).toHaveAttribute('aria-current', 'page');
  await reloadReady(page);
  await expect(page.locator('#queue-view')).toBeVisible();
  await expect(page.locator('#queue-list')).toContainText('07 - Turns in 1/5');
  expect((await readPractice(page)).queue).toEqual([LESSON_A]);

  await page.goBack();
  await expectHash(page, videoHash(LESSON_A));
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await reloadReady(page);
  expect((await readPractice(page)).queue).toEqual([LESSON_A]);
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await readPractice(page)).queue).toEqual([]);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await readPractice(page)).queue).toEqual([LESSON_A]);
});

test('desktop queue reorders, removes, and opens lessons while preserving other practice data', async ({ page }) => {
  const preserved = {
    version: 1,
    queue: [LESSON_B],
    segments: [],
    completed: { [LESSON_B]: 1700000000000 },
    reflections: { [LESSON_B]: { text: 'Keep this session reflection.', updatedAt: 1700000001000 } }
  };
  await page.addInitScript(value => {
    if (localStorage.getItem('workspacePracticeSeeded')) return;
    localStorage.setItem('practiceData', JSON.stringify(value));
    localStorage.setItem('workspacePracticeSeeded', 'true');
  }, preserved);
  await openPage(page, videoHash(LESSON_A), { desktop: true });
  await page.locator('#lesson-queue-toggle').click();
  await expect.poll(async () => (await readPractice(page)).queue).toEqual([LESSON_B, LESSON_A]);
  await page.locator('#nav-queue').click();
  await expectHash(page, '#view=queue');
  await expect(page.locator('#queue-view')).toBeVisible();
  await expect(page.locator('#queue-list')).toContainText('09 - 3X3 Steps');
  await expect(page.locator('#queue-list')).toContainText('07 - Turns in 1/5');
  await expect(page.locator('#nav-queue')).toHaveAttribute('aria-current', 'page');
  const rowA = page.locator(`#queue-list .queue-lesson[data-path="${LESSON_A}"]`);
  const rowB = page.locator(`#queue-list .queue-lesson[data-path="${LESSON_B}"]`);
  await rowA.locator('.queue-options > summary').click();
  await rowA.locator('[data-workspace-action="up"]').click();
  await expect.poll(() => page.locator('#queue-list .queue-lesson').evaluateAll(rows => rows.map(row => row.dataset.path))).toEqual([LESSON_A, LESSON_B]);
  await expect.poll(async () => (await readPractice(page)).queue).toEqual([LESSON_A, LESSON_B]);
  await expect(rowA.locator('[data-workspace-action="up"]')).toBeDisabled();
  await rowB.locator('.queue-options > summary').click();
  await rowB.locator('[data-workspace-action="remove"]').click();
  await expect(rowB).toHaveCount(0);
  await expect.poll(async () => (await readPractice(page)).queue).toEqual([LESSON_A]);
  const current = await readPractice(page);
  expect(current.completed).toEqual(preserved.completed);
  expect(current.reflections).toEqual(preserved.reflections);
  await reloadReady(page);
  expect((await readPractice(page)).queue).toEqual([LESSON_A]);
  await rowA.locator('[data-workspace-action="open"]').click();
  await expectHash(page, videoHash(LESSON_A));
  await expect(page.locator('#lesson-queue-toggle')).toHaveAttribute('aria-pressed', 'true');
});

test('opening a lesson does not mark it complete and explicit completion survives reload', async ({ page }) => {
  await openPage(page, videoHash(LESSON_A));
  const complete = page.locator('#lesson-complete-toggle');
  await expect(complete).toBeVisible();
  await expect(complete).toHaveAttribute('aria-pressed', 'false');
  expect((await readPractice(page))?.completed?.[LESSON_A]).toBeUndefined();
  await complete.click();
  await expect(complete).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await readPractice(page))?.completed?.[LESSON_A]).toEqual(expect.any(Number));
  const completedAt = (await readPractice(page)).completed[LESSON_A];
  expect(completedAt).toBeGreaterThan(0);
  await reloadReady(page);
  await expect(complete).toHaveAttribute('aria-pressed', 'true');
  expect((await readPractice(page)).completed[LESSON_A]).toBe(completedAt);

  await complete.click();
  await expect(complete).toHaveAttribute('aria-pressed', 'false');
  await reloadReady(page);
  await expect(complete).toHaveAttribute('aria-pressed', 'false');
  expect((await readPractice(page)).completed[LESSON_A]).toBeUndefined();
});

test('two open tabs can favorite different lessons without overwriting each other', async ({ page, context }) => {
  await openPage(page, folderHash(FOLDER_A), { desktop: true });
  const other = await context.newPage();
  try {
    await openPage(other, folderHash(FOLDER_B), { desktop: true });
    const firstStar = page.locator(`.tile-star-btn[data-path="${LESSON_A}"]`);
    const secondStar = other.locator(`.tile-star-btn[data-path="${LESSON_B}"]`);
    await expect(firstStar).toHaveAttribute('aria-pressed', 'false');
    await expect(secondStar).toHaveAttribute('aria-pressed', 'false');
    await Promise.all([firstStar.click(), secondStar.click()]);
    await expect(firstStar).toHaveAttribute('aria-pressed', 'true');
    await expect(secondStar).toHaveAttribute('aria-pressed', 'true');
    const sortedPaths = [LESSON_A, LESSON_B].sort();
    for (const tab of [page, other]) {
      await expect.poll(() => tab.evaluate(() => JSON.parse(localStorage.getItem('favoriteVideos') || '[]').sort())).toEqual(sortedPaths);
    }
    // Verify the saved result through rendered UI after both tabs reload.
    await Promise.all([reloadReady(page), reloadReady(other)]);
    await expect(firstStar).toHaveAttribute('aria-pressed', 'true');
    await expect(secondStar).toHaveAttribute('aria-pressed', 'true');
    await firstStar.click();
    await expect(firstStar).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => other.evaluate(() => JSON.parse(localStorage.getItem('favoriteVideos') || '[]'))).toEqual([LESSON_B]);
    await expect(secondStar).toHaveAttribute('aria-pressed', 'true');
  } finally {
    await other.close();
  }
});

test('global search matches instructor, course, and lesson regardless of token order or case', async ({ page }) => {
  await openPage(page, '', { desktop: true });
  const query = 'turns beginner carolina';
  await page.locator('#library-search-launch').click();
  await page.locator('#spotlight-input').fill(query);
  const spotlightTitles = page.locator('#spotlight-results .spotlight-result-title');
  await expect(spotlightTitles).toHaveText(['07 - Turns in 1/5']);
  await page.locator('#spotlight-input').fill('CAROLINA   turns BEGINNER');
  await expect(spotlightTitles).toHaveText(['07 - Turns in 1/5']);
  await page.keyboard.press('Escape');
  await expect(page.locator('#library-search-launch')).toBeFocused();
  await page.locator('#library-search-launch').click();
  await page.locator('#spotlight-input').fill('CAROLINA   turns BEGINNER');
  await expect(spotlightTitles).toHaveText(['07 - Turns in 1/5']);
  await page.keyboard.press('Enter');
  await expectHash(page, videoHash(LESSON_A));
});
