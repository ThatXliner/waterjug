import { beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import type { User } from '@supabase/supabase-js';

const getPrivilegedSupabase = vi.fn();

vi.mock('$lib/server/supabase', () => ({ getPrivilegedSupabase }));

const { actions } = await import('./+page.server');
const user = { id: 'd34db33f-0000-4000-8000-000000000000' } as User;
const opponent = 'a11ce000-0000-4000-8000-000000000000';

describe('peer-checked result HTTP boundaries', () => {
	beforeEach(() => {
		getPrivilegedSupabase.mockClear();
	});

	it('rejects anonymous reports before creating a privileged client', async () => {
		const action = actions.reportResult;
		if (!action) throw new Error('reportResult action is missing');

		await expect(
			action({
				request: { formData: vi.fn() },
				params: { id: '1' },
				locals: { user: null, role: null }
			} as never)
		).rejects.toEqual(expect.objectContaining({ status: 401 }));
		expect(getPrivilegedSupabase).not.toHaveBeenCalled();
	});

	it('rejects selecting yourself as the opponent', async () => {
		const action = actions.reportResult;
		if (!action) throw new Error('reportResult action is missing');
		const formData = new FormData();
		formData.set('opponent', user.id);
		formData.set('outcome', 'won');
		formData.set('submissionId', crypto.randomUUID());

		const result = await action({
			request: { formData: async () => formData },
			params: { id: '1' },
			locals: { user, role: 'player' }
		} as never);

		expect(result).toEqual(
			expect.objectContaining({
				status: 400,
				data: { resultError: 'Select another player as your opponent' }
			})
		);
		expect(getPrivilegedSupabase).not.toHaveBeenCalled();
	});

	it('rejects generated malformed opponent and replay identifiers before database access', async () => {
		const action = actions.reportResult;
		if (!action) throw new Error('reportResult action is missing');
		const validUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

		await fc.assert(
			fc.asyncProperty(
				fc.string().filter((value) => !validUuid.test(value)),
				fc.boolean(),
				async (malformed, corruptOpponent) => {
					const formData = new FormData();
					formData.set('opponent', corruptOpponent ? malformed : opponent);
					formData.set('outcome', 'won');
					formData.set('submissionId', corruptOpponent ? crypto.randomUUID() : malformed);
					const result = await action({
						request: { formData: async () => formData },
						params: { id: '1' },
						locals: { user, role: 'player' }
					} as never);

					expect(result).toEqual(expect.objectContaining({ status: 400 }));
				}
			)
		);
		expect(getPrivilegedSupabase).not.toHaveBeenCalled();
	});

	it('rejects malformed review transitions before privileged access', async () => {
		const action = actions.reviewResult;
		if (!action) throw new Error('reviewResult action is missing');

		for (const [resultId, decision] of [
			['not-an-id', 'confirmed'],
			['0', 'confirmed'],
			['1', 'invalid']
		]) {
			const formData = new FormData();
			formData.set('resultId', resultId);
			formData.set('decision', decision);
			const result = await action({
				request: { formData: async () => formData },
				params: { id: '1' },
				locals: { user, role: 'player' }
			} as never);
			expect(result).toEqual(expect.objectContaining({ status: 400 }));
		}

		expect(getPrivilegedSupabase).not.toHaveBeenCalled();
	});
});
