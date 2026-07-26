import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function sourceFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = resolve(directory, entry.name);
		return entry.isDirectory() ? sourceFiles(path) : [relative(workspace, path)];
	});
}

describe('client/server Supabase boundaries', () => {
	it('keeps private credentials and privileged imports out of client-reachable modules', () => {
		const files = sourceFiles(resolve(workspace, 'src')).filter(
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

	it('uses the verified locals snapshot as the root layout identity authority', () => {
		const source = readFileSync(resolve(workspace, 'src/routes/+layout.server.ts'), 'utf8');

		expect(source).toContain('locals: { session, user, supabase, role }');
		expect(source).not.toContain('safeGetSession');
	});
});
