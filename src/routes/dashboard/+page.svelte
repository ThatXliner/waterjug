<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();
	let ratings = $derived(data.ratings);
	let displayName = $derived(data.displayName);
	let editingName = $state(false);
	let nameValue = $state('');
</script>

<div class="flex flex-col w-full min-h-screen p-8">
	<header class="flex items-center justify-between mb-8">
		<div>
			<h1 class="text-3xl font-bold">
				{#if displayName}
					{displayName}
				{:else}
					My Games
				{/if}
			</h1>
			{#if !displayName && !editingName}
				<button
					class="btn btn-sm btn-ghost mt-1"
					onclick={() => {
						editingName = true;
						nameValue = '';
					}}
				>
					Set your display name
				</button>
			{/if}
			{#if editingName}
				<form
					method="POST"
					action="?/setDisplayName"
					use:enhance={() => {
						editingName = false;
					}}
					class="flex items-center gap-2 mt-1"
				>
					<input
						type="text"
						name="displayName"
						class="input input-bordered input-sm"
						bind:value={nameValue}
						required
						placeholder="Your display name"
					/>
					<button class="btn btn-sm btn-primary" type="submit">Save</button>
					<button
						class="btn btn-sm btn-ghost"
						type="button"
						onclick={() => {
							editingName = false;
						}}>Cancel</button
					>
				</form>
			{/if}
			{#if form?.error}
				<p class="text-error text-sm mt-1">{form.error}</p>
			{/if}
		</div>
		<a class="btn btn-primary" href="/game/new">Create a game</a>
	</header>
	<main class="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
		{#each ratings as rating}
			<div class="card w-96 bg-base-200 shadow-xl">
				<div class="card-body">
					<h2 class="card-title">{rating.games?.[0]?.name}</h2>
					<p>Your rating: {rating.rating}</p>
					<div class="card-actions">
						<a href="/game/play/{rating.game_id}" class="btn btn-primary w-full">Go to game</a>
					</div>
				</div>
			</div>
		{:else}
			<div class="alert alert-warning">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="stroke-current shrink-0 h-6 w-6"
					fill="none"
					viewBox="0 0 24 24"
					><path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
					/></svg
				>
				<span>No games found!</span>
			</div>
		{/each}
	</main>
</div>
