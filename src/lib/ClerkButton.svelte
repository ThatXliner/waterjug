<script lang="ts">
	import { Clerk } from '@clerk/clerk-js/dist/clerk.mjs';
	import { PUBLIC_CLERK_PUBLISHABLE_KEY } from '$env/static/public';
	import { onMount } from 'svelte';

	const clerk = new Clerk(PUBLIC_CLERK_PUBLISHABLE_KEY);
	let div: HTMLDivElement;
	onMount(() => {
		(async () => {
			await clerk.load();
			if (clerk.user) {
				clerk.mountUserButton(div);
			} else {
				clerk.mountSignIn(div);
			}
		})();
	});
</script>

<div bind:this={div} />
