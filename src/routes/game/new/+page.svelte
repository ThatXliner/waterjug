<script lang="ts">
	import { onMount } from 'svelte';
	import type { ActionData } from './$types';

	// /** @type {import('./$types').PageData} */
	// export let data;
	export let form: ActionData;
	onMount(() => {
		if (form?.error) {
			console.log(form.error);
			window.alert(JSON.stringify(form.error));
		}
	});
</script>

<div class="hero min-h-screen bg-base-200">
	<div class="text-center hero-content">
		<div class="max-w-md">
			<h1 class="mb-5 text-5xl font-bold">Create a New Game</h1>
			<form method="POST" action="?/create">
				<div class="form-control">
					<label class="label" for="gameName">
						<span class="label-text">Game Name</span>
					</label>
					<input
						class="input input-bordered"
						type="text"
						placeholder="Enter game name"
						name="gameName"
						id="gameName"
						required
					/>
				</div>
				<button class="btn btn-primary mt-5" type="submit">Create Game</button>
			</form>
		</div>
	</div>
</div>
