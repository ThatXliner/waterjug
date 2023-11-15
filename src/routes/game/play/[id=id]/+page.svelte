<script lang="ts">
	import type { PageData } from './$types';
	import type { Database } from '$lib/supabase';

	export let data: PageData;
	type Output = Pick<Database['public']['Tables']['ratings']['Row'], 'user_id' | 'rating'>;
	$: dbData = data.data as Output[];
	$: name = data.gameName;
	$: me = data.user;

	// Not sure if this sorts greatest to least
	$: sorted = dbData.sort((a, b) => b.rating - a.rating);
	let modal: HTMLDialogElement;
	let winner: string;
	// TODO: Realtime
</script>

<!-- More like a form saying "i lost against ___" -->
<!-- Open the modal using ID.showModal() method -->

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
			<div class="modal-action">
				<form method="dialog">
					<button class="btn">close</button>
				</form>
				<button class="btn btn-primary" type="submit" disabled={winner == 'Select a person'}
					>Submit</button
				>
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
		<button
			class="btn btn-primary"
			on:click={() => {
				modal.showModal();
			}}>Add a result</button
		>
	</div>
	<div class="overflow-x-auto w-fit mx-auto border-2 rounded-box p-3">
		<table class="table">
			<thead>
				<tr>
					<th class="text-left">Rank</th>
					<th class="text-left">Person</th>
				</tr>
			</thead>
			<tbody>
				{#each sorted as { user_id, rating }}
					<tr>
						<td>{rating}</td>
						<td>{user_id}</td>
						<td><a href="" class="btn">Go to profile</a></td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</main>
