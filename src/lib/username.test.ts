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
});
