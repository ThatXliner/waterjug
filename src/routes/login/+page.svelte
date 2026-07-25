<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';

	let { data } = $props();
	let supabase = $derived(data.supabase);
	let resetComplete = $derived(page.url.searchParams.get('reset') === 'success');

	onMount(() => {
		supabase.auth.getSession().then(({ data: sessionData, error }) => {
			if (sessionData.session != null) {
				window.location.href = '/dashboard';
			}
			if (error != null) {
				window.alert(error);
			}
		});
	});

	let email = $state('');
	let password = $state('');
	let errorMessage = $state('');
	let submitting = $state(false);

	async function handleLogin(event: SubmitEvent) {
		event.preventDefault();
		errorMessage = '';
		submitting = true;

		const { error } = await supabase.auth.signInWithPassword({ email, password });
		submitting = false;

		if (error != null) {
			errorMessage = error.message;
			return;
		}

		window.location.href = '/dashboard';
	}
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
			<form class="card-body" onsubmit={handleLogin}>
				{#if resetComplete}
					<div class="alert alert-success" role="status">
						<span>Your password has been updated. You can now log in.</span>
					</div>
				{/if}
				{#if errorMessage}
					<div class="alert alert-error" role="alert">
						<span>{errorMessage}</span>
					</div>
				{/if}
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
					<div class="label">
						<a href="/forgot-password" class="label-text-alt link link-hover">Forgot password?</a>
					</div>
				</div>
				<div class="form-control mt-6">
					<button class="btn btn-primary" type="submit" disabled={submitting}>
						{submitting ? 'Logging in…' : 'Login'}
					</button>
				</div>
			</form>
		</div>
	</div>
</div>
