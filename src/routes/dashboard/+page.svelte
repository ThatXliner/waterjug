<script lang="ts">
	import type { PageData } from './$types';
	export let data: PageData;
	$: ({ ratings } = data);
</script>

<a class="btn btn-primary" href="/game/new">Create a game</a>
<div class="flex m-3">
	{#each ratings as rating}
		<a href="/game/play/{rating.game_id}" class="card w-96 bg-base-100 shadow-xl">
			<div class="card-body">
				<h2 class="card-title">{rating.games.name}</h2>
				<p>Your rating: {rating.rating}</p>
				<div class="card-actions">
					<button class="btn btn-primary w-full">Go to game</button>
				</div>
			</div>
		</a>
	{/each}
</div>
