<script lang="ts">
	import '../app.css';
	import { invalidate } from '$app/navigation';
	import { onMount } from 'svelte';

	let { data, children } = $props();
	let { session, supabase, displayName, username, user } = $derived(data);
	let accountName = $derived(username ? `@${username}` : displayName || session?.user?.email);

	onMount(() => {
		const { data } = supabase.auth.onAuthStateChange((_, newSession) => {
			if (newSession?.expires_at !== session?.expires_at) {
				invalidate('supabase:auth');
			}
		});

		return () => data.subscription.unsubscribe();
	});

	const loggedIn = $derived(session != null);

	async function handleSignOut() {
		await supabase.auth.signOut();
		window.location.href = '/';
	}
</script>

<!-- TODO: mobile responsiveness

Should put as much stuff as possible in the navbar (if on desktop)
Otherwise, just put it in the sidebar
-->
{#if loggedIn}
	<div class="drawer">
		<input id="my-drawer" type="checkbox" class="drawer-toggle" />
		<div class="drawer-content">
			<div class="navbar bg-base-100">
				<div class="flex-none">
					<label for="my-drawer" aria-label="Open sidebar" class="btn btn-square btn-ghost">
						<svg
							xmlns="http://www.w3.org/2000/svg"
							fill="none"
							viewBox="0 0 24 24"
							class="inline-block w-5 h-5 stroke-current"
							><path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M4 6h16M4 12h16M4 18h16"
							/></svg
						>
					</label>
				</div>
				<div class="flex-1">
					<a href="/" class="btn btn-ghost normal-case text-xl font-mono">WaterJug</a>
				</div>
				<div class="flex-none flex items-center gap-2">
					{#if user}
						<a class="link text-sm opacity-70" href="/profile/{user.id}">{accountName}</a>
					{/if}
					<button class="btn btn-square btn-ghost" aria-label="Sign out" onclick={handleSignOut}>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							fill="none"
							viewBox="0 0 24 24"
							stroke-width="1.5"
							stroke="currentColor"
							class="w-6 h-6"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9"
							/>
						</svg>
					</button>
				</div>
			</div>
			{@render children()}
		</div>
		<div class="drawer-side">
			<label for="my-drawer" aria-label="close sidebar" class="drawer-overlay"></label>
			<ul class="menu p-4 w-80 min-h-full bg-base-200 text-base-content">
				<li class="menu-title text-base-content/70">{accountName}</li>
				{#if user}
					<li><a class="link" href="/profile/{user.id}">Profile</a></li>
				{/if}
				<li><a class="link" href="/dashboard">Dashboard</a></li>
				<li>
					<button class="link" onclick={handleSignOut}>Log out</button>
				</li>
			</ul>
		</div>
	</div>
{:else}
	{@render children()}
{/if}
