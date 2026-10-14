import { behaviorBases } from './coverage-bases';
import { expect, test } from '@playwright/test';

for (const base of behaviorBases) {
  test(`production asset cache reuses bytes with a native uncached control ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    const asset = await page
      .locator('script[type="module"][src]')
      .getAttribute('src');
    expect(asset).toBeTruthy();
    const read = async () =>
      page.evaluate(async (asset) => {
        const url = new URL(asset!, location.href).href;
        performance.clearResourceTimings();
        const response = await fetch(url);
        const body = await response.text();
        const timing = performance
          .getEntriesByName(url)
          .at(-1) as PerformanceResourceTiming;
        return {
          body,
          transferSize: timing.transferSize,
          status: response.status,
          cache: response.headers.get('cache-control'),
        };
      }, asset);
    const warm = await read();
    const cached = await read();
    expect(warm.status).toBe(200);
    expect(cached.body).toBe(warm.body);
    expect(cached.cache).toContain('immutable');
    expect(cached.transferSize).toBe(0);
    const cdp = await page.context().newCDPSession(page);
    try {
      await cdp.send('Network.enable');
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      const uncached = await read();
      expect(uncached.body).toBe(warm.body);
      expect(uncached.transferSize).toBeGreaterThan(0);
    } finally {
      await cdp.detach();
    }
  });
}
