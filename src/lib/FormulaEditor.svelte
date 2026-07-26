<script lang="ts">
	import { onMount } from 'svelte';
	import {
		autocompletion,
		type Completion,
		type CompletionContext
	} from '@codemirror/autocomplete';
	import { StreamLanguage } from '@codemirror/language';
	import { linter, lintGutter, type Diagnostic } from '@codemirror/lint';
	import { EditorState } from '@codemirror/state';
	import { EditorView, basicSetup } from 'codemirror';
	import { RatingFormulaError, validateRatingFormula } from '$lib/rating';

	type Props = {
		id: string;
		name: string;
		labelledBy: string;
		describedBy?: string;
		value?: string;
		maxLength?: number;
		required?: boolean;
	};

	let {
		id,
		name,
		labelledBy,
		describedBy,
		value = $bindable(''),
		maxLength = 500,
		required = false
	}: Props = $props();
	let editorHost: HTMLDivElement;
	let editor: EditorView | undefined;

	const formulaFunctions = new Set(['abs', 'min', 'max', 'pow', 'round', 'floor', 'ceil']);
	const formulaVariables = new Set(['rating', 'opponentRating', 'score', 'expected']);
	const formulaLanguage = StreamLanguage.define({
		token(stream) {
			if (stream.eatSpace()) return null;
			if (stream.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i)) return 'number';
			const identifier = stream.match(/^[A-Za-z_][A-Za-z0-9_]*/);
			if (identifier && identifier !== true) {
				const name = identifier[0];
				if (formulaFunctions.has(name)) return 'keyword';
				if (formulaVariables.has(name)) return 'variableName';
				return 'invalid';
			}
			if (stream.match(/^[+\-*/%^(),]/)) return 'operator';
			stream.next();
			return 'invalid';
		}
	});

	const completions: Completion[] = [
		...Array.from(formulaVariables, (label) => ({
			label,
			type: 'variable',
			detail: 'formula input'
		})),
		...Array.from(formulaFunctions, (label) => ({
			label,
			type: 'function',
			apply: `${label}()`,
			detail: 'allowed function'
		}))
	];

	function completeFormula(context: CompletionContext) {
		const word = context.matchBefore(/[A-Za-z_][A-Za-z0-9_]*/);
		if (!word && !context.explicit) return null;
		return {
			from: word?.from ?? context.pos,
			options: completions
		};
	}

	const validateFormula = linter((view): Diagnostic[] => {
		const source = view.state.doc.toString();
		try {
			validateRatingFormula(source);
			return [];
		} catch (error) {
			const position =
				error instanceof RatingFormulaError && error.position !== undefined
					? Math.min(error.position, source.length)
					: 0;
			return [
				{
					from: position,
					to: Math.min(position + 1, source.length),
					severity: 'error',
					message: error instanceof Error ? error.message : 'Invalid rating formula'
				}
			];
		}
	});

	const editorTheme = EditorView.theme({
		'&': {
			border: '1px solid color-mix(in oklab, var(--color-base-content) 20%, transparent)',
			borderRadius: 'var(--radius-field)',
			backgroundColor: 'var(--color-base-100)',
			color: 'var(--color-base-content)'
		},
		'&.cm-focused': {
			outline: '2px solid var(--color-primary)',
			outlineOffset: '2px'
		},
		'.cm-content': {
			minHeight: '7rem',
			fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
			fontSize: '0.875rem',
			lineHeight: '1.5'
		},
		'.cm-gutters': {
			backgroundColor: 'var(--color-base-200)',
			color: 'color-mix(in oklab, var(--color-base-content) 55%, transparent)',
			borderRight: '1px solid color-mix(in oklab, var(--color-base-content) 12%, transparent)'
		},
		'.cm-activeLine, .cm-activeLineGutter': {
			backgroundColor: 'color-mix(in oklab, var(--color-primary) 8%, transparent)'
		},
		'.cm-tooltip': {
			backgroundColor: 'var(--color-base-100)',
			color: 'var(--color-base-content)',
			border: '1px solid var(--color-base-300)'
		}
	});

	onMount(() => {
		editor = new EditorView({
			parent: editorHost,
			doc: value,
			extensions: [
				basicSetup,
				formulaLanguage,
				autocompletion({ override: [completeFormula] }),
				validateFormula,
				lintGutter(),
				EditorState.changeFilter.of((transaction) => transaction.newDoc.length <= maxLength),
				EditorView.lineWrapping,
				EditorView.contentAttributes.of({
					id,
					'aria-labelledby': labelledBy,
					...(describedBy ? { 'aria-describedby': describedBy } : {})
				}),
				EditorView.updateListener.of((update) => {
					if (update.docChanged) value = update.state.doc.toString();
				}),
				editorTheme
			]
		});
		return () => {
			editor?.destroy();
			editor = undefined;
		};
	});

	$effect(() => {
		if (!editor) return;
		const currentValue = editor.state.doc.toString();
		if (currentValue !== value) {
			editor.dispatch({
				changes: { from: 0, to: currentValue.length, insert: value }
			});
		}
	});

	function focusEditorAfterInvalidInput() {
		editor?.focus();
	}
</script>

<div class="formula-editor" bind:this={editorHost} data-formula-editor></div>
<textarea
	class="sr-only"
	{name}
	bind:value
	maxlength={maxLength}
	{required}
	tabindex="-1"
	aria-hidden="true"
	oninvalid={focusEditorAfterInvalidInput}></textarea>
