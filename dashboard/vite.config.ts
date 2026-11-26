import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Two builds of the same page:
// - default: served by merlin-mcp at /dashboard/ (Workers static assets, or src/node.ts on Node),
//   reading GET /api/dashboard with the server's own token. `npm run dev` proxies /api to :8787.
// - direct (`npm run build:direct`, VITE_MERLIN_DIRECT=1): a static site for any host. Each student
//   signs in with their own Merlin account and the browser calls Merlin itself; no server holds a token.
//   MARLON_BASE sets the path it is served under (default /).
const direct = process.env.VITE_MERLIN_DIRECT === '1';

// Direct mode holds a Merlin token in the page, so the page may talk to Merlin and to nothing else.
const CSP = [
	"default-src 'self'",
	"script-src 'self'",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' data: blob:",
	`connect-src 'self' ${process.env.VITE_MERLIN_ORIGIN || 'https://moodle.srce.hr'}`,
	"object-src 'none'",
	"base-uri 'none'",
	"form-action 'none'",
].join('; ');

function directSecurity(): Plugin {
	return {
		name: 'marlon-direct-security',
		transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }],
		generateBundle() {
			// For hosts that read a _headers file (Cloudflare Pages, Netlify): the same policy plus no framing.
			this.emitFile({
				type: 'asset',
				fileName: '_headers',
				source: `/*\n  Content-Security-Policy: ${CSP}; frame-ancestors 'none'\n  X-Frame-Options: DENY\n  Referrer-Policy: no-referrer\n  X-Content-Type-Options: nosniff\n\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n`,
			});
		},
	};
}

export default defineConfig({
	base: direct ? (process.env.MARLON_BASE ?? '/') : '/dashboard/',
	plugins: [react(), direct && directSecurity()],
	build: {
		outDir: direct ? 'dist-direct' : 'dist/dashboard',
		emptyOutDir: true,
		chunkSizeWarningLimit: 1200,
	},
	server: {
		proxy: { '/api': 'http://127.0.0.1:8787' },
	},
});
