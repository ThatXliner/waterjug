<script lang="ts">
	/** @type {import('./$types').PageData} */
	export let data;
	const { supabase } = data;
	import { onMount } from 'svelte';
	let email: string;
	let password: string;
	onMount(() => {
		// // monkey patch because
		// // something is being a monkey
		// // @ts-ignore
		// Array.prototype.contains = function (...args) {
		// 	// @ts-ignore
		// 	return this.includes(...args);
		// };
	});
</script>

<div class="hero min-h-screen bg-base-200">
	<div class="hero-content flex-col">
		<div class="text-center lg:text-left max-w-sm">
			<h1 class="text-5xl font-bold">Sign up</h1>
		</div>
		<div class="card flex-shrink-0 w-full max-w-sm shadow-2xl bg-base-100">
			<form class="card-body">
				<div class="form-control">
					<label class="label" for="email-input">
						<span class="label-text">Email</span>
					</label>
					<input
						type="email"
						placeholder="email"
						id="email-input"
						class="input input-bordered"
						required
						bind:value={email}
					/>
				</div>
				<div class="form-control">
					<label class="label" for="password-input">
						<span class="label-text">Password (at least 6 characters)</span>
					</label>
					<input
						type="password"
						id="password-input"
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
							const { data: _, error } = await supabase.auth.signUp({
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
