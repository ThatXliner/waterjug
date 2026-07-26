<script lang="ts">
	import { page } from '$app/state';
</script>

<main class="hero min-h-screen bg-base-200">
	<div class="hero-content text-center">
		<div class="max-w-md">
			<p class="text-error mb-2 font-semibold">{page.status}</p>
			<h1 class="mb-4 text-4xl font-bold">
				{page.status === 403 ? 'Invitation required' : 'Game unavailable'}
			</h1>
			<p class="mb-6">{page.error?.message ?? 'This game could not be loaded.'}</p>
			<a class="btn btn-primary" href="/dashboard">Back to my games</a>
		</div>
	</div>
</main>
