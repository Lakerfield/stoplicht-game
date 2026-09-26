import { expect, test } from '@playwright/test';
import { unlockDevMode } from './helpers';

test.describe('menu', () => {
  test('lists twenty levels, only the first playable', async ({ page }) => {
    await page.goto('/');
    const rows = page.locator('.level-row');
    await expect(rows).toHaveCount(20);
    await expect(rows.first()).toBeEnabled();
    await expect(rows.nth(1)).toBeDisabled();
    await expect(rows.first()).toContainText('Eén kruispunt');
  });

  test('switches language', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'EN', exact: true }).click();
    await expect(page.locator('header p').first()).toContainText('Tune the traffic lights');
    await expect(page.locator('.level-row').first()).toContainText('One junction');
    await expect(page.getByRole('button', { name: 'EN', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'NL', exact: true }).click();
    await expect(page.locator('header p').first()).toContainText('Stem de verkeerslichten');
    await expect(page.locator('.level-row').first()).toContainText('Eén kruispunt');
  });

  test('dev mode unlocks the editor and every level', async ({ page }) => {
    await page.goto('/');
    await unlockDevMode(page);
    await expect(page.locator('.level-row').nth(19)).toBeEnabled();
    await expect(page.locator('.level-clone')).toHaveCount(20);
    await page.getByRole('button', { name: /editor verbergen/ }).click();
    await expect(page.locator('.level-row').nth(1)).toBeDisabled();
  });

  test('unknown urls land on the menu', async ({ page }) => {
    await page.goto('/does/not/exist');
    await expect(page.locator('.level-row')).toHaveCount(20);
  });
});
