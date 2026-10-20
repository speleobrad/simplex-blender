import { test as base, expect } from '@playwright/test';
import { seedStorage } from './storage-fixtures.js';

const isKnownCdnIssue = (url, message = '') => {
  const cdn = /(?:unpkg\.com|cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|google-analytics\.com)/i.test(url);
  return cdn && /(?:failed to load resource|net::|blocked|driver\.js|collect)/i.test(message);
};
export async function captureRuntime(page) {
  const runtime = { errors: [], consoleMessages: [], failedRequests: [] };
  page.on('console', message => {
    const url = message.location().url;
    if (message.type() === 'error' && !isKnownCdnIssue(url, message.text())) runtime.consoleMessages.push(message.text());
  });
  page.on('pageerror', error => runtime.errors.push(error));
  page.on('requestfailed', request => {
    const message = request.failure()?.errorText ?? 'request failed';
    if (!isKnownCdnIssue(request.url(), message)) runtime.failedRequests.push({ url: request.url(), errorText: message });
  });
  page.on('response', response => {
    if (response.status() >= 400 && new URL(response.url()).origin === new URL(page.url() || 'http://127.0.0.1').origin) {
      runtime.failedRequests.push({ url: response.url(), errorText: `HTTP ${response.status()}` });
    }
  });
  return runtime;
}

export const test = base.extend({
  captureRuntime: async ({ page }, use) => {
    const runtime = await captureRuntime(page);
    await use(runtime);
    const details = [
      ...runtime.errors.map(error => error.message),
      ...runtime.consoleMessages,
      ...runtime.failedRequests.map(request => `${request.url}: ${request.errorText}`)
    ];
    if (details.length) throw new Error(`Application runtime failures:\n${details.join('\n')}`);
  },
  seedStorage: async ({ page }, use) => {
    await use((scenarioName = 'factory') => seedStorage(page, scenarioName));
  },
  appPage: async ({ page, captureRuntime, seedStorage }, use) => {
    await use({
      goto: async (scenarioName = 'factory') => {
        await page.evaluate(() => { window.name = ''; });
        await seedStorage(scenarioName);
        await page.goto('/index.html');
        return page;
      },
      page,
      runtime: captureRuntime
    });
  },
  resetApp: async ({ page }, use) => {
    await use(async () => {
      await page.evaluate(() => {
        window.name = '__skipStorageSeed';
        window.localStorage.clear();
      });
      await page.reload();
      await page.getByRole('button', { name: 'Settings' }).waitFor();
    });
  }
});

export { expect };
