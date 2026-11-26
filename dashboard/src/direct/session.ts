/**
 * Direct mode's sign-in: the student's own Merlin token, from SRCE's official app sign-in
 * (launch.php, the same flow as scripts/get-token.mjs), kept only in this browser's local
 * storage. The password is only ever typed on SRCE's own page. Sign-in, token parsing and the
 * web+marlon return handler are Leon's, from the first version of the dashboard.
 */

import { md5 } from './md5';
import { createClient, isAuthError, MerlinError, MERLIN_ORIGIN } from './merlin';
import { t } from '../i18n';

const MERLIN = 'marlon.merlin';
const LAST = 'marlon.last';

/** The active year's session: what every call uses. */
export interface MerlinSession {
	token: string;
	year: string;
	fullname?: string;
}

/**
 * Each academic year is a separate Moodle site with its own token, so a student can be signed in to
 * several at once. Stored as `{ sessions: { [year]: { token, fullname } }, active: year }`.
 */
interface Stored {
	sessions: Record<string, { token: string; fullname?: string }>;
	active?: string;
}

let mem: Stored | undefined;

/** Reads the stored shape, and migrates the old single `{ token, year, fullname }` one. */
function normalise(v: unknown): Stored {
	const o = (v ?? {}) as { sessions?: Record<string, { token?: unknown; fullname?: unknown }>; active?: unknown; token?: unknown; year?: unknown; fullname?: unknown };
	const sessions: Stored['sessions'] = {};
	if (o.sessions && typeof o.sessions === 'object') {
		for (const [year, s] of Object.entries(o.sessions)) {
			if (s && typeof s.token === 'string') sessions[year] = { token: s.token, fullname: typeof s.fullname === 'string' ? s.fullname : undefined };
		}
	} else if (typeof o.token === 'string' && typeof o.year === 'string') {
		sessions[o.year] = { token: o.token, fullname: typeof o.fullname === 'string' ? o.fullname : undefined };
	}
	const years = Object.keys(sessions);
	const active = typeof o.active === 'string' && sessions[o.active] ? o.active : typeof o.year === 'string' && sessions[o.year] ? o.year : years.sort().reverse()[0];
	return { sessions, active };
}

function read(): Stored {
	try {
		const raw = localStorage.getItem(MERLIN);
		if (raw) return normalise(JSON.parse(raw));
	} catch {
		/* unreadable: fall through to memory */
	}
	return mem ?? { sessions: {} };
}

function write(s: Stored): void {
	mem = s;
	try {
		localStorage.setItem(MERLIN, JSON.stringify(s));
	} catch {
		/* private mode: the sessions live for this page */
	}
}

/** The active year's session, if signed in. */
export function getMerlin(): MerlinSession | undefined {
	const st = read();
	const s = st.active ? st.sessions[st.active] : undefined;
	return st.active && s ? { token: s.token, year: st.active, fullname: s.fullname } : undefined;
}

/** Every signed-in year, newest first. */
export function getSessions(): MerlinSession[] {
	const st = read();
	return Object.keys(st.sessions)
		.sort()
		.reverse()
		.map((year) => ({ token: st.sessions[year].token, year, fullname: st.sessions[year].fullname }));
}

/** Make an already signed-in year the active one. */
export function setActiveYear(year: string): void {
	const st = read();
	if (st.sessions[year]) write({ ...st, active: year });
}

/** Save a session for its year and make it active. A different account must never see the previous one's saved pages or tokens. */
export function setMerlin(s: MerlinSession): void {
	const st = read();
	const prevSameYear = st.sessions[s.year];
	const otherAccount =
		Object.values(st.sessions).some((v) => v.fullname && s.fullname && v.fullname !== s.fullname) ||
		(!!prevSameYear && prevSameYear.token !== s.token && !(prevSameYear.fullname && prevSameYear.fullname === s.fullname));
	if (otherAccount) clearSaved();
	write({ sessions: { ...(otherAccount ? {} : st.sessions), [s.year]: { token: s.token, fullname: s.fullname } }, active: s.year });
}

/** Forget every saved page and part in this browser. */
function clearSaved(): void {
	try {
		for (const k of Object.keys(localStorage)) if (k === LAST || k.startsWith(`${LAST}.`) || k.startsWith('marlon.part.')) localStorage.removeItem(k);
	} catch {
		/* ignore */
	}
}

/** Sign out of every year: tokens and saved pages are removed from this browser. */
export function signOut(): void {
	mem = undefined;
	try {
		localStorage.removeItem(MERLIN);
	} catch {
		/* ignore */
	}
	clearSaved();
}

/** Academic years to offer: the current one (rolls over 1 Oct) and the two before it. */
export function yearOptions(now = new Date()): string[] {
	const y = now.getFullYear();
	const start = now.getMonth() >= 9 ? y : y - 1;
	return [start, start - 1, start - 2].map((s) => `${s}-${s + 1}`);
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
// to it, and the browser bounces it back to our own page : no copy. iOS/Safari ignore this and fall
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
		localStorage.setItem(PENDING_YEAR, JSON.stringify({ year, at: Date.now(), passport }));
	} catch {
		/* ignore */
	}
	const scheme = autoReturn ? PROTO : 'merlin-token';
	// encodeURIComponent is essential: a literal "+" in a query string decodes to a space, so
	// urlscheme=web+marlon would reach Moodle as "web marlon" and be rejected. Send it as web%2Bmarlon.
	return `${MERLIN_ORIGIN}/${year}/admin/tool/mobile/launch.php?service=moodle_mobile_app&passport=${passport}&urlscheme=${encodeURIComponent(scheme)}`;
}

const PENDING_MAX_MS = 15 * 60_000;

/** The sign-in this browser started (year), if it is recent; read once, then forgotten. */
function takePending(): { year: string; passport: string } | undefined {
	try {
		const raw = localStorage.getItem(PENDING_YEAR);
		localStorage.removeItem(PENDING_YEAR);
		const p = raw ? (JSON.parse(raw) as { year?: string; at?: number; passport?: string }) : undefined;
		return p?.year && p.passport && typeof p.at === 'number' && Date.now() - p.at < PENDING_MAX_MS ? { year: p.year, passport: p.passport } : undefined;
	} catch {
		return undefined;
	}
}

/**
 * launch.php answers token=base64(md5(site url + passport):::token[:::private token]). Returns the token
 * only when the signature matches the sign-in this browser started (same check as scripts/get-token.mjs),
 * so an answer from anyone else's sign-in is refused.
 */
export function verifyLaunchAnswer(answer: string, year: string, passport: string, origin = MERLIN_ORIGIN): string | null {
	const m = /(?:^|[^a-z0-9_])token=([^&\s]+)/i.exec(answer.trim());
	if (!m || !passport) return null;
	try {
		const [sig, tok] = atob(decodeURIComponent(m[1]).trim()).split(':::');
		const token = (tok ?? '').trim().toLowerCase();
		if (!/^[0-9a-f]{32}$/.test(token)) return null;
		return sig === md5(`${origin}/${year}${passport}`) ? token : null;
	} catch {
		return null;
	}
}

/**
 * If the browser returned a token to us via the handler (#tok=…), pull it out and wipe it from the URL.
 * Only accepted for the sign-in this browser started in the last 15 minutes, once, and only when Merlin's
 * signature matches that sign-in: a link carrying someone else's token is refused.
 */
export function tokenFromHash(): { token: string; year: string } | null {
	const m = /[#&]tok=([^&]+)/.exec(location.hash);
	if (!m) return null;
	history.replaceState(null, '', location.pathname + location.search);
	const pending = takePending();
	if (!pending) return null;
	try {
		const token = verifyLaunchAnswer(decodeURIComponent(m[1]), pending.year, pending.passport);
		return token ? { token, year: pending.year } : null;
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
		if (isAuthError(err)) throw new Error(t('li.errRejected'));
		if ((err as MerlinError).retryAfterS !== undefined) throw new Error(t('li.errPause'));
		throw err instanceof Error ? err : new Error(t('err.login'));
	}
}
