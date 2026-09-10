import { expect, test } from '@playwright/test';

const LESSON = 'Carolina Rosa - Beginner/07 - Turns in 15.mp4';
const BOOKMARKS = Array.from({ length: 14 }, (_, index) => ({
    t: 12 + index * 10,
    n: `Practice cue ${index + 1}: soften the shoulders, spot the turn, and finish with a smaller step.\nRepeat slowly before adding speed.`,
    ts: 1788956000000 + index,
}));

async function openNotebook(page, populated = true) {
    await page.route('https://fonts.googleapis.com/**', route => route.abort());
    await page.route('https://fonts.gstatic.com/**', route => route.abort());
    await page.addInitScript(({ lesson, bookmarks }) => {
        if (localStorage.getItem('notebookDesignSeeded')) return;
        localStorage.setItem('notebookDesignSeeded', 'true');
        localStorage.setItem('videoBookmarks', JSON.stringify(bookmarks.length ? { [lesson]: bookmarks } : {}));
        localStorage.setItem('practiceData', JSON.stringify({
            version: 1, queue: [], segments: [], completed: {},
            reflections: bookmarks.length ? { [lesson]: { text: 'Keep the next practice focused: smaller steps and a relaxed upper body.', updatedAt: 1788956100000 } } : {},
        }));
    }, { lesson: LESSON, bookmarks: populated ? BOOKMARKS : [] });
    await page.goto('/#view=notes');
    await expect(page.locator('body')).toHaveAttribute('data-app-ready', 'true');
    await expect(page.getByRole('heading', { name: 'Notebook', exact: true })).toBeVisible();
}

async function savedNotes(page) {
    return page.evaluate(() => JSON.parse(localStorage.getItem('videoBookmarks')));
}

test('a long mobile Notebook leaves all bottom destinations reachable by ordinary taps', async ({ page }) => {
    await openNotebook(page);
    await expect(page.locator('#notes-view')).toHaveAttribute('role', 'region');
    await expect(page.locator('#notes-view')).not.toHaveAttribute('aria-modal', 'true');
    await expect(page.getByRole('button', { name: 'Close notes', exact: true })).toHaveCount(0);
    const before = await savedNotes(page);
    for (const position of ['top', 'end']) {
        await page.locator(position === 'top' ? '.notebook-reflection' : '.notes-bookmark-item:last-child').scrollIntoViewIfNeeded();
        // Do not force this click or dispatch a synthetic event. The old modal
        // stacking covered this exact touch target with the Notebook content.
        await page.locator('[data-workspace-view="queue"]').click();
        await expect(page.locator('#queue-view')).toBeVisible();
        await page.locator('[data-workspace-view="notes"]').click();
        await expect(page.locator('#notes-view')).toBeVisible();
        await page.locator('[data-workspace-view="home"]').click();
        await expect(page.locator('#home-view')).toBeVisible();
        await page.locator('[data-workspace-view="notes"]').click();
    }
    expect(await savedNotes(page)).toEqual(before);
});

test('an empty Notebook has a working browse action and retains ordinary page navigation', async ({ page }) => {
    await openNotebook(page, false);
    await expect(page.getByRole('heading', { name: 'Start with a lesson', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Browse lessons', exact: true }).click();
    await expect(page.locator('#home-view')).toBeVisible();
    await expect(page.locator('#notes-view')).toBeHidden();
    expect(await savedNotes(page)).toEqual({});
});

test('Notebook search can recover from no results without hiding saved entries', async ({ page }) => {
    await openNotebook(page);
    await page.locator('#notes-search-input').fill('missingword9876');
    await expect(page.getByRole('heading', { name: 'No notes match your search' })).toBeVisible();
    await page.getByRole('button', { name: 'Clear search', exact: true }).click();
    await expect(page.locator('#notes-search-input')).toHaveValue('');
    await expect(page.locator('.notes-bookmark-item')).toHaveCount(BOOKMARKS.length);
    await expect(page.locator('.notebook-reflection')).toHaveCount(1);
    expect((await savedNotes(page))[LESSON]).toEqual(BOOKMARKS);
});

test('an unfinished inline note survives Queue navigation and reload before explicit save', async ({ page }) => {
    await openNotebook(page);
    const row = page.locator('.notes-bookmark-item').first();
    const draft = 'A cue for tomorrow:\nKeep the last step small.';
    await row.getByRole('button', { name: 'Edit note', exact: true }).click();
    await row.locator('textarea').fill(draft);
    await expect(row.getByRole('status')).toContainText('Draft kept on this device');
    await page.locator('[data-workspace-view="queue"]').click();
    await page.locator('[data-workspace-view="notes"]').click();
    await page.reload();
    await expect(page.locator('body')).toHaveAttribute('data-app-ready', 'true');
    await row.getByRole('button', { name: 'Edit note', exact: true }).click();
    await expect(row.locator('textarea')).toHaveValue(draft);
    expect((await savedNotes(page))[LESSON][0].n).toBe(BOOKMARKS[0].n);
    await row.getByRole('button', { name: 'Save note', exact: true }).click();
    await expect(row.locator('textarea')).toHaveCount(0);
    expect((await savedNotes(page))[LESSON][0].n).toBe(draft);
});

test('narrow and desktop Notebook layouts keep long notes within the reading surface', async ({ page }) => {
    await openNotebook(page);
    for (const viewport of [{ width: 320, height: 740 }, { width: 1280, height: 900 }]) {
        await page.setViewportSize(viewport);
        await expect(page.getByRole('heading', { name: 'Notebook', exact: true })).toBeVisible();
        const overflow = await page.locator('#notes-view').evaluate(element => ({
            page: document.documentElement.scrollWidth - innerWidth,
            notebook: element.scrollWidth - element.clientWidth,
            content: document.getElementById('notes-content').scrollWidth - document.getElementById('notes-content').clientWidth,
        }));
        expect(overflow.page).toBeLessThanOrEqual(1);
        expect(overflow.notebook).toBeLessThanOrEqual(1);
        expect(overflow.content).toBeLessThanOrEqual(1);
        expect((await savedNotes(page))[LESSON]).toEqual(BOOKMARKS);
    }
});
