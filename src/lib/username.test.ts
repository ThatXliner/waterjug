import { describe, expect, it } from 'vitest';
import {
	isValidUsername,
	normalizeUsername,
	USERNAME_REQUIREMENTS,
	validateUsername
} from './username';

describe('usernames', () => {
	it('normalizes whitespace and case', () => {
		expect(normalizeUsername('  Water_Jug42 ')).toBe('water_jug42');
	});

	it.each(['abc', 'water_jug42', '123', 'a'.repeat(30)])('accepts %s', (username) => {
		expect(isValidUsername(username)).toBe(true);
		expect(validateUsername(username)).toBeNull();
	});

	it.each(['ab', 'a'.repeat(31), '_water', 'water_', 'water-jug', 'water jug', 'water.jug'])(
		'rejects %s',
		(username) => {
			expect(validateUsername(username)).toBe(USERNAME_REQUIREMENTS);
		}
	);

	it('enforces the exact length and edge-character boundaries', () => {
		expect(validateUsername('a1')).toBe(USERNAME_REQUIREMENTS);
		expect(validateUsername('a1b')).toBeNull();
		expect(validateUsername(`a${'1'.repeat(28)}b`)).toBeNull();
		expect(validateUsername(`a${'1'.repeat(29)}b`)).toBe(USERNAME_REQUIREMENTS);
		expect(validateUsername('_ab')).toBe(USERNAME_REQUIREMENTS);
		expect(validateUsername('ab_')).toBe(USERNAME_REQUIREMENTS);
	});

	it('preserves validation invariants across deterministic fuzz inputs', () => {
		let state = 0x5eed1234;
		const next = () => {
			state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
			return state;
		};
		const arbitraryCharacters = [
			...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_- .',
			'é',
			'水',
			'🙂',
			'\n',
			'\t'
		];

		for (let sample = 0; sample < 5000; sample += 1) {
			const length = next() % 48;
			let input = '';
			for (let index = 0; index < length; index += 1) {
				input += arbitraryCharacters[next() % arbitraryCharacters.length];
			}

			const normalized = normalizeUsername(input);
			const accepted = validateUsername(input) === null;

			expect(normalizeUsername(normalized)).toBe(normalized);
			expect(accepted).toBe(isValidUsername(normalized));
			if (accepted) {
				expect(normalized.length).toBeGreaterThanOrEqual(3);
				expect(normalized.length).toBeLessThanOrEqual(30);
				expect(normalized).toMatch(/^[a-z0-9]/);
				expect(normalized).toMatch(/[a-z0-9]$/);
			}
		}
	});

	it('accepts normalized valid generators and rejects forbidden-character mutations', () => {
		let state = 0xc0ffee;
		const next = () => {
			state = (Math.imul(state, 1103515245) + 12345) >>> 0;
			return state;
		};
		const validCharacters = 'abcdefghijklmnopqrstuvwxyz0123456789_';
		const edgeCharacters = 'abcdefghijklmnopqrstuvwxyz0123456789';
		const forbiddenCharacters = ['-', '.', ' ', '/', '@', 'é', '水', '🙂'];

		for (let sample = 0; sample < 2000; sample += 1) {
			const length = 3 + (next() % 28);
			let username = edgeCharacters[next() % edgeCharacters.length];
			for (let index = 1; index < length - 1; index += 1) {
				username += validCharacters[next() % validCharacters.length];
			}
			username += edgeCharacters[next() % edgeCharacters.length];

			const decorated = ` \t${username.toUpperCase()}\n`;
			expect(normalizeUsername(decorated)).toBe(username);
			expect(validateUsername(decorated)).toBeNull();

			const insertionPoint = 1 + (next() % (username.length - 1));
			const forbidden = forbiddenCharacters[next() % forbiddenCharacters.length];
			const mutated =
				username.slice(0, insertionPoint) + forbidden + username.slice(insertionPoint);
			expect(validateUsername(mutated)).toBe(USERNAME_REQUIREMENTS);
		}
	});
});
