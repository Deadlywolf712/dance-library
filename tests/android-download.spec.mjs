import { expect, test } from '@playwright/test';

const APK_URL = 'https://github.com/Deadlywolf712/dance-library/releases/latest/download/Dance-Library-Android.apk';

test.beforeEach(async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.route('https://fonts.gstatic.com/**', route => route.abort());
});

test('Android APK download is prominent and touch friendly on mobile', async ({ page }) => {
  await page.goto('/');

  const download = page.getByRole('link', {
    name: 'Download the latest Dance Library APK for Android'
  });
  await expect(download).toBeVisible();
  await expect(download).toHaveAttribute('href', APK_URL);
  await expect(download).toHaveAttribute('target', '_blank');
  await expect(download).toHaveAttribute('rel', 'noopener noreferrer');

  const bounds = await download.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds.height).toBeGreaterThanOrEqual(48);
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
});

test('Android APK download remains visible in the desktop hero', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');

  const download = page.locator('#android-download-link');
  await expect(download).toBeVisible();
  await expect(download).toHaveAttribute('href', APK_URL);
  await expect(download.getByText('Get the Android app')).toBeVisible();
  await expect(download.getByText('Download APK')).toBeVisible();
});
