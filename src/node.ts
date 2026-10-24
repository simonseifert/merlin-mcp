/**
 * Node entry: the same server as the Worker, without Cloudflare.
 *
 *   node dist/node.js            HTTP on $PORT (default 8787): /mcp, /api/*, approvals
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

export function envFromProcess(vars: NodeJS.ProcessEnv, approvals: Approvals): Env {
	const pick = (k: string) => (vars[k] && vars[k]!.length > 0 ? vars[k] : undefined);
	return {
		MOODLE_URL: pick('MOODLE_URL'),
		MOODLE_BASE: pick('MOODLE_BASE'),
		MERLIN_YEARS: pick('MERLIN_YEARS'),
		MOODLE_TOKEN: pick('MOODLE_TOKEN') ?? '',
		MOODLE_TOKENS: pick('MOODLE_TOKENS'),
		MCP_BEARER: pick('MCP_BEARER') ?? '',
		API_BEARER: pick('API_BEARER'),
		LEGACY_API_BEARER: pick('LEGACY_API_BEARER') ?? '0',
		RELAY_BEARER: pick('RELAY_BEARER'),
		MOODLE_CONTACT: pick('MOODLE_CONTACT'),
		MERLIN_ENABLE_SEND: pick('MERLIN_ENABLE_SEND'),
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
	return new Request(new URL(req.url ?? '/', base), {
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
	Readable.fromWeb(response.body as never).pipe(res);
}

export function startHttp(env: Env, port: number, publicUrl?: string) {
	const server = createHttpServer(async (req, res) => {
		try {
			const base = publicUrl ?? `http://${req.headers.host ?? `localhost:${port}`}`;
			await send(res, await handle(toRequest(req, base), env));
		} catch (err) {
			res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Internal error');
			console.error('merlin-mcp:', err instanceof Error ? err.message : 'request failed');
		}
	});
	server.listen(port);
	return server;
}

async function main() {
	const stdio = process.argv.includes('--stdio');
	const approvals = new Approvals(sqliteKv(process.env.MERLIN_DB ?? 'merlin.sqlite'));
	const env = envFromProcess(process.env, approvals);
	if (!env.MOODLE_TOKEN && !env.MOODLE_TOKENS) throw new Error('Set MOODLE_TOKEN (or MOODLE_TOKENS).');
	if (stdio) {
		// stdout is the protocol channel: never log to it.
		await createServer({ ...env, MERLIN_ENABLE_SEND: '0' }).connect(new StdioServerTransport());
		return;
	}
	if (!env.MCP_BEARER) throw new Error('Set MCP_BEARER (the HTTP server never runs without auth).');
	const port = Number(process.env.PORT ?? 8787);
	startHttp(env, port, process.env.MERLIN_PUBLIC_URL);
	console.error(`merlin-mcp listening on :${port} (POST /mcp)`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
	main().catch((err) => {
		console.error('merlin-mcp:', err instanceof Error ? err.message : String(err));
		process.exit(1);
	});
}
