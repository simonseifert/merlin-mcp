/** Checking Moodle's sign-in answer. No React or browser imports, so the root tests can load it. */

import { md5 } from './md5';
import { MERLIN_ORIGIN } from './merlin';

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
