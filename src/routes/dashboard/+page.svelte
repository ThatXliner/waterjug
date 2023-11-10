<script lang="ts">
	import type { PageData } from './$types';
	export let data: PageData;
	$: ({ ratings, supabase } = data);
</script>

<div class="navbar bg-base-100">
	<div class="flex-none">
		<button class="btn btn-square btn-ghost">
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
		</button>
	</div>
	<div class="flex-1">
		<a class="btn btn-ghost normal-case text-xl">daisyUI</a>
	</div>
	<div class="flex-none">
		<button
			class="btn btn-square btn-ghost"
			on:click={async () => {
				await supabase.auth.signOut();
				window.location.href = '/';
			}}
		>
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
<a class="btn btn-primary" href="/game/new">Create a game</a>
<p>{JSON.stringify(ratings)}</p>
