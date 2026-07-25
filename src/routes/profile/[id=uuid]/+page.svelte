<script lang="ts">
	import { enhance } from '$app/forms';
	import { MAX_DISPLAY_NAME_LENGTH } from '$lib/profile';

	let { data, form } = $props();
	let profile = $derived(data.profile);
	let ratings = $derived(data.ratings);
	let tournaments = $derived(data.tournaments);
	let editing = $state(false);

	$effect(() => {
		if (form?.updateSuccess) editing = false;
	});
</script>

<svelte:head>
	<title>{profile.display_name || 'Player profile'} · WaterJug</title>
</svelte:head>

<div class="flex flex-col w-full min-h-screen p-4 sm:p-8">
	<header class="mb-8 flex flex-wrap items-start justify-between gap-4">
		<div>
			<p class="text-sm font-semibold uppercase tracking-wide opacity-60">Player profile</p>
			<h1 class="text-3xl font-bold">{profile.display_name || 'Unnamed Player'}</h1>
			{#if profile.username}
				<p class="text-lg opacity-75">@{profile.username}</p>
			{/if}
			<p class="text-sm opacity-60">
				Joined {new Date(profile.created_at).toLocaleDateString()}
			</p>
		</div>
		{#if data.isOwner && !editing}
			<button class="btn btn-outline btn-sm" onclick={() => (editing = true)}>Edit profile</button>
		{/if}
	</header>

	{#if data.isOwner && editing}
		<section class="card bg-base-200 mb-8 max-w-xl shadow">
			<form method="POST" action="?/updateProfile" use:enhance class="card-body">
				<h2 class="card-title">Edit profile</h2>
				<label class="form-control">
					<span class="label-text mb-2">Display name</span>
					<input
						class="input input-bordered"
						name="displayName"
						value={profile.display_name}
						maxlength={MAX_DISPLAY_NAME_LENGTH}
						required
					/>
				</label>
				{#if form?.updateError}
					<p class="text-error text-sm" role="alert">{form.updateError}</p>
				{/if}
				<div class="card-actions justify-end">
					<button class="btn btn-ghost" type="button" onclick={() => (editing = false)}>
						Cancel
					</button>
					<button class="btn btn-primary" type="submit">Save profile</button>
				</div>
			</form>
		</section>
	{/if}

	<section class="mb-8">
		<div class="mb-3 flex items-end justify-between gap-4">
			<h2 class="text-2xl font-bold">Game ratings</h2>
			<span class="badge badge-neutral"
				>{ratings.length} {ratings.length === 1 ? 'game' : 'games'}</span
			>
		</div>
		{#if ratings.length > 0}
			<div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
				{#each ratings as r}
					<div class="card bg-base-200 shadow">
						<div class="card-body">
							<h3 class="card-title">{r.games?.name ?? 'Unknown game'}</h3>
							<p class="text-3xl font-bold tabular-nums">{Math.round(r.rating)}</p>
							<p class="text-sm opacity-60">Current rating</p>
							<div class="card-actions justify-end">
								<a href="/game/play/{r.game_id}" class="btn btn-sm btn-primary">View game</a>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{:else}
			<div class="rounded-box bg-base-200 p-6 text-center opacity-70">No game ratings yet.</div>
		{/if}
	</section>

	<section>
		<h2 class="text-2xl font-bold mb-3">Tournaments</h2>
		{#if tournaments.length > 0}
			<div class="flex flex-col gap-2">
				{#each tournaments as t}
					<div class="card bg-base-200 shadow p-4">
						<div class="flex flex-wrap items-center gap-3">
							<span class="font-semibold">{t.name}</span>
							<span class="badge badge-sm">{t.type.replace('_', ' ')}</span>
							<span class="badge badge-sm badge-neutral">{t.status}</span>
							<a href="/game/play/{t.game_id}" class="btn btn-ghost btn-xs ml-auto">View game</a>
						</div>
					</div>
				{/each}
			</div>
		{:else}
			<div class="rounded-box bg-base-200 p-6 text-center opacity-70">
				No tournament appearances yet.
			</div>
		{/if}
	</section>
</div>
