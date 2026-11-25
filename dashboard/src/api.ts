import type { Dashboard } from './types';
import { demoDashboard } from './demo';

const KEY = 'marlon.key'; // single-user public server (#key= link)
const LAST = 'marlon.last';
const MERLIN = 'marlon.merlin'; // multi-user: the visitor's own Merlin token + year

/** Why the dashboard can't load: 'merlin' = sign in with a Merlin token; 'key' = needs the #key= link. */
export type AuthKind = 'merlin' | 'key';
export class AuthError extends Error {
	constructor(readonly kind: AuthKind) {
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

// ---------- multi-user Merlin token ----------

export interface MerlinSession {
	token: string;
	year: string;
	fullname?: string;
}
let memMerlin: MerlinSession | undefined;
export function getMerlin(): MerlinSession | undefined {
	try {
		const raw = localStorage.getItem(MERLIN);
		return raw ? (JSON.parse(raw) as MerlinSession) : memMerlin;
	} catch {
		return memMerlin;
	}
}
export function setMerlin(s: MerlinSession): void {
	memMerlin = s;
	try {
		localStorage.setItem(MERLIN, JSON.stringify(s));
	} catch {
		/* private mode: session lives for this page */
	}
}
export function signOut(): void {
	memMerlin = undefined;
	try {
		localStorage.removeItem(MERLIN);
		localStorage.removeItem(LAST);
	} catch {
		/* ignore */
	}
}

/** 32-hex token, or a `...token=BASE64(sig:::token)` address the launch flow redirects to. */
export function extractToken(input: string): string | null {
	const t = input.trim();
	if (/^[0-9a-f]{32}$/i.test(t)) return t.toLowerCase();
	const m = /token=([^&\s]+)/.exec(t);
	if (m) {
		const raw = decodeURIComponent(m[1]).trim();
		if (/^[0-9a-f]{32}$/i.test(raw)) return raw.toLowerCase(); // token=<hex>
		try {
			const parts = atob(raw).split(':::'); // token=base64(sig:::token[:::private])
			const tok = (parts[1] ?? parts[0] ?? '').trim();
			if (/^[0-9a-f]{32}$/i.test(tok)) return tok.toLowerCase();
		} catch {
			/* not base64 */
		}
	}
	// last resort: any 32-hex run anywhere in the pasted text
	const any = /[0-9a-f]{32}/i.exec(t);
	return any ? any[0].toLowerCase() : null;
}

// Auto-return (desktop): we register a handler for a `web+…` scheme, tell Moodle to redirect the token
// to it, and the browser bounces it back to our own page — no copy. iOS/Safari ignore this and fall
// back to the copy flow; both carry the token the same way, so extractToken handles either.
const PROTO = 'web+marlon';
const PENDING_YEAR = 'marlon.pendingYear';

/** Offer to handle our `web+marlon://` links so the token comes straight back here. One-time browser prompt. */
export function registerAuthHandler(): void {
	try {
		navigator.registerProtocolHandler(PROTO, `${location.origin}${import.meta.env.BASE_URL}#tok=%s`);
	} catch {
		/* unsupported (Safari/iOS) or blocked: the copy flow still works */
	}
}

/** The official SRCE/AAI app sign-in link for one year. The user signs in there; we never see the password. */
export function launchUrl(year: string, autoReturn = false): string {
	const passport = (Math.random().toString(36) + Math.random().toString(36)).replace(/[^a-z0-9]/g, '').slice(0, 16);
	try {
		localStorage.setItem(PENDING_YEAR, year);
	} catch {
		/* ignore */
	}
	const scheme = autoReturn ? PROTO : 'merlin-token';
	// encodeURIComponent is essential: a literal "+" in a query string decodes to a space, so
	// urlscheme=web+marlon would reach Moodle as "web marlon" and be rejected. Send it as web%2Bmarlon.
	return `https://moodle.srce.hr/${year}/admin/tool/mobile/launch.php?service=moodle_mobile_app&passport=${passport}&urlscheme=${encodeURIComponent(scheme)}`;
}

export function pendingYear(): string | undefined {
	try {
		return localStorage.getItem(PENDING_YEAR) ?? undefined;
	} catch {
		return undefined;
	}
}

/** If the browser returned a token to us via the handler (#tok=…), pull it out and wipe it from the URL. */
export function tokenFromHash(): string | null {
	const m = /[#&]tok=([^&]+)/.exec(location.hash);
	if (!m) return null;
	history.replaceState(null, '', location.pathname + location.search);
	try {
		return extractToken(decodeURIComponent(m[1]));
	} catch {
		return null;
	}
}

/** True when the pasted text is a Merlin sign-in link, not the token address we need. */
export function currentAcademicYear(now = new Date()): string {
	const y = now.getFullYear();
	const start = now.getMonth() >= 9 ? y : y - 1;
	return `${start}-${start + 1}`;
}

export const isLaunchLink = (t: string): boolean => /launch\.php|\/login\//i.test(t) && !/token=/.test(t);

/** Validate a token against Merlin. Returns the account name, or throws with a message to show. */
export async function signIn(token: string, year: string): Promise<MerlinSession> {
	const res = await fetch(`/api/merlin-login?year=${year}`, { headers: { 'X-Merlin-Token': token }, cache: 'no-store' });
	const body = (await res.json().catch(() => ({}))) as { fullname?: string; error?: string };
	if (!res.ok) throw new Error(body.error ?? `Prijava nije uspjela (${res.status}).`);
	const s: MerlinSession = { token, year, fullname: body.fullname };
	setMerlin(s);
	return s;
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

export async function fetchDashboard(fresh = false): Promise<Dashboard> {
	if (isDemo()) {
		await new Promise((r) => setTimeout(r, 400));
		return demoDashboard();
	}
	const merlin = getMerlin();
	const key = getKey();
	const headers: Record<string, string> = {};
	let qs = fresh ? '?fresh=1' : '';
	if (merlin) {
		headers['X-Merlin-Token'] = merlin.token;
		qs = `?year=${merlin.year}${fresh ? '&fresh=1' : ''}`;
	} else if (key) {
		headers.Authorization = `Bearer ${key}`;
	}
	const res = await fetch(`/api/dashboard${qs}`, { headers, cache: 'no-store' });
	if (res.status === 401) {
		// Multi-user servers answer 401 with {login:true}; a single-user public one answers plain text.
		const body = await res.clone().json().catch(() => null) as { login?: boolean } | null;
		throw new AuthError(body?.login || merlin ? 'merlin' : 'key');
	}
	if (res.status === 429) throw new Error('Merlin traži malo pauze. Probaj opet za minutu.');
	if (!res.ok) throw new Error(`Server je vratio ${res.status}`);
	const data = (await res.json()) as Dashboard;
	try {
		localStorage.setItem(LAST, JSON.stringify(data));
	} catch {
		/* full or private: fine */
	}
	return data;
}
