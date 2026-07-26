<script lang="ts">
	import { enhance } from '$app/forms';
	import { USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH, USERNAME_REQUIREMENTS } from '$lib/username';

	let { data, form } = $props();
	let ratings = $derived(data.ratings);
	let displayName = $derived(data.displayName);
	let username = $derived(data.username);
	let editingName = $state(false);
	let nameValue = $state('');
	let editingUsername = $state(false);
	let usernameValue = $state('');
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
			<div class="mt-2">
				{#if !editingUsername}
					<div class="flex items-center gap-2">
						{#if username}
							<a class="link text-lg" href="/profile/{data.userId}">@{username}</a>
						{:else}
							<span class="text-sm opacity-70">No username set</span>
						{/if}
						<button
							class="btn btn-xs btn-ghost"
							onclick={() => {
								editingUsername = true;
								usernameValue = username ?? '';
							}}
						>
							{username ? 'Change username' : 'Set username'}
						</button>
					</div>
				{:else}
					<form
						method="POST"
						action="?/setUsername"
						use:enhance
						class="flex flex-wrap items-center gap-2"
					>
						<label class="sr-only" for="username">Username</label>
						<span aria-hidden="true">@</span>
						<input
							id="username"
							type="text"
							name="username"
							class="input input-bordered input-sm"
							bind:value={usernameValue}
							required
							minlength={USERNAME_MIN_LENGTH}
							maxlength={USERNAME_MAX_LENGTH}
							autocomplete="username"
						/>
						<button class="btn btn-sm btn-primary" type="submit">Save</button>
						<button
							class="btn btn-sm btn-ghost"
							type="button"
							onclick={() => (editingUsername = false)}>Cancel</button
						>
						<p class="basis-full text-xs opacity-70">{USERNAME_REQUIREMENTS}</p>
					</form>
				{/if}
				{#if form?.usernameError}
					<p class="text-error text-sm mt-1" role="alert">{form.usernameError}</p>
				{/if}
			</div>
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
