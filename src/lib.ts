/**
 * Pure helper functions for the Merlin MCP worker.
 *
 * Kept dependency-free (no `agents`/`@modelcontextprotocol/sdk` imports) so
 * they can be unit-tested with plain vitest, no workerd/Durable Object
 * runtime required. src/index.ts is the only file that wires these into the
 * actual Worker/MCP surface.
 */

// ---------- Academic year / URL derivation ----------

/**
 * Srce spins up a fresh Merlin instance per academic year at
 * https://moodle.srce.hr/<start>-<end>. Croatian academic years roll over on
 * 1 October, *in Croatia*: not at UTC midnight. Workers run in UTC, and
 * Zagreb is UTC+1 (CET) or UTC+2 (CEST, which is in effect on 1 Oct), so a
 * naive `now.getUTCMonth()` check misreads the date for up to two hours
 * every year (22:00-23:59 UTC on 30 Sept is already 1 Oct in Zagreb).
 */
export function zagrebDateParts(now: Date): { year: number; month: number; day: number } {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Europe/Zagreb',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).formatToParts(now);
	const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
	return { year: get('year'), month: get('month'), day: get('day') };
}

/** First calendar year of the Croatian academic year current at `now`, Zagreb-local. */
export function academicYearStart(now: Date): number {
	const { year, month } = zagrebDateParts(now);
	return month >= 10 ? year : year - 1; // month is 1-indexed here; 10 = October
}

export interface MoodleUrlEnv {
	MOODLE_URL?: string;
	MOODLE_BASE?: string;
}

/**
 * `year` (explicit override, format yyyy-yyyy) wins over `env.MOODLE_URL`
 * (hard pin) wins over the date-derived guess.
 */
export function moodleUrl(env: MoodleUrlEnv, now: Date = new Date(), year?: string): string {
	const base = env.MOODLE_BASE ?? 'https://moodle.srce.hr';
	if (year !== undefined) {
		if (!isValidYear(year)) {
			throw new YearError(`year must look like "2025-2026" (two consecutive years), got "${year}"`);
		}
		return `${base}/${year}`;
	}
	if (env.MOODLE_URL) return env.MOODLE_URL;
	const start = academicYearStart(now);
	return `${base}/${start}-${start + 1}`;
}

// ---------- Multiple active years ----------
//
// Merlin is one Moodle instance per academic year, each with its own database
// (2026-2027 was cloned from 2025-2026 in Aug 2026 and has drifted since).
// Ids are only unique within one year, and teachers keep using last year's
// courses after the 1 October rollover, so readers must look at several
// years at once and tag every item with the year it came from.

/** Thrown for a malformed `year`; REST routes map it to HTTP 400. */
export class YearError extends Error {}

const YEAR_RE = /^(\d{4})-(\d{4})$/;

export function isValidYear(year: string): boolean {
	const m = YEAR_RE.exec(year);
	if (!m) return false;
	const start = Number(m[1]);
	return Number(m[2]) === start + 1 && start >= 2000 && start <= 2100;
}

export function yearLabel(start: number): string {
	return `${start}-${start + 1}`;
}

/** The year the worker uses when none is given: the MOODLE_URL pin if it names one, else today's (Zagreb). */
export function currentYear(env: MoodleUrlEnv, now: Date = new Date()): string {
	const pinned = env.MOODLE_URL ? /(\d{4}-\d{4})\/?$/.exec(env.MOODLE_URL)?.[1] : undefined;
	if (pinned && isValidYear(pinned)) return pinned;
	return yearLabel(academicYearStart(now));
}

export interface YearsEnv extends MoodleUrlEnv {
	MERLIN_YEARS?: string; // optional override, e.g. "2025-2026,2026-2027"
}

/** Parses a comma-separated year list, newest first, de-duplicated. Throws YearError on any bad entry. */
export function parseYearList(list: string): string[] {
	const years = list
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	for (const y of years) {
		if (!isValidYear(y)) throw new YearError(`MERLIN_YEARS entry "${y}" must look like "2025-2026"`);
	}
	return [...new Set(years)].sort().reverse();
}

/**
 * The years to read, before reachability probing: the current year and the
 * previous one (teachers keep posting exam terms and results in last year's
 * courses), newest first. During September the next year's instance usually
 * exists already and courses start posting there, so it is returned as
 * `probe`: include it only if it actually answers.
 */
export function activeYearCandidates(env: YearsEnv, now: Date = new Date()): { years: string[]; probe?: string } {
	if (env.MERLIN_YEARS && env.MERLIN_YEARS.trim()) return { years: parseYearList(env.MERLIN_YEARS) };
	const cur = currentYear(env, now);
	const start = Number(cur.slice(0, 4));
	const years = [cur, yearLabel(start - 1)];
	return zagrebDateParts(now).month === 9 ? { years, probe: yearLabel(start + 1) } : { years };
}

/** activeYearCandidates plus the probe year when `isReachable` says it answers. Newest first. */
export async function activeYears(
	env: YearsEnv,
	now: Date,
	isReachable: (year: string) => Promise<boolean>
): Promise<string[]> {
	const { years, probe } = activeYearCandidates(env, now);
	if (probe && (await isReachable(probe).catch(() => false))) return [probe, ...years];
	return years;
}

// ---------- Per-year Moodle tokens ----------

export interface TokenEnv {
	MOODLE_TOKEN: string;
	MOODLE_TOKENS?: string; // optional JSON map {"2025-2026": "...", "2026-2027": "..."}
}

function parseTokenMap(env: TokenEnv): Record<string, string> {
	if (!env.MOODLE_TOKENS) return {};
	try {
		const map = JSON.parse(env.MOODLE_TOKENS);
		return map && typeof map === 'object' && !Array.isArray(map) ? (map as Record<string, string>) : {};
	} catch {
		return {}; // malformed map: fall back to MOODLE_TOKEN rather than failing every call
	}
}

/** Token for one year: MOODLE_TOKENS[year] if set, else MOODLE_TOKEN. */
export function tokenForYear(env: TokenEnv, year: string | undefined): string {
	const map = parseTokenMap(env);
	const t = year ? map[year] : undefined;
	return typeof t === 'string' && t ? t : env.MOODLE_TOKEN;
}

/** Every configured token, for redaction. */
export function allTokens(env: TokenEnv): string[] {
	return [env.MOODLE_TOKEN, ...Object.values(parseTokenMap(env))].filter((t): t is string => typeof t === 'string' && t.length > 0);
}

// ---------- Fan-out + merge across years ----------

export type YearTagged<T> = { year: string } & T;

export interface FanOutResult<T> {
	years: string[];
	items: Array<YearTagged<T>>;
	errors?: Record<string, string>;
}

/**
 * Runs `fn` for every year in parallel and tags each returned item with its
 * year. One year failing (site down, function missing in that release) is
 * reported under `errors` and never hides the other years' items.
 */
export async function fanOut<T extends object>(years: string[], fn: (year: string) => Promise<T[]>): Promise<FanOutResult<T>> {
	const settled = await Promise.allSettled(years.map((y) => fn(y)));
	const items: Array<YearTagged<T>> = [];
	const errors: Record<string, string> = {};
	settled.forEach((r, i) => {
		const year = years[i];
		if (r.status === 'fulfilled') {
			for (const item of r.value ?? []) items.push({ year, ...item });
		} else {
			errors[year] = r.reason instanceof Error ? r.reason.message : String(r.reason);
		}
	});
	return Object.keys(errors).length ? { years, items, errors } : { years, items };
}

/**
 * Collapses items that are the same record copied into several years (the
 * Aug 2026 database clone duplicated everything older than the copy). `key`
 * must include more than the id, because ids collide across years for
 * *different* records. The kept copy is the first one `prefer` accepts (else
 * the first seen); it gets `also_in` listing the other years.
 */
export function dedupeAcrossYears<T extends { year: string }>(
	items: T[],
	key: (item: T) => string,
	prefer?: (item: T) => boolean
): Array<T & { also_in?: string[] }> {
	const groups = new Map<string, T[]>();
	for (const item of items) {
		const k = key(item);
		const g = groups.get(k);
		if (g) g.push(item);
		else groups.set(k, [item]);
	}
	const out: Array<T & { also_in?: string[] }> = [];
	for (const g of groups.values()) {
		if (g.length === 1) {
			out.push(g[0]);
			continue;
		}
		const kept = (prefer && g.find(prefer)) || g[0];
		const others = g.filter((x) => x !== kept).map((x) => x.year);
		out.push({ ...kept, also_in: [...new Set(others)] });
	}
	return out;
}

/** Stable numeric sort on one field; missing values sort last. */
export function sortByNumber<T>(items: T[], field: (item: T) => unknown, direction: 'asc' | 'desc'): T[] {
	const val = (x: T) => {
		const v = Number(field(x));
		return Number.isFinite(v) ? v : direction === 'asc' ? Infinity : -Infinity;
	};
	return [...items].sort((a, b) => (direction === 'asc' ? val(a) - val(b) : val(b) - val(a)));
}

/** Promise.all with a concurrency limit; results keep input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
	const results = new Array<R>(items.length);
	let next = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (next < items.length) {
			const i = next++;
			results[i] = await fn(items[i], i);
		}
	});
	await Promise.all(workers);
	return results;
}

// ---------- Auth ----------

/**
 * Constant-time-ish string comparison. Plain `===` on secrets leaks timing
 * information proportional to the length of the matching prefix, which is
 * enough to brute-force a bearer token character-by-character over enough
 * requests. Hashing both sides first means we always compare two
 * fixed-length (32 byte) digests, so there's no early-exit signal tied to
 * the *secret's* content or length.
 */
export async function constantTimeEqual(a: string, b: string): Promise<boolean> {
	const enc = new TextEncoder();
	const [da, db] = await Promise.all([
		crypto.subtle.digest('SHA-256', enc.encode(a)),
		crypto.subtle.digest('SHA-256', enc.encode(b)),
	]);
	const va = new Uint8Array(da);
	const vb = new Uint8Array(db);
	let diff = 0;
	for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
	return diff === 0;
}

// ---------- /api/call allow-list ----------

/**
 * Explicit, narrow allow-list for the read-only REST passthrough.
 *
 * A wsfunction is admitted only if its name contains "_get_", "_list_" or
 * "_search_" as a bounded token (underscore on both sides, at least one more
 * word segment after it). This deliberately excludes `view` entirely:
 * Moodle's `*_view_*` and `*_viewed`/`*_log_view_*` functions are NOT
 * read-only: they write to the activity log and can flip completion-
 * tracking state (e.g. `mod_quiz_view_attempt`, `core_course_view_course`,
 * `core_user_view_user_profile`, `gradereport_user_view_grade_report`).
 * The previous regex (`_(get|list|search|view)`) let every one of those
 * through.
 *
 * A secondary denylist blocks functions that are nominally "get" but mint
 * credentials/tokens/launch data instead of returning course data: e.g.
 * `tool_mobile_get_autologin_key`, `core_calendar_get_calendar_export_token`,
 * `mod_lti_get_tool_launch_data`, `tiny_premium_get_api_key`. These don't
 * "write" to Moodle, but handing them out through a bearer-gated passthrough
 * would let the bearer holder mint a fresh credential rather than just read
 * data, which is a materially bigger blast radius if the bearer ever leaks.
 */
const SAFE_WSFUNCTION_RE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*_(get|list|search)_[a-z0-9]+(?:_[a-z0-9]+)*$/;

const CREDENTIAL_MINTING_DENYLIST = [
	'autologin',
	'export_token',
	'api_key',
	'launch_data',
	'draft_itemid',
	'qr_login',
	// "get" in name only (audit 2026-10-05): these act on live state.
	// mod_quiz_get_attempt_data/summary return questions of an in-progress
	// attempt and can close an overdue one (handle_if_time_expired); keeping
	// agents out of live quizzes is an academic-integrity line, not just safety.
	'get_attempt_data',
	'get_attempt_summary',
	'get_attempt_access_information',
	'get_page_for_editing', // mod_wiki: takes an edit lock
	'get_join_url', // mod_bigbluebuttonbn: mints a join link
	'tool_mobile_get_content', // runs mobile-app plugin code
];

export function isSafeWsFunction(fn: string): boolean {
	if (!SAFE_WSFUNCTION_RE.test(fn)) return false;
	// "search" and "view" both double as Moodle *component* names (core_search,
	// gradereport_singleview, core_calendar's "monthly_view"/"day_view" result
	// shapes), so the base regex alone lets a few real `_view_`-as-verb writes
	// through: e.g. core_search_view_results matches on "core_SEARCH_view_..."
	// because "search" satisfies the get/list/search requirement even though
	// "view" is the actual verb here. Block any function with "_view_" as a
	// bounded middle token (not simply ending in "...monthly_view", which is a
	// safe noun, not a verb).
	if (/_view_/.test(fn)) return false;
	return !CREDENTIAL_MINTING_DENYLIST.some((bad) => fn.includes(bad));
}

/**
 * The exact functions /api/call accepts (reviewed 23 Oct 2026): what the
 * reference automation (watchers, deadline radar, archiver) calls, plus
 * core_course_get_courses_by_field for the teacher list. Each one must also pass isSafeWsFunction. Adding a function
 * means reading its Moodle source first: none may write, log a view, mark
 * anything read except as documented in the README, or mint a credential.
 */
export const API_CALL_ALLOWLIST: ReadonlySet<string> = new Set([
	'core_webservice_get_site_info',
	'core_enrol_get_users_courses',
	'core_course_get_contents',
	'core_course_get_courses_by_field',
	'core_course_get_updates_since',
	'core_calendar_get_action_events_by_timesort',
	'core_calendar_get_calendar_events',
	'core_message_get_messages',
	'core_message_get_conversations',
	'message_popup_get_popup_notifications',
	'mod_assign_get_assignments',
	'mod_quiz_get_quizzes_by_courses',
	'mod_quiz_get_user_attempts',
	'mod_quiz_get_attempt_review',
	'mod_forum_get_forums_by_courses',
	'mod_forum_get_forum_discussions',
	'mod_forum_get_discussion_posts', // marks the returned posts read (Moodle 5.2), like opening the thread
	'mod_workshop_get_workshops_by_courses',
	'gradereport_user_get_grade_items',
]);

/**
 * Parameters /api/call always sets itself, overriding the caller, for listed
 * functions that would otherwise change state: core_message_get_messages marks
 * the returned messages read when markasread=1.
 */
export const FORCED_API_PARAMS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
	core_message_get_messages: { markasread: '0' },
};

export function isAllowedApiFunction(fn: string): boolean {
	return API_CALL_ALLOWLIST.has(fn) && isSafeWsFunction(fn);
}

/** Query params that must always come from server state, never the caller. */
export const RESERVED_MOODLE_PARAMS = new Set(['wstoken', 'wsfunction', 'moodlewsrestformat']);

/**
 * Sent on every request to Merlin, so SRCE's web-server logs can tell what this is
 * without asking (Moodle itself does not store the User-Agent). Honest and fixed:
 * only the contact address is configurable (secret MOODLE_CONTACT), never the rest,
 * and it is never browser-like.
 */
/** Released version (keep in sync with package.json). Sent in the User-Agent and /healthz. */
export const VERSION = '0.4.1';

export function moodleUserAgent(contact?: string): string {
	const c = (contact ?? '').trim();
	const safe = /^[^\s()@]+@[^\s()@]+\.[^\s()@]+$/.test(c) ? `; contact: ${c}` : '';
	return `merlin-mcp/${VERSION} (+https://github.com/simonseifert/merlin-mcp; personal read-only student client${safe})`;
}

/**
 * Fields Moodle returns that are credentials, not data. core_webservice_get_site_info's
 * userprivateaccesskey downloads files via /tokenpluginfile.php and never expires.
 * Stripped from every passthrough response, at any depth, along with copies
 * of a key embedded in strings (tokenpluginfile.php URLs, token= params).
 */
const CREDENTIAL_FIELDS = new Set(['userprivateaccesskey', 'privatetoken', 'token', 'wstoken']);

/** Credentials Moodle can embed inside strings: /tokenpluginfile.php/<privatekey>/ paths and token= query params. */
function redactEmbeddedCredentials(text: string): string {
	// Also covers the forms Moodle HTML and nested JSON use: &amp; / &#38; / %26 separators,
	// %3D for "=", and \/ or %2F after tokenpluginfile.php.
	return text
		.replace(/(tokenpluginfile\.php(?:\/|\\\/|%2f))[^/\\"'\s?#&%]+/gi, '$1[redacted]')
		.replace(/((?:[?&]|&amp;|&#0*38;|%26)(?:ws)?token(?:=|%3d))[^&"'\s#<>\\]+/gi, '$1[redacted]');
}

export function withoutCredentials<T>(value: T): T {
	if (typeof value === 'string') return redactEmbeddedCredentials(value) as T;
	if (Array.isArray(value)) return value.map((v) => withoutCredentials(v)) as T;
	if (value && typeof value === 'object') {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			if (!CREDENTIAL_FIELDS.has(k.toLowerCase())) out[k] = withoutCredentials(v);
		}
		return out as T;
	}
	return value;
}

// ---------- /api/file host/redirect validation ----------

const MOODLE_FILE_HOST = 'moodle.srce.hr';

/**
 * Parses `target` and confirms it is an `https://moodle.srce.hr/...` URL
 * using the actual parsed hostname/protocol (not a `startsWith` string
 * check, which is a classic bypass vector for things like userinfo tricks
 * or lookalike hosts once the check gets copy-pasted elsewhere).
 */
export function parseAllowedMoodleFileUrl(target: string): URL | null {
	let url: URL;
	try {
		url = new URL(target);
	} catch {
		return null;
	}
	if (url.protocol !== 'https:') return null;
	if (url.hostname !== MOODLE_FILE_HOST) return null;
	if (url.port !== '') return null; // only the default HTTPS port: the token must not reach another service on that host
	// Only the file-serving scripts: the token is appended, so it must not reach any other Moodle page or endpoint.
	if (!/^\/\d{4}-\d{4}\/(?:webservice\/)?pluginfile\.php\//.test(url.pathname)) return null;
	if (/%2f|%5c|\\/i.test(url.pathname)) return null; // no encoded or back slashes that a server might re-split
	return url;
}

/**
 * True if a fetch Response is a redirect we should refuse to follow.
 * Workers' `fetch(url, { redirect: 'manual' })` surfaces a redirect as an
 * ordinary Response with a 3xx status and a Location header (unlike browser
 * fetch, it does not produce an opaque `type: 'opaqueredirect'` response), so
 * a plain status check is both correct and sufficient here.
 */
export function isRedirectResponse(res: Response): boolean {
	return res.status >= 300 && res.status < 400;
}

// ---------- Output shaping ----------

const NAMED_ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
	rsquo: '’',
	lsquo: '‘',
	rdquo: '”',
	ldquo: '“',
	ndash: '–',
	mdash: '—',
	hellip: '…',
};

/** Cheap HTML->text: drop tags/scripts/styles, decode common entities, collapse whitespace. */
export function stripHtml(html: unknown): string {
	if (typeof html !== 'string' || html.length === 0) return typeof html === 'string' ? html : '';
	let text = html
		.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
		.replace(/<[^>]+>/g, '');
	text = text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, ent: string) => {
		if (ent[0] === '#') {
			const code = ent[1]?.toLowerCase() === 'x' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
			// Out-of-range or surrogate code points would make fromCodePoint throw on a bad post.
			return Number.isFinite(code) && code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : m;
		}
		return NAMED_ENTITIES[ent.toLowerCase()] ?? m;
	});
	return text.replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*/g, '\n\n').trim();
}

export function truncate(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars)}\n...[truncated ${text.length - maxChars} more characters]`;
}

export function clamp(n: number, min: number, max: number): number {
	if (Number.isNaN(n)) return min;
	return Math.min(max, Math.max(min, n));
}

/** Replace any occurrence of a secret value inside outgoing text, defense-in-depth against leaking it via echoed error bodies. */
export function redactSecret(text: string, secret: string | string[] | undefined): string {
	const secrets = Array.isArray(secret) ? secret : secret ? [secret] : [];
	let out = text;
	for (const s of secrets) if (s) out = out.split(s).join('[redacted]');
	return out;
}

// ---------- Times ----------

const ZAGREB_FMT = new Intl.DateTimeFormat('en-GB', {
	timeZone: 'Europe/Zagreb',
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	minute: '2-digit',
	hour12: false,
	timeZoneName: 'short',
});

/**
 * Unix seconds -> "2025-11-11 23:59 CET" in Zagreb time. Models routinely get
 * epoch-to-local conversion wrong around DST, and deadlines are where that
 * matters, so tools put this string next to every timestamp. 0/empty -> undefined.
 */
export function zagrebTime(epochSeconds: unknown): string | undefined {
	const n = Number(epochSeconds);
	if (!Number.isFinite(n) || n <= 0) return undefined;
	const p = Object.fromEntries(ZAGREB_FMT.formatToParts(new Date(n * 1000)).map((x) => [x.type, x.value]));
	const hour = p.hour === '24' ? '00' : p.hour;
	return `${p.year}-${p.month}-${p.day} ${hour}:${p.minute} ${p.timeZoneName}`;
}

// ---------- Tool results ----------

const OMIT_NOTE = 'Output was too large; trailing items were dropped. Narrow the request (fewer days, one course, a smaller limit) to see them.';

/** Largest array-valued property of an object, by serialized size. */
function largestArrayProp(obj: Record<string, unknown>): string | undefined {
	let best: string | undefined;
	let bestLen = -1;
	for (const [k, v] of Object.entries(obj)) {
		if (!Array.isArray(v)) continue;
		const len = JSON.stringify(v).length;
		if (len > bestLen) {
			best = k;
			bestLen = len;
		}
	}
	return best;
}

/** Keeps the largest n leading items (binary search) such that build(n) fits in maxChars. */
function fitItems(total: number, build: (n: number) => string, maxChars: number): string | undefined {
	let lo = 0;
	let hi = total;
	let best: string | undefined;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		const text = build(mid);
		if (text.length <= maxChars) {
			best = text;
			lo = mid + 1;
		} else {
			hi = mid - 1;
		}
	}
	return best;
}

/**
 * Uniform MCP tool result: compact JSON with a hard size cap that never cuts
 * mid-string. Over the cap, whole trailing items are dropped from the result
 * array (or the largest array in the result object) and the count is reported,
 * so the text is always valid JSON.
 */
export function toToolResult(data: unknown, maxChars = 200_000): { content: Array<{ type: 'text'; text: string }> } {
	const wrap = (text: string) => ({ content: [{ type: 'text' as const, text }] });
	// Every tool result passes through here, so strip credentials once for all of them.
	data = withoutCredentials(data);
	const full = JSON.stringify(data) ?? 'null';
	if (full.length <= maxChars) return wrap(full);

	let fitted: string | undefined;
	if (Array.isArray(data)) {
		fitted = fitItems(
			data.length,
			(n) => JSON.stringify([...data.slice(0, n), { truncated: true, omitted_items: data.length - n, note: OMIT_NOTE }]),
			maxChars
		);
	} else if (data && typeof data === 'object') {
		const obj = data as Record<string, unknown>;
		const prop = largestArrayProp(obj);
		if (prop) {
			const arr = obj[prop] as unknown[];
			fitted = fitItems(
				arr.length,
				(n) => JSON.stringify({ ...obj, [prop]: arr.slice(0, n), truncated: true, omitted_items: arr.length - n, note: OMIT_NOTE }),
				maxChars
			);
		}
	}
	if (fitted) return wrap(fitted);
	// One indivisible giant value: still return valid JSON, with a readable preview.
	// Escaping can grow the preview, so shrink it until the whole result fits.
	const note = `Output was ${full.length} characters, over the ${maxChars} limit, and could not be cut by item. Preview of the start follows.`;
	let len = Math.max(0, maxChars - 400);
	let out = JSON.stringify({ truncated: true, note, preview: full.slice(0, len) });
	while (out.length > maxChars && len > 0) {
		len = Math.floor(len * 0.8);
		out = JSON.stringify({ truncated: true, note, preview: full.slice(0, len) });
	}
	return wrap(out);
}
