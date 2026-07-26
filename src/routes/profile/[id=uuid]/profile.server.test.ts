import { DISPLAY_NAME_CONTROL_CHARACTERS, MAX_DISPLAY_NAME_LENGTH } from '$lib/profile';
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { actions, load } from './+page.server';

const updateProfile = actions.updateProfile;
const loadProfile = load;

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
	displayName?: string | Blob | null;
	supabase?: object;
}) {
	const formData = new FormData();
	if (displayName !== null) {
		formData.set('displayName', displayName);
	}

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

function supabaseReturning(
	data: { display_name: string } | null,
	error: { message: string } | null
) {
	const maybeSingle = vi.fn().mockResolvedValue({ data, error });
	const select = vi.fn().mockReturnValue({ maybeSingle });
	const eq = vi.fn().mockReturnValue({ select });
	const update = vi.fn().mockReturnValue({ eq });
	const from = vi.fn().mockReturnValue({ update });

	return { client: { from }, spies: { from, update, eq } };
}

function concurrentProfileStore(userId: string) {
	let storedDisplayName = 'Initial Player';
	let arrivals = 0;
	let releaseBarrier = () => {};
	const barrier = new Promise<void>((resolve) => {
		releaseBarrier = resolve;
	});
	const scopedUserIds: string[] = [];

	const from = vi.fn().mockImplementation(() => ({
		update: ({ display_name }: { display_name: string }) => ({
			eq: (_column: string, scopedUserId: string) => ({
				select: () => ({
					maybeSingle: async () => {
						scopedUserIds.push(scopedUserId);
						arrivals += 1;
						if (arrivals === 2) releaseBarrier();
						await barrier;

						if (scopedUserId !== userId) return { data: null, error: null };
						storedDisplayName = display_name;
						return { data: { display_name }, error: null };
					}
				})
			})
		})
	}));

	return {
		client: { from },
		scopedUserIds,
		getStoredDisplayName: () => storedDisplayName
	};
}

const validDisplayName = fc
	.string({ minLength: 1, maxLength: MAX_DISPLAY_NAME_LENGTH })
	.map((value) => value.trim())
	.filter((value) => value.length > 0 && !DISPLAY_NAME_CONTROL_CHARACTERS.test(value));

function loadEvent({
	currentUserId,
	profile = {
		data: {
			display_name: 'Water Wizard',
			username: 'water_wizard',
			created_at: '2024-01-02T00:00:00.000Z'
		},
		error: null
	},
	ratings = {
		data: [{ rating: 1432, game_id: 7, games: [{ name: 'Water Polo' }] }],
		error: null
	},
	tournamentParts = {
		data: [
			{
				tournaments: {
					tournament_id: 9,
					name: 'Jug Finals',
					type: 'bracket',
					status: 'active',
					game_id: 7
				}
			}
		],
		error: null
	}
}: {
	currentUserId?: string;
	profile?: { data: object | null; error: object | null };
	ratings?: { data: object[] | null; error: object | null };
	tournamentParts?: { data: object[] | null; error: object | null };
}) {
	const from = vi.fn().mockImplementation((table: string) => {
		if (table === 'profiles') {
			return {
				select: () => ({
					eq: () => ({ maybeSingle: vi.fn().mockResolvedValue(profile) })
				})
			};
		}
		if (table === 'ratings') {
			return {
				select: () => ({
					eq: () => ({ order: vi.fn().mockResolvedValue(ratings) })
				})
			};
		}
		return {
			select: () => ({
				eq: () => Promise.resolve(tournamentParts)
			})
		};
	});

	return {
		params: { id: '4e786386-43d9-4558-9d51-423fc135ef34' },
		locals: {
			safeGetSession: vi.fn().mockResolvedValue({
				session: currentUserId ? {} : null,
				user: currentUserId ? { id: currentUserId } : null
			}),
			supabase: { from }
		}
	} as never;
}

describe('public profile loading', () => {
	it('returns the same public data anonymously while exposing ownership only to the owner', async () => {
		const profileId = '4e786386-43d9-4558-9d51-423fc135ef34';
		const anonymous = await loadProfile(loadEvent({ currentUserId: undefined }));
		const owner = await loadProfile(loadEvent({ currentUserId: profileId }));
		if (!anonymous || !owner) throw new Error('Profile loader returned no data');

		expect(anonymous).toMatchObject({
			profile: { display_name: 'Water Wizard', username: 'water_wizard' },
			ratings: [{ rating: 1432, game_id: 7 }],
			tournaments: [{ tournament_id: 9, name: 'Jug Finals' }],
			isOwner: false
		});
		expect(owner).toMatchObject({ isOwner: true });
		expect(owner.profile).toEqual(anonymous.profile);
		expect(owner.ratings).toEqual(anonymous.ratings);
		expect(owner.tournaments).toEqual(anonymous.tournaments);
	});

	it('distinguishes a missing profile from a profile query failure', async () => {
		await expect(
			loadProfile(loadEvent({ profile: { data: null, error: null } }))
		).rejects.toMatchObject({ status: 404 });
		await expect(
			loadProfile(loadEvent({ profile: { data: null, error: { message: 'database offline' } } }))
		).rejects.toMatchObject({ status: 500 });
	});

	it('fails closed when related public rating or tournament queries fail', async () => {
		await expect(
			loadProfile(loadEvent({ ratings: { data: null, error: { message: 'ratings failed' } } }))
		).rejects.toMatchObject({ status: 500 });
		await expect(
			loadProfile(
				loadEvent({
					tournamentParts: { data: null, error: { message: 'tournaments failed' } }
				})
			)
		).rejects.toMatchObject({ status: 500 });
	});
});

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

	it('rejects every mismatched authenticated user before querying the database', async () => {
		await fc.assert(
			fc.asyncProperty(fc.uuid(), fc.uuid(), async (currentUserId, profileUserId) => {
				fc.pre(currentUserId !== profileUserId);
				const from = vi.fn();

				await expect(
					updateProfile(
						actionEvent({
							currentUserId,
							profileUserId,
							supabase: { from }
						})
					)
				).rejects.toMatchObject({ status: 403 });
				expect(from).not.toHaveBeenCalled();
			}),
			{ numRuns: 250 }
		);
	});

	it('updates only the authenticated profile row', async () => {
		const { client, spies } = supabaseReturning({ display_name: 'Water Wizard' }, null);
		const userId = '4e786386-43d9-4558-9d51-423fc135ef34';

		await expect(
			updateProfile(actionEvent({ currentUserId: userId, supabase: client }))
		).resolves.toEqual({ updateSuccess: true });
		expect(spies.from).toHaveBeenCalledWith('profiles');
		expect(spies.update).toHaveBeenCalledWith({ display_name: 'Water Wizard' });
		expect(spies.eq).toHaveBeenCalledWith('user_id', userId);
	});

	it('rejects invalid form states without touching the database', async () => {
		for (const displayName of [null, new Blob(['not text']), 'player\nname', 'a'.repeat(51)]) {
			const from = vi.fn();
			const result = await updateProfile(
				actionEvent({
					currentUserId: '4e786386-43d9-4558-9d51-423fc135ef34',
					displayName,
					supabase: { from }
				})
			);

			expect(result).toMatchObject({ status: 400 });
			expect(from).not.toHaveBeenCalled();
		}
	});

	it('does not report success when the database rejects or loses the profile row', async () => {
		const databaseFailure = supabaseReturning(null, { message: 'write conflict' });
		const missingProfile = supabaseReturning(null, null);
		const userId = '4e786386-43d9-4558-9d51-423fc135ef34';

		await expect(
			updateProfile(actionEvent({ currentUserId: userId, supabase: databaseFailure.client }))
		).resolves.toMatchObject({
			status: 500,
			data: { updateError: 'Unable to update profile' }
		});
		await expect(
			updateProfile(actionEvent({ currentUserId: userId, supabase: missingProfile.client }))
		).rejects.toMatchObject({ status: 404 });
	});

	it('keeps concurrent owner updates scoped to one row with explicit last-write-wins semantics', async () => {
		await fc.assert(
			fc.asyncProperty(validDisplayName, validDisplayName, async (firstName, secondName) => {
				const userId = '4e786386-43d9-4558-9d51-423fc135ef34';
				const store = concurrentProfileStore(userId);

				const results = await Promise.all([
					updateProfile(
						actionEvent({
							currentUserId: userId,
							displayName: firstName,
							supabase: store.client
						})
					),
					updateProfile(
						actionEvent({
							currentUserId: userId,
							displayName: secondName,
							supabase: store.client
						})
					)
				]);

				expect(results).toEqual([{ updateSuccess: true }, { updateSuccess: true }]);
				expect(store.scopedUserIds).toEqual([userId, userId]);
				expect([firstName, secondName]).toContain(store.getStoredDisplayName());
			}),
			{ numRuns: 100 }
		);
	});

	it('isolates an authorized write from a simultaneous cross-user attempt', async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.uuid(),
				fc.uuid(),
				validDisplayName,
				async (ownerId, attackerId, displayName) => {
					fc.pre(ownerId !== attackerId);
					const database = supabaseReturning({ display_name: displayName }, null);

					const [ownerResult, attackerResult] = await Promise.allSettled([
						updateProfile(
							actionEvent({
								currentUserId: ownerId,
								profileUserId: ownerId,
								displayName,
								supabase: database.client
							})
						),
						updateProfile(
							actionEvent({
								currentUserId: attackerId,
								profileUserId: ownerId,
								displayName: 'Hijacked',
								supabase: database.client
							})
						)
					]);

					expect(ownerResult).toEqual({
						status: 'fulfilled',
						value: { updateSuccess: true }
					});
					expect(attackerResult).toMatchObject({
						status: 'rejected',
						reason: { status: 403 }
					});
					expect(database.spies.update).toHaveBeenCalledTimes(1);
					expect(database.spies.eq).toHaveBeenCalledWith('user_id', ownerId);
				}
			),
			{ numRuns: 100 }
		);
	});
});
