import { expect, test } from '@playwright/test';
import { expectNoSeriousA11yViolations } from '../acceptance/fixtures/axe';
import { API_URL, TEST_SECRET } from '../env';

test('the static web app loads with security headers', async ({ page }) => {
  const res = await page.goto('/');
  expect(res?.status()).toBe(200);
  expect(res?.headers()['content-security-policy']).toContain("default-src 'self'");
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expectNoSeriousA11yViolations(page);
});

test('the API answers with X-Server-Time and the test API resets the emulators', async ({ request }) => {
  const health = await request.get(`${API_URL}/health`);
  expect(health.ok()).toBe(true);
  expect(Number(health.headers()['x-server-time'])).toBeGreaterThan(0);
  const reset = await request.post(`${API_URL}/__test/reset`, {
    headers: { 'x-test-secret': TEST_SECRET },
    data: { seed: 'base' },
  });
  expect(reset.status()).toBe(200);
});
