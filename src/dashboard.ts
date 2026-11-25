/**
 * GET /api/dashboard: everything the web dashboard (dashboard/) shows, in one
 * read-only call. It runs the same MCP tool callbacks /mcp serves (so years,
 * HTML stripping and credential redaction behave exactly like the tools) and
 * folds their answers into one shape: courses with points, a calendar, exams,
 * seminars and announcements.
 *
 * Never asks for assignment feedback (that logs a teacher-visible event), never
 * opens a forum thread (that marks it read). Answers are cached per isolate or
 * process for CACHE_MS so a reloaded page doesn't turn into Merlin load.
 *
 * Auth (src/app.ts): DASHBOARD_KEY opens this route and nothing else; API_BEARER
 * opens it too. A Node server that only listens on loopback serves it with no key
 * (DASHBOARD_OPEN, set in src/node.ts).
 */

import { z } from 'zod';
import { allTokens, currentYear, isValidYear, redactSecret, withoutCredentials } from './lib.js';

/** Just the part of McpServer that registerTools uses. */
type ToolSink = { tool(...args: unknown[]): unknown };
type Register = (server: never, getEnv: () => never) => void;
type ToolCaller = (name: string, args?: Record<string, unknown>) => Promise<any>;

export const DASHBOARD_CACHE_MS = 5 * 60_000;
const cache = new Map<string, { expires: number; value: Promise<Dashboard> }>();

/** The caller's Merlin token was missing or rejected (multi-user mode): the client must (re)authenticate. */
export class DashboardAuthError extends Error {}

/** Looks like a Moodle web-service token (32 hex). */
export const isMerlinToken = (t: string): boolean => /^[0-9a-f]{32}$/i.test(t.trim());

/** A short, non-reversible id for a token, so the per-user cache never holds the raw token as a key. */
export function tokenId(token: string): string {
	let h = 2166136261;
	for (let i = 0; i < token.length; i++) h = Math.imul(h ^ token.charCodeAt(i), 16777619);
	return (h >>> 0).toString(36);
}

const AUTH_ERRORS = /invalidtoken|accessexception|invalidlogin|tokennotfound|forcepasswordchange/i;

/** Test hook. */
export function __resetDashboardCache(): void {
	cache.clear();
}

// ---------- classification (pure, tested) ----------

export type EventKind = 'exam' | 'seminar' | 'deadline' | 'class' | 'event';

const EXAM = /(ispit|kolokvij|me[đd]uispit|zavr[šs]n|pismen|usmen|parcijal|provjer[ae] znanja|\btest\b|\bexam|mid[- ]?term|\bfinal)/i;
const SEMINAR = /(seminar|esej|essay|prezentacij|presentation|referat|projekt|project|case stud|studij slu[čc]aja|poster|term paper)/i;
// Moodle's own "X is due" / "Rok za X deadline" wording, in English and Croatian.
const DUE_SUFFIX = /\s+(is due|closes|opens|deadline|rok( za predaju)?|zatvara se|otvara se)$/i;
const DUE_PREFIX = /^(rok za|rok predaje za|zatvaranje:?|otvaranje:?)\s+/i;
export const cleanTitle = (name: string) => name.replace(DUE_PREFIX, '').replace(DUE_SUFFIX, '').trim();

/** What kind of item a calendar event or assignment is, from its name and Moodle type. Exams win over seminars. */
export function classifyItem(name: string, opts: { description?: string; activity?: string; eventtype?: string } = {}): EventKind {
	const title = cleanTitle(name);
	if (EXAM.test(title)) return 'exam';
	if (SEMINAR.test(title)) return 'seminar';
	// Description only as a weaker hint: "kolokvij" in a lecture's notes shouldn't make it an exam.
	if (opts.activity === 'quiz' && opts.description && EXAM.test(opts.description)) return 'exam';
	if (opts.eventtype === 'due' || opts.eventtype === 'close' || opts.activity === 'assign' || opts.activity === 'quiz') return 'deadline';
	if (opts.eventtype === 'course' || opts.eventtype === 'group') return 'class';
	return 'event';
}

/** "90,00 %" -> 90; anything unreadable -> undefined. */
export function parsePercent(s: unknown): number | undefined {
	if (typeof s !== 'string') return undefined;
	const n = Number(s.replace(/[^\d,.-]/g, '').replace(',', '.'));
	return Number.isFinite(n) && /\d/.test(s) ? n : undefined;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

// ---------- shape ----------

export interface GradeItem {
	name: string;
	module?: string;
	raw?: number;
	min?: number;
	max?: number;
	formatted?: string;
	percent?: number;
	weight?: string;
	feedback?: string;
	graded_at?: number;
}
export interface DashCourse {
	key: string; // year:id, unique across years
	id: number;
	year: string;
	name: string;
	shortname?: string;
	total?: { raw?: number; max?: number; percent?: number; formatted?: string };
	items: GradeItem[];
	error?: string;
}
export interface DashEvent {
	key: string;
	year: string;
	title: string;
	kind: EventKind;
	course?: string;
	courseid?: number;
	start: number;
	duration?: number;
	location?: string;
	description?: string;
	url?: string;
	todo?: boolean; // still on Merlin's "to do" list (action events)
}
export interface DashAnnouncement {
	key: string;
	year: string;
	course?: string;
	forum?: string;
	subject: string;
	author?: string;
	created: number;
	message?: string;
	kind?: EventKind;
}
export interface DashSeminar {
	key: string;
	year: string;
	title: string;
	course?: string;
	due?: number;
	intro?: string;
	source: 'assignment' | 'calendar';
}
export interface Dashboard {
	generated_at: number;
	year: string;
	years: string[];
	user?: { fullname?: string; firstname?: string; site?: string };
	courses: DashCourse[];
	events: DashEvent[];
	exams: DashEvent[];
	seminars: DashSeminar[];
	announcements: DashAnnouncement[];
	errors?: Array<{ part: string; error: string }>;
}

// ---------- assembly ----------

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

export async function buildDashboard(call: ToolCaller, year: string, now = Date.now(), opts: { strict?: boolean } = {}): Promise<Dashboard> {
	const errors: Array<{ part: string; error: string }> = [];
	// Multi-user: confirm the caller's token works before fanning out, so a bad token is a clean 401
	// (not a page full of errors) and no other call runs with it.
	if (opts.strict) {
		try {
			const who = await call('moodle_whoami', { year });
			if (!(who?.items ?? [])[0]?.fullname) throw new DashboardAuthError('Merlin rejected this token.');
		} catch (err) {
			if (err instanceof DashboardAuthError) throw err;
			const msg = err instanceof Error ? err.message : String(err);
			if ((err as { retryAfterS?: number })?.retryAfterS !== undefined) throw err;
			throw new DashboardAuthError(AUTH_ERRORS.test(msg) ? 'Merlin rejected this token.' : msg);
		}
	}
	const part = async <T>(name: string, p: Promise<T>, fallback: T): Promise<T> => {
		try {
			return await p;
		} catch (err) {
			// The rate brake must reach the caller as a 429, not as a half-empty page.
			if ((err as { retryAfterS?: number })?.retryAfterS !== undefined) throw err;
			errors.push({ part: name, error: err instanceof Error ? err.message : String(err) });
			return fallback;
		}
	};
	const sec = Math.floor(now / 1000);
	const [who, courses, grades, calendar, todo, assignments, forum] = await Promise.all([
		part('whoami', call('moodle_whoami', { year }), null),
		part('courses', call('moodle_get_courses', { year }), null),
		part('grades', call('moodle_get_grades', { year }), null),
		part('calendar', call('moodle_get_calendar_events', { days_ahead: 120, year }), null),
		part('deadlines', call('moodle_get_upcoming_deadlines', { days_ahead: 120, limit: 50, year }), null),
		part('assignments', call('moodle_get_assignments', { year }), null),
		part('announcements', call('moodle_get_new_forum_posts', { hours_ago: 24 * 45, limit: 40, year }), null),
	]);
	for (const [name, r] of [['courses', courses], ['grades', grades], ['calendar', calendar], ['deadlines', todo], ['assignments', assignments], ['announcements', forum]] as const) {
		for (const [y, e] of Object.entries((r as any)?.errors ?? {})) errors.push({ part: `${name} ${y}`, error: String((e as any)?.error ?? e) });
	}

	const me = (who?.items ?? [])[0] ?? {};

	// Courses with points: the course total item is the headline, mod items the detail.
	const byCourse = new Map<string, any>();
	for (const g of grades?.items ?? []) byCourse.set(`${g.year ?? year}:${g.courseid}`, g);
	const dashCourses: DashCourse[] = (courses?.items ?? []).map((c: any) => {
		const key = `${c.year ?? year}:${c.id}`;
		const g = byCourse.get(key);
		const items: GradeItem[] = [];
		let total: DashCourse['total'];
		for (const gi of g?.gradeitems ?? []) {
			const item: GradeItem = {
				name: str(gi.itemname) ?? 'Stavka',
				module: str(gi.itemmodule),
				raw: num(gi.graderaw),
				min: num(gi.grademin),
				max: num(gi.grademax),
				formatted: str(gi.gradeformatted),
				percent: parsePercent(gi.percentageformatted),
				weight: str(gi.weightformatted),
				feedback: str(gi.feedback),
				graded_at: num(gi.gradedategraded),
			};
			if (gi.itemtype === 'course') total = { raw: item.raw, max: item.max, percent: item.percent, formatted: item.formatted };
			else if (gi.itemtype !== 'category') items.push(item);
		}
		return { key, id: c.id, year: c.year ?? year, name: str(c.fullname) ?? `Kolegij ${c.id}`, shortname: str(c.shortname), total, items, error: g?.error ? String(g.error) : undefined };
	});

	// Calendar: calendar events plus action events ("to do"), de-duplicated by id per year.
	const todoKeys = new Set<string>();
	const events = new Map<string, DashEvent>();
	const add = (e: any, todoItem: boolean) => {
		const y = e.year ?? year;
		const key = `${y}:${e.id}`;
		const start = num(e.timestart) ?? num(e.timesort);
		if (!start || !str(e.name)) return;
		if (todoItem) todoKeys.add(key);
		if (events.has(key)) return;
		const title = cleanTitle(String(e.name));
		events.set(key, {
			key,
			year: y,
			title,
			kind: classifyItem(String(e.name), { description: e.description, activity: e.activity, eventtype: e.eventtype ?? (todoItem ? 'due' : undefined) }),
			course: str(e.course),
			courseid: num(e.courseid),
			start,
			duration: num(e.timeduration) || undefined,
			location: str(e.location),
			description: str(e.description),
			url: str(e.url),
		});
	};
	for (const e of calendar?.items ?? []) add(e, false);
	for (const e of todo?.items ?? []) add(e, true);
	const allEvents = [...events.values()].map((e) => (todoKeys.has(e.key) ? { ...e, todo: true } : e)).sort((a, b) => a.start - b.start);

	// Seminars: assignments that read like one (due in the last 30 days or later, or no due date), plus calendar items.
	const seminars: DashSeminar[] = [];
	const seenTitles = new Set<string>();
	for (const a of assignments?.items ?? []) {
		const due = num(a.duedate) || undefined;
		if (classifyItem(String(a.name ?? '')) !== 'seminar') continue;
		if (due && due < sec - 30 * 86400) continue;
		seenTitles.add(`${a.year}:${String(a.name).toLowerCase()}`);
		seminars.push({ key: `${a.year ?? year}:a${a.id}`, year: a.year ?? year, title: String(a.name), course: str(a.coursename), due, intro: str(a.intro), source: 'assignment' });
	}
	for (const e of allEvents) {
		if (e.kind !== 'seminar' || seenTitles.has(`${e.year}:${e.title.toLowerCase()}`)) continue;
		seminars.push({ key: e.key, year: e.year, title: e.title, course: e.course, due: e.start, intro: e.description, source: 'calendar' });
	}
	seminars.sort((a, b) => (a.due ?? Infinity) - (b.due ?? Infinity));

	const announcements: DashAnnouncement[] = (forum?.items ?? []).map((d: any) => {
		const kind = classifyItem(`${d.subject ?? ''}`);
		return {
			key: `${d.year ?? year}:d${d.discussion}`,
			year: d.year ?? year,
			course: str(d.course),
			forum: str(d.forum),
			subject: str(d.subject) ?? '(bez naslova)',
			author: str(d.author),
			created: num(d.created) ?? num(d.timemodified) ?? 0,
			message: str(d.message),
			kind: kind === 'exam' || kind === 'seminar' ? kind : undefined,
		};
	});

	return withoutCredentials({
		generated_at: sec,
		year,
		years: [year],
		user: { fullname: str(me.fullname), firstname: str(me.firstname), site: str(me.sitename) },
		courses: dashCourses,
		events: allEvents,
		exams: allEvents.filter((e) => e.kind === 'exam'),
		seminars,
		announcements,
		errors: errors.length ? errors : undefined,
	}) as Dashboard;
}

/** GET /api/dashboard[?year=yyyy-yyyy][&fresh=1]. Auth is checked by the caller. */
type DashEnv = { MOODLE_URL?: string; MOODLE_TOKEN: string; MOODLE_TOKENS?: string };
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };

/**
 * GET /api/dashboard[?year=][&fresh=1]. `opts.userToken` set (multi-user mode) means the page carried
 * its own Merlin token: the dashboard is built with it, cached only against its id, and a rejected token
 * answers 401. The token is never stored beyond the in-memory cache value (which holds no token).
 */
export async function handleDashboard(request: Request, env: DashEnv, register: Register, opts: { userToken?: string } = {}): Promise<Response> {
	const headers = JSON_HEADERS;
	if (request.method !== 'GET') return new Response(JSON.stringify({ error: 'GET only' }), { status: 405, headers });
	const url = new URL(request.url);
	const year = url.searchParams.get('year') ?? currentYear(env);
	if (!isValidYear(year)) return new Response(JSON.stringify({ error: 'year must look like 2026-2027' }), { status: 400, headers });
	const strict = Boolean(opts.userToken);
	const callEnv: DashEnv = opts.userToken ? { ...env, MOODLE_TOKEN: opts.userToken, MOODLE_TOKENS: undefined } : env;
	const key = `${opts.userToken ? tokenId(opts.userToken) : 'shared'}:${year}`;
	const hit = cache.get(key);
	let value: Promise<Dashboard>;
	if (hit && hit.expires > Date.now() && url.searchParams.get('fresh') !== '1') value = hit.value;
	else {
		value = buildDashboard(toolCaller(register, callEnv), year, Date.now(), { strict });
		cache.set(key, { expires: Date.now() + DASHBOARD_CACHE_MS, value });
		value.catch(() => cache.delete(key));
	}
	try {
		return new Response(redactSecret(JSON.stringify(await value), allTokens(callEnv)), { headers });
	} catch (err) {
		if (err instanceof DashboardAuthError) {
			cache.delete(key);
			return new Response(JSON.stringify({ error: err.message, login: true }), { status: 401, headers });
		}
		const retry = (err as { retryAfterS?: number })?.retryAfterS;
		const status = retry !== undefined ? 429 : 502;
		return new Response(JSON.stringify({ error: redactSecret(err instanceof Error ? err.message : 'failed', allTokens(callEnv)) }), {
			status,
			headers: retry !== undefined ? { ...headers, 'Retry-After': String(retry) } : headers,
		});
	}
}

/**
 * GET /api/merlin-login[?year=]: confirm a Merlin token (from the X-Merlin-Token header) works, and
 * return the account name and active years. 401 if it is missing or rejected. Used by the login screen;
 * the token is used for this one whoami call and not stored.
 */
export async function handleMerlinLogin(request: Request, env: DashEnv, register: Register, userToken: string): Promise<Response> {
	const headers = JSON_HEADERS;
	const url = new URL(request.url);
	const year = url.searchParams.get('year') ?? currentYear(env);
	if (!isValidYear(year)) return new Response(JSON.stringify({ error: 'year must look like 2026-2027' }), { status: 400, headers });
	const callEnv: DashEnv = { ...env, MOODLE_TOKEN: userToken, MOODLE_TOKENS: undefined };
	try {
		const who = await toolCaller(register, callEnv)('moodle_whoami', { year });
		const me = (who?.items ?? [])[0];
		if (!me?.fullname) throw new DashboardAuthError('Merlin rejected this token.');
		return new Response(JSON.stringify({ ok: true, fullname: me.fullname, firstname: me.firstname, site: me.sitename, year }), { headers });
	} catch (err) {
		if ((err as { retryAfterS?: number })?.retryAfterS !== undefined) {
			return new Response(JSON.stringify({ error: 'Merlin je zatražio pauzu. Pokušaj za koju minutu.' }), { status: 429, headers });
		}
		const msg = err instanceof Error ? err.message : String(err);
		const bad = err instanceof DashboardAuthError || AUTH_ERRORS.test(msg);
		return new Response(JSON.stringify({ error: bad ? 'Token nije prihvaćen. Provjeri da je za točnu godinu i da nije istekao.' : redactSecret(msg, allTokens(callEnv)) }), { status: bad ? 401 : 502, headers });
	}
}
