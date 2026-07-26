<script lang="ts">
	import { onMount } from 'svelte';
	import FormulaEditor from '$lib/FormulaEditor.svelte';

	let { form } = $props();
	let system = $state('glicko');
	let inviteOnly = $state(false);
	let customFormula = $state('rating + 32 * (score - expected)');
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
						value={form?.name ?? ''}
						required
					/>
				</div>
				<div class="divider">Rating configuration</div>
				<div class="grid gap-4 sm:grid-cols-2">
					<label class="form-control">
						<span class="label-text mb-1">Rating system</span>
						<select class="select select-bordered" name="system" bind:value={system}>
							<option value="glicko">Glicko-2</option>
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
							step="any"
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
						<legend class="px-2 font-semibold">Glicko-2 parameters</legend>
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
								><span class="label-text">Initial volatility</span><input
									class="input input-bordered"
									name="glickoInitialVolatility"
									type="number"
									value="0.06"
									min="0.000001"
									max="0.2"
									step="any"
									required
								/></label
							>
							<label class="form-control"
								><span class="label-text">System constant (τ)</span><input
									class="input input-bordered"
									name="glickoTau"
									type="number"
									value="0.5"
									min="0.3"
									max="1.2"
									step="any"
									required
								/></label
							>
						</div>
					</fieldset>
				{:else}
					<input type="hidden" name="glickoInitialDeviation" value="350" />
					<input type="hidden" name="glickoMaxDeviation" value="350" />
					<input type="hidden" name="glickoInitialVolatility" value="0.06" />
					<input type="hidden" name="glickoTau" value="0.5" />
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
					<div class="form-control">
						<span id="newFormulaLabel" class="label-text mb-1">Rating formula</span>
						<FormulaEditor
							id="newFormula"
							name="customFormula"
							labelledBy="newFormulaLabel"
							describedBy="newFormulaHelp"
							bind:value={customFormula}
							required
						/>
						<span id="newFormulaHelp" class="label-text-alt mt-1"
							>Returns the new rating. Variables: rating, opponentRating, score, expected.
							Functions: abs, min, max, pow, round, floor, ceil.</span
						>
					</div>
				{:else}
					<input type="hidden" name="customFormula" value="rating + 32 * (score - expected)" />
				{/if}

				<label class="label mt-4 cursor-pointer justify-start gap-3">
					<input
						class="checkbox checkbox-primary"
						type="checkbox"
						name="inviteOnly"
						bind:checked={inviteOnly}
					/>
					<span class="label-text">Invite-only game</span>
				</label>
				{#if inviteOnly}
					<div class="form-control mt-3">
						<label class="label" for="invitedEmails">
							<span class="label-text">Invited players</span>
						</label>
						<textarea
							class="textarea textarea-bordered"
							name="invitedEmails"
							id="invitedEmails"
							placeholder="player@example.com, teammate@example.com"
							aria-describedby="inviteHelp"
							required></textarea>
						<p id="inviteHelp" class="label-text-alt mt-1 text-left">
							Enter email addresses separated by commas, spaces, or new lines.
						</p>
					</div>
				{/if}
				{#if form?.message}
					<div class="alert alert-error mt-4" role="alert">
						<span>{form.message}</span>
					</div>
				{/if}
				{#if form?.configurationError}
					<p class="text-error text-sm">{form.configurationError}</p>
				{/if}
				<button class="btn btn-primary mt-5 w-full" type="submit">Create Game</button>
			</form>
		</div>
	</div>
</div>
