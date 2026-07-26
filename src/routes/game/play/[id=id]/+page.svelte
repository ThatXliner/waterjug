<script>
	import { enhance } from '$app/forms';
	import { closeDialog, showDialog } from '$lib/dialog';
	import FormulaEditor from '$lib/FormulaEditor.svelte';

	let { data, form } = $props();
	let dbData = $derived(data.data);
	let results = $derived(data.results);
	let name = $derived(data.gameName);
	let inviteOnly = $derived(data.inviteOnly);
	let me = $derived(data.user);
	let profileMap = $derived(data.profileMap);
	let tournaments = $derived(data.tournaments);
	let configuration = $derived(data.configuration);
	let configurationRevision = $derived(data.configurationRevision);
	let isOwner = $derived(data.isOwner);

	/** @param {string} userId */
	function displayName(userId = '') {
		return profileMap[userId] || userId.slice(0, 8);
	}
	/** @param {string} timestamp */
	function displayTimestamp(timestamp) {
		return `${new Date(timestamp).toISOString().replace('T', ' ').slice(0, 16)} UTC`;
	}

	let sorted = $derived([...dbData].sort((a, b) => b.rating - a.rating));
	let modal = $state();
	let opponent = $state('');
	let outcome = $state('won');
	let submissionId = $state('');
	let tournamentModal = $state();
	let configurationModal = $state();
	let configurationSystem = $state('glicko');
	let configurationFormula = $state('');
	let tournamentForm = $state({
		name: '',
		type: 'bracket',
		selectedParticipants: new Set()
	});

	function openModal() {
		opponent = '';
		outcome = 'won';
		submissionId = crypto.randomUUID();
		showDialog(modal);
	}
	function openTournamentModal() {
		showDialog(tournamentModal);
	}
	function openConfigurationModal() {
		configurationSystem = configuration.system;
		configurationFormula = configuration.custom.formula;
		showDialog(configurationModal);
	}
	/** @param {string} userId */
	function toggleParticipant(userId = '') {
		if (tournamentForm.selectedParticipants.has(userId)) {
			tournamentForm.selectedParticipants.delete(userId);
		} else {
			tournamentForm.selectedParticipants.add(userId);
		}
	}
</script>

<dialog bind:this={modal} class="modal">
	<div class="modal-box">
		<h3 class="font-bold text-lg">Report a result</h3>
		<p class="mb-4 text-sm opacity-70">Your opponent must confirm before ratings change.</p>
		<form method="POST" action="?/reportResult" class="space-y-4">
			<input type="hidden" name="submissionId" value={submissionId} />
			<select
				class="select select-bordered w-full max-w-xs"
				bind:value={opponent}
				required
				name="opponent"
			>
				<option disabled value="">Select your opponent</option>
				{#each dbData as { user_id }}
					{#if user_id == me}
						<option disabled value={user_id}>{displayName(user_id)} (yourself)</option>
					{:else}
						<option value={user_id}>{displayName(user_id)}</option>
					{/if}
				{/each}
			</select>
			<div class="flex gap-4">
				<label class="label cursor-pointer justify-start gap-2">
					<input class="radio" type="radio" name="outcome" value="won" bind:group={outcome} />
					<span>I won</span>
				</label>
				<label class="label cursor-pointer justify-start gap-2">
					<input class="radio" type="radio" name="outcome" value="lost" bind:group={outcome} />
					<span>I lost</span>
				</label>
			</div>
			{#if form?.resultError}
				<p class="text-error text-sm">{form.resultError}</p>
			{/if}
			<div class="modal-action">
				<button class="btn" type="button" onclick={() => closeDialog(modal)}>Close</button>
				<button class="btn btn-primary" type="submit" disabled={!opponent}>Report result</button>
			</div>
		</form>
	</div>
	<form method="dialog" class="modal-backdrop">
		<button>close</button>
	</form>
</dialog>

<dialog bind:this={tournamentModal} class="modal">
	<div class="modal-box">
		<h3 class="font-bold text-lg mb-4">Create Tournament</h3>
		<form
			method="POST"
			action="?/createTournament"
			use:enhance={() => {
				closeDialog(tournamentModal);
			}}
		>
			<div class="form-control mb-3">
				<label class="label" for="tname">Tournament name</label>
				<input
					id="tname"
					type="text"
					name="name"
					class="input input-bordered"
					bind:value={tournamentForm.name}
					required
				/>
			</div>
			<fieldset class="mb-3">
				<legend class="label">Type</legend>
				<label class="label cursor-pointer justify-start gap-2">
					<input
						type="radio"
						name="type"
						value="bracket"
						class="radio"
						bind:group={tournamentForm.type}
					/>
					<span>Bracket</span>
				</label>
				<label class="label cursor-pointer justify-start gap-2">
					<input
						type="radio"
						name="type"
						value="round_robin"
						class="radio"
						bind:group={tournamentForm.type}
					/>
					<span>Round Robin</span>
				</label>
			</fieldset>
			<fieldset class="mb-3">
				<legend class="label">Participants</legend>
				<div class="max-h-40 overflow-y-auto border rounded-box p-2">
					{#each dbData as { user_id }}
						{#if user_id !== me}
							<label class="label cursor-pointer justify-start gap-2">
								<input
									type="checkbox"
									name="participants"
									value={user_id}
									class="checkbox"
									checked={tournamentForm.selectedParticipants.has(user_id)}
									onchange={() => toggleParticipant(user_id)}
								/>
								<span>{displayName(user_id)}</span>
							</label>
						{/if}
					{/each}
				</div>
			</fieldset>
			{#if form?.tournamentError}
				<p class="text-error text-sm mb-2">{form.tournamentError}</p>
			{/if}
			<div class="modal-action">
				<button class="btn" type="button" onclick={() => closeDialog(tournamentModal)}>Close</button
				>
				<button class="btn btn-primary" type="submit">Create</button>
			</div>
		</form>
	</div>
	<form method="dialog" class="modal-backdrop">
		<button>close</button>
	</form>
</dialog>

<dialog bind:this={configurationModal} class="modal">
	<div class="modal-box max-w-2xl">
		<h3 class="font-bold text-lg mb-4">Rating configuration</h3>
		<form method="POST" action="?/configure" class="space-y-4">
			<input type="hidden" name="configurationRevision" value={configurationRevision} />
			<div class="grid gap-4 sm:grid-cols-3">
				<label class="form-control">
					<span class="label-text">System</span>
					<select class="select select-bordered" name="system" bind:value={configurationSystem}>
						<option value="glicko">Glicko</option>
						<option value="elo">Elo</option>
						<option value="custom">Custom</option>
					</select>
				</label>
				<label class="form-control">
					<span class="label-text">Starting rating</span>
					<input
						class="input input-bordered"
						name="defaultRating"
						type="number"
						value={configuration.defaultRating}
						min="0"
						max="1000000"
						step="any"
						required
					/>
				</label>
				<label class="form-control">
					<span class="label-text">Period (days)</span>
					<input
						class="input input-bordered"
						name="periodDays"
						type="number"
						value={configuration.periodDays}
						min="0.0416667"
						max="3650"
						step="any"
						required
					/>
				</label>
			</div>
			<fieldset class="rounded-box border border-base-300 p-3">
				<legend class="px-2 font-semibold">Glicko</legend>
				<div class="grid gap-3 sm:grid-cols-2">
					<label class="form-control"
						><span class="label-text">Initial deviation</span><input
							class="input input-bordered"
							name="glickoInitialDeviation"
							type="number"
							value={configuration.glicko.initialDeviation}
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
							value={configuration.glicko.maxDeviation}
							min="1"
							max="1000"
							step="any"
							required
						/></label
					>
					<label class="form-control"
						><span class="label-text">Deviation increase</span><input
							class="input input-bordered"
							name="glickoPeriodDeviationIncrease"
							type="number"
							value={configuration.glicko.periodDeviationIncrease}
							min="0"
							max="1000"
							step="any"
							required
						/></label
					>
					<label class="form-control"
						><span class="label-text">Scale</span><input
							class="input input-bordered"
							name="glickoScale"
							type="number"
							value={configuration.glicko.scale}
							min="1"
							max="10000"
							step="any"
							required
						/></label
					>
				</div>
			</fieldset>
			<fieldset class="rounded-box border border-base-300 p-3">
				<legend class="px-2 font-semibold">Elo</legend>
				<div class="grid gap-3 sm:grid-cols-2">
					<label class="form-control"
						><span class="label-text">K-factor</span><input
							class="input input-bordered"
							name="eloKFactor"
							type="number"
							value={configuration.elo.kFactor}
							min="0.01"
							max="1000"
							step="any"
							required
						/></label
					>
					<label class="form-control"
						><span class="label-text">Scale</span><input
							class="input input-bordered"
							name="eloScale"
							type="number"
							value={configuration.elo.scale}
							min="1"
							max="10000"
							step="any"
							required
						/></label
					>
				</div>
			</fieldset>
			<div class="form-control">
				<span id="configurationFormulaLabel" class="label-text">Custom formula</span>
				<FormulaEditor
					id="configurationFormula"
					name="customFormula"
					labelledBy="configurationFormulaLabel"
					describedBy="configurationFormulaHelp"
					bind:value={configurationFormula}
					required
				/>
				<span id="configurationFormulaHelp" class="label-text-alt"
					>rating, opponentRating, score, expected; abs, min, max, pow, round, floor, ceil</span
				>
			</div>
			{#if form?.configurationError}
				<p class="text-error text-sm">{form.configurationError}</p>
			{/if}
			<p class="text-xs opacity-70">
				Changing the starting rating affects new players only; existing ratings are preserved.
			</p>
			<div class="modal-action">
				<button class="btn" type="button" onclick={() => closeDialog(configurationModal)}
					>Close</button
				>
				<button class="btn btn-primary" type="submit">Save configuration</button>
			</div>
		</form>
	</div>
	<form method="dialog" class="modal-backdrop"><button>close</button></form>
</dialog>

<main class="m-3 flex-col space-y-5">
	<div class="flex justify-evenly">
		<div class="flex items-center gap-3">
			<h3 class="text-5xl">{name}</h3>
			{#if inviteOnly}
				<span class="badge badge-secondary">Invite only</span>
			{/if}
		</div>
		<div class="flex gap-2">
			<button class="btn btn-primary" onclick={openModal}>Add a result</button>
			<button class="btn btn-secondary" onclick={openTournamentModal}>Create Tournament</button>
			{#if isOwner}
				<button class="btn" onclick={openConfigurationModal}>Rating settings</button>
			{/if}
		</div>
	</div>
	<div class="mx-auto flex w-fit gap-2 text-sm">
		<span class="badge badge-outline">{configuration.system}</span>
		<span class="badge badge-outline">Starts at {configuration.defaultRating}</span>
		<span class="badge badge-outline">{configuration.periodDays}-day period</span>
	</div>
	<div class="overflow-x-auto w-fit mx-auto border-2 rounded-box p-3">
		<table class="table">
			<thead>
				<tr>
					<th class="text-left">Rating</th>
					<th class="text-left">Person</th>
				</tr>
			</thead>
			<tbody>
				{#each sorted as user_rating}
					<tr>
						<td>{user_rating.rating}</td>
						<td>
							<a class="link link-hover font-medium" href="/profile/{user_rating.user_id}">
								{displayName(user_rating.user_id)}
							</a>
						</td>
						<td><a href="/profile/{user_rating.user_id}" class="btn btn-sm">View profile</a></td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<section class="mx-auto w-full max-w-3xl">
		<div class="mb-3 flex items-center justify-between">
			<h4 class="text-2xl font-bold">Results</h4>
			{#if form?.resultSuccess}
				<span class="text-success text-sm">Result sent to your opponent.</span>
			{:else if form?.reviewSuccess}
				<span class="text-success text-sm">Result reviewed.</span>
			{/if}
		</div>
		{#if form?.reviewError}
			<div class="alert alert-error mb-3 text-sm">{form.reviewError}</div>
		{/if}
		{#if results.length === 0}
			<p class="rounded-box border border-dashed p-5 text-center opacity-70">
				No results reported yet.
			</p>
		{:else}
			<div class="space-y-3">
				{#each results as result}
					<article class="card border border-base-300 bg-base-100 shadow-sm">
						<div class="card-body gap-3 p-4">
							<div class="flex flex-wrap items-center justify-between gap-2">
								<p>
									<a class="link link-hover font-semibold" href="/profile/{result.winner_id}">
										{displayName(result.winner_id)}
									</a>
									beat
									<a class="link link-hover font-semibold" href="/profile/{result.loser_id}">
										{displayName(result.loser_id)}
									</a>
								</p>
								<span
									class:badge-warning={result.status === 'pending'}
									class:badge-success={result.status === 'confirmed'}
									class:badge-error={result.status === 'disputed'}
									class="badge capitalize">{result.status}</span
								>
							</div>
							<p class="text-xs opacity-65">
								Reported by {displayName(result.reporter_id)} ·
								{displayTimestamp(result.created_at)}
							</p>
							{#if result.status === 'pending' && result.reporter_id !== me}
								<div class="rounded-box bg-warning/10 p-3">
									<p class="mb-2 text-sm font-medium">This result is waiting for your review.</p>
									<form method="POST" action="?/reviewResult" class="flex gap-2">
										<input type="hidden" name="resultId" value={result.id} />
										<button
											class="btn btn-success btn-sm"
											type="submit"
											name="decision"
											value="confirmed">Confirm</button
										>
										<button
											class="btn btn-error btn-outline btn-sm"
											type="submit"
											name="decision"
											value="disputed">Dispute</button
										>
									</form>
								</div>
							{:else if result.status === 'pending'}
								<p class="text-sm text-warning">Waiting for your opponent to confirm or dispute.</p>
							{:else if result.status === 'confirmed'}
								<p class="text-sm text-success">Confirmed — ratings have been updated.</p>
							{:else}
								<p class="text-sm text-error">Disputed — ratings were not changed.</p>
							{/if}
						</div>
					</article>
				{/each}
			</div>
		{/if}
	</section>

	{#if tournaments.length > 0}
		<div class="w-fit mx-auto mt-6">
			<h4 class="text-2xl font-bold mb-3">Tournaments</h4>
			<div class="flex flex-col gap-2">
				{#each tournaments as t}
					<div class="card bg-base-200 shadow p-4">
						<div class="flex items-center gap-4">
							<span class="font-semibold">{t.name}</span>
							<span class="badge badge-sm">{t.type}</span>
							<span class="badge badge-sm badge-neutral">{t.status}</span>
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}
</main>
