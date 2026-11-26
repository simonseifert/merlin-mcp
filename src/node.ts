/**
 * Node entry: the same server as the Worker, without Cloudflare.
 *
 *   node dist/node.js            HTTP on $HOST:$PORT (default 127.0.0.1:8787): /mcp, /api/*, approvals
 *   node dist/node.js --stdio    MCP over stdin/stdout for one local client, read-only
 *
 * Config comes from environment variables with the same names as the Worker's
 * secrets and vars (MOODLE_TOKEN, MCP_BEARER, API_BEARER, RELAY_BEARER, ...).
 * Pending sends live in SQLite at $MERLIN_DB (default ./merlin.sqlite), in one
 * process, which gives the same one-store guarantee as the Durable Object.
 *
 * stdio mode never offers moodle_send_message: approving a send needs the
 * HTTP approval routes, so a stdio server is read-only.
 * Behind a reverse proxy, set MERLIN_PUBLIC_URL so approval links point at the
 * public address rather than localhost.
 */

import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer, handle, type Env } from './app.js';
import { Approvals, type KvStorage } from './approvals.js';

/** KvStorage over one SQLite table: JSON values, the same get/put/delete/list the Durable Object storage gives. */
export function sqliteKv(path: string): KvStorage {
	const db = new DatabaseSync(path);
	db.exec('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
	const get = db.prepare('SELECT v FROM kv WHERE k = ?');
	const put = db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v');
	const del = db.prepare('DELETE FROM kv WHERE k = ?');
	const list = db.prepare("SELECT k, v FROM kv WHERE substr(k, 1, length(?)) = ? ORDER BY k");
	return {
		async get<T>(k: string) {
			const row = get.get(k) as { v: string } | undefined;
			return row ? (JSON.parse(row.v) as T) : undefined;
		},
		async put<T>(k: string, v: T) {
			put.run(k, JSON.stringify(v));
		},
		async delete(k: string) {
			return Number(del.run(k).changes) > 0;
		},
		async list<T>({ prefix }: { prefix: string }) {
			const rows = list.all(prefix, prefix) as Array<{ k: string; v: string }>;
			return new Map(rows.map((r) => [r.k, JSON.parse(r.v) as T]));
		},
	};
}

/** In-memory KvStorage, for stdio mode (no sends, so nothing worth persisting). */
export function memoryKv(): KvStorage {
	const m = new Map<string, string>();
	return {
		async get<T>(k: string) {
			const v = m.get(k);
			return v === undefined ? undefined : (JSON.parse(v) as T);
		},
		async put<T>(k: string, v: T) {
			m.set(k, JSON.stringify(v));
		},
		async delete(k: string) {
			return m.delete(k);
		},
		async list<T>({ prefix }: { prefix: string }) {
			return new Map([...m].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, JSON.parse(v) as T]));
		},
	};
}

export function envFromProcess(vars: NodeJS.ProcessEnv, approvals: Approvals): Env {
	const pick = (k: string) => (vars[k] && vars[k]!.length > 0 ? vars[k] : undefined);
	return {
		MOODLE_URL: pick('MOODLE_URL'),
		MOODLE_BASE: pick('MOODLE_BASE'),
		MERLIN_YEARS: pick('MERLIN_YEARS'),
		MOODLE_TOKEN: pick('MOODLE_TOKEN') ?? '',
		MOODLE_TOKENS: pick('MOODLE_TOKENS'),
		MCP_BEARER: pick('MCP_BEARER') ?? '',
		DASHBOARD_KEY: pick('DASHBOARD_KEY'),
		API_BEARER: pick('API_BEARER'),
		LEGACY_API_BEARER: pick('LEGACY_API_BEARER') ?? '0',
		RELAY_BEARER: pick('RELAY_BEARER'),
		MOODLE_CONTACT: pick('MOODLE_CONTACT'),
		MERLIN_ENABLE_SEND: pick('MERLIN_ENABLE_SEND'),
		MERLIN_EXAM_WORDS: pick('MERLIN_EXAM_WORDS'),
		MERLIN_SEMINAR_WORDS: pick('MERLIN_SEMINAR_WORDS'),
		NOTIFY_NTFY_URL: pick('NOTIFY_NTFY_URL'),
		NOTIFY_NTFY_TOKEN: pick('NOTIFY_NTFY_TOKEN'),
		NOTIFY_WEBHOOK_URL: pick('NOTIFY_WEBHOOK_URL'),
		NOTIFY_WEBHOOK_FORMAT: pick('NOTIFY_WEBHOOK_FORMAT'),
		APPROVALS: { idFromName: () => 'approvals', get: () => approvals },
	};
}

function toRequest(req: IncomingMessage, base: string): Request {
	const headers = new Headers();
	for (const [k, v] of Object.entries(req.headers)) {
		if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
		else if (v !== undefined) headers.set(k, v);
	}
	const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
	// Take only path + query from the request line: an absolute-form target ("GET http://evil.example/... HTTP/1.1")
	// must not replace the trusted base, or approval links would point elsewhere.
	// The host can only ever come from the trusted base: copy path and query onto it, never parse them as a URL
	// (a path like "//evil.example/x" would otherwise read as a protocol-relative address).
	const target = new URL(req.url ?? '/', 'http://placeholder.invalid');
	const url = new URL(base);
	url.pathname = target.pathname;
	url.search = target.search;
	return new Request(url, {
		method: req.method,
		headers,
		body: hasBody ? (Readable.toWeb(req) as ReadableStream) : undefined,
		// Node's fetch requires this for a streamed request body.
		...(hasBody ? { duplex: 'half' } : {}),
	} as RequestInit);
}

async function send(res: ServerResponse, response: Response): Promise<void> {
	res.writeHead(response.status, Object.fromEntries(response.headers));
	if (!response.body) return void res.end();
	const body = Readable.fromWeb(response.body as never);
	// A broken upstream stream (e.g. Moodle dropping a file download) must not crash the process.
	body.on('error', (err) => {
		console.error('merlin-mcp: response stream failed:', err instanceof Error ? err.message : 'unknown');
		res.destroy();
	});
	body.pipe(res);
}

/** Built web dashboard (dashboard/dist, `npm run build:dashboard`); on Workers the same folder is served as static assets. */
const DASHBOARD_DIR = fileURLToPath(new URL('../dashboard/dist/', import.meta.url));
const MIME: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.webp': 'image/webp',
	'.woff2': 'font/woff2',
	'.json': 'application/json; charset=utf-8',
};

/** Static files under /dashboard/, or undefined to fall through to the API. Paths can't leave DASHBOARD_DIR. */
export async function dashboardFile(pathname: string, dir = DASHBOARD_DIR): Promise<Response | undefined> {
	if (pathname === '/dashboard') return new Response(null, { status: 308, headers: { Location: '/dashboard/' } });
	if (!pathname.startsWith('/dashboard/')) return undefined;
	let rel: string;
	try {
		rel = decodeURIComponent(pathname.slice(1));
	} catch {
		return new Response('Bad path', { status: 400 });
	}
	if (rel.endsWith('/')) rel += 'index.html';
	const full = normalize(dir + rel);
	if (!full.startsWith(normalize(dir)) || full.includes(`${sep}..${sep}`)) return new Response('Not found', { status: 404 });
	try {
		const body = await readFile(full);
		const type = MIME[extname(full)] ?? 'application/octet-stream';
		const headers: Record<string, string> = { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
		headers['Cache-Control'] = rel.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
		if (type.startsWith('text/html')) {
			headers['Content-Security-Policy'] = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'";
			headers['X-Frame-Options'] = 'DENY';
		}
		return new Response(body, { headers });
	} catch {
		return new Response('Dashboard not built: run npm run build:dashboard', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
	}
}

export function dashboardOpen(host: string, publicUrl?: string, setting?: string): boolean {
	if (setting === '0' || publicUrl) return false;
	return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

export function startHttp(env: Env, port: number, publicUrl?: string, host = '127.0.0.1') {
	const server = createHttpServer(async (req, res) => {
		try {
			// Never trust the Host header for the base: approval links (with their key) are built from it,
			// so a caller could otherwise point the owner's Send button at their own server.
			const listening = server.address();
			const base = publicUrl ?? `http://localhost:${typeof listening === 'object' && listening ? listening.port : port}`;
			const request = toRequest(req, base);
			const file = req.method === 'GET' || req.method === 'HEAD' ? await dashboardFile(new URL(request.url).pathname) : undefined;
			await send(res, file ?? (await handle(request, env)));
		} catch (err) {
			res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Internal error');
			console.error('merlin-mcp:', err instanceof Error ? err.message : 'request failed');
		}
	});
	server.listen(port, host);
	return server;
}

async function main() {
	const stdio = process.argv.includes('--stdio');
	// stdio never offers the send tool, so it needs no approval store and creates no database file.
	const approvals = new Approvals(stdio ? memoryKv() : sqliteKv(process.env.MERLIN_DB ?? 'merlin.sqlite'));
	const env = envFromProcess(process.env, approvals);
	if (!env.MOODLE_TOKEN && !env.MOODLE_TOKENS) throw new Error('Set MOODLE_TOKEN (or MOODLE_TOKENS).');
	if (stdio) {
		// stdout is the protocol channel: never log to it.
		await createServer({ ...env, MERLIN_ENABLE_SEND: '0' }).connect(new StdioServerTransport());
		return;
	}
	if (!env.MCP_BEARER) throw new Error('Set MCP_BEARER (the HTTP server never runs without auth).');
	const port = Number(process.env.PORT ?? 8787);
	// Only this machine by default. Set HOST=0.0.0.0 (the Docker image does) to accept other machines.
	const host = process.env.HOST ?? '127.0.0.1';
	// Only this machine can reach a loopback server, so the dashboard needs no key there. Not behind a
	// reverse proxy (MERLIN_PUBLIC_URL), which would forward the internet to loopback. DASHBOARD_OPEN=0 turns it off.
	env.DASHBOARD_OPEN = dashboardOpen(host, process.env.MERLIN_PUBLIC_URL, process.env.DASHBOARD_OPEN) ? '1' : '0';
	const server = startHttp(env, port, process.env.MERLIN_PUBLIC_URL, host);
	console.error(`merlin-mcp listening on ${host}:${port} (POST /mcp)`);
	const stop = () => server.close(() => process.exit(0));
	process.on('SIGTERM', stop);
	process.on('SIGINT', stop);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
	main().catch((err) => {
		console.error('merlin-mcp:', err instanceof Error ? err.message : String(err));
		process.exit(1);
	});
}
