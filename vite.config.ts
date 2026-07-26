import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	test: {
		// Database fixtures share one local Auth/Postgres stack; keep files isolated while
		// allowing each file's explicit concurrency tests to overlap their own requests.
		fileParallelism: false,
		include: ['src/**/*.{test,spec}.{js,ts}']
	}
});
