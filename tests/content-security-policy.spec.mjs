import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'allow' });

test.beforeEach(async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.route('https://fonts.gstatic.com/**', route => route.abort());
});

test('the hardened policy permits the app and blocks unapproved scripts', async ({ page }) => {
  const unapprovedNetworkRequests = [];
  await page.route('https://example.com/**', route => {
    unapprovedNetworkRequests.push(route.request().url());
    return route.abort();
  });

  await page.addInitScript(() => {
    window.__danceLibraryCspViolations = [];
    document.addEventListener('securitypolicyviolation', event => {
      window.__danceLibraryCspViolations.push({
        blockedURI: event.blockedURI,
        effectiveDirective: event.effectiveDirective
      });
    });
  });

  await page.goto('/');
  await expect(page.locator('#app-loader')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Dance Library', exact: true })).toBeVisible();
  await expect(page.locator('script:not([src])')).toHaveCount(0);

  const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(policy).toContain("script-src 'self' https://cdn.jsdelivr.net");
  expect(policy).toContain("script-src-attr 'none'");
  expect(policy).toContain("media-src 'self' blob: https://*.b-cdn.net");
  expect(policy).toContain("connect-src 'self' https://*.b-cdn.net");
  expect(policy).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  expect(policy).not.toContain("'unsafe-eval'");

  const startupViolations = await page.evaluate(() => window.__danceLibraryCspViolations);
  expect(startupViolations).toEqual([]);

  await page.evaluate(() => {
    const unapprovedScript = document.createElement('script');
    unapprovedScript.src = 'https://example.com/blocked.js';
    document.head.appendChild(unapprovedScript);
  });

  await expect.poll(
    () => page.evaluate(() => window.__danceLibraryCspViolations),
    { message: 'the browser should enforce script-src against an unapproved origin' }
  ).toContainEqual(expect.objectContaining({
    blockedURI: 'https://example.com/blocked.js',
    effectiveDirective: 'script-src-elem'
  }));
  expect(unapprovedNetworkRequests).toEqual([]);
});

test('the external registration script installs the project service worker', async ({ page }) => {
  await page.goto('/');

  const registrationScript = page.locator('script[src^="sw-register.js?v="]');
  await expect(registrationScript).toHaveCount(1);

  const workerScriptUrl = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return registration.active?.scriptURL || '';
  });
  expect(new URL(workerScriptUrl).pathname).toBe('/sw.js');
});
