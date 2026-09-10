import { expect, test } from '@playwright/test';

const LESSON = 'Fernando Sosa  Tatiana Bonaguro - Sosa Style Beginner/03 - Susie Q y Tres-Tres.mp4';
const SELECTORS = {
    workspace: '#video-view', column: '#video-sticky-wrapper', frame: '.player-container',
    video: '#video-player', toolbar: '.video-controls-bar', footer: '.lesson-footer-controls',
    guide: '#video-info-wrapper',
};
test.use({ isMobile: false, hasTouch: false });

async function openLesson(page, viewport) {
    await page.setViewportSize(viewport);
    await page.route('https://**/*', route => route.abort());
    // This suite measures layout independently of the CDN. Playback behavior
    // and real media readiness have separate regression coverage.
    await page.addInitScript(() => {
        class LayoutHls {
            static Events = { MANIFEST_PARSED: 'manifestParsed', FRAG_LOADED: 'fragLoaded', ERROR: 'error' };
            static ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' };
            static isSupported() { return true; }
            on() {}
            loadSource() {}
            attachMedia() {}
            destroy() {}
        }
        globalThis.Hls = LayoutHls;
    });
    await page.goto(`/#video=${encodeURIComponent(LESSON)}`);
    await expect(page.locator('body')).toHaveAttribute('data-app-ready', 'true');
    await page.locator('#practice-tab-guide').click();
    await page.evaluate(() => { document.getElementById('main-content').scrollTop = 0; });
}

async function bounds(page) {
    return page.evaluate(selectors => {
        const result = {};
        for (const [name, selector] of Object.entries(selectors)) {
            const element = document.querySelector(selector);
            const rect = element.getBoundingClientRect();
            const css = getComputedStyle(element);
            result[name] = {
                left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
                width: rect.width, height: rect.height,
                innerWidth: element.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight),
                overflow: element.scrollWidth - element.clientWidth,
                objectFit: css.objectFit,
            };
        }
        result.pageOverflow = document.documentElement.scrollWidth - innerWidth;
        result.shortPhoneLandscape = innerWidth >= 560 && innerWidth <= 900 && innerHeight <= 500;
        const main = document.getElementById('main-content');
        result.mainOverflow = main.scrollWidth - main.clientWidth;
        result.clippedControls = [...document.querySelectorAll(
            '.practice-panel-tabs [role="tab"], #video-summary .timestamp-pill, #video-summary summary, #quick-note-btn, #lesson-footer-controls button'
        )].filter(element => {
            const r = element.getBoundingClientRect();
            if (!r.width || !r.height) return false;
            const owner = element.closest('#video-info-wrapper') ? result.guide : result.column;
            return r.left < owner.left - 1 || r.right > owner.right + 1;
        }).map(element => element.id || element.textContent.trim());
        return result;
    }, SELECTORS);
}

async function settleWorkspaceTransition(page) {
    await page.evaluate(async () => {
        // The sidebar's margin animates the workspace position even after its
        // class changes and the internal player/guide proportions are valid.
        await new Promise(requestAnimationFrame);
        const animations = ['#sidebar', '#main-content', '#video-view']
            .flatMap(selector => document.querySelector(selector).getAnimations());
        await Promise.allSettled(animations.map(animation => animation.finished));
    });
}

function expectAlignedPlayer(measurements) {
    const { column, frame, video, toolbar, footer } = measurements;
    // The video has a one-pixel frame border. Everything else must share the
    // same column edges; a 1000px player above a 1400px toolbar must fail.
    for (const [name, rect] of Object.entries({ frame, video, toolbar, footer })) {
        expect(Math.abs(rect.left - column.left), `${name} left edge`).toBeLessThanOrEqual(2);
        expect(Math.abs(rect.right - column.right), `${name} right edge`).toBeLessThanOrEqual(2);
    }
    expect(frame.width).toBeGreaterThan(0);
    if (measurements.shortPhoneLandscape) {
        // A short phone deliberately caps the full-width frame by viewport
        // height; contain preserves the actual media's proportions inside it.
        expect(Math.abs(frame.height - video.height), 'video fills the bounded landscape frame').toBeLessThanOrEqual(2);
        expect(video.objectFit).toBe('contain');
    } else {
        expect(Math.abs(frame.width / frame.height - 16 / 9), 'player frame aspect ratio').toBeLessThan(0.02);
        expect(Math.abs(video.width / video.height - 16 / 9), 'video aspect ratio').toBeLessThan(0.02);
    }
    expect(toolbar.top).toBeGreaterThanOrEqual(frame.bottom - 2);
    expect(footer.top).toBeGreaterThanOrEqual(toolbar.bottom - 2);
    expect(measurements.pageOverflow).toBeLessThanOrEqual(1);
    expect(measurements.mainOverflow).toBeLessThanOrEqual(1);
    for (const name of ['workspace', 'column', 'toolbar', 'footer', 'guide']) {
        expect(measurements[name].overflow, `${name} content fits its container`).toBeLessThanOrEqual(1);
    }
    expect(measurements.clippedControls).toEqual([]);
}

function expectAdjacentGuide(measurements) {
    const { workspace, column, guide } = measurements;
    expect(workspace.width).toBeLessThanOrEqual(1602);
    expect(Math.abs(guide.top - column.top), 'guide begins beside the player').toBeLessThanOrEqual(2);
    expect(guide.left - column.right, 'space between player and guide').toBeGreaterThanOrEqual(23.5);
    expect(guide.left - column.right, 'space between player and guide').toBeLessThanOrEqual(32.5);
    expect(guide.width).toBeGreaterThanOrEqual(workspace.innerWidth >= 1200 ? 360 : 300);
    expect(guide.width).toBeLessThanOrEqual(422);
    expect(guide.width / workspace.innerWidth).toBeLessThanOrEqual(0.4);
    expect(guide.width).toBeLessThan(column.width);
}

for (const viewport of [{ width: 1920, height: 1080 }, { width: 2048, height: 1124 }, { width: 2772, height: 1522 }]) {
    test(`wide lesson stays joined with either sidebar state at ${viewport.width}×${viewport.height}`, async ({ page }) => {
        await openLesson(page, viewport);
        for (const sidebar of ['open', 'closed']) {
            if (sidebar === 'closed') {
                await page.locator('#close-sidebar-btn').click();
                await expect(page.locator('body')).toHaveClass(/sidebar-closed/);
            }
            await expect(async () => {
                const current = await bounds(page);
                expectAlignedPlayer(current);
                expectAdjacentGuide(current);
            }).toPass();
        }
    });
}

for (const viewport of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }]) {
    test(`ordinary desktop keeps a useful adjacent guide at ${viewport.width}×${viewport.height}`, async ({ page }) => {
        await openLesson(page, viewport);
        const current = await bounds(page);
        expectAlignedPlayer(current);
        expectAdjacentGuide(current);
        await page.locator('.lesson-tools-disclosure > summary').click();
        expectAlignedPlayer(await bounds(page));
    });
}

for (const viewport of [{ width: 1024, height: 768 }, { width: 844, height: 390 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
    test(`stacked lesson preserves shared edges and accessible controls at ${viewport.width}×${viewport.height}`, async ({ page }) => {
        await openLesson(page, viewport);
        const current = await bounds(page);
        expectAlignedPlayer(current);
        expect(current.guide.top).toBeGreaterThanOrEqual(current.column.bottom - 2);
        expect(Math.abs(current.guide.left - current.column.left)).toBeLessThanOrEqual(2);
        expect(Math.abs(current.guide.right - current.column.right)).toBeLessThanOrEqual(2);
        await page.locator('.lesson-tools-disclosure > summary').click();
        expectAlignedPlayer(await bounds(page));
    });
}

for (const sidebar of ['open', 'closed']) {
    test(`theater exit restores the wide lesson geometry with sidebar ${sidebar}`, async ({ page }) => {
        await openLesson(page, { width: 2048, height: 1124 });
        if (sidebar === 'closed') await page.locator('#close-sidebar-btn').click();
        await settleWorkspaceTransition(page);
        await expect(async () => {
            const current = await bounds(page);
            expectAlignedPlayer(current);
            expectAdjacentGuide(current);
        }).toPass();
        const before = await bounds(page);
        await page.evaluate(() => { globalThis.__wideLayoutVideo = document.getElementById('video-player'); });
        await page.locator('#theater-btn').click();
        await expect(page.locator('#theater-btn')).toHaveAttribute('aria-pressed', 'true');
        await page.keyboard.press('Escape');
        await expect(page.locator('#theater-btn')).toHaveAttribute('aria-pressed', 'false');
        await expect(async () => {
            const after = await bounds(page);
            expectAlignedPlayer(after);
            expectAdjacentGuide(after);
            for (const key of Object.keys(SELECTORS)) {
                for (const edge of ['left', 'right', 'width', 'height']) {
                    expect(Math.abs(after[key][edge] - before[key][edge]), `${key} ${edge} restored`).toBeLessThanOrEqual(2);
                }
            }
        }).toPass();
        expect(await page.evaluate(() => globalThis.__wideLayoutVideo === document.getElementById('video-player'))).toBe(true);
    });
}
