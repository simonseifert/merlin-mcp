import type { DashCourse, EventKind } from './types';
import { locale, t, tn } from './i18n';

/** Every date the page shows is the Zagreb date, whatever time zone the browser is in. */
const TZ = 'Europe/Zagreb';
const cache = new Map<string, Intl.DateTimeFormat>();
function fmt(o: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
	const loc = locale();
	const id = loc + JSON.stringify(o);
	let f = cache.get(id);
	if (!f) cache.set(id, (f = new Intl.DateTimeFormat(loc, { timeZone: TZ, ...o })));
	return f;
}

export const fmtTime = (s: number) => fmt({ hour: '2-digit', minute: '2-digit', hour12: false }).format(s * 1000);
export const fmtDay = (s: number) => fmt({ weekday: 'short', day: 'numeric', month: 'short' }).format(s * 1000);
export const fmtDayLong = (s: number) => fmt({ weekday: 'long', day: 'numeric', month: 'long' }).format(s * 1000);
export const fmtDate = (s: number) => fmt({ day: 'numeric', month: 'long', year: 'numeric' }).format(s * 1000);
export const fmtMonth = (d: Date) => fmt({ month: 'long', year: 'numeric' }).format(d);
export const fmtDayNum = (s: number) => fmt({ day: 'numeric' }).format(s * 1000);
export const fmtMonthShort = (s: number) => fmt({ month: 'short' }).format(s * 1000);
/** Short weekday names, Monday first, in the current language (for the calendar header). */
export function weekdayNames(): string[] {
	// 5 Jan 2026 is a Monday; noon UTC is the same day in Zagreb.
	return Array.from({ length: 7 }, (_, i) => fmt({ weekday: 'short' }).format(Date.UTC(2026, 0, 5 + i, 12)));
}

/** Zagreb calendar day as yyyy-mm-dd, for grouping. Fixed locale: only the parts are used. */
const keyFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
export function dayKey(s: number): string {
	const p = Object.fromEntries(keyFmt.formatToParts(s * 1000).map((x) => [x.type, x.value]));
	return `${p.year}-${p.month}-${p.day}`;
}

export function relative(s: number, now = Date.now() / 1000): string {
	const d = s - now;
	const abs = Math.abs(d);
	const days = Math.round(d / 86400);
	if (abs < 60) return t('rel.now');
	if (abs < 3600) return t(d >= 0 ? 'rel.inMin' : 'rel.minAgo', { n: Math.max(1, Math.round(abs / 60)) });
	if (abs < 86400 && dayKey(s) === dayKey(now)) return d >= 0 ? t('rel.todayAt', { time: fmtTime(s) }) : t('rel.today');
	if (days === 1) return t('rel.tomorrowAt', { time: fmtTime(s) });
	if (days === -1) return t('rel.yesterday');
	if (d > 0) return tn('rel.inDays', days);
	return tn('rel.daysAgo', -days);
}

export function countdown(s: number, now = Date.now() / 1000) {
	const d = Math.max(0, s - now);
	return { days: Math.floor(d / 86400), hours: Math.floor((d % 86400) / 3600), minutes: Math.floor((d % 3600) / 60) };
}

export function greeting(now = new Date()): string {
	const h = Number(fmt({ hour: 'numeric', hour12: false }).format(now)) % 24;
	if (h < 5) return t('greet.night');
	if (h < 12) return t('greet.morning');
	if (h < 18) return t('greet.day');
	return t('greet.evening');
}

export const kindLabel = (k: EventKind): string => t(`kind.${k}`);

/** Hand-picked, Apple-ish system hues. */
const PALETTE = ['#0a84ff', '#bf5af2', '#ff375f', '#ff9f0a', '#30d158', '#64d2ff', '#5e5ce6', '#ff6482', '#ffd60a', '#66d4cf'];
function hash(s: string): number {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
	return h >>> 0;
}
export function courseColor(name: string | undefined, all?: string[]): string {
	if (!name) return '#8e8e93';
	const idx = all ? all.indexOf(name) : -1;
	return PALETTE[(idx >= 0 ? idx : hash(name)) % PALETTE.length];
}

export function coursePercent(c: DashCourse): number | undefined {
	const t = c.total;
	if (t?.percent !== undefined) return t.percent;
	if (t?.raw !== undefined && t.max) return (t.raw / t.max) * 100;
	// Merlin hides the course total on many courses ("-"): fall back to what has been graded so far.
	return gradedSoFar(c).percent;
}

export const nfmt = (n: number | undefined, digits = 1) => (n === undefined ? '–' : n.toLocaleString(locale(), { maximumFractionDigits: digits }));

/**
 * Course name without its leading code. Only code-like tokens are stripped: 4+ characters of A-Z, 0-9 and
 * hyphens that contain a digit. Words, short tokens and "(M1)" style suffixes stay, so two groups of the
 * same course never read the same. A trailing academic year in brackets is dropped.
 *
 *   "IT101 Baze podataka"       -> "Baze podataka"
 *   "2627-ACC Računovodstvo"    -> "Računovodstvo"
 *   "SQL baze podataka"         -> "SQL baze podataka"
 *   "HTML i CSS"                -> "HTML i CSS"
 *   "3D modeliranje"            -> "3D modeliranje"
 *   "MAT1 Matematika (M1)"      -> "Matematika (M1)"
 *   "Marketing (2026/2027)"     -> "Marketing"
 */
export function shortCourse(name?: string): string {
	if (!name) return '';
	const short = name
		.replace(/^\s*(?:(?=[A-Z0-9-]*\d)[A-Z0-9][A-Z0-9-]{3,}\s+)+(?=\S)/, '')
		.replace(/\s*\(\s*\d{4}\s*[/-]\s*\d{2,4}\s*\)\s*$/, '')
		.trim();
	return short || name.trim();
}

/** Plain http(s) addresses only: Merlin content is untrusted, so no javascript: or data: links. */
export function safeUrl(url?: string): string | undefined {
	if (!url) return undefined;
	try {
		const u = new URL(url);
		return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : undefined;
	} catch {
		return undefined;
	}
}

const PART_IDS = { whoami: 1, courses: 1, calendar: 1, deadlines: 1, assignments: 1, grades: 1, announcements: 1, main: 1 };
type PartId = keyof typeof PART_IDS;

/** "grades 2026-2027" -> "bodovi" (or "points"): error part ids in human words, each named once. */
export function partWords(parts: Array<{ part: string }>): string {
	const words = parts.map((p) => {
		const id = p.part.split(/[\s:]/)[0];
		return id in PART_IDS ? t(`part.${id as PartId}`) : id;
	});
	return [...new Set(words)].join(', ');
}

/** True when the grades could not be loaded (any error part starting with "grades"). */
export const gradesFailed = (errors?: Array<{ part: string }>): boolean => !!errors?.some((e) => e.part.startsWith('grades'));

/** What has been graded so far: points earned out of points available. */
export function gradedSoFar(c: DashCourse) {
	const items = c.items.filter((i) => i.raw !== undefined && i.max);
	const raw = items.reduce((s, i) => s + (i.raw ?? 0), 0);
	const max = items.reduce((s, i) => s + (i.max ?? 0), 0);
	if (max) return { raw, max, percent: (raw / max) * 100, count: items.length };
	// No ranges from Merlin: fall back to the mean of the per-item percentages.
	const pct = c.items.map((i) => i.percent).filter((p): p is number => p !== undefined);
	return { raw, max, percent: pct.length ? pct.reduce((a, b) => a + b, 0) / pct.length : undefined, count: pct.length };
}

/** Headline for a course: total points when Merlin shows them, else the graded-so-far percentage. */
export function courseHeadline(c: DashCourse): { value: string; unit: string } {
	if (c.total?.raw !== undefined) return { value: nfmt(c.total.raw), unit: c.total.max ? t('head.ofMax', { max: nfmt(c.total.max, 0) }) : t('head.points') };
	const p = gradedSoFar(c).percent;
	return p === undefined ? { value: '–', unit: t('head.none') } : { value: `${nfmt(p, 0)}%`, unit: t('head.graded') };
}
