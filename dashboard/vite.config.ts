import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served by merlin-mcp at /dashboard/ (Workers static assets, or src/node.ts on Node).
// `npm run dev` proxies /api to a local merlin-mcp on :8787.
export default defineConfig({
	base: '/dashboard/',
	plugins: [react()],
	build: {
		outDir: 'dist/dashboard',
		emptyOutDir: true,
		chunkSizeWarningLimit: 1200,
	},
	server: {
		proxy: { '/api': 'http://127.0.0.1:8787' },
	},
});
