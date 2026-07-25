import { describe, expect, it, vi } from 'vitest';
import { actions } from './+page.server';

const updateProfile = actions.updateProfile;

if (!updateProfile) {
	throw new Error('updateProfile action is not defined');
}

function actionEvent({
	currentUserId,
	profileUserId = '4e786386-43d9-4558-9d51-423fc135ef34',
	displayName = 'Water Wizard',
	supabase = {}
}: {
	currentUserId?: string;
	profileUserId?: string;
	displayName?: string;
	supabase?: object;
}) {
	const formData = new FormData();
	formData.set('displayName', displayName);

	return {
		params: { id: profileUserId },
		request: new Request('http://localhost/profile', { method: 'POST', body: formData }),
		locals: {
			safeGetSession: vi.fn().mockResolvedValue({
				session: currentUserId ? {} : null,
				user: currentUserId ? { id: currentUserId } : null
			}),
			supabase
		}
	} as never;
}

describe('profile update action', () => {
	it('requires authentication', async () => {
		await expect(updateProfile(actionEvent({ currentUserId: undefined }))).rejects.toMatchObject({
			status: 401
		});
	});

	it("rejects updates to another user's profile before querying the database", async () => {
		const from = vi.fn();

		await expect(
			updateProfile(
				actionEvent({
					currentUserId: '1aa8fca5-a0ac-4bb5-ae93-c63f20f19973',
					supabase: { from }
				})
			)
		).rejects.toMatchObject({ status: 403 });
		expect(from).not.toHaveBeenCalled();
	});

	it('updates only the authenticated profile row', async () => {
		const maybeSingle = vi.fn().mockResolvedValue({
			data: { display_name: 'Water Wizard' },
			error: null
		});
		const select = vi.fn().mockReturnValue({ maybeSingle });
		const eq = vi.fn().mockReturnValue({ select });
		const update = vi.fn().mockReturnValue({ eq });
		const from = vi.fn().mockReturnValue({ update });
		const userId = '4e786386-43d9-4558-9d51-423fc135ef34';

		await expect(
			updateProfile(actionEvent({ currentUserId: userId, supabase: { from } }))
		).resolves.toEqual({ updateSuccess: true });
		expect(from).toHaveBeenCalledWith('profiles');
		expect(update).toHaveBeenCalledWith({ display_name: 'Water Wizard' });
		expect(eq).toHaveBeenCalledWith('user_id', userId);
	});
});
