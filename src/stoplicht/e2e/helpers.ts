import { expect, type Page } from '@playwright/test';

/** Grid size per level id (from the generator); used to click junction tiles on the canvas. */
const GRIDS: Record<string, [number, number]> = { level1: [11, 9], level2: [15, 9], level3: [15, 11], level4: [13, 9], level12: [21, 9] };
const TILE_PX = 64;

/** Screen position of a tile centre, mirroring the scene's fit-to-screen zoom. */
export async function tileCenter(page: Page, levelId: string, tx: number, ty: number): Promise<[number, number]> {
  const [gw, gh] = GRIDS[levelId];
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas');
  const zoom = Math.min(1.5, Math.max(0.2, Math.min((box.width - 32) / (gw * TILE_PX), (box.height - 220) / (gh * TILE_PX))));
  return [box.x + box.width / 2 + (tx + 0.5 - gw / 2) * TILE_PX * zoom, box.y + box.height / 2 + (ty + 0.5 - gh / 2) * TILE_PX * zoom];
}

/** Waits until the scene has drawn and fitted the level (the canvas carries data-level). */
export async function waitForMap(page: Page, levelId: string): Promise<void> {
  await expect(page.locator(`canvas[data-level="${levelId}"]`)).toBeVisible();
}

export async function openLevel(page: Page, levelId: string): Promise<void> {
  await page.goto(`/play/${levelId}`);
  await waitForMap(page, levelId);
  await expect(page.locator('.hud-time')).toContainText('0:00.0');
}

export async function openJunction(page: Page, levelId: string, tx: number, ty: number): Promise<void> {
  await waitForMap(page, levelId);
  const [x, y] = await tileCenter(page, levelId, tx, ty);
  await page.mouse.click(x, y);
  await expect(page.locator('.panel')).toBeVisible();
}

/** Presses a stepper button of the panel slider (0 = minus, 1 = plus). */
export async function step(page: Page, direction: 0 | 1, times = 1): Promise<void> {
  const btn = page.locator('.panel .btn.step').nth(direction);
  for (let i = 0; i < times; i++) {
    await btn.dispatchEvent('pointerdown');
    await btn.dispatchEvent('pointerup');
  }
}

export async function unlockDevMode(page: Page): Promise<void> {
  for (let i = 0; i < 7; i++) await page.locator('.version').click({ modifiers: ['Shift'] });
  await expect(page.getByRole('button', { name: /Editor/ })).toBeVisible();
}

/** Drag on the editor canvas from tile a to tile b (roads are drawn per tile). */
export async function drawRoad(page: Page, a: [number, number], b: [number, number]): Promise<void> {
  const grid = await page.evaluate(() => {
    const r = document.querySelector('.editor-svg rect')!.getBoundingClientRect();
    const level = JSON.parse(localStorage.getItem('stoplicht:editor-level')!);
    return { x: r.x, y: r.y, w: r.width, gw: level.grid.width, gh: level.grid.height };
  });
  const tile = grid.w / grid.gw;
  const at = (x: number, y: number): [number, number] => [grid.x + tile * (x + 0.5), grid.y + tile * (y + 0.5)];
  await page.mouse.move(...at(...a));
  await page.mouse.down();
  await page.mouse.move(...at(...b), { steps: 4 });
  await page.mouse.up();
}

export function editorLevel(page: Page): Promise<{ roads: unknown[]; spawns: { time: number; spawnPoint: string; vehicleType: string }[]; intersections: { id: string }[]; spawnPoints: { id: string }[]; grid: { width: number; height: number } }> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('stoplicht:editor-level')!));
}
