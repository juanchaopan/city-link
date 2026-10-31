import { expect, test, type Page } from '@playwright/test';

async function open(page: Page, path: string) {
  await page.goto(path);
  await page.locator('html[data-ready="true"]').waitFor({ state: 'attached' });
}

test('进入游戏的画面和基准截图一致', async ({ page }) => {
  await open(page, '/');
  await expect(page.locator('canvas')).toHaveScreenshot('home.png');
});

test('效果页和基准截图一致', async ({ page }) => {
  await open(page, '/gallery.html');
  await expect(page.locator('canvas')).toHaveScreenshot('gallery.png');
});
