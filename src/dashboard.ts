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
import { allTokens, currentYear, isValidYear, redactSecret, withoutCredentials } from './lib.js';

/** Just the part of McpServer that registerTools uses. */
type ToolSink = { tool(...args: unknown[]): unknown };
type Register = (server: never, getEnv: () => never) => void;
type ToolCaller = (name: string, args?: Record<string, unknown>) => Promise<any>;

export type DashboardPart = 'main' | 'grades' | 'announcements';
export const DASHBOARD_PARTS: readonly DashboardPart[] = ['main', 'grades', 'announcements'];
export const DASHBOARD_CACHE_MS: Record<DashboardPart, number> = { main: 5 * 60_000, announcements: 10 * 60_000, grades: 15 * 60_000 };
const cache = new Map<string, { expires: number; value: Promise<unknown> }>();

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

type Part = <T>(name: string, p: Promise<T>, fallback: T) => Promise<T>;

/** Runs one part of a dashboard answer, collecting failures in `errors` instead of failing the page. */
function collector(errors: Array<{ part: string; error: string }>): Part {
	return async (name, p, fallback) => {
		try {
			const r: any = await p;
			for (const [y, e] of Object.entries(r?.errors ?? {})) errors.push({ part: `${name} ${y}`, error: String((e as any)?.error ?? e) });
			return r;
		} catch (err) {
			// The rate brake must reach the caller as a 429, not as a half-empty page.
			if ((err as { retryAfterS?: number })?.retryAfterS !== undefined) throw err;
			errors.push({ part: name, error: err instanceof Error ? err.message : String(err) });
			return fallback;
		}
	};
}

/** part=main: account, courses (without points), calendar, exams and seminars. About 5 Merlin calls. */
export async function buildMain(call: ToolCaller, year: string, now = Date.now()): Promise<Dashboard> {
	const errors: Array<{ part: string; error: string }> = [];
	const part = collector(errors);
	const sec = Math.floor(now / 1000);
	const [who, courses, calendar, todo, assignments] = await Promise.all([
		part('whoami', call('moodle_whoami', { year }), null),
		part('courses', call('moodle_get_courses', { year }), null),
		part('calendar', call('moodle_get_calendar_events', { days_ahead: 120, year }), null),
		part('deadlines', call('moodle_get_upcoming_deadlines', { days_ahead: 120, limit: 50, quiz_details: false, year }), null),
		part('assignments', call('moodle_get_assignments', { year }), null),
	]);

	const me = (who?.items ?? [])[0] ?? {};
	const dashCourses: DashCourse[] = (courses?.items ?? []).map((c: any) => ({
		key: `${c.year ?? year}:${c.id}`,
		id: c.id,
		year: c.year ?? year,
		name: str(c.fullname) ?? `Kolegij ${c.id}`,
		shortname: str(c.shortname),
		items: [],
	}));
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

	return withoutCredentials({
		generated_at: sec,
		year,
		years: [year],
		user: { fullname: str(me.fullname), firstname: str(me.firstname), site: str(me.sitename) },
		courses: dashCourses,
		events: allEvents,
		exams: allEvents.filter((e) => e.kind === 'exam'),
		seminars,
		announcements: [],
		errors: errors.length ? errors : undefined,
	}) as Dashboard;
}

export interface DashGrades {
	generated_at: number;
	year: string;
	courses: Array<Pick<DashCourse, 'key' | 'total' | 'items' | 'error'>>;
	errors?: Array<{ part: string; error: string }>;
}

/** part=grades: every grade item per course (one Merlin call per course, the course list is cached). */
export async function buildGrades(call: ToolCaller, year: string, now = Date.now()): Promise<DashGrades> {
	const errors: Array<{ part: string; error: string }> = [];
	const grades = await collector(errors)('grades', call('moodle_get_grades', { year }), null);
	const courses = (grades?.items ?? []).map((g: any) => {
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
		return { key: `${g.year ?? year}:${g.courseid}`, total, items, error: g?.error ? String(g.error) : undefined };
	});
	return withoutCredentials({ generated_at: Math.floor(now / 1000), year, courses, errors: errors.length ? errors : undefined }) as DashGrades;
}

export interface DashAnnouncements {
	generated_at: number;
	year: string;
	announcements: DashAnnouncement[];
	errors?: Array<{ part: string; error: string }>;
}

/** part=announcements: teachers' announcements of the last 45 days (forum list + one call per announcement forum). */
export async function buildAnnouncements(call: ToolCaller, year: string, now = Date.now()): Promise<DashAnnouncements> {
	const errors: Array<{ part: string; error: string }> = [];
	const forum = await collector(errors)('announcements', call('moodle_get_new_forum_posts', { hours_ago: 24 * 45, limit: 40, year }), null);
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

	return withoutCredentials({ generated_at: Math.floor(now / 1000), year, announcements, errors: errors.length ? errors : undefined }) as DashAnnouncements;
}

const BUILDERS: Record<DashboardPart, (call: ToolCaller, year: string) => Promise<unknown>> = {
	main: buildMain,
	grades: buildGrades,
	announcements: buildAnnouncements,
};

/** GET /api/dashboard[?part=main|grades|announcements][&year=yyyy-yyyy][&fresh=1]. Auth is checked by the caller. */
type DashEnv = { MOODLE_URL?: string; MOODLE_TOKEN: string; MOODLE_TOKENS?: string };
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };

export async function handleDashboard(request: Request, env: DashEnv, register: Register): Promise<Response> {
	const headers = JSON_HEADERS;
	if (request.method !== 'GET') return new Response(JSON.stringify({ error: 'GET only' }), { status: 405, headers });
	const url = new URL(request.url);
	const year = url.searchParams.get('year') ?? currentYear(env);
	if (!isValidYear(year)) return new Response(JSON.stringify({ error: 'year must look like 2026-2027' }), { status: 400, headers });
	const part = (url.searchParams.get('part') ?? 'main') as DashboardPart;
	if (!DASHBOARD_PARTS.includes(part)) return new Response(JSON.stringify({ error: `part must be one of ${DASHBOARD_PARTS.join(', ')}` }), { status: 400, headers });
	const key = `${part}:${year}`;
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
