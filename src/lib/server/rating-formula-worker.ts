import { Worker } from 'node:worker_threads';
import {
	parseRatingFormulaProgram,
	RatingFormulaError,
	type RatingFormulaContext,
	type RatingFormulaProgram
} from '$lib/rating';

const DEFAULT_TIMEOUT_MS = 1_000;

const WORKER_SOURCE = String.raw`
'use strict';
const { parentPort, workerData } = require('node:worker_threads');

const functions = Object.freeze({
	abs: Math.abs,
	min: Math.min,
	max: Math.max,
	pow: Math.pow,
	round: Math.round,
	floor: Math.floor,
	ceil: Math.ceil
});
const variables = new Set(['rating', 'opponentRating', 'score', 'expected']);
const binaryOperators = new Set(['+', '-', '*', '/', '%', '^']);
const maxAbsoluteRating = 1000000000;

function evaluate(node, context, depth = 0) {
	if (!node || typeof node !== 'object' || depth > 32) {
		throw new Error('formula program is invalid');
	}
	switch (node.type) {
		case 'number':
			if (typeof node.value !== 'number' || !Number.isFinite(node.value)) {
				throw new Error('formula contains an invalid number');
			}
			return node.value;
		case 'variable':
			if (!variables.has(node.name)) throw new Error('formula contains an invalid variable');
			return context[node.name];
		case 'unary': {
			if (node.operator !== '+' && node.operator !== '-') {
				throw new Error('formula contains an invalid unary operator');
			}
			const value = evaluate(node.value, context, depth + 1);
			return node.operator === '-' ? -value : value;
		}
		case 'binary': {
			if (!binaryOperators.has(node.operator)) {
				throw new Error('formula contains an invalid binary operator');
			}
			const left = evaluate(node.left, context, depth + 1);
			const right = evaluate(node.right, context, depth + 1);
			switch (node.operator) {
				case '+': return left + right;
				case '-': return left - right;
				case '*': return left * right;
				case '/': return left / right;
				case '%': return left % right;
				case '^': return Math.pow(left, right);
			}
			break;
		}
		case 'call': {
			if (!Object.hasOwn(functions, node.name) || !Array.isArray(node.values)) {
				throw new Error('formula contains an invalid function call');
			}
			return functions[node.name](...node.values.map((value) => evaluate(value, context, depth + 1)));
		}
	}
	throw new Error('formula program is invalid');
}

try {
	const { program, contexts } = workerData;
	if (!Array.isArray(contexts) || contexts.length === 0 || contexts.length > 2) {
		throw new Error('formula context batch is invalid');
	}
	const values = contexts.map((context) => {
		if (!context || typeof context !== 'object') throw new Error('formula context is invalid');
		for (const name of variables) {
			if (typeof context[name] !== 'number' || !Number.isFinite(context[name])) {
				throw new Error('context variable "' + name + '" must be a finite number');
			}
		}
		const result = evaluate(program, context);
		if (!Number.isFinite(result) || Math.abs(result) > maxAbsoluteRating) {
			throw new Error(
				'formula result must be a finite number between -' +
					maxAbsoluteRating +
					' and ' +
					maxAbsoluteRating
			);
		}
		return Object.is(result, -0) ? 0 : result;
	});
	parentPort.postMessage({ ok: true, values });
} catch (error) {
	parentPort.postMessage({
		ok: false,
		error: error instanceof Error ? error.message : 'unknown worker error'
	});
}
`;

type WorkerMessage = { ok: true; values: number[] } | { ok: false; error: string };

export type RatingFormulaWorkerOptions = {
	timeoutMs?: number;
};

function runFormulaWorker(
	program: RatingFormulaProgram,
	contexts: readonly RatingFormulaContext[],
	options: RatingFormulaWorkerOptions
) {
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 10_000) {
		throw new RatingFormulaError('worker timeout must be between 0 and 10000 milliseconds');
	}

	return new Promise<readonly number[]>((resolve, reject) => {
		const worker = new Worker(WORKER_SOURCE, {
			eval: true,
			name: 'waterjug-rating-formula',
			workerData: { program, contexts },
			argv: [],
			execArgv: [],
			env: {},
			resourceLimits: {
				maxOldGenerationSizeMb: 16,
				maxYoungGenerationSizeMb: 4,
				codeRangeSizeMb: 4,
				stackSizeMb: 2
			}
		});
		let settled = false;
		const finish = (callback: () => void) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			worker.removeAllListeners();
			void worker.terminate();
			callback();
		};
		const timer = setTimeout(() => {
			finish(() =>
				reject(new RatingFormulaError(`formula execution exceeded ${timeoutMs} milliseconds`))
			);
		}, timeoutMs);

		worker.on('message', (message: WorkerMessage) => {
			if (message?.ok === true) {
				finish(() => resolve(message.values));
			} else {
				finish(() =>
					reject(
						new RatingFormulaError(
							message && typeof message.error === 'string'
								? message.error
								: 'formula worker returned an invalid response'
						)
					)
				);
			}
		});
		worker.on('error', (error) => {
			finish(() =>
				reject(
					new RatingFormulaError(
						`formula worker failed: ${error instanceof Error ? error.message : 'unknown worker error'}`
					)
				)
			);
		});
		worker.on('exit', (code) => {
			if (!settled) {
				finish(() =>
					reject(
						new RatingFormulaError(
							code === 0
								? 'formula worker exited without a result'
								: `formula worker stopped with exit code ${code}`
						)
					)
				);
			}
		});
	});
}

export function evaluateRatingFormulaIsolated(
	expression: string,
	contexts: readonly RatingFormulaContext[],
	options: RatingFormulaWorkerOptions = {}
) {
	const program = parseRatingFormulaProgram(expression);
	return runFormulaWorker(program, contexts, options);
}

export async function preflightRatingFormulaIsolated(
	expression: string,
	options: RatingFormulaWorkerOptions = {}
) {
	await evaluateRatingFormulaIsolated(
		expression,
		[{ rating: 1200, opponentRating: 1200, score: 1, expected: 0.5 }],
		options
	);
}
