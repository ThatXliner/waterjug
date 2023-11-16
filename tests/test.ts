import { expect, test } from '@playwright/test';
// TODO: full integration testing
test('index page has expected h1', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { name: /WaterJug/ })).toBeVisible();
});
