import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { currentYear, decodeAnswer, launchUrl, writeEnv } from '../scripts/get-token.mjs';

const SITE = 'https://moodle.srce.hr/2026-2027';
const TOKEN = 'a'.repeat(32);

function answer(site: string, passport: string, extra = ':::privatesecret') {
	const sig = createHash('md5').update(site + passport).digest('hex');
	return 'merlin-token://token=' + Buffer.from(`${sig}:::${TOKEN}${extra}`).toString('base64');
}

describe('scripts/get-token.mjs', () => {
	it('builds the official mobile launch link for the year', () => {
		expect(launchUrl(SITE, 'p1')).toBe(`${SITE}/admin/tool/mobile/launch.php?service=moodle_mobile_app&passport=p1&urlscheme=merlin-token`);
	});

	it('decodes the answer, checks the signature and drops the private token', () => {
		const r = decodeAnswer(answer(SITE, 'p1'), SITE, 'p1');
		expect(r).toEqual({ token: TOKEN, signatureOk: true });
		expect(JSON.stringify(r)).not.toContain('privatesecret');
	});

	it('flags an answer from another link or year', () => {
		expect(decodeAnswer(answer(SITE, 'other'), SITE, 'p1').signatureOk).toBe(false);
		expect(decodeAnswer(answer('https://moodle.srce.hr/2025-2026', 'p1'), SITE, 'p1').signatureOk).toBe(false);
	});

	it('refuses text without a token', () => {
		expect(() => decodeAnswer('merlin-token://token=bm90aGluZw==', SITE, 'p1')).toThrow(/No token/);
	});

	it('writes MOODLE_TOKEN into an env file readable only by the owner, keeping other lines', () => {
		const f = path.join(mkdtempSync(path.join(os.tmpdir(), 'gt-')), 'merlin.env');
		writeFileSync(f, 'MCP_BEARER=x\nMOODLE_TOKEN=old\n');
		writeEnv(f, 'MOODLE_TOKEN', TOKEN);
		expect(readFileSync(f, 'utf8')).toBe(`MCP_BEARER=x\nMOODLE_TOKEN=${TOKEN}\n`);
		expect(statSync(f).mode & 0o777).toBe(0o600);
	});

	it('rolls the academic year over on 1 October', () => {
		expect(currentYear(new Date('2026-09-30T12:00:00Z'))).toBe('2025-2026');
		expect(currentYear(new Date('2026-10-01T12:00:00Z'))).toBe('2026-2027');
	});
});
