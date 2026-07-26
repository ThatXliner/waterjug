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

test('browser validation rejects a malformed recovery email before any auth request', async ({
	page
}) => {
	let requestCount = 0;
	await page.route('**/auth/v1/recover?**', async (route) => {
		requestCount += 1;
		await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
	});

	await page.goto('/forgot-password');
	await page.getByLabel('Email').fill('not-an-email');
	await page.getByRole('button', { name: 'Send reset link' }).click();

	await expect(page.getByLabel('Email')).toHaveJSProperty('validity.valid', false);
	expect(requestCount).toBe(0);
	await expect(page.getByRole('status')).toHaveCount(0);
});

test('a failed recovery request can be retried to a successful terminal state', async ({
	page
}) => {
	let requestCount = 0;
	await page.route('**/auth/v1/recover?**', async (route) => {
		requestCount += 1;
		if (requestCount === 1) {
			await route.fulfill({
				status: 429,
				contentType: 'application/json',
				body: JSON.stringify({ message: 'Too many requests' })
			});
			return;
		}

		await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
	});

	await page.goto('/forgot-password');
	await page.getByLabel('Email').fill('person@example.com');
	await page.getByRole('button', { name: 'Send reset link' }).click();
	await expect(page.getByRole('alert')).toContainText('Too many requests');
	await expect(page.getByRole('button', { name: 'Send reset link' })).toBeEnabled();

	await page.getByRole('button', { name: 'Send reset link' }).click();

	await expect(page.getByRole('status')).toContainText('If an account exists');
	expect(requestCount).toBe(2);
});

test('concurrent recovery submissions produce only one in-flight auth request', async ({
	page
}) => {
	let requestCount = 0;
	let releaseRequest!: () => void;
	const requestGate = new Promise<void>((resolve) => {
		releaseRequest = resolve;
	});

	await page.route('**/auth/v1/recover?**', async (route) => {
		requestCount += 1;
		await requestGate;
		await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
	});

	await page.goto('/forgot-password');
	await page.getByLabel('Email').fill('person@example.com');
	await page.locator('form').evaluate((form) => {
		const eventOptions = { bubbles: true, cancelable: true };
		form.dispatchEvent(new SubmitEvent('submit', eventOptions));
		form.dispatchEvent(new SubmitEvent('submit', eventOptions));
	});

	await expect(page.getByRole('button', { name: 'Sending…' })).toBeDisabled();
	await expect.poll(() => requestCount).toBe(1);
	releaseRequest();
	await expect(page.getByRole('status')).toContainText('If an account exists');
	expect(requestCount).toBe(1);
});

test('an invalid or expired reset link cannot make an authorized update request', async ({
	page
}) => {
	let updateRequestCount = 0;
	page.on('request', (request) => {
		if (request.url().includes('/auth/v1/user') && request.method() !== 'GET') {
			updateRequestCount += 1;
		}
	});

	await page.goto('/reset-password');

	await expect(page.getByRole('alert')).toContainText(
		'This password reset link is invalid or has expired.'
	);
	await expect(page.getByRole('button', { name: 'Update password' })).toHaveCount(0);
	await expect(page.getByRole('link', { name: 'Request a new reset link' })).toHaveAttribute(
		'href',
		'/forgot-password'
	);
	expect(updateRequestCount).toBe(0);
});

test('confirms a completed password reset on the login page', async ({ page }) => {
	await page.goto('/login?reset=success');

	await expect(page.getByRole('status')).toContainText(
		'Your password has been updated. You can now log in.'
	);
});
test('unauthenticated users cannot reach privileged game action parsing', async ({ request }) => {
	for (const endpoint of [
		'/game/new?/create',
		'/game/play/1?/reportResult',
		'/game/play/1?/reviewResult',
		'/game/play/1?/createTournament',
		'/game/play/1?/configure'
	]) {
		const response = await request.post(endpoint, {
			form: {
				gameName: 'unauthorized configuration',
				periodDays: 'not-a-period',
				configurationRevision: 'not-a-revision'
			},
			headers: { origin: 'http://localhost:4173' },
			maxRedirects: 0
		});

		expect(response.status(), endpoint).toBe(401);
	}
});
