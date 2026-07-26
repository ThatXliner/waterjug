export function showDialog(dialog: unknown): void {
	if (dialog instanceof HTMLDialogElement) {
		dialog.showModal();
	}
}

export function closeDialog(dialog: unknown): void {
	if (dialog instanceof HTMLDialogElement) {
		dialog.close();
	}
}
