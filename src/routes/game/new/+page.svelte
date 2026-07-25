<script lang="ts">
	import { onMount } from 'svelte';

	let { form } = $props();
	let system = $state('glicko');
	onMount(() => {
		if (form?.configurationError) window.alert(form.configurationError);
	});
</script>

<div class="hero min-h-screen bg-base-200">
	<div class="text-center hero-content">
		<div class="w-full max-w-2xl py-10">
			<h1 class="mb-5 text-5xl font-bold">Create a New Game</h1>
			<form method="POST" action="?/create" class="space-y-4 text-left">
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

				<div class="divider">Rating configuration</div>
				<div class="grid gap-4 sm:grid-cols-2">
					<label class="form-control">
						<span class="label-text mb-1">Rating system</span>
						<select class="select select-bordered" name="system" bind:value={system}>
							<option value="glicko">Glicko</option>
							<option value="elo">Elo</option>
							<option value="custom">Custom formula</option>
						</select>
					</label>
					<label class="form-control">
						<span class="label-text mb-1">Starting rating</span>
						<input
							class="input input-bordered"
							name="defaultRating"
							type="number"
							value="1200"
							min="0"
							max="1000000"
							required
						/>
					</label>
					<label class="form-control">
						<span class="label-text mb-1">Rating period (days)</span>
						<input
							class="input input-bordered"
							name="periodDays"
							type="number"
							value="1"
							min="0.0416667"
							max="3650"
							step="any"
							required
						/>
					</label>
				</div>

				{#if system === 'glicko'}
					<fieldset class="rounded-box border border-base-300 p-4">
						<legend class="px-2 font-semibold">Glicko parameters</legend>
						<div class="grid gap-4 sm:grid-cols-2">
							<label class="form-control"
								><span class="label-text">Initial deviation</span><input
									class="input input-bordered"
									name="glickoInitialDeviation"
									type="number"
									value="350"
									min="1"
									max="1000"
									step="any"
									required
								/></label
							>
							<label class="form-control"
								><span class="label-text">Maximum deviation</span><input
									class="input input-bordered"
									name="glickoMaxDeviation"
									type="number"
									value="350"
									min="1"
									max="1000"
									step="any"
									required
								/></label
							>
							<label class="form-control"
								><span class="label-text">Deviation increase per period</span><input
									class="input input-bordered"
									name="glickoPeriodDeviationIncrease"
									type="number"
									value="63.2"
									min="0"
									max="1000"
									step="any"
									required
								/></label
							>
							<label class="form-control"
								><span class="label-text">Rating scale</span><input
									class="input input-bordered"
									name="glickoScale"
									type="number"
									value="400"
									min="1"
									max="10000"
									step="any"
									required
								/></label
							>
						</div>
					</fieldset>
				{:else}
					<input type="hidden" name="glickoInitialDeviation" value="350" />
					<input type="hidden" name="glickoMaxDeviation" value="350" />
					<input type="hidden" name="glickoPeriodDeviationIncrease" value="63.2" />
					<input type="hidden" name="glickoScale" value="400" />
				{/if}

				{#if system === 'elo'}
					<fieldset class="rounded-box border border-base-300 p-4">
						<legend class="px-2 font-semibold">Elo parameters</legend>
						<div class="grid gap-4 sm:grid-cols-2">
							<label class="form-control"
								><span class="label-text">K-factor</span><input
									class="input input-bordered"
									name="eloKFactor"
									type="number"
									value="32"
									min="0.01"
									max="1000"
									step="any"
									required
								/></label
							>
							<label class="form-control"
								><span class="label-text">Rating scale</span><input
									class="input input-bordered"
									name="eloScale"
									type="number"
									value="400"
									min="1"
									max="10000"
									step="any"
									required
								/></label
							>
						</div>
					</fieldset>
				{:else}
					<input type="hidden" name="eloKFactor" value="32" />
					<input type="hidden" name="eloScale" value="400" />
				{/if}

				{#if system === 'custom'}
					<label class="form-control">
						<span class="label-text mb-1">Rating formula</span>
						<input
							class="input input-bordered font-mono"
							name="customFormula"
							value="rating + 32 * (score - expected)"
							maxlength="500"
							required
						/>
						<span class="label-text-alt mt-1"
							>Returns the new rating. Variables: rating, opponentRating, score, expected.
							Functions: abs, min, max, pow, round, floor, ceil.</span
						>
					</label>
				{:else}
					<input type="hidden" name="customFormula" value="rating + 32 * (score - expected)" />
				{/if}

				{#if form?.configurationError}
					<p class="text-error text-sm">{form.configurationError}</p>
				{/if}
				<button class="btn btn-primary mt-5 w-full" type="submit">Create Game</button>
			</form>
		</div>
	</div>
</div>
