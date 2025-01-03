<script lang="ts">
	/** @type {import('./$types').PageData} */
	export let data;
	const { supabase } = data;
	import { onMount } from 'svelte';
	onMount(async () => {
		const { data, error } = await supabase.auth.getSession();
		if (data.session != null) {
			console.log('loaded', data);
			window.location.href = '/dashboard';
		}
		if (error != null) {
			console.log(error);
			window.alert(error);
		}
	});

	let email: string;
	let password: string;
</script>

<a href="/" class="fixed btn btn-primary mt-4 ml-4"
	><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-6 h-6">
		<path
			fill-rule="evenodd"
			d="M11.03 3.97a.75.75 0 010 1.06l-6.22 6.22H21a.75.75 0 010 1.5H4.81l6.22 6.22a.75.75 0 11-1.06 1.06l-7.5-7.5a.75.75 0 010-1.06l7.5-7.5a.75.75 0 011.06 0z"
			clip-rule="evenodd"
		/>
	</svg>
	Back to home</a
>
<div class="hero min-h-screen bg-base-200">
	<div class="hero-content flex-col justify-stretch">
		<div class="text-center lg:text-left max-w-sm">
			<h1 class="text-5xl font-bold">Login now!</h1>
			<p class="py-6">
				No account? <a href="/signup" class="link link-primary">Sign up now</a>
			</p>
		</div>
		<div class="card flex-shrink-0 w-full max-w-sm shadow-2xl bg-base-100">
			<form class="card-body">
				<div class="form-control">
					<label class="label" for="email-input">
						<span class="label-text">Email</span>
					</label>
					<input
						id="email-input"
						type="email"
						placeholder="email"
						class="input input-bordered"
						required
						bind:value={email}
					/>
				</div>
				<div class="form-control">
					<label class="label" for="password-input">
						<span class="label-text">Password</span>
					</label>
					<input
						id="password-input"
						type="password"
						placeholder="password"
						class="input input-bordered"
						required
						bind:value={password}
					/>
					<label class="label">
						<button
							on:click={async () => {
								// TODO
								window.alert('Not implemented yet');
							}}
							class="label-text-alt link link-hover">Forgot password?</button
						>
					</label>
				</div>
				<div class="form-control mt-6">
					<button
						class="btn btn-primary"
						on:click={async () => {
							// todo: use forms + proper validation
							// i use proper forms i can actually get free
							// validation
							const { data, error } = await supabase.auth.signInWithPassword({
								email,
								password,
								redirect: '/dashboard'
							});
							if (error != null) {
								console.log(error);
								window.alert(error);
								return;
							}
							console.log(data);
						}}>Login</button
					>
				</div>
			</form>
		</div>
	</div>
</div>
