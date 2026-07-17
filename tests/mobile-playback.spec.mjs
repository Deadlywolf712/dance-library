import { expect, test } from '@playwright/test';

const LESSON_PATH = 'Adolfo Indacochea  Tania Cannarsa - Salsa On2 Advanced/01 - Syncopation.mp4';

async function installFakeHls(page) {
  await page.addInitScript(() => {
    function createWaveUrl(durationSeconds = 12) {
      const sampleRate = 8000;
      const sampleCount = sampleRate * durationSeconds;
      const buffer = new ArrayBuffer(44 + sampleCount * 2);
      const view = new DataView(buffer);
      const writeText = (offset, value) => {
        for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
      };
      writeText(0, 'RIFF');
      view.setUint32(4, 36 + sampleCount * 2, true);
      writeText(8, 'WAVE');
      writeText(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeText(36, 'data');
      view.setUint32(40, sampleCount * 2, true);
      for (let sample = 0; sample < sampleCount; sample += 1) {
        const value = Math.sin((sample / sampleRate) * Math.PI * 440) * 500;
        view.setInt16(44 + sample * 2, value, true);
      }
      return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
    }

    class FakeHls {
      static Events = { MANIFEST_PARSED: 'manifestParsed', ERROR: 'error' };
      static ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' };
      static isSupported() { return true; }

      constructor() {
        this.handlers = new Map();
        this.destroyed = false;
        this.networkRestarts = 0;
        this.mediaRecoveries = 0;
        globalThis.__fakeHlsInstances.push(this);
      }

      on(event, handler) {
        const handlers = this.handlers.get(event) || [];
        handlers.push(handler);
        this.handlers.set(event, handlers);
      }

      emit(event, data = {}) {
        for (const handler of this.handlers.get(event) || []) handler(event, data);
      }

      loadSource(source) { this.source = source; }

      attachMedia(media) {
        this.media = media;
        this.objectUrl = createWaveUrl();
        media.src = this.objectUrl;
        const announceManifest = () => setTimeout(() => this.emit(FakeHls.Events.MANIFEST_PARSED), 0);
        if (media.readyState >= 1) announceManifest();
        else media.addEventListener('loadedmetadata', announceManifest, { once: true });
        media.load();
      }

      startLoad() { this.networkRestarts += 1; }
      recoverMediaError() { this.mediaRecoveries += 1; }

      destroy() {
        this.destroyed = true;
        if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
      }
    }

    globalThis.__fakeHlsInstances = [];
    globalThis.Hls = FakeHls;
  });
}

async function requireUserGestureForPlayback(page) {
  await page.addInitScript(() => {
    const nativePlay = HTMLMediaElement.prototype.play;
    globalThis.__autoplayGateOpen = false;
    document.addEventListener('click', event => {
      if (event.target.closest?.('#video-retry-btn')) globalThis.__autoplayGateOpen = true;
    }, true);
    HTMLMediaElement.prototype.play = function guardedPlay() {
      if (globalThis.__autoplayGateOpen) return nativePlay.call(this);
      return Promise.reject(new DOMException('A direct tap is required.', 'NotAllowedError'));
    };
  });
}

async function openLesson(page, savedPosition) {
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.route('https://fonts.gstatic.com/**', route => route.abort());
  await installFakeHls(page);
  if (savedPosition !== undefined) {
    await page.addInitScript(({ lessonPath, position }) => {
      localStorage.setItem('videoPositions', JSON.stringify({ [lessonPath]: position }));
    }, { lessonPath: LESSON_PATH, position: savedPosition });
  }

  await page.goto(`/#video=${encodeURIComponent(LESSON_PATH)}`);
  await page.waitForFunction(() => {
    const video = document.getElementById('video-player');
    return video && Number.isFinite(video.duration) && video.duration > 11;
  });
  await expect(page.locator('#video-player')).toHaveAttribute('playsinline', '');
  await expect(page.locator('#video-player')).toHaveAttribute('webkit-playsinline', '');
}

async function expectContinuousPlayback(page, minimumAdvance = 1.5) {
  const before = await page.locator('#video-player').evaluate(async video => {
    video.muted = true;
    await video.play();
    globalThis.__postPlayPauses = 0;
    video.addEventListener('pause', () => { globalThis.__postPlayPauses += 1; });
    return video.currentTime;
  });
  await page.waitForTimeout(2200);
  const after = await page.locator('#video-player').evaluate(video => ({
    currentTime: video.currentTime,
    paused: video.paused,
    ended: video.ended,
    error: video.error?.code || null,
    pauses: globalThis.__postPlayPauses
  }));
  expect(after.currentTime - before).toBeGreaterThan(minimumAdvance);
  expect(after.paused).toBe(false);
  expect(after.ended).toBe(false);
  expect(after.error).toBe(null);
  expect(after.pauses).toBe(0);
}

test('fresh mobile HLS playback keeps advancing', async ({ page }) => {
  await openLesson(page);
  await expectContinuousPlayback(page);
});

test('autoplay denial exposes a direct one-tap Play video action', async ({ page }) => {
  await requireUserGestureForPlayback(page);
  await openLesson(page);
  const playAction = page.getByRole('button', { name: 'Play video' });
  await expect(playAction).toBeVisible();
  await playAction.click();
  await expect(playAction).toBeHidden();
  await expectContinuousPlayback(page);
});

test('a valid saved position resumes and keeps playing', async ({ page }) => {
  await openLesson(page, 6);
  await expect.poll(() => page.locator('#video-player').evaluate(video => video.currentTime)).toBeGreaterThan(5.8);
  await expectContinuousPlayback(page);
});

for (const savedPosition of [11.6, 9999]) {
  test(`stale saved position ${savedPosition} restarts from a playable point`, async ({ page }) => {
    await openLesson(page, savedPosition);
    const initialTime = await page.locator('#video-player').evaluate(video => video.currentTime);
    expect(initialTime).toBeLessThan(3);
    const storedPosition = await page.evaluate(path => JSON.parse(localStorage.getItem('videoPositions') || '{}')[path], LESSON_PATH);
    expect(storedPosition).toBeUndefined();
    await expectContinuousPlayback(page);
  });
}

test('stale callbacks cannot destroy the current stream and media recovery is bounded', async ({ page }) => {
  await openLesson(page);
  await page.getByRole('button', { name: 'Next lesson' }).click();
  await expect.poll(() => page.evaluate(() => globalThis.__fakeHlsInstances.length)).toBeGreaterThanOrEqual(2);
  await page.getByRole('button', { name: 'Previous lesson' }).click();
  await expect.poll(() => page.evaluate(() => globalThis.__fakeHlsInstances.length)).toBeGreaterThanOrEqual(3);

  const currentDestroyedByStaleError = await page.evaluate(() => {
    const first = globalThis.__fakeHlsInstances[0];
    const current = globalThis.__fakeHlsInstances.at(-1);
    first.emit(globalThis.Hls.Events.ERROR, {
      fatal: true,
      type: globalThis.Hls.ErrorTypes.MEDIA_ERROR,
      details: 'stale-session-test'
    });
    return current.destroyed;
  });
  expect(currentDestroyedByStaleError).toBe(false);

  await page.evaluate(() => {
    const current = globalThis.__fakeHlsInstances.at(-1);
    current.emit(globalThis.Hls.Events.ERROR, {
      fatal: true,
      type: globalThis.Hls.ErrorTypes.MEDIA_ERROR,
      details: 'current-session-test'
    });
  });
  await expect.poll(() => page.evaluate(() => globalThis.__fakeHlsInstances.at(-1).mediaRecoveries)).toBe(1);

  await page.evaluate(() => {
    const current = globalThis.__fakeHlsInstances.at(-1);
    current.emit(globalThis.Hls.Events.ERROR, {
      fatal: true,
      type: globalThis.Hls.ErrorTypes.NETWORK_ERROR,
      details: 'network-recovery-test'
    });
  });
  await expect.poll(() => page.evaluate(() => globalThis.__fakeHlsInstances.at(-1).networkRestarts)).toBe(1);
  await expectContinuousPlayback(page);
});
