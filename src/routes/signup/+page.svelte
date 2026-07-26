<script lang="ts">
	import { onMount } from 'svelte';
	import {
		normalizeUsername,
		USERNAME_MAX_LENGTH,
		USERNAME_MIN_LENGTH,
		USERNAME_REQUIREMENTS,
		validateUsername
	} from '$lib/username';

	let { data } = $props();
	let supabase = $derived(data.supabase);

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
	let username = $state('');
	let signupError = $state('');

	function handleSignUp() {
		const normalizedUsername = normalizeUsername(username);
		const validationError = validateUsername(normalizedUsername);
		if (validationError) {
			signupError = validationError;
			return;
		}
		signupError = '';

		supabase.auth
			.signUp({
				email,
				password,
				options: {
					emailRedirectTo: '/',
					data: { username: normalizedUsername }
				}
			})
			.then(({ error }) => {
				if (error != null) {
					signupError =
						error.message === 'Database error saving new user'
							? 'That username is already taken.'
							: error.message;
					return;
				}
				window.location.href = '/';
			});
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
	<div class="hero-content flex-col">
		<div class="text-center lg:text-left max-w-sm">
			<h1 class="text-5xl font-bold">Sign Up</h1>
			<p class="py-6">
				Already have an account? <a href="/login" class="link link-primary">Log in now</a>
			</p>
		</div>
		<div class="card flex-shrink-0 w-full max-w-sm shadow-2xl bg-base-100">
			<form
				class="card-body"
				onsubmit={(event) => {
					event.preventDefault();
					handleSignUp();
				}}
			>
				<div class="form-control">
					<label class="label" for="username-input">
						<span class="label-text">Username</span>
					</label>
					<input
						type="text"
						placeholder="water_jug"
						id="username-input"
						class="input input-bordered"
						required
						minlength={USERNAME_MIN_LENGTH}
						maxlength={USERNAME_MAX_LENGTH}
						autocomplete="username"
						aria-describedby="username-help"
						bind:value={username}
					/>
					<p id="username-help" class="text-xs opacity-70 mt-1">{USERNAME_REQUIREMENTS}</p>
				</div>
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
					<button class="btn btn-primary" type="submit">Sign Up</button>
				</div>
				{#if signupError}
					<p class="text-error text-sm" role="alert">{signupError}</p>
				{/if}
			</form>
		</div>
	</div>
</div>
