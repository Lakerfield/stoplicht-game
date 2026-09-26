import { expect, test } from '@playwright/test';
import { waitForMap } from './helpers';

/** Runs in the "mobile" project only (phone emulation). */
test.describe('phone layout', () => {
  test('top bar stays one row and the panel clears the control bar', async ({ page }) => {
    await page.goto('/play/level3');
    await waitForMap(page, 'level3');
    const top = await page.locator('.hud-top').boundingBox();
    expect(top!.height).toBeLessThan(80);
    const grid = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
    const canvas = await page.locator('canvas').boundingBox();
    const zoom = Math.min(1.5, Math.max(0.2, Math.min((grid.w - 32) / (15 * 64), (grid.h - 220) / (11 * 64))));
    await page.touchscreen.tap(canvas!.x + canvas!.width / 2 + (4.5 - 7.5) * 64 * zoom, canvas!.y + canvas!.height / 2);
    const panel = page.locator('.panel');
    await expect(panel).toBeVisible();
    const panelBox = await panel.boundingBox();
    const bar = await page.locator('.hud-bottom .hud-card').boundingBox();
    expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(bar!.y + 1);
    expect(panelBox!.height / grid.h).toBeLessThan(0.55);
  });

  test('canvas follows a rotation', async ({ page }) => {
    await page.goto('/play/level1');
    await waitForMap(page, 'level1');
    await page.setViewportSize({ width: 844, height: 390 });
    await expect.poll(() => page.evaluate(() => `${document.querySelector('canvas')!.getBoundingClientRect().width}x${innerWidth}`)).toBe('844x844');
  });
});
