<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();
	let dbData = $derived(data.data);
	let name = $derived(data.gameName);
	let me = $derived(data.user);
	let profileMap = $derived(data.profileMap);
	let tournaments = $derived(data.tournaments);

	function displayName(userId: string) {
		return profileMap[userId] || userId.slice(0, 8);
	}

	let sorted = $derived([...dbData].sort((a, b) => b.rating - a.rating));
	let modal = $state<HTMLDialogElement | null>(null);
	let winner = $state('');
	let tournamentModal = $state<HTMLDialogElement | null>(null);
	let tournamentForm = $state({
		name: '',
		type: 'bracket',
		selectedParticipants: new Set<string>()
	});

	function openModal() {
		modal?.showModal();
	}
	function openTournamentModal() {
		tournamentModal?.showModal();
	}
	function toggleParticipant(userId: string) {
		if (tournamentForm.selectedParticipants.has(userId)) {
			tournamentForm.selectedParticipants.delete(userId);
		} else {
			tournamentForm.selectedParticipants.add(userId);
		}
	}
</script>

<dialog bind:this={modal} class="modal">
	<div class="modal-box">
		<h3 class="font-bold text-lg">I lost against...</h3>
		<form method="POST">
			<select
				class="select select-bordered w-full max-w-xs"
				bind:value={winner}
				required
				name="winner"
			>
				<option disabled selected>Select a person</option>
				{#each dbData as { user_id }}
					{#if user_id == me}
						<option disabled value={user_id}>{displayName(user_id)} (yourself)</option>
					{:else}
						<option value={user_id}>{displayName(user_id)}</option>
					{/if}
				{/each}
			</select>
			<div class="modal-action">
				<button class="btn" type="button" onclick={() => modal?.close()}>Close</button>
				<button class="btn btn-primary" type="submit" disabled={!winner}>Submit</button>
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
				tournamentModal?.close();
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
				<button class="btn" type="button" onclick={() => tournamentModal?.close()}>Close</button>
				<button class="btn btn-primary" type="submit">Create</button>
			</div>
		</form>
	</div>
	<form method="dialog" class="modal-backdrop">
		<button>close</button>
	</form>
</dialog>

<main class="m-3 flex-col space-y-5">
	<div class="flex justify-evenly">
		<h3 class="text-5xl">{name}</h3>
		<div class="flex gap-2">
			<button class="btn btn-primary" onclick={openModal}>Add a result</button>
			<button class="btn btn-secondary" onclick={openTournamentModal}>Create Tournament</button>
		</div>
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
						<td>{displayName(user_rating.user_id)}</td>
						<td><a href="/profile/{user_rating.user_id}" class="btn">Go to profile</a></td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

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
