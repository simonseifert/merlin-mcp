import { describe, expect, it } from 'vitest';
import { createClient, DIRECT_FUNCTIONS, isAuthError, MerlinError } from '../dashboard/src/direct/merlin';
import { buildAnnouncements, buildGrades, buildMain } from '../src/dashboard-build';

// Direct mode: the browser's own read-only Merlin client. All data is fake.

const Y = '2026-2027';
const TOKEN = '0123456789abcdef0123456789abcdef';
const NOW = 1_800_000_000_000;
const S = NOW / 1000;

function merlin(fn: string): unknown {
	switch (fn) {
		case 'core_webservice_get_site_info':
			return { userid: 42, fullname: 'Test Student', firstname: 'Test', sitename: 'Merlin', userprivateaccesskey: 'PRIVKEY', functions: [{ name: 'x' }] };
		case 'core_enrol_get_users_courses':
			return [{ id: 10, shortname: 'TEST101', fullname: 'Test Course 101' }];
		case 'gradereport_user_get_grade_items':
			return {
				usergrades: [
					{
						gradeitems: [
							{ itemname: 'Kolokvij 1', itemtype: 'mod', itemmodule: 'quiz', graderaw: 18, grademin: 0, grademax: 25, percentageformatted: '72,00 %', feedback: '<p>Dobro</p>' },
							{ itemtype: 'course', graderaw: 18, grademax: 100, percentageformatted: '18,00 %', gradeformatted: '18,00' },
						],
					},
				],
			};
		case 'core_calendar_get_calendar_events':
			return { events: [{ id: 1, name: 'Međuispit', courseid: 10, eventtype: 'course', timestart: S + 86400, timeduration: 5400, location: 'A-1' }] };
		case 'core_calendar_get_action_events_by_timesort':
			return { events: [{ id: 3, name: 'Seminar: Tržište is due', modulename: 'assign', timesort: S + 5 * 86400, course: { id: 10, fullname: 'Test Course 101' } }] };
		case 'mod_assign_get_assignments':
			return { courses: [{ id: 10, fullname: 'Test Course 101', assignments: [{ id: 7, name: 'Seminar: Tržište', duedate: S + 5 * 86400, intro: '<p>10 stranica</p>' }] }] };
		case 'mod_forum_get_forums_by_courses':
			return [
				{ id: 5, course: 10, name: 'Obavijesti', type: 'news' },
				{ id: 6, course: 10, name: 'Pitanja', type: 'general' },
			];
		case 'mod_forum_get_forum_discussions':
			return { discussions: [{ discussion: 99, subject: 'Termin kolokvija', userfullname: 'Prof', created: S - 3600, timemodified: S - 3600, message: '<p>Utorak u 10</p>' }] };
		default:
			return { exception: 'moodle_exception', errorcode: 'unexpected', message: fn };
	}
}

type Seen = { fn: string; url: string; body: string; init: RequestInit };
function fake(answer: (fn: string) => Response | unknown = merlin) {
	const seen: Seen[] = [];
	let inFlight = 0;
	let peak = 0;
	const fetchFn = (async (input: string, init: RequestInit) => {
		const fn = new URL(input).searchParams.get('wsfunction') ?? '';
		seen.push({ fn, url: input, body: String(init.body), init });
		inFlight++;
		peak = Math.max(peak, inFlight);
		await new Promise((r) => setTimeout(r, 1));
		inFlight--;
		const out = answer(fn);
		return out instanceof Response ? out : new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json' } });
	}) as typeof fetch;
	return { seen, fetchFn, peak: () => peak };
}

describe('direct client', () => {
	it('only calls the eight read-only functions, and never sends anything', async () => {
		const f = fake();
		const c = createClient(TOKEN, Y, { fetch: f.fetchFn, now: () => NOW });
		for (const fn of ['core_message_send_instant_messages', 'mod_assign_save_submission', 'mod_forum_get_discussion_posts', 'mod_assign_get_submission_status']) {
			await expect(c.call(fn)).rejects.toMatchObject({ code: 'notallowed' });
		}
		await expect(c.tools('moodle_send_message')).rejects.toMatchObject({ code: 'notallowed' });
		expect(f.seen).toEqual([]);
		expect([...DIRECT_FUNCTIONS].every((fn) => /^(core_webservice_get_site_info|core_enrol_get_users_courses|core_calendar_get_|mod_assign_get_assignments|gradereport_user_get_grade_items|mod_forum_get_forums_by_courses|mod_forum_get_forum_discussions)/.test(fn))).toBe(true);
	});

	it('keeps the token in the POST body, never in a URL, and sends no cookies', async () => {
		const f = fake();
		await createClient(TOKEN, Y, { fetch: f.fetchFn, now: () => NOW }).call('core_webservice_get_site_info', { wstoken: 'smuggled' });
		const [s] = f.seen;
		expect(s.url.startsWith(`https://moodle.srce.hr/${Y}/webservice/rest/server.php?`)).toBe(true);
		expect(s.url).not.toContain(TOKEN);
		expect(s.url).not.toContain('smuggled');
		expect(s.body).toBe(`wstoken=${TOKEN}`);
		expect(s.init).toMatchObject({ method: 'POST', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
	});

	it('rejects a malformed token or year before any call', () => {
		expect(() => createClient('not-a-token', Y)).toThrow(MerlinError);
		expect(() => createClient(TOKEN, '../x')).toThrow(MerlinError);
	});

	it('builds the same main, grades and announcements parts the server builds', async () => {
		const f = fake();
		const c = createClient(TOKEN, Y, { fetch: f.fetchFn, now: () => NOW });
		const main = await buildMain(c.tools, Y, NOW);
		expect(main.user?.fullname).toBe('Test Student');
		expect(main.courses).toEqual([expect.objectContaining({ key: `${Y}:10`, name: 'Test Course 101', items: [] })]);
		expect(main.exams.map((e) => e.title)).toEqual(['Međuispit']);
		expect(main.seminars).toEqual([expect.objectContaining({ title: 'Seminar: Tržište', intro: '10 stranica' })]);
		expect(main.errors).toBeUndefined();
		expect(JSON.stringify(main)).not.toMatch(/PRIVKEY|0123456789abcdef/);

		const grades = await buildGrades(c.tools, Y, NOW);
		expect(grades.courses[0]).toMatchObject({ key: `${Y}:10`, total: { raw: 18, max: 100, percent: 18 } });
		expect(grades.courses[0].items).toEqual([expect.objectContaining({ name: 'Kolokvij 1', percent: 72, feedback: 'Dobro' })]);

		const ann = await buildAnnouncements(c.tools, Y, NOW);
		expect(ann.announcements).toEqual([expect.objectContaining({ subject: 'Termin kolokvija', kind: 'exam', message: 'Utorak u 10' })]);

		// site_info and the course list are fetched once for all three parts; only news forums are read.
		expect(f.seen.filter((s) => s.fn === 'core_webservice_get_site_info')).toHaveLength(1);
		expect(f.seen.filter((s) => s.fn === 'core_enrol_get_users_courses')).toHaveLength(1);
		expect(f.seen.filter((s) => s.fn === 'mod_forum_get_forum_discussions')).toHaveLength(1);
	});

	it('keeps at most 4 calls in flight', async () => {
		const f = fake();
		const c = createClient(TOKEN, Y, { fetch: f.fetchFn, now: () => NOW });
		await Promise.all(Array.from({ length: 12 }, () => c.call('core_webservice_get_site_info')));
		expect(f.peak()).toBeLessThanOrEqual(4);
	});

	it('pauses when Merlin says slow down, without calling again', async () => {
		let t = NOW;
		const f = fake(() => new Response('busy', { status: 429, headers: { 'Retry-After': '30' } }));
		const c = createClient(TOKEN, Y, { fetch: f.fetchFn, now: () => t });
		await expect(c.call('core_webservice_get_site_info')).rejects.toMatchObject({ retryAfterS: 30 });
		t += 10_000;
		await expect(c.call('core_webservice_get_site_info')).rejects.toMatchObject({ retryAfterS: 20 });
		expect(f.seen).toHaveLength(1);
	});

	it('recognises a rejected token, and never echoes it', async () => {
		const f = fake(() => ({ exception: 'moodle_exception', errorcode: 'invalidtoken', message: `Invalid token ${TOKEN}` }));
		const c = createClient(TOKEN, Y, { fetch: f.fetchFn, now: () => NOW });
		const err = await c.call('core_webservice_get_site_info').catch((e) => e);
		expect(isAuthError(err)).toBe(true);
		expect(String(err.message)).not.toContain(TOKEN);
	});
});
