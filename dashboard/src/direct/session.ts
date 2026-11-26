/**
 * Direct mode's sign-in: the student's own Merlin token, from SRCE's official app sign-in
 * (launch.php, the same flow as scripts/get-token.mjs), kept only in this browser's local
 * storage. The password is only ever typed on SRCE's own page. Sign-in, token parsing and the
 * web+marlon return handler are Leon's, from the first version of the dashboard.
 */

import { createClient, isAuthError, MerlinError } from './merlin';

const MERLIN = 'marlon.merlin';
const LAST = 'marlon.last';

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
	// A different account (or year) must never see the previous one's saved page.
	const prev = getMerlin();
	if (prev?.token !== s.token || prev?.year !== s.year) clearSaved();
	memMerlin = s;
	try {
		localStorage.setItem(MERLIN, JSON.stringify(s));
	} catch {
		/* private mode: session lives for this page */
	}
}
/** Forget every saved page and part in this browser. */
function clearSaved(): void {
	try {
		localStorage.removeItem(LAST);
		for (const k of Object.keys(localStorage)) if (k.startsWith('marlon.part.')) localStorage.removeItem(k);
	} catch {
		/* ignore */
	}
}

export function signOut(): void {
	memMerlin = undefined;
	try {
		localStorage.removeItem(MERLIN);
		clearSaved();
	} catch {
		/* ignore */
	}
}

/**
 * A token from what the student pasted: either the whole input is a bare 32-hex token, or it holds an
 * explicit token address (`...token=BASE64(sig:::token)` or `...token=<hex>`, as the launch flow
 * redirects to). Nothing else is accepted: no hunting for a 32-hex run in arbitrary text, which would
 * send unrelated clipboard contents to Merlin.
 */
export function extractToken(input: string): string | null {
	const t = input.trim();
	if (/^[0-9a-f]{32}$/i.test(t)) return t.toLowerCase();
	const m = /(?:^|[^a-z0-9_])token=([^&\s]+)/i.exec(t);
	if (!m) return null;
	let raw: string;
	try {
		raw = decodeURIComponent(m[1]).trim();
	} catch {
		return null;
	}
	if (/^[0-9a-f]{32}$/i.test(raw)) return raw.toLowerCase(); // token=<hex>
	try {
		const parts = atob(raw).split(':::'); // token=base64(sig:::token[:::private])
		const tok = (parts[1] ?? parts[0] ?? '').trim();
		if (/^[0-9a-f]{32}$/i.test(tok)) return tok.toLowerCase();
	} catch {
		/* not base64 */
	}
	return null;
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
	const passport = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20);
	try {
		// Remembered so a token coming back in the address bar is accepted only after a sign-in this browser started.
		localStorage.setItem(PENDING_YEAR, JSON.stringify({ year, at: Date.now() }));
	} catch {
		/* ignore */
	}
	const scheme = autoReturn ? PROTO : 'merlin-token';
	// encodeURIComponent is essential: a literal "+" in a query string decodes to a space, so
	// urlscheme=web+marlon would reach Moodle as "web marlon" and be rejected. Send it as web%2Bmarlon.
	return `https://moodle.srce.hr/${year}/admin/tool/mobile/launch.php?service=moodle_mobile_app&passport=${passport}&urlscheme=${encodeURIComponent(scheme)}`;
}

const PENDING_MAX_MS = 15 * 60_000;

/** The sign-in this browser started (year), if it is recent; read once, then forgotten. */
function takePending(): string | undefined {
	try {
		const raw = localStorage.getItem(PENDING_YEAR);
		localStorage.removeItem(PENDING_YEAR);
		const p = raw ? (JSON.parse(raw) as { year?: string; at?: number }) : undefined;
		return p?.year && typeof p.at === 'number' && Date.now() - p.at < PENDING_MAX_MS ? p.year : undefined;
	} catch {
		return undefined;
	}
}

/**
 * If the browser returned a token to us via the handler (#tok=…), pull it out and wipe it from the URL.
 * Only accepted when this browser started a sign-in in the last 15 minutes, and only once: otherwise a
 * link carrying someone else's token could sign a student in as that account without them noticing.
 */
export function tokenFromHash(): { token: string; year: string } | null {
	const m = /[#&]tok=([^&]+)/.exec(location.hash);
	if (!m) return null;
	history.replaceState(null, '', location.pathname + location.search);
	const year = takePending();
	if (!year) return null;
	try {
		const token = extractToken(decodeURIComponent(m[1]));
		return token ? { token, year } : null;
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

/** Validate a token straight against Merlin (one site_info call from this browser). Returns the session, or throws a message to show. */
export async function signIn(token: string, year: string): Promise<MerlinSession> {
	try {
		const info = await createClient(token, year).call<{ fullname?: string }>('core_webservice_get_site_info');
		if (!info?.fullname) throw new MerlinError('Merlin rejected this token.', 'invalidtoken');
		const s: MerlinSession = { token, year, fullname: info.fullname };
		setMerlin(s);
		return s;
	} catch (err) {
		if (isAuthError(err)) throw new Error('Token nije prihvaćen. Provjeri da je za točnu godinu i da nije istekao.');
		if ((err as MerlinError).retryAfterS !== undefined) throw new Error('Merlin je zatražio pauzu. Pokušaj za koju minutu.');
		throw err instanceof Error ? err : new Error('Prijava nije uspjela.');
	}
}
