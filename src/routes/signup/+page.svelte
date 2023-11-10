<script lang="ts">
	/** @type {import('./$types').PageData} */
	export let data;
	const { supabase } = data;
	import { onMount } from 'svelte';
	let email: string;
	let password: string;
	onMount(() => {
		// monkey patch because
		// something is being a monkey
		// @ts-ignore
		Array.prototype.contains = function (...args) {
			// @ts-ignore
			return this.includes(...args);
		};
	});
</script>

<div class="hero min-h-screen bg-base-200">
	<div class="hero-content flex-col">
		<div class="text-center lg:text-left max-w-sm">
			<h1 class="text-5xl font-bold">Sign up</h1>
			<!-- <p class="py-6">
				Provident cupiditate voluptatem et in. Quaerat fugiat ut assumenda excepturi exercitationem
				quasi. In deleniti eaque aut repudiandae et a id nisi.
			</p> -->
		</div>
		<div class="card flex-shrink-0 w-full max-w-sm shadow-2xl bg-base-100">
			<form class="card-body">
				<div class="form-control">
					<label class="label">
						<span class="label-text">Email</span>
					</label>
					<input
						type="email"
						placeholder="email"
						class="input input-bordered"
						required
						bind:value={email}
					/>
				</div>
				<div class="form-control">
					<label class="label">
						<span class="label-text">Password (at least 6 characters)</span>
					</label>
					<input
						type="password"
						placeholder="password"
						class="input input-bordered"
						required
						bind:value={password}
					/>
				</div>
				<div class="form-control mt-6">
					<button
						class="btn btn-primary"
						on:click={async () => {
							const { data, error } = await supabase.auth.signUp({
								email,
								password,
								options: {
									emailRedirectTo: '/'
								}
							});
							if (error != null) {
								console.log('What');
								window.alert(error);
								return;
							}
							window.location.href = '/';
						}}>Sign Up</button
					>
				</div>
			</form>
		</div>
	</div>
</div>
