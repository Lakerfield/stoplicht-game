import { expect, test } from '@playwright/test';
import { drawRoad, editorLevel } from './helpers';

test.describe('editor', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/editor');
    await expect(page.locator('.editor-svg')).toBeVisible();
    await page.getByRole('button', { name: /Nieuw level/ }).click();
    await page.getByRole('button', { name: /Nieuw leeg level maken/ }).click();
    await expect.poll(async () => (await editorLevel(page)).roads.length).toBe(0);
  });

  test('draws roads, derives junctions and spawn points, and undoes', async ({ page }) => {
    await drawRoad(page, [0, 4], [12, 4]);
    await drawRoad(page, [6, 0], [6, 8]);
    await expect.poll(async () => (await editorLevel(page)).intersections.map(i => i.id)).toEqual(['A']);
    await expect.poll(async () => (await editorLevel(page)).spawnPoints.length).toBe(4);
    await page.getByRole('button', { name: 'Ongedaan maken' }).click();
    await expect.poll(async () => (await editorLevel(page)).roads.length).toBe(1);
    await page.keyboard.press('Meta+Shift+Z');
    await expect.poll(async () => (await editorLevel(page)).roads.length).toBe(2);
  });

  test('adds a spawn series from the popup, selects and deletes spawns', async ({ page }) => {
    await drawRoad(page, [0, 4], [12, 4]);
    await drawRoad(page, [6, 0], [6, 8]);
    await page.locator('.timeline-label').first().click();
    const popup = page.locator('.dialog-wide');
    await expect(popup).toContainText(/Spawnpunt \d/);
    await popup.getByRole('button', { name: /Reeks toevoegen/ }).click();
    await expect(popup.locator('tbody tr')).toHaveCount(5);
    await popup.locator('.spawn-check').nth(0).check();
    await popup.locator('.spawn-check').nth(1).check();
    await popup.getByRole('button', { name: /Verwijder geselecteerde/ }).click();
    await expect(popup.locator('tbody tr')).toHaveCount(3);
    await expect.poll(async () => (await editorLevel(page)).spawns.length).toBe(3);
  });

  test('tests the level in the game and comes back', async ({ page }) => {
    await drawRoad(page, [0, 4], [12, 4]);
    await drawRoad(page, [6, 0], [6, 8]);
    await page.locator('.timeline-label').first().click();
    await page.locator('.dialog-wide').getByRole('button', { name: /Reeks toevoegen/ }).click();
    await page.locator('.dialog-wide').getByLabel('Sluiten').click();
    await page.getByRole('button', { name: /Level testen/ }).first().click();
    await expect(page).toHaveURL(/\/play\/editor$/);
    await expect(page.locator('canvas')).toBeVisible();
    await page.getByRole('button', { name: /Bereken/ }).click();
    await expect(page.locator('.dialog')).toContainText('Eindtijd');
    await page.locator('.dialog').getByRole('button', { name: /Terug naar editor/ }).click();
    await expect(page).toHaveURL(/\/editor$/);
  });
});
