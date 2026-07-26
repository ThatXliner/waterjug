import { describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';
import { actions, load } from './+page.server';

const user = { id: 'd34db33f-0000-4000-8000-000000000000' } as User;

describe('new game authorization', () => {
	it('does not render for players', () => {
		expect(() => load({ locals: { user, role: 'player' } } as never)).toThrowError(
			expect.objectContaining({ status: 403 })
		);
	});

	it('rejects a player before reading or writing submitted data', async () => {
		const formData = vi.fn();
		const action = actions.create;
		if (!action) throw new Error('create action is missing');

		await expect(
			action({
				request: { formData },
				locals: { user, role: 'player' }
			} as never)
		).rejects.toEqual(expect.objectContaining({ status: 403 }));
		expect(formData).not.toHaveBeenCalled();
	});

	it('allows admins to render the page', () => {
		expect(load({ locals: { user, role: 'admin' } } as never)).toBeUndefined();
	});
});
