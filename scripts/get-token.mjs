#!/usr/bin/env node
// Get your own Merlin web-service token. Merlin signs you in through AAI@EduHr, so
// Moodle never sees a password and login/token.php can't work. This uses the same
// mobile sign-in the official app uses (admin/tool/mobile/launch.php): you log in
// yourself in your browser; this script only builds the link and reads the answer.
//
//   node scripts/get-token.mjs link [--year 2026-2027]
//     Prints a link. Open it in a browser and sign in. The last redirect goes to
//     merlin-token://token=... which the browser can't open: copy that whole address
//     (address bar, or DevTools > Network > launch.php > the Location header).
//
//   node scripts/get-token.mjs save 'merlin-token://token=...' [--year 2026-2027] [--out merlin.env]
//     Checks the answer belongs to this link and site, then writes MOODLE_TOKEN into
//     the env file (mode 600). The token is not printed. Add --print to see it.
//
// Your token is a password: never paste it into chats, issues or shared files.
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BASE = 'https://moodle.srce.hr';
const SCHEME = 'merlin-token';

/** The academic year that is current on a date (rolls over on 1 October). */
export function currentYear(d = new Date()) {
	const y = d.getUTCFullYear();
	return d.getUTCMonth() >= 9 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

export function launchUrl(site, passport) {
	return `${site}/admin/tool/mobile/launch.php?service=moodle_mobile_app&passport=${passport}&urlscheme=${SCHEME}`;
}

/**
 * Reads what launch.php handed back: <scheme>://token=base64(md5(site + passport):::token[:::privatetoken]).
 * Returns the token and whether the signature matches this site and passport. The private token is dropped.
 */
export function decodeAnswer(answer, site, passport) {
	const b64 = decodeURIComponent(String(answer).replace(/^.*token=/, '')).trim();
	const [signature, token] = Buffer.from(b64, 'base64').toString('utf8').split(':::');
	if (!/^[0-9a-f]{32}$/.test(token ?? '')) throw new Error('No token found in that text. Copy the whole merlin-token://token=... address.');
	const expected = createHash('md5').update(site + (passport ?? '')).digest('hex');
	return { token, signatureOk: Boolean(passport) && signature === expected };
}

/** Sets KEY=value in an env file (creating it), keeping other lines, and makes it readable by you only. */
export function writeEnv(file, key, value) {
	const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter((l) => !l.startsWith(`${key}=`)) : [];
	while (lines.length && lines[lines.length - 1] === '') lines.pop();
	lines.push(`${key}=${value}`);
	writeFileSync(file, lines.join('\n') + '\n', { mode: 0o600 });
	chmodSync(file, 0o600);
}

function arg(args, name, fallback) {
	const i = args.indexOf(name);
	return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

function main(argv) {
	const [cmd, ...rest] = argv;
	const year = arg(rest, '--year', currentYear());
	if (!/^\d{4}-\d{4}$/.test(year)) throw new Error('--year looks like 2026-2027');
	const site = `${BASE}/${year}`;
	const stash = path.join(os.tmpdir(), `merlin-token-passport-${year}`);

	if (cmd === 'link') {
		const passport = randomBytes(8).toString('hex');
		writeFileSync(stash, passport, { mode: 0o600 });
		console.log(`Open this in your browser and sign in to Merlin ${year}:\n\n${launchUrl(site, passport)}\n`);
		console.log(`At the end the browser shows an error for a ${SCHEME}:// address. Copy that whole address, then run:`);
		console.log(`  node scripts/get-token.mjs save '<the ${SCHEME}://token=... address>' --year ${year}`);
		return;
	}
	if (cmd === 'save' && rest[0] && !rest[0].startsWith('--')) {
		let passport = '';
		try {
			passport = readFileSync(stash, 'utf8').trim();
		} catch {}
		const { token, signatureOk } = decodeAnswer(rest[0], site, passport);
		if (!signatureOk) console.error('Warning: this answer does not match the last link for this year (other year, or an old link). The token may still work; check with moodle_whoami.');
		const out = arg(rest, '--out', 'merlin.env');
		writeEnv(out, 'MOODLE_TOKEN', token);
		console.log(`Saved MOODLE_TOKEN to ${out} (only you can read it). ${rest.includes('--print') ? token : ''}`.trim());
		console.log('Next: start the server and call moodle_whoami to check it works for every year you need.');
		return;
	}
	console.error("usage: get-token.mjs link [--year YYYY-YYYY] | get-token.mjs save '<merlin-token://token=...>' [--year YYYY-YYYY] [--out merlin.env] [--print]");
	process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
	try {
		main(process.argv.slice(2));
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		process.exit(1);
	}
}
