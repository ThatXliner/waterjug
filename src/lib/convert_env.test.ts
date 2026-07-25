import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const script = fileURLToPath(new URL('../../scripts/convert_env.js', import.meta.url));

function convert(input: string) {
	return execFileSync(process.execPath, [script], { input, encoding: 'utf8' })
		.trim()
		.split('\n')
		.sort();
}

describe('Supabase environment conversion', () => {
	test('maps current unquoted CLI output to SvelteKit variables', () => {
		expect(
			convert(
				[
					'ANON_KEY=anon-value',
					'API_URL=http://127.0.0.1:54321',
					'DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres',
					'SERVICE_ROLE_KEY=service-value'
				].join('\n')
			)
		).toEqual([
			'DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres',
			'PUBLIC_SUPABASE_ANON_KEY=anon-value',
			'PUBLIC_SUPABASE_URL=http://127.0.0.1:54321',
			'SUPABASE_SERVICE_ROLE_KEY=service-value'
		]);
	});

	test('continues to support quoted CLI output and empty values', () => {
		expect(convert('ANON_KEY="anon-value"\nAPI_URL="http://localhost"\nOPTIONAL=""')).toEqual([
			'OPTIONAL=',
			'PUBLIC_SUPABASE_ANON_KEY=anon-value',
			'PUBLIC_SUPABASE_URL=http://localhost'
		]);
	});
});
