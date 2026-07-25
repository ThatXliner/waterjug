import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

const getPrivilegedSupabase = vi.fn();

vi.mock('$lib/server/supabase', () => ({ getPrivilegedSupabase }));

const { actions } = await import('./+page.server');
const user = { id: 'd34db33f-0000-4000-8000-000000000000' } as User;

describe('rating result authorization', () => {
	beforeEach(() => {
		getPrivilegedSupabase.mockClear();
	});

	it('rejects anonymous submissions before creating a privileged client', async () => {
		const action = actions.default;
		if (!action) throw new Error('default action is missing');

		await expect(
			action({
				request: { formData: vi.fn() },
				params: { id: '1' },
				locals: { user: null, role: null }
			} as never)
		).rejects.toEqual(expect.objectContaining({ status: 401 }));
		expect(getPrivilegedSupabase).not.toHaveBeenCalled();
	});

	it('rejects self-reported wins before creating a privileged client', async () => {
		const action = actions.default;
		if (!action) throw new Error('default action is missing');
		const formData = new FormData();
		formData.set('winner', user.id);

		const result = await action({
			request: {
				formData: async () => formData
			},
			params: { id: '1' },
			locals: { user, role: 'player' }
		} as never);

		expect(result).toEqual(
			expect.objectContaining({
				status: 400,
				data: { resultError: 'Select another player as the winner' }
			})
		);
		expect(getPrivilegedSupabase).not.toHaveBeenCalled();
	});
});
