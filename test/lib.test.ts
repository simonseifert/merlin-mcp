import { describe, expect, it } from 'vitest';
import {
	academicYearStart,
	activeYearCandidates,
	activeYears,
	allTokens,
	currentYear,
	dedupeAcrossYears,
	fanOut,
	isValidYear,
	mapLimit,
	parseYearList,
	sortByNumber,
	tokenForYear,
	clamp,
	constantTimeEqual,
	isRedirectResponse,
	isSafeWsFunction,
	moodleUrl,
	moodleUserAgent,
	withoutCredentials,
	parseAllowedMoodleFileUrl,
	redactSecret,
	API_CALL_ALLOWLIST,
	isAllowedApiFunction,
	stripHtml,
	toToolResult,
	truncate,
	zagrebTime,
} from '../src/lib.js';

describe('academicYearStart / moodleUrl (year rollover)', () => {
	it('stays in the previous academic year deep into September (UTC)', () => {
		expect(academicYearStart(new Date('2026-09-15T12:00:00Z'))).toBe(2025);
	});

	it('rolls over on 1 October in plain UTC-safe cases', () => {
		expect(academicYearStart(new Date('2026-10-02T12:00:00Z'))).toBe(2026);
	});

	it('rolls over at Zagreb-local midnight, not UTC midnight (CEST is UTC+2 on 1 Oct)', () => {
		// 30 Sept 23:59 UTC == 1 Oct 01:59 CEST in Zagreb -> already the new year.
		const stillLastYearUTC = new Date('2026-09-30T21:59:00Z'); // 23:59 CEST, still 30 Sept in Zagreb
		const alreadyNewYearZagreb = new Date('2026-09-30T22:01:00Z'); // 00:01 CEST 1 Oct in Zagreb
		expect(academicYearStart(stillLastYearUTC)).toBe(2025);
		expect(academicYearStart(alreadyNewYearZagreb)).toBe(2026);
	});

	it('moodleUrl derives the URL from the date when nothing is overridden', () => {
		expect(moodleUrl({}, new Date('2026-10-15T12:00:00Z'))).toBe('https://moodle.srce.hr/2026-2027');
		expect(moodleUrl({}, new Date('2026-05-15T12:00:00Z'))).toBe('https://moodle.srce.hr/2025-2026');
	});

	it('an explicit year param wins over everything else', () => {
		expect(moodleUrl({ MOODLE_URL: 'https://moodle.srce.hr/2026-2027' }, new Date('2026-10-15T12:00:00Z'), '2024-2025')).toBe(
			'https://moodle.srce.hr/2024-2025'
		);
	});

	it('MOODLE_URL hard override wins over the date guess when no explicit year given', () => {
		expect(moodleUrl({ MOODLE_URL: 'https://moodle.srce.hr/2099-2100' }, new Date('2026-10-15T12:00:00Z'))).toBe(
			'https://moodle.srce.hr/2099-2100'
		);
	});

	it('rejects a malformed explicit year', () => {
		expect(() => moodleUrl({}, new Date(), '2025')).toThrow();
		expect(() => moodleUrl({}, new Date(), 'not-a-year')).toThrow();
	});

	it('respects MOODLE_BASE for both derived and explicit-year URLs', () => {
		expect(moodleUrl({ MOODLE_BASE: 'https://example.test' }, new Date('2026-05-01T00:00:00Z'))).toBe(
			'https://example.test/2025-2026'
		);
		expect(moodleUrl({ MOODLE_BASE: 'https://example.test' }, new Date(), '2020-2021')).toBe('https://example.test/2020-2021');
	});
});

describe('constantTimeEqual', () => {
	it('matches identical strings', async () => {
		expect(await constantTimeEqual('Bearer abc123', 'Bearer abc123')).toBe(true);
	});

	it('rejects differing strings of the same length', async () => {
		expect(await constantTimeEqual('Bearer abc123', 'Bearer abc124')).toBe(false);
	});

	it('rejects differing strings of different lengths', async () => {
		expect(await constantTimeEqual('Bearer abc', 'Bearer abc123')).toBe(false);
	});

	it('rejects an empty header against a real secret', async () => {
		expect(await constantTimeEqual('', 'Bearer abc123')).toBe(false);
	});
});

describe('isSafeWsFunction', () => {
	it.each([
		'core_webservice_get_site_info',
		'core_enrol_get_users_courses',
		'core_course_get_contents',
		'mod_forum_get_forum_discussions',
		'message_popup_get_popup_notifications',
		'core_calendar_get_calendar_events',
		'gradereport_user_get_grade_items',
		'core_calendar_get_action_events_by_timesort',
		'mod_assign_get_assignments',
		'mod_assign_get_submission_status',
		'mod_quiz_get_user_attempts',
		'mod_quiz_get_attempt_review',
		'mod_forum_get_discussion_posts',
		'core_course_get_updates_since',
		'core_calendar_get_calendar_monthly_view', // "view" here is a noun (view type), not a verb
		'mod_lesson_get_content_pages_viewed',
	])('allows %s', (fn) => {
		expect(isSafeWsFunction(fn)).toBe(true);
	});

	it.each([
		'mod_assign_save_submission',
		'mod_assign_submit_for_grading',
		'mod_assign_save_grade',
		'core_notes_create_notes',
		'core_message_send_instant_messages',
		'mod_assign_lock_submissions',
		'mod_assign_revert_submissions_to_draft',
	])('rejects write function %s', (fn) => {
		expect(isSafeWsFunction(fn)).toBe(false);
	});

	it.each([
		'mod_quiz_view_attempt',
		'core_course_view_course',
		'core_user_view_user_profile',
		'gradereport_user_view_grade_report',
		'mod_forum_view_forum_discussion',
	])('rejects view/logging function %s', (fn) => {
		expect(isSafeWsFunction(fn)).toBe(false);
	});

	it('rejects core_search_view_results even though "search" is also a component name', () => {
		// This is the case the naive `_(get|list|search|view)` regex missed:
		// "core_search" is itself a subsystem name, so a plain substring/verb
		// check on "search" lets the real verb here ("view") sneak through.
		expect(isSafeWsFunction('core_search_view_results')).toBe(false);
	});

	it.each([
		'tool_mobile_get_autologin_key',
		'core_calendar_get_calendar_export_token',
		'mod_lti_get_tool_launch_data',
		'tiny_premium_get_api_key',
		'tool_mobile_get_tokens_for_qr_login',
		'core_files_get_unused_draft_itemid',
	])('rejects credential-minting function %s even though it is nominally a "get"', (fn) => {
		expect(isSafeWsFunction(fn)).toBe(false);
	});

	it('rejects functions with no get/list/search verb at all', () => {
		expect(isSafeWsFunction('core_notes_delete_notes')).toBe(false);
	});

	it.each([
		'core_message_send_instant_messages',
		'core_message_send_messages_to_conversation',
		'core_message_mark_message_read',
		'core_message_delete_conversations_by_id',
	])('keeps message writes off the /api/call passthrough: %s', (fn) => {
		expect(isSafeWsFunction(fn)).toBe(false);
	});

	it.each([
		'mod_quiz_get_attempt_data',
		'mod_quiz_get_attempt_summary',
		'mod_quiz_get_attempt_access_information',
		'mod_wiki_get_page_for_editing',
		'mod_bigbluebuttonbn_get_join_url',
		'tool_mobile_get_content',
	])('denies get-named functions that touch live state: %s', (fn) => {
		expect(isSafeWsFunction(fn)).toBe(false);
	});

	it.each(['mod_quiz_get_attempt_review', 'mod_quiz_get_user_attempts', 'mod_quiz_get_quizzes_by_courses'])(
		'still allows finished-quiz reads used by automation: %s',
		(fn) => {
			expect(isSafeWsFunction(fn)).toBe(true);
		}
	);
});

describe('parseAllowedMoodleFileUrl', () => {
	it('accepts a genuine moodle.srce.hr https URL', () => {
		const url = parseAllowedMoodleFileUrl('https://moodle.srce.hr/2025-2026/pluginfile.php/123/mod_resource/content/1/x.pdf');
		expect(url).not.toBeNull();
		expect(url?.hostname).toBe('moodle.srce.hr');
	});

	it('rejects a lookalike subdomain', () => {
		expect(parseAllowedMoodleFileUrl('https://moodle.srce.hr.evil.com/x.pdf')).toBeNull();
	});

	it('rejects a non-default port (the token must not reach other services on the host)', () => {
		expect(parseAllowedMoodleFileUrl('https://moodle.srce.hr:8443/2025-2026/pluginfile.php/1/x.pdf')).toBeNull();
		expect(parseAllowedMoodleFileUrl('https://moodle.srce.hr:443/2025-2026/pluginfile.php/1/x.pdf')).not.toBeNull();
	});

	it('rejects userinfo-smuggled hosts', () => {
		expect(parseAllowedMoodleFileUrl('https://moodle.srce.hr@evil.com/x.pdf')).toBeNull();
	});

	it('rejects a different scheme', () => {
		expect(parseAllowedMoodleFileUrl('http://moodle.srce.hr/x.pdf')).toBeNull();
		expect(parseAllowedMoodleFileUrl('ftp://moodle.srce.hr/x.pdf')).toBeNull();
	});

	it('rejects a malformed URL instead of throwing', () => {
		expect(parseAllowedMoodleFileUrl('not a url')).toBeNull();
	});

	it('rejects a plain wrong host', () => {
		expect(parseAllowedMoodleFileUrl('https://evil.example/x.pdf')).toBeNull();
	});
});

describe('isRedirectResponse', () => {
	it('flags 3xx as a redirect', () => {
		expect(isRedirectResponse(new Response(null, { status: 302 }))).toBe(true);
		expect(isRedirectResponse(new Response(null, { status: 301 }))).toBe(true);
	});

	it('does not flag 200 or 404', () => {
		expect(isRedirectResponse(new Response(null, { status: 200 }))).toBe(false);
		expect(isRedirectResponse(new Response(null, { status: 404 }))).toBe(false);
	});
});

describe('stripHtml', () => {
	it('leaves invalid numeric entities alone instead of throwing', () => {
		expect(stripHtml('a &#1114112; b &#xD800; c &#0; d')).toBe('a &#1114112; b &#xD800; c &#0; d');
	});
	it('removes tags and decodes common entities', () => {
		expect(stripHtml('<p>Hi &amp; welcome &ndash; enjoy</p>')).toBe('Hi & welcome – enjoy');
	});

	it('drops script/style content entirely', () => {
		expect(stripHtml('<div>keep<script>evil()</script>me</div>')).toBe('keep me');
	});

	it('passes plain text through unchanged (mod whitespace collapse)', () => {
		expect(stripHtml('just text')).toBe('just text');
	});

	it('handles non-string input gracefully', () => {
		expect(stripHtml(undefined)).toBe('');
		expect(stripHtml(42)).toBe('');
	});
});

describe('truncate / clamp / redactSecret / toToolResult', () => {
	it('truncate leaves short text alone', () => {
		expect(truncate('short', 100)).toBe('short');
	});

	it('truncate cuts long text with a marker', () => {
		const long = 'x'.repeat(50);
		const out = truncate(long, 10);
		expect(out.startsWith('x'.repeat(10))).toBe(true);
		expect(out).toContain('truncated 40 more characters');
	});

	it('clamp bounds both directions', () => {
		expect(clamp(500, 1, 100)).toBe(100);
		expect(clamp(-5, 1, 100)).toBe(1);
		expect(clamp(50, 1, 100)).toBe(50);
		expect(clamp(NaN, 1, 100)).toBe(1);
	});

	it('redactSecret scrubs the secret out of error text', () => {
		expect(redactSecret('failed calling ?wstoken=SUPERSECRET&x=1', 'SUPERSECRET')).toBe('failed calling ?wstoken=[redacted]&x=1');
	});

	it('redactSecret is a no-op with no secret configured', () => {
		expect(redactSecret('hello', undefined)).toBe('hello');
	});

	it('toToolResult stays under the cap even when the preview is escape-heavy', () => {
		const giant = { blob: '"\\'.repeat(5000) }; // one indivisible value full of characters JSON escapes
		const text = toToolResult(giant, 2000).content[0].text;
		expect(text.length).toBeLessThanOrEqual(2000);
		expect(JSON.parse(text).truncated).toBe(true);
	});

	it('toToolResult is compact JSON (no pretty-print) when small', () => {
		expect(toToolResult({ a: [1, 2] }).content[0].text).toBe('{"a":[1,2]}');
	});

	it('toToolResult drops whole trailing array items and stays valid JSON', () => {
		const items = Array.from({ length: 500 }, (_, i) => ({ id: i, text: 'žđ "quoted" '.repeat(20) }));
		const text = toToolResult(items, 20_000).content[0].text;
		expect(text.length).toBeLessThanOrEqual(20_000);
		const parsed = JSON.parse(text) as Array<Record<string, unknown>>;
		const marker = parsed[parsed.length - 1];
		expect(marker.truncated).toBe(true);
		expect(marker.omitted_items).toBe(500 - (parsed.length - 1));
		expect(parsed[0]).toEqual(items[0]);
	});

	it('toToolResult trims the largest array inside an envelope object', () => {
		const env = { years: ['2026-2027'], items: Array.from({ length: 300 }, (_, i) => ({ i, pad: 'x'.repeat(200) })) };
		const parsed = JSON.parse(toToolResult(env, 10_000).content[0].text);
		expect(parsed.years).toEqual(['2026-2027']);
		expect(parsed.truncated).toBe(true);
		expect(parsed.items.length + parsed.omitted_items).toBe(300);
	});

	it('toToolResult caps huge payloads', () => {
		const huge = { blob: 'y'.repeat(300_000) };
		const result = toToolResult(huge, 1000);
		expect(result.content[0].text.length).toBeLessThan(1200);
		expect(result.content[0].text).toContain('truncated');
		expect(() => JSON.parse(result.content[0].text)).not.toThrow();
	});

	it('zagrebTime shows Zagreb wall time with the right DST zone', () => {
		expect(zagrebTime(1762901940)).toBe('2025-11-11 23:59 CET');
		expect(zagrebTime(1759600000)).toBe('2025-10-04 19:46 CEST');
		expect(zagrebTime(Date.UTC(2026, 2, 29, 0, 30) / 1000)).toBe('2026-03-29 01:30 CET');
		expect(zagrebTime(Date.UTC(2026, 2, 29, 1, 30) / 1000)).toBe('2026-03-29 03:30 CEST');
		expect(zagrebTime(Date.UTC(2026, 0, 1, 23, 0) / 1000)).toBe('2026-01-02 00:00 CET');
		expect(zagrebTime(0)).toBeUndefined();
		expect(zagrebTime(undefined)).toBeUndefined();
	});
});

describe('active years', () => {
	const oct = new Date('2026-10-05T10:00:00Z');
	const sep = new Date('2026-09-15T10:00:00Z');
	const may = new Date('2026-05-15T10:00:00Z');

	it('isValidYear wants two consecutive years', () => {
		expect(isValidYear('2025-2026')).toBe(true);
		expect(isValidYear('2026-2025')).toBe(false);
		expect(isValidYear('2025-2027')).toBe(false);
		expect(isValidYear('2025')).toBe(false);
		expect(isValidYear('1900-1901')).toBe(false);
	});

	it('moodleUrl rejects a reversed year', () => {
		expect(() => moodleUrl({}, new Date(), '2026-2025')).toThrow();
	});

	it('currentYear follows the date, or a MOODLE_URL pin that names a year', () => {
		expect(currentYear({}, oct)).toBe('2026-2027');
		expect(currentYear({}, may)).toBe('2025-2026');
		expect(currentYear({ MOODLE_URL: 'https://moodle.srce.hr/2024-2025' }, oct)).toBe('2024-2025');
		expect(currentYear({ MOODLE_URL: 'https://other.example/moodle' }, oct)).toBe('2026-2027');
	});

	it('is current + previous, newest first, outside September', () => {
		expect(activeYearCandidates({}, oct)).toEqual({ years: ['2026-2027', '2025-2026'] });
		expect(activeYearCandidates({}, may)).toEqual({ years: ['2025-2026', '2024-2025'] });
	});

	it('offers next year as a probe only in September (Zagreb time)', () => {
		expect(activeYearCandidates({}, sep)).toEqual({ years: ['2025-2026', '2024-2025'], probe: '2026-2027' });
		// 31 Aug 22:30 UTC is already 1 Sep in Zagreb
		expect(activeYearCandidates({}, new Date('2026-08-31T22:30:00Z')).probe).toBe('2026-2027');
		expect(activeYearCandidates({}, new Date('2026-08-31T21:30:00Z')).probe).toBeUndefined();
	});

	it('includes the probe year only when it is reachable', async () => {
		expect(await activeYears({}, sep, async () => true)).toEqual(['2026-2027', '2025-2026', '2024-2025']);
		expect(await activeYears({}, sep, async () => false)).toEqual(['2025-2026', '2024-2025']);
		expect(
			await activeYears({}, sep, async () => {
				throw new Error('HTTP 404');
			})
		).toEqual(['2025-2026', '2024-2025']);
	});

	it('never probes outside September', async () => {
		let probed = false;
		await activeYears({}, oct, async () => (probed = true));
		expect(probed).toBe(false);
	});

	it('MERLIN_YEARS overrides everything', () => {
		expect(activeYearCandidates({ MERLIN_YEARS: '2025-2026, 2026-2027,2025-2026' }, sep)).toEqual({
			years: ['2026-2027', '2025-2026'],
		});
		expect(() => parseYearList('2025-2026,bogus')).toThrow();
	});
});

describe('per-year tokens', () => {
	it('uses MOODLE_TOKENS[year] when present, else MOODLE_TOKEN', () => {
		const env = { MOODLE_TOKEN: 'base', MOODLE_TOKENS: JSON.stringify({ '2025-2026': 'old' }) };
		expect(tokenForYear(env, '2025-2026')).toBe('old');
		expect(tokenForYear(env, '2026-2027')).toBe('base');
		expect(tokenForYear(env, undefined)).toBe('base');
	});

	it('falls back to MOODLE_TOKEN on a malformed map', () => {
		expect(tokenForYear({ MOODLE_TOKEN: 'base', MOODLE_TOKENS: '{not json' }, '2025-2026')).toBe('base');
	});

	it('allTokens lists every token for redaction', () => {
		const env = { MOODLE_TOKEN: 'base', MOODLE_TOKENS: JSON.stringify({ a: 'one', b: 'two' }) };
		expect(allTokens(env).sort()).toEqual(['base', 'one', 'two']);
		expect(redactSecret('x base y two', allTokens(env))).toBe('x [redacted] y [redacted]');
	});
});

describe('fanOut / merge helpers', () => {
	it('tags items with their year and keeps going when one year fails', async () => {
		const res = await fanOut(['2026-2027', '2025-2026'], async (y) => {
			if (y === '2025-2026') throw new Error('site down');
			return [{ id: 1 }, { id: 2 }];
		});
		expect(res.items).toEqual([
			{ year: '2026-2027', id: 1 },
			{ year: '2026-2027', id: 2 },
		]);
		expect(res.errors).toEqual({ '2025-2026': 'site down' });
		expect(res.years).toEqual(['2026-2027', '2025-2026']);
	});

	it('omits errors when every year succeeds', async () => {
		const res = await fanOut(['a', 'b'], async (y) => [{ y }]);
		expect(res.errors).toBeUndefined();
		expect(res.items).toHaveLength(2);
	});

	it('dedupes copies of one record but keeps id collisions that differ', () => {
		const items = [
			{ year: '2026-2027', id: 7, t: 100, subject: 'copied', url: 'https://moodle.srce.hr/2025-2026/x' },
			{ year: '2025-2026', id: 7, t: 100, subject: 'copied', url: 'https://moodle.srce.hr/2025-2026/x' },
			{ year: '2026-2027', id: 9, t: 300, subject: 'new-year item' },
			{ year: '2025-2026', id: 9, t: 250, subject: 'different old-year item, same id' },
		];
		const out = dedupeAcrossYears(
			items,
			(n) => `${n.id}|${n.t}|${n.subject}`,
			(n) => typeof n.url === 'string' && n.url.includes(`/${n.year}/`)
		);
		expect(out).toHaveLength(3);
		const copied = out.find((n) => n.id === 7)!;
		expect(copied.year).toBe('2025-2026'); // preferred: its link points at its own year
		expect(copied.also_in).toEqual(['2026-2027']);
		expect(out.filter((n) => n.id === 9)).toHaveLength(2);
	});

	it('sortByNumber sorts both ways with missing values last', () => {
		const xs = [{ t: 2 }, { t: undefined }, { t: 1 }, { t: 3 }];
		expect(sortByNumber(xs, (x) => x.t, 'asc').map((x) => x.t)).toEqual([1, 2, 3, undefined]);
		expect(sortByNumber(xs, (x) => x.t, 'desc').map((x) => x.t)).toEqual([3, 2, 1, undefined]);
	});

	it('mapLimit keeps order and respects the limit', async () => {
		let running = 0;
		let peak = 0;
		const out = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
			running++;
			peak = Math.max(peak, running);
			await new Promise((r) => setTimeout(r, 5));
			running--;
			return n * 2;
		});
		expect(out).toEqual([2, 4, 6, 8, 10, 12, 14]);
		expect(peak).toBeLessThanOrEqual(3);
	});
});

describe('moodleUserAgent', () => {
	it('is fixed and names no one by default', () => {
		expect(moodleUserAgent()).toBe('merlin-mcp/1.0 (personal read-only student client)');
	});
	it('adds a valid contact address', () => {
		expect(moodleUserAgent(' a@b.hr ')).toBe('merlin-mcp/1.0 (personal read-only student client; contact: a@b.hr)');
	});
	it('drops anything that is not a plain address (no header injection)', () => {
		expect(moodleUserAgent('a@b.hr\r\nX-Evil: 1')).toBe('merlin-mcp/1.0 (personal read-only student client)');
		expect(moodleUserAgent('Mozilla/5.0 (x)')).toBe('merlin-mcp/1.0 (personal read-only student client)');
	});
});

describe('withoutCredentials', () => {
	it('drops credential fields at any depth and keeps the rest', () => {
		const site = { userid: 1, userprivateaccesskey: 'k', nested: [{ privatetoken: 'p', name: 'x' }], Token: 't' };
		expect(withoutCredentials(site)).toEqual({ userid: 1, nested: [{ name: 'x' }] });
		expect(withoutCredentials([1, 'a', null])).toEqual([1, 'a', null]);
	});
	it('redacts keys embedded in URLs inside strings', () => {
		const html = '<img src="https://moodle.srce.hr/2026-2027/tokenpluginfile.php/abc123/9/user/icon/f1"> <a href="x.php?id=1&token=secret9">';
		expect(withoutCredentials({ description: html }).description).toBe(
			'<img src="https://moodle.srce.hr/2026-2027/tokenpluginfile.php/[redacted]/9/user/icon/f1"> <a href="x.php?id=1&token=[redacted]">'
		);
	});
	it('redacts entity-, percent- and JSON-escaped forms', () => {
		const r = (s: string) => withoutCredentials(s);
		expect(r('a.php?id=1&amp;token=k1"')).toBe('a.php?id=1&amp;token=[redacted]"');
		expect(r('a.php?id=1&#38;wstoken=k2 ')).toBe('a.php?id=1&#38;wstoken=[redacted] ');
		expect(r('u=a.php%3Fid%3D1%26token%3Dk3')).toBe('u=a.php%3Fid%3D1%26token%3D[redacted]');
		expect(r('tokenpluginfile.php\\/k4\\/9')).toBe('tokenpluginfile.php\\/[redacted]\\/9');
		expect(r('tokenpluginfile.php%2Fk5%2F9')).toBe('tokenpluginfile.php%2F[redacted]%2F9');
	});
});

describe('API_CALL_ALLOWLIST', () => {
	it('every listed function also passes the pattern check', () => {
		for (const fn of API_CALL_ALLOWLIST) expect(isSafeWsFunction(fn), fn).toBe(true);
	});
	it('nothing that writes, views or sends is listed', () => {
		for (const fn of API_CALL_ALLOWLIST) expect(fn).not.toMatch(/_(send|save|update|delete|create|view|submit|start|process|mark)_/);
	});
	it('isAllowedApiFunction is the list, not the pattern', () => {
		expect(isAllowedApiFunction('core_course_get_contents')).toBe(true);
		expect(isAllowedApiFunction('core_user_get_users_by_field')).toBe(false);
	});
});
