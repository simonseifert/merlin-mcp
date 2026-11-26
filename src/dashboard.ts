/**
 * GET /api/dashboard: what the web dashboard (dashboard/) shows, read-only, in three parts so
 * each page load stays far below the Workers limit of 50 outgoing requests per invocation:
 *
 *   part=main           (default) about 5 Merlin calls: account, courses, calendar, deadlines, assignments
 *   part=grades         one call per course (max 40): every grade item, for the points and the detail sheet
 *   part=announcements  one call for the forum list plus one per announcement forum (max 30)
 *
 * The page asks for main first and the other two beside it, each in its own request (its own call
 * budget), and merges them. Each part runs the same MCP tool callbacks /mcp serves (so years, HTML
 * stripping and credential redaction behave exactly like the tools) and is cached per isolate or
 * process: main for 5 minutes, announcements 10, grades 15 (they rarely change). fresh=1 skips it.
 *
 * Never asks for assignment feedback (that logs a teacher-visible event), never opens a forum
 * thread (that marks it read), and skips quiz details on deadlines (the page doesn't show them).
 *
 * Auth (src/app.ts): DASHBOARD_KEY opens this route and nothing else; API_BEARER opens it too. A
 * Node server that only listens on loopback serves it with no key (DASHBOARD_OPEN, set in src/node.ts).
 * It always reads the server's own token: one server, one person's Merlin.
 */

import { z } from 'zod';
import { allTokens, currentYear, isValidYear, redactSecret, tokenForYear } from './lib.js';
import { buildAnnouncements, buildGrades, buildMain, configureClassification, type ToolCaller } from './dashboard-build.js';

export * from './dashboard-build.js';

/** Just the part of McpServer that registerTools uses. */
type ToolSink = { tool(...args: unknown[]): unknown };
type Register = (server: never, getEnv: () => never) => void;

export type DashboardPart = 'main' | 'grades' | 'announcements';
export const DASHBOARD_PARTS: readonly DashboardPart[] = ['main', 'grades', 'announcements'];
export const DASHBOARD_CACHE_MS: Record<DashboardPart, number> = { main: 5 * 60_000, announcements: 10 * 60_000, grades: 15 * 60_000 };
const cache = new Map<string, { expires: number; value: Promise<unknown> }>();

/** Test hook. */
export function __resetDashboardCache(): void {
	cache.clear();
}

const text = (result: any): any => JSON.parse(result?.content?.[0]?.text ?? 'null');

/** Runs registerTools against a stub server so tool callbacks can be called in-process, arguments validated as on /mcp. */
export function toolCaller(register: Register, env: unknown): ToolCaller {
	const tools = new Map<string, { shape: Record<string, z.ZodType>; cb: (args: unknown, extra: unknown) => Promise<unknown> }>();
	const sink: ToolSink = {
		tool(...args: unknown[]) {
			const cb = args[args.length - 1] as (a: unknown, e: unknown) => Promise<unknown>;
			const shape = (typeof args[2] === 'object' && args[2] !== null ? args[2] : {}) as Record<string, z.ZodType>;
			tools.set(String(args[0]), { shape, cb });
		},
	};
	register(sink as never, () => env as never);
	return async (name, args = {}) => {
		const t = tools.get(name);
		if (!t) throw new Error(`no tool ${name}`);
		const parsed = z.object(t.shape).parse(args);
		const out = (await t.cb(parsed, {})) as { isError?: boolean };
		const data = text(out);
		if (out?.isError) throw new Error(typeof data === 'string' ? data : JSON.stringify(data));
		return data;
	};
}

const BUILDERS: Record<DashboardPart, (call: ToolCaller, year: string) => Promise<unknown>> = {
	main: buildMain,
	grades: buildGrades,
	announcements: buildAnnouncements,
};

/** GET /api/dashboard[?part=main|grades|announcements][&year=yyyy-yyyy][&fresh=1]. Auth is checked by the caller. */
type DashEnv = { MOODLE_URL?: string; MOODLE_TOKEN: string; MOODLE_TOKENS?: string; MERLIN_EXAM_WORDS?: string; MERLIN_SEMINAR_WORDS?: string };
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };

export async function handleDashboard(request: Request, env: DashEnv, register: Register): Promise<Response> {
	const headers = JSON_HEADERS;
	if (request.method !== 'GET') return new Response(JSON.stringify({ error: 'GET only' }), { status: 405, headers });
	const url = new URL(request.url);
	const year = url.searchParams.get('year') ?? currentYear(env);
	if (!isValidYear(year)) return new Response(JSON.stringify({ error: 'year must look like 2026-2027' }), { status: 400, headers });
	configureClassification({ examWords: env.MERLIN_EXAM_WORDS, seminarWords: env.MERLIN_SEMINAR_WORDS });
	const part = (url.searchParams.get('part') ?? 'main') as DashboardPart;
	if (!DASHBOARD_PARTS.includes(part)) return new Response(JSON.stringify({ error: `part must be one of ${DASHBOARD_PARTS.join(', ')}` }), { status: 400, headers });
	// Keyed by whose token answers too, so two tokens on one isolate never share a page.
	const token = tokenForYear(env, year) ?? '';
	let h = 2166136261;
	for (let i = 0; i < token.length; i++) h = Math.imul(h ^ token.charCodeAt(i), 16777619);
	const key = `${(h >>> 0).toString(36)}:${part}:${year}`;
	const hit = cache.get(key);
	let value: Promise<unknown>;
	if (hit && hit.expires > Date.now() && url.searchParams.get('fresh') !== '1') value = hit.value;
	else {
		value = BUILDERS[part](toolCaller(register, env), year);
		cache.set(key, { expires: Date.now() + DASHBOARD_CACHE_MS[part], value });
		value.catch(() => cache.delete(key));
	}
	try {
		return new Response(redactSecret(JSON.stringify(await value), allTokens(env)), { headers });
	} catch (err) {
		const retry = (err as { retryAfterS?: number })?.retryAfterS;
		const status = retry !== undefined ? 429 : 502;
		return new Response(JSON.stringify({ error: redactSecret(err instanceof Error ? err.message : 'failed', allTokens(env)) }), {
			status,
			headers: retry !== undefined ? { ...headers, 'Retry-After': String(retry) } : headers,
		});
	}
}
