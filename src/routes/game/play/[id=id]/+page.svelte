<script lang="ts">
	let { data } = $props();
	let dbData = $derived(data.data);
	let name = $derived(data.gameName);
	let me = $derived(data.user);

	let sorted = $derived([...dbData].sort((a, b) => b.rating - a.rating));
	let modal = $state(null);
	let winner = $state('');

	function openModal() {
		modal?.showModal();
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
						<option disabled value={user_id}>{user_id} (yourself)</option>
					{:else}
						<option value={user_id}>{user_id}</option>
					{/if}
				{/each}
			</select>
		</form>

		<div class="modal-action">
			<form method="dialog"><button class="btn">close</button></form>

			<button class="btn btn-primary" type="submit" disabled={!winner}>Submit</button>
		</div>
	</div>
	<form method="dialog" class="modal-backdrop">
		<button>close</button>
	</form>
</dialog>
<main class="m-3 flex-col space-y-5">
	<div class="flex justify-evenly">
		<h3 class="text-5xl">{name}</h3>
		<button class="btn btn-primary" onclick={openModal}>Add a result</button>
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
						<td>{user_rating.user_id}</td>
						<td><a href="/profile/{user_rating.user_id}" class="btn">Go to profile</a></td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</main>
