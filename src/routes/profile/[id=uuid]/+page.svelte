<script lang="ts">
	let { data } = $props();
	let profile = $derived(data.profile);
	let ratings = $derived(data.ratings);
	let tournaments = $derived(data.tournaments);
</script>

<div class="flex flex-col w-full min-h-screen p-8">
	<header class="mb-8">
		<h1 class="text-3xl font-bold">{profile.display_name || 'Unnamed Player'}</h1>
		<p class="text-sm opacity-60">Joined {new Date(profile.created_at).toLocaleDateString()}</p>
	</header>

	<section class="mb-8">
		<h2 class="text-2xl font-bold mb-3">Game Ratings</h2>
		{#if ratings.length > 0}
			<div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
				{#each ratings as r}
					<div class="card bg-base-200 shadow p-4">
						<h3 class="font-semibold">{r.games?.[0]?.name ?? 'Unknown Game'}</h3>
						<p>Rating: {r.rating}</p>
						<a href="/game/play/{r.game_id}" class="btn btn-sm btn-primary mt-2">View Game</a>
					</div>
				{/each}
			</div>
		{:else}
			<p class="opacity-60">No games played yet.</p>
		{/if}
	</section>

	<section>
		<h2 class="text-2xl font-bold mb-3">Tournaments</h2>
		{#if tournaments.length > 0}
			<div class="flex flex-col gap-2">
				{#each tournaments as t}
					<div class="card bg-base-200 shadow p-4">
						<div class="flex items-center gap-4">
							<span class="font-semibold">{t.name}</span>
							<span class="badge badge-sm">{t.type}</span>
							<span class="badge badge-sm badge-neutral">{t.status}</span>
						</div>
					</div>
				{/each}
			</div>
		{:else}
			<p class="opacity-60">No tournaments yet.</p>
		{/if}
	</section>
</div>
