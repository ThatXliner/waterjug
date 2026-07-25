import { expect, test } from '@playwright/test';

// TODO: full integration testing
test('index page has expected h1', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { name: /WaterJug/ })).toBeVisible();
});

test('login links to password recovery', async ({ page }) => {
	await page.goto('/login');
	await page.getByRole('link', { name: 'Forgot password?' }).click();

	await expect(page).toHaveURL('/forgot-password');
	await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
});

test('requests a password reset with a callback to the update page', async ({ page }) => {
	let recoveryRequest:
		| {
				email: string;
				redirectTo: string | null;
		  }
		| undefined;

	await page.route('**/auth/v1/recover?**', async (route) => {
		const request = route.request();
		recoveryRequest = {
			email: request.postDataJSON().email,
			redirectTo: new URL(request.url()).searchParams.get('redirect_to')
		};
		await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
	});

	await page.goto('/forgot-password');
	await page.getByLabel('Email').fill('person@example.com');
	await page.getByRole('button', { name: 'Send reset link' }).click();

	await expect(page.getByRole('status')).toContainText(
		'If an account exists for person@example.com, a password reset link is on its way.'
	);
	expect(recoveryRequest).toEqual({
		email: 'person@example.com',
		redirectTo: 'http://localhost:4173/reset-password'
	});
});

test('shows recovery options for an invalid or expired reset link', async ({ page }) => {
	await page.goto('/reset-password');

	await expect(page.getByRole('alert')).toContainText(
		'This password reset link is invalid or has expired.'
	);
	await expect(page.getByRole('link', { name: 'Request a new reset link' })).toHaveAttribute(
		'href',
		'/forgot-password'
	);
});

test('confirms a completed password reset on the login page', async ({ page }) => {
	await page.goto('/login?reset=success');

	await expect(page.getByRole('status')).toContainText(
		'Your password has been updated. You can now log in.'
	);
});
