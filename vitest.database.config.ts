import { defineConfig } from 'vitest/config';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	root: repositoryRoot,
	test: {
		include: [
			'src/**/*.database.test.ts',
			'src/**/*.integration.test.ts',
			'supabase/tests/**/*.integration.test.ts'
		],
		testTimeout: 60_000,
		hookTimeout: 30_000,
		fileParallelism: false,
		typecheck: {
			tsconfig: resolve(repositoryRoot, 'tsconfig.json')
		}
	}
});
