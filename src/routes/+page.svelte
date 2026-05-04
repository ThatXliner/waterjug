<script lang="ts">
	import { onMount } from 'svelte';

	let { data } = $props();

	onMount(() => {
		const { supabase } = data;
		supabase.auth.getSession().then(({ data: sessionData, error }) => {
			if (sessionData.session != null) {
				window.location.href = '/dashboard';
			}
			if (error != null) {
				window.alert(error);
			}
		});
	});
</script>

<section class="w-full h-screen bg-base-100 flex flex-col">
	<main class="flex flex-col justify-center items-center px-8 grow-[3] min-h-screen md:min-h-0">
		<img src="/waterjug.png" alt="WaterJug Logo" />
		<h2 class="text-6xl font-extrabold text-center text-zinc-800 dark:text-zinc-200 text-shadow-lg">
			WaterJug
		</h2>
		<p class="mt-4 text-lg text-center text-zinc-600 dark:text-zinc-400">
			The one and only rating tracker
		</p>
		<div class="mt-8 flex gap-4">
			<a href="/login" class="btn btn-outline btn-primary">Log In</a>
			<a href="/signup" class="btn btn-primary">Sign Up</a>
		</div>
	</main>
	<div class="bg-zinc-50 dark:bg-zinc-800 w-full py-12 px-8">
		<h2 class="text-3xl font-semibold text-center text-zinc-800 dark:text-zinc-200">
			Our Features
		</h2>
		<div class="mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
			<div class="flex flex-col items-center text-center">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="24"
					height="24"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					class=" text-zinc-600 dark:text-zinc-300 h-12 w-12"
					><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" /></svg
				>
				<h3 class="mt-4 text-xl font-semibold text-zinc-900 dark:text-zinc-100">Cloud Sync</h3>
				<p class="mt-2 text-zinc-600 dark:text-zinc-400">
					Watch ratings change in real time<sup>*</sup>, across any device
					<br />
					<sub>*not implemented yet</sub>
				</p>
			</div>
			<div class="flex flex-col items-center text-center">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="24"
					height="24"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					class="text-zinc-600 dark:text-zinc-300 h-12 w-12"
					><circle cx="12" cy="8" r="7" /><polyline
						points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"
					/></svg
				>
				<h3 class="mt-4 text-xl font-semibold text-zinc-900 dark:text-zinc-100">Glicko</h3>
				<p class="mt-2 text-zinc-600 dark:text-zinc-400">
					WaterJug implements <a
						href="https://en.wikipedia.org/wiki/Glicko_rating_system"
						class="link">Glicko</a
					>, the leading rating system used in
					<a
						href="https://www.chess.com/blog/kurtgodden/elo-to-glicko-your-rating-explained"
						class="link">Chess.com</a
					>,
					<a class="link" href="https://tetris.wiki/TETR.IO">Tetr.io</a>,
					<a href="https://store.steampowered.com/oldnews/38643" class="link">Team Fortress 2</a>,
					and many more
				</p>
			</div>
			<div class="flex flex-col items-center text-center">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="24"
					height="24"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					class=" text-zinc-600 dark:text-zinc-300 h-12 w-12"
					><line x1="12" x2="12" y1="20" y2="10" /><line x1="18" x2="18" y1="20" y2="4" /><line
						x1="6"
						x2="6"
						y1="20"
						y2="16"
					/></svg
				>
				<h3 class="mt-4 text-xl font-semibold text-zinc-900 dark:text-zinc-100">
					Advanced Analytics
				</h3>
				<p class="mt-2 text-zinc-600 dark:text-zinc-400">
					Rating history, match predictions, and much much more<sup>*</sup>
					<br />
					<sub>*not implemented yet</sub>
				</p>
			</div>
			<div class="flex flex-col items-center text-center">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="24"
					height="24"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					class=" text-zinc-600 dark:text-zinc-300 h-12 w-12"
				>
					<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
					<polyline points="22 4 12 14.01 9 11.01" />
				</svg>
				<h3 class="mt-4 text-xl font-semibold text-zinc-900 dark:text-zinc-100">
					Peer-checked ratings
				</h3>
				<p class="mt-2 text-zinc-600 dark:text-zinc-400">
					Utilizing a unique trust system, we can ensure honest results<sup>*</sup>
					<br />
					<sub>*not implemented yet</sub>
				</p>
			</div>
		</div>
	</div>
</section>
