<script lang="ts">
	let { data } = $props();
	let supabase = $derived(data.supabase);

	let email = $state('');
	let errorMessage = $state('');
	let submitted = $state(false);
	let submitting = $state(false);

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		errorMessage = '';
		submitting = true;

		const { error } = await supabase.auth.resetPasswordForEmail(email, {
			redirectTo: `${window.location.origin}/reset-password`
		});
		submitting = false;

		if (error) {
			errorMessage = error.message;
			return;
		}

		submitted = true;
	}
</script>

<a href="/login" class="fixed btn btn-primary mt-4 ml-4">Back to login</a>

<div class="hero min-h-screen bg-base-200">
	<div class="hero-content flex-col">
		<div class="text-center max-w-sm">
			<h1 class="text-5xl font-bold">Reset your password</h1>
			<p class="py-6">Enter your email and we’ll send you a link to choose a new password.</p>
		</div>
		<div class="card flex-shrink-0 w-full max-w-sm shadow-2xl bg-base-100">
			{#if submitted}
				<div class="card-body">
					<div class="alert alert-success" role="status">
						<span>
							If an account exists for {email}, a password reset link is on its way.
						</span>
					</div>
					<p class="text-sm">
						Check your inbox and spam folder. The link is time-limited and can only be used once.
					</p>
					<a href="/login" class="btn btn-primary">Return to login</a>
				</div>
			{:else}
				<form class="card-body" onsubmit={handleSubmit}>
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
							autocomplete="email"
							placeholder="email"
							class="input input-bordered"
							required
							bind:value={email}
						/>
					</div>
					<div class="form-control mt-6">
						<button class="btn btn-primary" type="submit" disabled={submitting}>
							{submitting ? 'Sending…' : 'Send reset link'}
						</button>
					</div>
				</form>
			{/if}
		</div>
	</div>
</div>
