import type { DashAnnouncements, Dashboard, DashGrades } from './types';
import { demoDashboard } from './demo';

const KEY = 'marlon.key'; // single-user public server (#key= link)
const LAST = 'marlon.last';

/** The server wants the #key= link (a public server opened without it, or the key was rotated). */
export class AuthError extends Error {}

export const isDemo = () => new URLSearchParams(location.search).has('demo');

// ---------- single-user key (#key=...) ----------

let memoryKey: string | undefined;
/** Picks the key up from a `#key=...` link once, keeps it in this browser, and wipes it from the address bar. */
export function captureKey(): void {
	const m = /^#key=([^&]+)/.exec(location.hash);
	if (!m) return;
	const v = decodeURIComponent(m[1]);
	try {
		localStorage.setItem(KEY, v);
	} catch {
		memoryKey = v;
	}
	history.replaceState(null, '', location.pathname + location.search);
}
export function getKey(): string | undefined {
	try {
		return localStorage.getItem(KEY) ?? memoryKey;
	} catch {
		return memoryKey;
	}
}

// ---------- the dashboard ----------

export function lastDashboard(): Dashboard | undefined {
	if (isDemo()) return demoDashboard();
	try {
		const raw = localStorage.getItem(LAST);
		return raw ? (JSON.parse(raw) as Dashboard) : undefined;
	} catch {
		return undefined;
	}
}

type Parts = { main?: Dashboard; grades?: DashGrades; announcements?: DashAnnouncements };
type PartName = keyof Parts;

async function fetchPart<T>(part: PartName, fresh: boolean): Promise<T> {
	const key = getKey();
	const res = await fetch(`/api/dashboard?part=${part}${fresh ? '&fresh=1' : ''}`, { headers: key ? { Authorization: `Bearer ${key}` } : {}, cache: 'no-store' });
	if (res.status === 401) throw new AuthError('key');
	if (res.status === 429) throw new Error('Merlin traži malo pauze. Probaj opet za minutu.');
	if (!res.ok) throw new Error(`Server je vratio ${res.status}`);
	return (await res.json()) as T;
}

/**
 * Fold the parts that have arrived into one Dashboard. A part that hasn't arrived (or failed) keeps
 * what the last saved copy had, so points and announcements never blink out while they reload.
 */
export function mergeParts(p: Parts, prev?: Dashboard, failed: Array<{ part: string; error: string }> = []): Dashboard | undefined {
	const base = p.main ?? prev;
	if (!base) return undefined;
	const old = new Map((prev?.courses ?? []).map((c) => [c.key, c]));
	const fresh = new Map((p.grades?.courses ?? []).map((c) => [c.key, c]));
	const courses = base.courses.map((c) => {
		const g = p.grades ? fresh.get(c.key) : old.get(c.key);
		return g ? { ...c, total: g.total, items: g.items ?? [], error: g.error } : c;
	});
	const errors = [...(p.main?.errors ?? []), ...(p.grades?.errors ?? []), ...(p.announcements?.errors ?? []), ...failed];
	return {
		...base,
		courses,
		announcements: p.announcements?.announcements ?? prev?.announcements ?? [],
		errors: errors.length ? errors : undefined,
	};
}

/**
 * Load the dashboard in three parallel requests (each with its own Merlin call budget on the server):
 * main (account, calendar, exams, seminars), grades and announcements. `onUpdate` gets the merged
 * page each time a part lands, so the calendar shows before the points. Throws only when main fails.
 */
export async function fetchDashboard(fresh = false, onUpdate: (d: Dashboard) => void = () => {}): Promise<Dashboard> {
	if (isDemo()) {
		await new Promise((r) => setTimeout(r, 400));
		const d = demoDashboard();
		onUpdate(d);
		return d;
	}
	const prev = lastDashboard();
	const parts: Parts = {};
	const failed: Array<{ part: string; error: string }> = [];
	let current: Dashboard | undefined;
	const emit = () => {
		// Until main lands, side parts only update the saved copy's points or announcements.
		const merged = mergeParts(parts, prev, failed);
		if (!merged || (!parts.main && !prev)) return;
		current = merged;
		onUpdate(merged);
	};
	const side = (['grades', 'announcements'] as const).map((name) =>
		fetchPart<any>(name, fresh)
			.then((d) => {
				parts[name] = d;
			})
			.catch((err) => {
				failed.push({ part: name, error: err instanceof Error ? err.message : String(err) });
			})
			.finally(emit)
	);
	parts.main = await fetchPart<Dashboard>('main', fresh);
	emit();
	await Promise.all(side);
	const done = current ?? mergeParts(parts, prev, failed)!;
	try {
		localStorage.setItem(LAST, JSON.stringify(done));
	} catch {
		/* full or private: fine */
	}
	return done;
}
