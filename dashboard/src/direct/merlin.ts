/**
 * Direct mode: the browser talks to Merlin itself with the student's own token, so no server ever
 * sees, holds or forwards it (Merlin's REST endpoint answers `Access-Control-Allow-Origin: *`).
 *
 * This client is deliberately small and read-only: it can call the eight functions in
 * DIRECT_FUNCTIONS and nothing else, whatever a caller asks. On top of it, `toolCaller` answers
 * the seven moodle_* tool names the dashboard uses, in the same shape the server's tools return,
 * so src/dashboard-build.ts folds them exactly as it does on the server.
 *
 * Gentle on Merlin: at most 4 calls in flight, 120 a minute, and a pause when Merlin answers
 * 429/503. Never asks for assignment feedback (a teacher-visible event) or opens a forum thread
 * (marks it read). The token travels in the POST body only, never in a URL.
 */

import type { ToolCaller } from '../../../src/dashboard-build';
import { stripHtml, truncate } from '../../../src/lib';

export const MERLIN_ORIGIN = 'https://moodle.srce.hr';

/** Everything direct mode may ask Merlin. All read-only; nothing here sends, submits or marks read. */
export const DIRECT_FUNCTIONS: ReadonlySet<string> = new Set([
	'core_webservice_get_site_info',
	'core_enrol_get_users_courses',
	'core_calendar_get_calendar_events',
	'core_calendar_get_action_events_by_timesort',
	'mod_assign_get_assignments',
	'gradereport_user_get_grade_items',
	'mod_forum_get_forums_by_courses',
	'mod_forum_get_forum_discussions',
]);

const MAX_IN_FLIGHT = 4;
const MAX_PER_MIN = 120;
const MAX_COURSES = 40;
const MAX_FORUMS = 30;

export class MerlinError extends Error {
	constructor(
		message: string,
		readonly code?: string,
		readonly retryAfterS?: number
	) {
		super(message);
	}
}

/** Merlin turned the token down: expired, revoked, or for another academic year. */
export const isAuthError = (err: unknown): boolean =>
	err instanceof MerlinError && /invalidtoken|accessexception|invalidlogin|tokennotfound|forcepasswordchange/i.test(err.code ?? '');

type Params = Record<string, string | number>;
type Course = { id: number; fullname?: string; shortname?: string; [k: string]: unknown };

export interface DirectClient {
	call<T = any>(fn: string, params?: Params): Promise<T>;
	tools: ToolCaller;
}

export function createClient(token: string, year: string, opts: { fetch?: typeof fetch; now?: () => number } = {}): DirectClient {
	if (!/^[0-9a-f]{32}$/i.test(token)) throw new MerlinError('That does not look like a Merlin token.', 'invalidtoken');
	if (!/^\d{4}-\d{4}$/.test(year)) throw new MerlinError('year must look like 2026-2027');
	const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
	const now = opts.now ?? Date.now;
	const endpoint = `${MERLIN_ORIGIN}/${year}/webservice/rest/server.php`;

	// ---- the brake ----
	let inFlight = 0;
	const waiting: Array<() => void> = [];
	const recent: number[] = [];
	let coolUntil = 0;
	const acquire = async () => {
		while (inFlight >= MAX_IN_FLIGHT) await new Promise<void>((r) => waiting.push(r));
		const t = now();
		if (t < coolUntil) throw new MerlinError('Merlin je zatražio pauzu.', 'ratelimited', Math.ceil((coolUntil - t) / 1000));
		while (recent.length && t - recent[0] >= 60_000) recent.shift();
		if (recent.length >= MAX_PER_MIN) throw new MerlinError('Previše poziva u minuti.', 'ratelimited', Math.ceil((60_000 - (t - recent[0])) / 1000));
		recent.push(t);
		inFlight++;
	};
	const release = () => {
		inFlight--;
		waiting.shift()?.();
	};

	async function call<T = any>(fn: string, params: Params = {}): Promise<T> {
		if (!DIRECT_FUNCTIONS.has(fn)) throw new MerlinError(`${fn} is not allowed in direct mode`, 'notallowed');
		const url = new URL(endpoint);
		url.searchParams.set('moodlewsrestformat', 'json');
		url.searchParams.set('wsfunction', fn);
		for (const [k, v] of Object.entries(params)) if (!/^(wstoken|wsfunction|moodlewsrestformat)$/.test(k)) url.searchParams.set(k, String(v));
		const body = new URLSearchParams({ wstoken: token });
		await acquire();
		let res: Response;
		try {
			// No credentials or referrer go along; a redirect would re-post the token elsewhere, so refuse it.
			res = await doFetch(url.toString(), { method: 'POST', body, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store' });
		} catch {
			throw new MerlinError('Merlin se ne javlja. Provjeri vezu.', 'network');
		} finally {
			release();
		}
		if (res.status === 429 || res.status === 503) {
			const ra = Number(res.headers.get('Retry-After'));
			const s = Number.isFinite(ra) && ra > 0 ? Math.min(ra, 600) : 60;
			coolUntil = now() + s * 1000;
			throw new MerlinError('Merlin je zatražio pauzu.', 'ratelimited', s);
		}
		if (!res.ok) throw new MerlinError(`Merlin HTTP ${res.status}`, 'http');
		let data: any;
		try {
			data = await res.json();
		} catch {
			throw new MerlinError('Merlin nije vratio JSON.', 'http');
		}
		if (data && typeof data === 'object' && 'exception' in data && data.exception) {
			throw new MerlinError(`Merlin: ${stripHtml(String(data.message ?? data.exception)).replaceAll(token, '[token]')}`, String(data.errorcode ?? ''));
		}
		return data as T;
	}

	// ---- the facts several parts need ----
	// Shared by the three parts of one load; a minute later (the refresh button) they are read again.
	const memo = new Map<string, { at: number; p: Promise<unknown> }>();
	const once = <T>(key: string, load: () => Promise<T>): Promise<T> => {
		const hit = memo.get(key);
		if (hit && now() - hit.at < 60_000) return hit.p as Promise<T>;
		const p = load();
		memo.set(key, { at: now(), p });
		p.catch(() => memo.delete(key));
		return p;
	};
	const siteInfo = () => once('site', () => call<Record<string, any>>('core_webservice_get_site_info'));
	const courses = () =>
		once('courses', async () => {
			const { userid } = await siteInfo();
			return (await call<Course[]>('core_enrol_get_users_courses', { userid, returnusercount: 0 })) ?? [];
		});
	const courseNames = async () => new Map((await courses()).map((c) => [c.id, c.fullname]));
	const mapLimit = async <A, B>(xs: A[], fn: (x: A) => Promise<B>) => Promise.all(xs.map(fn)); // the brake caps concurrency
	const strip = (v: unknown, max: number) => (typeof v === 'string' && v ? truncate(stripHtml(v), max) : undefined);
	const tag = <T extends object>(items: T[]) => ({ items: items.map((i) => ({ ...i, year })) });
	const nowS = () => Math.floor(now() / 1000);

	// ---- the seven tools the dashboard reads, shaped like the server's moodle_* tools ----
	const tools: Record<string, (args: Record<string, any>) => Promise<unknown>> = {
		async moodle_whoami() {
			const { userprivateaccesskey: _k, functions: _f, ...rest } = await siteInfo();
			return tag([rest]);
		},
		async moodle_get_courses() {
			return tag((await courses()).map((c) => ({ id: c.id, shortname: c.shortname, fullname: c.fullname, visible: c.visible, startdate: c.startdate, enddate: c.enddate })));
		},
		async moodle_get_calendar_events({ days_ahead = 14 }) {
			const t = nowS();
			const params: Params = {
				'options[timestart]': t,
				'options[timeend]': t + days_ahead * 86400,
				'options[userevents]': 1,
				'options[siteevents]': 1,
				'options[ignorehidden]': 1,
			};
			(await courses()).forEach((c, i) => (params[`events[courseids][${i}]`] = c.id));
			const [data, names] = await Promise.all([call<{ events?: any[] }>('core_calendar_get_calendar_events', params), courseNames()]);
			return tag(
				(data.events ?? [])
					.map((e) => ({
						id: e.id,
						name: e.name,
						course: names.get(e.courseid),
						courseid: e.courseid,
						eventtype: e.eventtype,
						activity: e.modulename || undefined,
						timestart: e.timestart,
						timeduration: e.timeduration,
						location: e.location || undefined,
						description: strip(e.description, 500),
					}))
					.sort((a, b) => a.timestart - b.timestart)
			);
		},
		async moodle_get_upcoming_deadlines({ days_ahead = 30, limit = 30 }) {
			const t = nowS();
			const data = await call<{ events?: any[] }>('core_calendar_get_action_events_by_timesort', { timesortfrom: t, timesortto: t + days_ahead * 86400, limitnum: limit });
			return tag(
				(data.events ?? []).map((e) => ({
					id: e.id,
					name: e.name,
					course: e.course?.fullname,
					courseid: e.course?.id,
					activity: e.modulename,
					timesort: e.timesort,
					url: e.url,
					overdue: e.overdue,
					description: strip(e.description, 500),
				}))
			);
		},
		async moodle_get_assignments() {
			const data = await call<{ courses?: any[] }>('mod_assign_get_assignments');
			const out: any[] = [];
			for (const c of data.courses ?? [])
				for (const a of c.assignments ?? []) out.push({ id: a.id, courseid: c.id, coursename: c.fullname, name: a.name, duedate: a.duedate, cutoffdate: a.cutoffdate, intro: strip(a.intro, 1000) });
			return tag(out.sort((a, b) => (b.duedate ?? 0) - (a.duedate ?? 0)));
		},
		async moodle_get_grades() {
			const [{ userid }, list] = await Promise.all([siteInfo(), courses()]);
			const names = new Map(list.map((c) => [c.id, c.fullname]));
			const items = await mapLimit(list.slice(0, MAX_COURSES), async (c) => {
				try {
					const data = await call<{ usergrades?: any[] }>('gradereport_user_get_grade_items', { courseid: c.id, userid });
					return {
						courseid: c.id,
						coursename: names.get(c.id),
						gradeitems: (data.usergrades?.[0]?.gradeitems ?? []).map((gi: any) => ({
							itemname: gi.itemtype === 'course' && !gi.itemname ? 'Course total' : gi.itemname,
							itemtype: gi.itemtype,
							itemmodule: gi.itemmodule,
							graderaw: gi.graderaw,
							gradeformatted: typeof gi.gradeformatted === 'string' ? stripHtml(gi.gradeformatted) : gi.gradeformatted,
							percentageformatted: gi.percentageformatted,
							grademin: gi.grademin,
							grademax: gi.grademax,
							weightformatted: strip(gi.weightformatted, 100),
							feedback: strip(gi.feedback, 1000),
							gradedategraded: gi.gradedategraded,
						})),
					};
				} catch (err) {
					if ((err as MerlinError).retryAfterS !== undefined || isAuthError(err)) throw err;
					return { courseid: c.id, error: err instanceof Error ? err.message : String(err) };
				}
			});
			return tag(items);
		},
		async moodle_get_new_forum_posts({ hours_ago = 168, limit = 40 }) {
			const since = nowS() - hours_ago * 3600;
			const [forums, names] = await Promise.all([call<any[]>('mod_forum_get_forums_by_courses'), courseNames()]);
			const news = (forums ?? []).filter((f) => f.type === 'news').slice(0, MAX_FORUMS);
			const per = await mapLimit(news, async (f) => {
				let data: { discussions?: any[] };
				try {
					data = await call('mod_forum_get_forum_discussions', { forumid: Number(f.id), sortorder: -1, page: 0, perpage: 15 });
				} catch (err) {
					if ((err as MerlinError).retryAfterS !== undefined || isAuthError(err)) throw err;
					return [];
				}
				return (data.discussions ?? [])
					.filter((d) => Number(d.timemodified) >= since || Number(d.created) >= since)
					.map((d) => ({
						forum_id: f.id,
						forum: f.name,
						courseid: f.course,
						course: names.get(Number(f.course)),
						discussion: d.discussion,
						subject: d.subject ?? d.name,
						author: d.userfullname,
						created: d.created,
						timemodified: d.timemodified,
						message: strip(d.message, 1500),
					}));
			});
			return tag(per.flat().sort((a, b) => Number(b.timemodified) - Number(a.timemodified)).slice(0, limit));
		},
	};

	return {
		call,
		tools: async (name, args = {}) => {
			const tool = tools[name];
			if (!tool) throw new MerlinError(`${name} is not available in direct mode`, 'notallowed');
			return tool(args);
		},
	};
}
