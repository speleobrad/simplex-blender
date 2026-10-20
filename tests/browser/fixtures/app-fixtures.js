import { test as base, expect } from '@playwright/test';
import { seedStorage } from './storage-fixtures.js';

const isNonEssentialAnalytics = (url, message = '') => /google-analytics\.com|googletagmanager\.com/i.test(url)
  || /google analytics|googletagmanager|gtag|analytics.*collect|collect.*analytics/i.test(message);

function recordExternalFailure(runtime, url, errorText) {
  if (!isNonEssentialAnalytics(url, errorText)) runtime.failedRequests.push({ url, errorText });
}
export async function captureRuntime(page) {
  const runtime = { errors: [], consoleMessages: [], failedRequests: [] };
  page.on('console', message => {
    const url = message.location().url;
    if (message.type() === 'error' && !isNonEssentialAnalytics(url, message.text())) runtime.consoleMessages.push(message.text());
  });
  page.on('pageerror', error => runtime.errors.push(error));
  page.on('requestfailed', request => {
    const message = request.failure()?.errorText ?? 'request failed';
    recordExternalFailure(runtime, request.url(), message);
  });
  page.on('response', response => {
    if (response.status() >= 400) {
      recordExternalFailure(runtime, response.url(), `HTTP ${response.status()}`);
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
    await page.route(/google-analytics\.com|googletagmanager\.com/i, route => route.fulfill({
      status: 204,
      contentType: 'text/plain',
      body: ''
    }));
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
