<script lang="ts">
	import { validateNewPassword } from '$lib/password';
	import { onMount } from 'svelte';

	let { data } = $props();
	let supabase = $derived(data.supabase);

	let password = $state('');
	let confirmation = $state('');
	let errorMessage = $state('');
	let checkingSession = $state(true);
	let hasRecoverySession = $state(false);
	let submitting = $state(false);

	onMount(() => {
		supabase.auth.getSession().then(({ data: { session }, error }) => {
			checkingSession = false;
			hasRecoverySession = session != null;
			if (error) {
				errorMessage = error.message;
			}
		});
	});

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (submitting || !hasRecoverySession) return;

		errorMessage = validateNewPassword(password, confirmation) ?? '';
		if (errorMessage) return;

		submitting = true;
		const { error } = await supabase.auth.updateUser({ password });
		if (error) {
			errorMessage = error.message;
			submitting = false;
			return;
		}

		await supabase.auth.signOut();
		window.location.href = '/login?reset=success';
	}
</script>

<a href="/login" class="fixed btn btn-primary mt-4 ml-4">Back to login</a>

<div class="hero min-h-screen bg-base-200">
	<div class="hero-content flex-col">
		<div class="text-center max-w-sm">
			<h1 class="text-5xl font-bold">Choose a new password</h1>
			<p class="py-6">Use at least six characters and keep it somewhere safe.</p>
		</div>
		<div class="card flex-shrink-0 w-full max-w-sm shadow-2xl bg-base-100">
			<div class="card-body">
				{#if checkingSession}
					<span class="loading loading-spinner self-center" aria-label="Checking reset link"></span>
				{:else if !hasRecoverySession}
					<div class="alert alert-error" role="alert">
						<span>{errorMessage || 'This password reset link is invalid or has expired.'}</span>
					</div>
					<a href="/forgot-password" class="btn btn-primary">Request a new reset link</a>
				{:else}
					<form onsubmit={handleSubmit}>
						{#if errorMessage}
							<div class="alert alert-error mb-4" role="alert">
								<span>{errorMessage}</span>
							</div>
						{/if}
						<div class="form-control">
							<label class="label" for="password-input">
								<span class="label-text">New password</span>
							</label>
							<input
								id="password-input"
								type="password"
								autocomplete="new-password"
								class="input input-bordered"
								minlength="6"
								required
								bind:value={password}
							/>
						</div>
						<div class="form-control mt-4">
							<label class="label" for="confirmation-input">
								<span class="label-text">Confirm new password</span>
							</label>
							<input
								id="confirmation-input"
								type="password"
								autocomplete="new-password"
								class="input input-bordered"
								minlength="6"
								required
								bind:value={confirmation}
							/>
						</div>
						<div class="form-control mt-6">
							<button class="btn btn-primary" type="submit" disabled={submitting}>
								{submitting ? 'Updating…' : 'Update password'}
							</button>
						</div>
					</form>
				{/if}
			</div>
		</div>
	</div>
</div>
