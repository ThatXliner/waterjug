export type RatingSystem = 'glicko' | 'elo' | 'custom';

export type RatingConfiguration = {
	version: 1;
	system: RatingSystem;
	defaultRating: number;
	periodDays: number;
	glicko: {
		initialDeviation: number;
		maxDeviation: number;
		periodDeviationIncrease: number;
		scale: number;
	};
	elo: {
		kFactor: number;
		scale: number;
	};
	custom: {
		formula: string;
	};
};

export type RatingState = {
	rating: number;
	deviation?: number;
	lastRatedAt?: string;
};

export const DEFAULT_RATING_CONFIGURATION: RatingConfiguration = {
	version: 1,
	system: 'glicko',
	defaultRating: 1200,
	periodDays: 1,
	glicko: {
		initialDeviation: 350,
		maxDeviation: 350,
		periodDeviationIncrease: 63.2,
		scale: 400
	},
	elo: {
		kFactor: 32,
		scale: 400
	},
	custom: {
		formula: 'rating + 32 * (score - expected)'
	}
};

export class RatingConfigurationError extends Error {
	constructor(readonly issues: string[]) {
		super(issues.join('; '));
		this.name = 'RatingConfigurationError';
	}
}

export class RatingCalculationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'RatingCalculationError';
	}
}

export class RatingConfigurationConflictError extends Error {
	constructor(message = 'Rating configuration changed since it was loaded. Reload and try again.') {
		super(message);
		this.name = 'RatingConfigurationConflictError';
	}
}

function record(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function numberField(
	value: unknown,
	fallback: number,
	name: string,
	min: number,
	max: number,
	issues: string[]
) {
	const result = value === undefined ? fallback : value;
	if (typeof result !== 'number' || !Number.isFinite(result) || result < min || result > max) {
		issues.push(`${name} must be a finite number between ${min} and ${max}`);
		return fallback;
	}
	return result;
}

/**
 * Validate untrusted persisted or form-derived configuration and return a complete,
 * versioned configuration. Missing fields receive documented defaults so existing
 * games remain compatible.
 */
export function parseRatingConfiguration(value: unknown): RatingConfiguration {
	const input = record(value);
	const glicko = record(input.glicko);
	const elo = record(input.elo);
	const custom = record(input.custom);
	const issues: string[] = [];
	const version = input.version ?? 1;
	if (version !== 1) issues.push('version must be 1');
	const system = input.system ?? DEFAULT_RATING_CONFIGURATION.system;
	if (!['glicko', 'elo', 'custom'].includes(String(system))) {
		issues.push('system must be glicko, elo, or custom');
	}

	const configuration: RatingConfiguration = {
		version: 1,
		system: ['glicko', 'elo', 'custom'].includes(String(system))
			? (system as RatingSystem)
			: DEFAULT_RATING_CONFIGURATION.system,
		defaultRating: numberField(
			input.defaultRating,
			DEFAULT_RATING_CONFIGURATION.defaultRating,
			'defaultRating',
			0,
			1_000_000,
			issues
		),
		periodDays: numberField(
			input.periodDays,
			DEFAULT_RATING_CONFIGURATION.periodDays,
			'periodDays',
			1 / 24,
			3650,
			issues
		),
		glicko: {
			initialDeviation: numberField(
				glicko.initialDeviation,
				DEFAULT_RATING_CONFIGURATION.glicko.initialDeviation,
				'glicko.initialDeviation',
				1,
				1000,
				issues
			),
			maxDeviation: numberField(
				glicko.maxDeviation,
				DEFAULT_RATING_CONFIGURATION.glicko.maxDeviation,
				'glicko.maxDeviation',
				1,
				1000,
				issues
			),
			periodDeviationIncrease: numberField(
				glicko.periodDeviationIncrease,
				DEFAULT_RATING_CONFIGURATION.glicko.periodDeviationIncrease,
				'glicko.periodDeviationIncrease',
				0,
				1000,
				issues
			),
			scale: numberField(
				glicko.scale,
				DEFAULT_RATING_CONFIGURATION.glicko.scale,
				'glicko.scale',
				1,
				10_000,
				issues
			)
		},
		elo: {
			kFactor: numberField(
				elo.kFactor,
				DEFAULT_RATING_CONFIGURATION.elo.kFactor,
				'elo.kFactor',
				0.01,
				1000,
				issues
			),
			scale: numberField(
				elo.scale,
				DEFAULT_RATING_CONFIGURATION.elo.scale,
				'elo.scale',
				1,
				10_000,
				issues
			)
		},
		custom: {
			formula:
				typeof custom.formula === 'string'
					? custom.formula
					: DEFAULT_RATING_CONFIGURATION.custom.formula
		}
	};

	if (configuration.glicko.initialDeviation > configuration.glicko.maxDeviation) {
		issues.push('glicko.initialDeviation cannot exceed glicko.maxDeviation');
	}
	try {
		validateRatingFormula(configuration.custom.formula);
	} catch (error) {
		issues.push(
			`custom.formula is invalid: ${error instanceof Error ? error.message : 'unknown error'}`
		);
	}
	if (issues.length > 0) throw new RatingConfigurationError(issues);
	return configuration;
}

const DECIMAL_FORM_NUMBER = /^(?:\d+(?:\.\d*)?|\.\d+)$/;

/**
 * Parse the rating period at the HTTP form boundary. Persisted configurations
 * contain JSON numbers, while forms contain strings; accepting only plain
 * decimal syntax prevents timestamps, units, hexadecimal, and exponent notation
 * from being silently coerced by Number().
 */
export function parseRatingPeriodDaysFormValue(value: unknown) {
	const candidate =
		typeof value === 'string' && DECIMAL_FORM_NUMBER.test(value.trim())
			? Number(value.trim())
			: NaN;
	const issues: string[] = [];
	const periodDays = numberField(candidate, NaN, 'periodDays', 1 / 24, 3650, issues);
	if (issues.length > 0) throw new RatingConfigurationError(issues);
	return periodDays;
}

const FORM_NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

export function parseRatingConfigurationNumber(value: FormDataEntryValue | null) {
	if (typeof value !== 'string') return Number.NaN;
	const normalized = value.trim();
	if (!FORM_NUMBER_PATTERN.test(normalized)) return Number.NaN;
	const parsed = Number(normalized);
	return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function parseRatingConfigurationForm(formData: FormData) {
	const number = (field: string) => parseRatingConfigurationNumber(formData.get(field));
	return parseRatingConfiguration({
		version: 1,
		system: formData.get('system')?.toString(),
		defaultRating: number('defaultRating'),
		periodDays: parseRatingPeriodDaysFormValue(formData.get('periodDays')),
		glicko: {
			initialDeviation: number('glickoInitialDeviation'),
			maxDeviation: number('glickoMaxDeviation'),
			periodDeviationIncrease: number('glickoPeriodDeviationIncrease'),
			scale: number('glickoScale')
		},
		elo: {
			kFactor: number('eloKFactor'),
			scale: number('eloScale')
		},
		custom: { formula: formData.get('customFormula')?.toString() }
	});
}

export function parseRatingConfigurationRevision(value: unknown) {
	const revision = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
	if (
		typeof revision !== 'number' ||
		!Number.isSafeInteger(revision) ||
		revision < 1 ||
		revision >= Number.MAX_SAFE_INTEGER
	) {
		throw new RatingConfigurationError([
			`configurationRevision must be a safe integer between 1 and ${Number.MAX_SAFE_INTEGER - 1}`
		]);
	}
	return revision;
}

export function nextRatingConfigurationRevision(expectedRevision: unknown) {
	return parseRatingConfigurationRevision(expectedRevision) + 1;
}

export type RatingConfigurationStore = {
	compareAndSet(
		expectedRevision: number,
		nextRevision: number,
		configuration: RatingConfiguration
	): Promise<boolean>;
};

/**
 * Persist configuration with optimistic concurrency. Storage implementations
 * must compare and update atomically; a stale writer receives a conflict rather
 * than silently replacing a newer configuration.
 */
export async function commitRatingConfiguration(
	store: RatingConfigurationStore,
	expectedRevisionValue: unknown,
	configurationValue: unknown
) {
	const expectedRevision = parseRatingConfigurationRevision(expectedRevisionValue);
	const configuration = parseRatingConfiguration(configurationValue);
	const nextRevision = nextRatingConfigurationRevision(expectedRevision);
	if (!(await store.compareAndSet(expectedRevision, nextRevision, configuration))) {
		throw new RatingConfigurationConflictError();
	}
	return { configuration, revision: nextRevision };
}

export type RatingFormulaContext = {
	rating: number;
	opponentRating: number;
	score: number;
	expected: number;
};

export class RatingFormulaError extends Error {
	constructor(
		message: string,
		readonly position?: number
	) {
		super(position === undefined ? message : `${message} at character ${position + 1}`);
		this.name = 'RatingFormulaError';
	}
}

type Token = {
	type: 'number' | 'name' | 'operator' | 'eof';
	value: string;
	position: number;
};
type FormulaFunction = {
	minimumArguments: number;
	maximumArguments: number;
	evaluate: (...values: number[]) => number;
};
const MAX_FORMULA_LENGTH = 500;
const MAX_FORMULA_TOKENS = 200;
const MAX_FORMULA_DEPTH = 32;
const MAX_ABSOLUTE_RATING = 1_000_000_000;
const FORMULA_NAMES = new Set(['rating', 'opponentRating', 'score', 'expected']);
const FORMULA_FUNCTIONS: Record<string, FormulaFunction> = {
	abs: { minimumArguments: 1, maximumArguments: 1, evaluate: Math.abs },
	min: { minimumArguments: 1, maximumArguments: 10, evaluate: Math.min },
	max: { minimumArguments: 1, maximumArguments: 10, evaluate: Math.max },
	pow: { minimumArguments: 2, maximumArguments: 2, evaluate: Math.pow },
	round: { minimumArguments: 1, maximumArguments: 1, evaluate: Math.round },
	floor: { minimumArguments: 1, maximumArguments: 1, evaluate: Math.floor },
	ceil: { minimumArguments: 1, maximumArguments: 1, evaluate: Math.ceil }
};

function tokenize(expression: string): Token[] {
	if (typeof expression !== 'string') throw new RatingFormulaError('formula must be a string');
	if (expression.trim().length === 0) throw new RatingFormulaError('formula cannot be empty');
	if (expression.length > MAX_FORMULA_LENGTH) {
		throw new RatingFormulaError(`formula cannot exceed ${MAX_FORMULA_LENGTH} characters`);
	}
	const tokens: Token[] = [];
	let position = 0;
	const push = (token: Token) => {
		if (tokens.length >= MAX_FORMULA_TOKENS) {
			throw new RatingFormulaError(
				`formula cannot exceed ${MAX_FORMULA_TOKENS} tokens`,
				token.position
			);
		}
		tokens.push(token);
	};
	while (position < expression.length) {
		const rest = expression.slice(position);
		const whitespace = /^\s+/.exec(rest);
		if (whitespace) {
			position += whitespace[0].length;
			continue;
		}
		const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i.exec(rest);
		if (number) {
			push({ type: 'number', value: number[0], position });
			position += number[0].length;
			continue;
		}
		const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
		if (name) {
			push({ type: 'name', value: name[0], position });
			position += name[0].length;
			continue;
		}
		const operator = rest[0];
		if ('+-*/%^(),'.includes(operator)) {
			push({ type: 'operator', value: operator, position });
			position += 1;
			continue;
		}
		throw new RatingFormulaError(`unsupported character "${operator}"`, position);
	}
	tokens.push({ type: 'eof', value: '', position: expression.length });
	return tokens;
}

export type RatingFormulaProgram =
	| { type: 'number'; value: number }
	| { type: 'variable'; name: keyof RatingFormulaContext }
	| { type: 'unary'; operator: '+' | '-'; value: RatingFormulaProgram }
	| {
			type: 'binary';
			operator: string;
			left: RatingFormulaProgram;
			right: RatingFormulaProgram;
	  }
	| { type: 'call'; name: string; values: RatingFormulaProgram[] };

export function parseRatingFormulaProgram(expression: string): RatingFormulaProgram {
	const tokens = tokenize(expression);
	let position = 0;
	let depth = 0;
	const current = () => tokens[position];
	const consume = (value?: string) => {
		const token = current();
		if (value !== undefined && token.value !== value) {
			throw new RatingFormulaError(
				`expected "${value}", but found "${token.value || 'end of formula'}"`,
				token.position
			);
		}
		position += 1;
		return token;
	};
	const nested = <T>(at: number, parse: () => T): T => {
		depth += 1;
		if (depth > MAX_FORMULA_DEPTH) {
			throw new RatingFormulaError(
				`formula cannot exceed ${MAX_FORMULA_DEPTH} levels of nesting`,
				at
			);
		}
		try {
			return parse();
		} finally {
			depth -= 1;
		}
	};
	const primary = (): RatingFormulaProgram => {
		const token = current();
		if (token.type === 'number') {
			consume();
			const value = Number(token.value);
			if (!Number.isFinite(value)) {
				throw new RatingFormulaError(
					`numeric literal "${token.value}" must be finite`,
					token.position
				);
			}
			return { type: 'number', value };
		}
		if (token.value === '(') {
			consume('(');
			const value = nested(token.position, add);
			consume(')');
			return value;
		}
		if (token.type === 'name') {
			consume();
			if (current().value === '(') {
				if (!Object.hasOwn(FORMULA_FUNCTIONS, token.value)) {
					throw new RatingFormulaError(
						`function "${token.value}" is not supported; use abs, min, max, pow, round, floor, or ceil`,
						token.position
					);
				}
				consume('(');
				const values: RatingFormulaProgram[] = [];
				if (current().value !== ')') {
					do {
						values.push(nested(token.position, add));
						if (current().value !== ',') break;
						consume(',');
					} while (true);
				}
				consume(')');
				const definition = FORMULA_FUNCTIONS[token.value];
				if (
					values.length < definition.minimumArguments ||
					values.length > definition.maximumArguments
				) {
					const expected =
						definition.minimumArguments === definition.maximumArguments
							? `${definition.minimumArguments}`
							: `${definition.minimumArguments} to ${definition.maximumArguments}`;
					throw new RatingFormulaError(
						`function "${token.value}" expects ${expected} argument${definition.maximumArguments === 1 ? '' : 's'}, but received ${values.length}`,
						token.position
					);
				}
				return { type: 'call', name: token.value, values };
			}
			if (!FORMULA_NAMES.has(token.value)) {
				throw new RatingFormulaError(
					`variable "${token.value}" is not supported; use rating, opponentRating, score, or expected`,
					token.position
				);
			}
			return { type: 'variable', name: token.value as keyof RatingFormulaContext };
		}
		throw new RatingFormulaError(
			`unexpected token "${token.value || 'end of formula'}"`,
			token.position
		);
	};
	const unary = (): RatingFormulaProgram => {
		if (current().value === '+' || current().value === '-') {
			const token = consume();
			return {
				type: 'unary',
				operator: token.value as '+' | '-',
				value: nested(token.position, unary)
			};
		}
		return primary();
	};
	const power = (): RatingFormulaProgram => {
		const left = unary();
		if (current().value !== '^') return left;
		const token = consume();
		return {
			type: 'binary',
			operator: token.value,
			left,
			right: nested(token.position, power)
		};
	};
	const multiply = (): RatingFormulaProgram => {
		let node = power();
		while (['*', '/', '%'].includes(current().value)) {
			node = { type: 'binary', operator: consume().value, left: node, right: power() };
		}
		return node;
	};
	const add = (): RatingFormulaProgram => {
		let node = multiply();
		while (['+', '-'].includes(current().value)) {
			node = { type: 'binary', operator: consume().value, left: node, right: multiply() };
		}
		return node;
	};
	const node = add();
	if (current().type !== 'eof') {
		throw new RatingFormulaError(`unexpected token "${current().value}"`, current().position);
	}
	return node;
}

function evaluateFormula(node: RatingFormulaProgram, context: RatingFormulaContext): number {
	switch (node.type) {
		case 'number':
			return node.value;
		case 'variable':
			return context[node.name];
		case 'unary': {
			const value = evaluateFormula(node.value, context);
			return node.operator === '-' ? -value : value;
		}
		case 'call':
			return FORMULA_FUNCTIONS[node.name].evaluate(
				...node.values.map((value) => evaluateFormula(value, context))
			);
		case 'binary': {
			const left = evaluateFormula(node.left, context);
			const right = evaluateFormula(node.right, context);
			switch (node.operator) {
				case '+':
					return left + right;
				case '-':
					return left - right;
				case '*':
					return left * right;
				case '/':
					return left / right;
				case '%':
					return left % right;
				case '^':
					return Math.pow(left, right);
			}
		}
	}
	throw new RatingFormulaError('formula contains an invalid expression');
}

export function validateRatingFormula(expression: string) {
	parseRatingFormulaProgram(expression);
}

export function compileRatingFormula(expression: string) {
	const formula = parseRatingFormulaProgram(expression);
	const evaluate = (context: RatingFormulaContext) => {
		for (const name of FORMULA_NAMES) {
			const value = context?.[name as keyof RatingFormulaContext];
			if (typeof value !== 'number' || !Number.isFinite(value)) {
				throw new RatingFormulaError(`context variable "${name}" must be a finite number`);
			}
		}
		const result = evaluateFormula(formula, context);
		if (!Number.isFinite(result) || Math.abs(result) > MAX_ABSOLUTE_RATING) {
			throw new RatingFormulaError(
				`formula result must be a finite number between -${MAX_ABSOLUTE_RATING} and ${MAX_ABSOLUTE_RATING}`
			);
		}
		return Object.is(result, -0) ? 0 : result;
	};
	evaluate({ rating: 1200, opponentRating: 1200, score: 1, expected: 0.5 });
	return evaluate;
}

export function evaluateRatingFormula(expression: string, context: RatingFormulaContext) {
	return compileRatingFormula(expression)(context);
}

function expectedScore(rating: number, opponentRating: number, scale: number) {
	return 1 / (1 + Math.pow(10, (opponentRating - rating) / scale));
}

function periodsSince(lastRatedAt: string | undefined, now: Date, periodDays: number) {
	if (!lastRatedAt) return 0;
	const elapsed = now.getTime() - new Date(lastRatedAt).getTime();
	if (!Number.isFinite(elapsed) || elapsed <= 0) return 0;
	return Math.floor(elapsed / (periodDays * 86_400_000));
}

function glickoRating(
	config: RatingConfiguration,
	player: RatingState,
	opponent: RatingState,
	score: number,
	now: Date
): RatingState {
	const parameters = config.glicko;
	const q = Math.log(10) / parameters.scale;
	const square = (value: number) => value * value;
	const inactivePeriods = periodsSince(player.lastRatedAt, now, config.periodDays);
	const deviation = Math.min(
		Math.hypot(
			player.deviation ?? parameters.initialDeviation,
			Math.sqrt(inactivePeriods) * parameters.periodDeviationIncrease
		),
		parameters.maxDeviation
	);
	const opponentDeviation = opponent.deviation ?? parameters.initialDeviation;
	const impact = 1 / Math.sqrt(1 + (3 * square(q) * square(opponentDeviation)) / square(Math.PI));
	const expected =
		1 / (1 + Math.pow(10, (-impact * (player.rating - opponent.rating)) / parameters.scale));
	const variance = 1 / (square(q) * square(impact) * expected * (1 - expected));
	const precision = 1 / square(deviation) + 1 / variance;
	return {
		rating: player.rating + (q / precision) * impact * (score - expected),
		deviation: Math.min(
			deviation / Math.sqrt(1 + square(deviation) / variance),
			parameters.maxDeviation
		),
		lastRatedAt: now.toISOString()
	};
}

function validateRatingState(value: RatingState, name: string): RatingState {
	if (
		typeof value?.rating !== 'number' ||
		!Number.isFinite(value.rating) ||
		Math.abs(value.rating) > 1_000_000_000
	) {
		throw new RatingCalculationError(
			`${name}.rating must be a finite number between -1000000000 and 1000000000`
		);
	}
	if (
		value.deviation !== undefined &&
		(typeof value.deviation !== 'number' ||
			!Number.isFinite(value.deviation) ||
			value.deviation <= 0 ||
			value.deviation > 1_000_000_000)
	) {
		throw new RatingCalculationError(
			`${name}.deviation must be a finite number greater than 0 and at most 1000000000`
		);
	}
	if (value.lastRatedAt !== undefined && !Number.isFinite(new Date(value.lastRatedAt).getTime())) {
		throw new RatingCalculationError(`${name}.lastRatedAt must be a valid date`);
	}
	return { ...value };
}

function validateCalculationTime(now: Date) {
	if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
		throw new RatingCalculationError('now must be a valid date');
	}
}

function validateScore(score: number): asserts score is 0 | 0.5 | 1 {
	if (score !== 0 && score !== 0.5 && score !== 1) {
		throw new RatingCalculationError('score must be 0, 0.5, or 1');
	}
}

function validateCalculatedState(state: RatingState) {
	const validated = validateRatingState(state, 'result');
	return {
		...validated,
		rating: Object.is(validated.rating, -0) ? 0 : validated.rating
	};
}

function calculateWithConfiguration(
	config: RatingConfiguration,
	playerValue: RatingState,
	opponentValue: RatingState,
	scoreValue: number,
	now: Date,
	customFormula?: ReturnType<typeof compileRatingFormula>
) {
	const player = validateRatingState(playerValue, 'player');
	const opponent = validateRatingState(opponentValue, 'opponent');
	validateScore(scoreValue);
	validateCalculationTime(now);
	const score = scoreValue;
	if (config.system === 'glicko') return glickoRating(config, player, opponent, score, now);
	const scale = config.system === 'elo' ? config.elo.scale : DEFAULT_RATING_CONFIGURATION.elo.scale;
	const expected = expectedScore(player.rating, opponent.rating, scale);
	let rating = player.rating + config.elo.kFactor * (score - expected);
	if (config.system === 'custom') {
		try {
			rating = (customFormula ?? compileRatingFormula(config.custom.formula))({
				rating: player.rating,
				opponentRating: opponent.rating,
				score,
				expected
			});
		} catch (error) {
			throw new RatingCalculationError(
				`custom formula failed: ${error instanceof Error ? error.message : 'unknown error'}`
			);
		}
	}
	return validateCalculatedState({ rating, lastRatedAt: now.toISOString() });
}

/**
 * Capture an immutable configuration snapshot for a unit of rating work. A match
 * therefore cannot mix algorithms or parameters when its persisted configuration
 * is updated concurrently.
 */
export function createRatingCalculator(configuration: RatingConfiguration) {
	const config = parseRatingConfiguration(configuration);
	const customFormula =
		config.system === 'custom' ? compileRatingFormula(config.custom.formula) : undefined;
	const calculate = (
		player: RatingState,
		opponent: RatingState,
		score: 0 | 0.5 | 1,
		now = new Date()
	) =>
		validateCalculatedState(
			calculateWithConfiguration(config, player, opponent, score, now, customFormula)
		);
	return {
		calculate,
		calculateMatch(
			player: RatingState,
			opponent: RatingState,
			playerScore: 0 | 0.5 | 1,
			now = new Date()
		) {
			validateScore(playerScore);
			const opponentScore = (1 - playerScore) as 0 | 0.5 | 1;
			return {
				player: calculate(player, opponent, playerScore, now),
				opponent: calculate(opponent, player, opponentScore, now)
			};
		}
	};
}

export function calculateRating(
	configuration: RatingConfiguration,
	player: RatingState,
	opponent: RatingState,
	score: 0 | 0.5 | 1,
	now = new Date()
): RatingState {
	return createRatingCalculator(configuration).calculate(player, opponent, score, now);
}

export type RatingFormulaBatchEvaluator = (
	expression: string,
	contexts: readonly RatingFormulaContext[]
) => Promise<readonly number[]>;

/**
 * Calculate both sides of a match while delegating custom-formula execution to
 * a caller-provided boundary. Server code supplies a worker-backed evaluator;
 * built-in Elo and Glicko calculations remain synchronous and in-process.
 */
export async function calculateRatingMatchWithFormulaEvaluator(
	configuration: RatingConfiguration,
	playerValue: RatingState,
	opponentValue: RatingState,
	playerScoreValue: 0 | 0.5 | 1,
	evaluateCustomFormula: RatingFormulaBatchEvaluator,
	now = new Date()
) {
	const config = parseRatingConfiguration(configuration);
	if (config.system !== 'custom') {
		return createRatingCalculator(config).calculateMatch(
			playerValue,
			opponentValue,
			playerScoreValue,
			now
		);
	}

	const player = validateRatingState(playerValue, 'player');
	const opponent = validateRatingState(opponentValue, 'opponent');
	validateScore(playerScoreValue);
	validateCalculationTime(now);
	const opponentScore = (1 - playerScoreValue) as 0 | 0.5 | 1;
	const playerExpected = expectedScore(
		player.rating,
		opponent.rating,
		DEFAULT_RATING_CONFIGURATION.elo.scale
	);
	const opponentExpected = expectedScore(
		opponent.rating,
		player.rating,
		DEFAULT_RATING_CONFIGURATION.elo.scale
	);

	let ratings: readonly number[];
	try {
		ratings = await evaluateCustomFormula(config.custom.formula, [
			{
				rating: player.rating,
				opponentRating: opponent.rating,
				score: playerScoreValue,
				expected: playerExpected
			},
			{
				rating: opponent.rating,
				opponentRating: player.rating,
				score: opponentScore,
				expected: opponentExpected
			}
		]);
	} catch (error) {
		throw new RatingCalculationError(
			`custom formula failed: ${error instanceof Error ? error.message : 'unknown error'}`
		);
	}
	if (ratings.length !== 2) {
		throw new RatingCalculationError('custom formula failed: evaluator returned an invalid result');
	}

	return {
		player: validateCalculatedState({ rating: ratings[0], lastRatedAt: now.toISOString() }),
		opponent: validateCalculatedState({ rating: ratings[1], lastRatedAt: now.toISOString() })
	};
}
