import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		alias: {
			// Real workerd-only modules; see test/shims/cloudflare-runtime.ts.
			'cloudflare:workers': fileURLToPath(new URL('./test/shims/cloudflare-runtime.ts', import.meta.url)),
		},
	},
	test: {
		environment: 'node',
		include: ['test/**/*.test.ts'],
	},
});
