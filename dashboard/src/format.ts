import type { DashCourse, EventKind } from './types';

const TZ = 'Europe/Zagreb';
const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('hr-HR', { timeZone: TZ, ...o });

export const fmtTime = (s: number) => fmt({ hour: '2-digit', minute: '2-digit' }).format(s * 1000);
export const fmtDay = (s: number) => fmt({ weekday: 'short', day: 'numeric', month: 'short' }).format(s * 1000);
export const fmtDayLong = (s: number) => fmt({ weekday: 'long', day: 'numeric', month: 'long' }).format(s * 1000);
export const fmtDate = (s: number) => fmt({ day: 'numeric', month: 'long', year: 'numeric' }).format(s * 1000);
export const fmtMonth = (d: Date) => fmt({ month: 'long', year: 'numeric' }).format(d);

/** Zagreb calendar day as yyyy-mm-dd, for grouping. */
const keyFmt = fmt({ year: 'numeric', month: '2-digit', day: '2-digit' });
export function dayKey(s: number): string {
	const p = Object.fromEntries(keyFmt.formatToParts(s * 1000).map((x) => [x.type, x.value]));
	return `${p.year}-${p.month}-${p.day}`;
}

export function relative(s: number, now = Date.now() / 1000): string {
	const d = s - now;
	const abs = Math.abs(d);
	const days = Math.round(d / 86400);
	if (abs < 60) return 'upravo';
	if (abs < 3600) return d >= 0 ? `za ${Math.max(1, Math.round(abs / 60))} min` : `prije ${Math.max(1, Math.round(abs / 60))} min`;
	if (abs < 86400 && dayKey(s) === dayKey(now)) return d >= 0 ? `danas u ${fmtTime(s)}` : `danas`;
	if (days === 1) return `sutra u ${fmtTime(s)}`;
	if (days === -1) return 'jučer';
	if (d > 0) return `za ${days} ${plural(days, 'dan', 'dana', 'dana')}`;
	return `prije ${-days} ${plural(-days, 'dan', 'dana', 'dana')}`;
}

/** Croatian plurals: 1 dan, 2-4 dana, 5+ dana (with 11-14 the exception). */
export function plural(n: number, one: string, few: string, many: string): string {
	const m10 = n % 10;
	const m100 = n % 100;
	if (m10 === 1 && m100 !== 11) return one;
	if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
	return many;
}

export function countdown(s: number, now = Date.now() / 1000) {
	const d = Math.max(0, s - now);
	return { days: Math.floor(d / 86400), hours: Math.floor((d % 86400) / 3600), minutes: Math.floor((d % 3600) / 60) };
}

export function greeting(now = new Date()): string {
	const h = Number(fmt({ hour: 'numeric', hour12: false }).format(now));
	if (h < 5) return 'Laku noć';
	if (h < 12) return 'Dobro jutro';
	if (h < 18) return 'Dobar dan';
	return 'Dobra večer';
}

export const KIND_LABEL: Record<EventKind, string> = { exam: 'Ispit', seminar: 'Seminar', deadline: 'Rok', class: 'Nastava', event: 'Događaj' };

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

export const nfmt = (n: number | undefined, digits = 1) => (n === undefined ? '–' : n.toLocaleString('hr-HR', { maximumFractionDigits: digits }));

export function shortCourse(name?: string): string {
	if (!name) return '';
	return name.replace(/^\s*[A-Z0-9]{3,}\s+/, '').replace(/\s*\(.*?\)\s*$/, '');
}

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
	if (c.total?.raw !== undefined) return { value: nfmt(c.total.raw), unit: c.total.max ? ` / ${nfmt(c.total.max, 0)} bodova` : ' bodova' };
	const p = gradedSoFar(c).percent;
	return p === undefined ? { value: '–', unit: ' još nema bodova' } : { value: `${nfmt(p, 0)}%`, unit: ' od ocijenjenog' };
}
