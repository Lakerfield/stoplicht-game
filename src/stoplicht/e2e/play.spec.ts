import { expect, test } from '@playwright/test';
import { openJunction, openLevel, step } from './helpers';

test.describe('playing a level', () => {
  test('computes the result instantly and shows the wait statistics', async ({ page }) => {
    await openLevel(page, 'level2');
    await page.getByRole('button', { name: /Bereken/ }).click();
    const dialog = page.locator('.dialog');
    await expect(dialog).toContainText("Alle auto's zijn weg");
    await expect(dialog).toContainText('Eindtijd');
    await expect(dialog).toContainText('Wachttijd per kruispunt');
    await expect(dialog).toContainText('per auto');
    await expect(dialog).toContainText(/in totaal, \d+ auto's gepasseerd/);
    await dialog.getByRole('button', { name: /Opnieuw/ }).click();
    await expect(page.locator('.hud-time')).toContainText('0:00.0');
  });

  test('shows a tutorial hint on level 1 until the junction is opened', async ({ page }) => {
    await openLevel(page, 'level1');
    await expect(page.locator('.hint-bubble')).toContainText('Tik op het kruispunt');
    await openJunction(page, 'level1', 5, 4);
    await expect(page.locator('.hint-bubble')).toHaveCount(0);
    await openLevel(page, 'level3');
    await expect(page.locator('.hint-bubble')).toHaveCount(0);
  });

  test('runs, pauses, edits and restarts', async ({ page }) => {
    await openLevel(page, 'level1');
    await page.getByRole('button', { name: /Start/ }).click();
    await page.getByRole('button', { name: '4×' }).click();
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: /Pauze/ }).click();
    await openJunction(page, 'level1', 5, 4);
    await expect(page.locator('.panel h2')).toHaveText('Kruispunt A');
    await step(page, 1, 2);
    await expect(page.locator('.hud-bottom .btn-primary')).toContainText('Herstart');
    await page.locator('.hud-bottom .btn-primary').click();
    await expect(page.locator('.hud-bottom .btn-primary')).toContainText('Pauze');
  });

  test('keeps working settings across a reload', async ({ page }) => {
    await openLevel(page, 'level1');
    await openJunction(page, 'level1', 5, 4);
    await step(page, 1, 3);
    await expect(page.locator('.panel .cycle-part').first()).toContainText('10.3');
    await page.reload();
    await openJunction(page, 'level1', 5, 4);
    await expect(page.locator('.panel .cycle-part').first()).toContainText('10.3');
  });

  test('links and unlinks the two directions', async ({ page }) => {
    await openLevel(page, 'level1');
    await openJunction(page, 'level1', 5, 4);
    const parts = page.locator('.panel .cycle-part');
    await step(page, 1);
    await expect(parts.nth(0)).toContainText('10.1');
    await expect(parts.nth(2)).toContainText('10.1');
    await page.locator('.panel .link-toggle').click();
    await step(page, 1);
    await expect(parts.nth(0)).toContainText('10.2');
    await expect(parts.nth(2)).toContainText('10.1');
  });

  test('copies settings from one junction to another', async ({ page }) => {
    await openLevel(page, 'level2');
    await openJunction(page, 'level2', 4, 4);
    await step(page, 1, 2);
    await page.locator('.panel .icon-copy').click();
    await openJunction(page, 'level2', 10, 4);
    await expect(page.locator('.panel h2')).toHaveText('Kruispunt B');
    await page.locator('.panel .icon-paste').click();
    await expect(page.locator('.panel .cycle-part').first()).toContainText('10.2');
  });

  test('symmetric junctions keep the link fixed', async ({ page }) => {
    await openLevel(page, 'level12');
    await openJunction(page, 'level12', 4, 4);
    await expect(page.locator('.panel .link-toggle')).toBeDisabled();
    await expect(page.locator('.panel .link-toggle')).toContainText('vast gekoppeld');
  });

  test('explains a crash', async ({ page }) => {
    await openLevel(page, 'level4');
    // starve junction B's east-west green so the queue backs up into junction A (strict level)
    await openJunction(page, 'level4', 7, 4);
    await page.locator('.panel .cycle-part').nth(2).click();
    const range = page.locator('.panel input[type=range]');
    await range.fill('1');
    await range.dispatchEvent('input');
    await page.getByRole('button', { name: /Bereken/ }).click();
    const dialog = page.locator('.dialog');
    await expect(dialog).toContainText('Botsing');
    await expect(dialog).toContainText(/rode auto/);
    await expect(dialog).toContainText('Wachttijd per kruispunt');
  });

  test('shows a friendly error for an unknown level', async ({ page }) => {
    await page.goto('/play/nope');
    await expect(page.locator('.dialog')).toContainText("Level 'nope' bestaat niet");
    await page.locator('.dialog').getByRole('button', { name: 'Menu' }).click();
    await expect(page.locator('.level-row')).toHaveCount(20);
  });
});
