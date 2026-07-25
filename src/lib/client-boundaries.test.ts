import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('client/server Supabase boundaries', () => {
	it('keeps private credentials and privileged imports out of client-reachable modules', () => {
		const files = execFileSync('rg', ['--files', 'src'], {
			cwd: workspace,
			encoding: 'utf8'
		})
			.trim()
			.split('\n')
			.filter(
				(file) =>
					(file.endsWith('.svelte') ||
						file.endsWith('+page.ts') ||
						file.endsWith('+layout.ts') ||
						(file.startsWith('src/lib/') && !file.includes('/server/'))) &&
					!file.endsWith('.test.ts') &&
					file !== 'src/lib/supabase.ts'
			);

		for (const file of files) {
			const source = readFileSync(resolve(workspace, file), 'utf8');
			expect(source, `${file} imports a private environment module`).not.toMatch(
				/\$env\/(?:static|dynamic)\/private/
			);
			expect(source, `${file} references the service-role credential`).not.toContain(
				'SUPABASE_SERVICE_ROLE_KEY'
			);
			expect(source, `${file} imports a server-only module`).not.toMatch(
				/(?:\$lib\/server|\/server\/supabase)/
			);
		}
	});
});
