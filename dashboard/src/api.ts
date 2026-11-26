import type { DashAnnouncements, Dashboard, DashGrades } from './types';
import { demoDashboard } from './demo';
import { buildAnnouncements, buildGrades, buildMain, configureClassification } from '../../src/dashboard-build';
import { createClient, isAuthError, type DirectClient } from './direct/merlin';
import { getMerlin, type MerlinSession } from './direct/session';

export * from './direct/session';

/**
 * Direct mode (a build with VITE_MERLIN_DIRECT=1): every student signs in with their own Merlin
 * account and this browser calls Merlin itself. No server is involved beyond serving the page.
 */
export const DIRECT = import.meta.env.VITE_MERLIN_DIRECT === '1';
// A host can teach direct mode its faculty's wording at build time (same as MERLIN_EXAM_WORDS on the server).
if (DIRECT) configureClassification({ examWords: import.meta.env.VITE_MERLIN_EXAM_WORDS, seminarWords: import.meta.env.VITE_MERLIN_SEMINAR_WORDS });

const KEY = 'marlon.key'; // single-user public server (#key= link)
const LAST = 'marlon.last';

/** Why the dashboard can't load: 'key' = the server wants the #key= link; 'merlin' = sign in to Merlin (direct mode). */
export class AuthError extends Error {
	constructor(readonly kind: 'key' | 'merlin') {
		super(kind);
	}
}

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

// ---------- direct mode: build each part in this browser ----------

const PART_TTL_MS: Record<PartName, number> = { main: 5 * 60_000, announcements: 10 * 60_000, grades: 15 * 60_000 };
const BUILD = { main: buildMain, grades: buildGrades, announcements: buildAnnouncements };
let direct: { session: MerlinSession; client: DirectClient } | undefined;

function directClient(s: MerlinSession): DirectClient {
	if (direct?.session.token !== s.token || direct.session.year !== s.year) direct = { session: s, client: createClient(s.token, s.year) };
	return direct.client;
}

async function buildPartDirect<T>(part: PartName, fresh: boolean): Promise<T> {
	const s = getMerlin();
	if (!s) throw new AuthError('merlin');
	const key = `marlon.part.${part}`;
	if (!fresh) {
		try {
			const hit = JSON.parse(localStorage.getItem(key) ?? 'null') as { at: number; year: string; data: T } | null;
			if (hit && hit.year === s.year && Date.now() - hit.at < PART_TTL_MS[part]) return hit.data;
		} catch {
			/* no cache */
		}
	}
	const client = directClient(s);
	try {
		// The account call first, so a dead token is a sign-in screen, not a page of errors (memoised: no extra call).
		if (part === 'main') await client.tools('moodle_whoami');
		const data = (await BUILD[part](client.tools, s.year)) as T;
		try {
			localStorage.setItem(key, JSON.stringify({ at: Date.now(), year: s.year, data }));
		} catch {
			/* full or private: fine */
		}
		return data;
	} catch (err) {
		if (isAuthError(err)) throw new AuthError('merlin');
		if ((err as { retryAfterS?: number }).retryAfterS !== undefined) throw new Error('Merlin traži malo pauze. Probaj opet za minutu.');
		throw err;
	}
}

async function fetchPart<T>(part: PartName, fresh: boolean): Promise<T> {
	if (DIRECT) return buildPartDirect<T>(part, fresh);
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
