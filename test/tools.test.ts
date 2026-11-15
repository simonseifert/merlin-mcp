import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index.js';
import { __resetCaches } from '../src/app.js';

// tools/call coverage for every MCP tool, through the real /mcp route with a
// mocked Moodle. All data below is fake ("Test Student", course TEST101).

const Y25 = '2025-2026';
const Y26 = '2026-2027';

const ENV = {
	MOODLE_TOKEN: 'the-moodle-token',
	MCP_BEARER: 'the-bearer-secret',
	API_BEARER: 'the-api-secret',
	LEGACY_API_BEARER: '0',
	RELAY_BEARER: 'the-relay-secret',
	MERLIN_YEARS: `${Y25},${Y26}`,
} as any;

const AUTH = { Authorization: 'Bearer the-bearer-secret' };

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

const jsonResponse = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const rpc = (method: string, params: unknown = {}) =>
	new Request('https://merlin-mcp.example/mcp', {
		method: 'POST',
		headers: { ...AUTH, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
	});

/** Every wsfunction any mocked Moodle call carried, across the whole file (for the guard test). */
const seenFunctions = new Set<string>();

type Call = { year: string; fn: string; params: URLSearchParams };
let calls: Call[];
let fetchMock: ReturnType<typeof vi.fn>;
let overrides: Record<string, (year: string, p: URLSearchParams) => unknown>;

/** Default fake Merlin. One course TEST101 per year: id 10 in both years (collision), id 20 only in 2026-2027. */
function fixture(year: string, fn: string, p: URLSearchParams): unknown {
	const is26 = year === Y26;
	switch (fn) {
		case 'core_webservice_get_site_info':
			return { userid: is26 ? 42 : 41, fullname: 'Test Student', sitename: 'Merlin', userprivateaccesskey: 'PRIVKEY', functions: [{ name: 'a' }, { name: 'b' }] };
		case 'core_enrol_get_users_courses':
			return is26
				? [{ id: 10, shortname: 'TEST101', fullname: 'Test Course 101', visible: 1 }, { id: 20, shortname: 'TEST202', fullname: 'Test Course 202', visible: 1 }]
				: [{ id: 10, shortname: 'TEST101', fullname: 'Test Course 101 (old)', visible: 1 }];
		case 'message_popup_get_popup_notifications':
			return {
				notifications: [
					{
						id: is26 ? 2 : 1,
						subject: is26 ? 'New 2026 notice' : 'Old 2025 notice',
						read: false,
						timecreated: is26 ? 2000 : 1000,
						fullmessage: '<p>Hello <b>Test Student</b></p>',
						fullmessagehtml: '<p>dup html</p>',
						iconurl: 'x',
						customdata: '{}',
					},
				],
			};
		case 'core_calendar_get_calendar_events':
			return { events: [{ id: 1, name: is26 ? 'Lecture' : 'Old exam', courseid: 10, eventtype: 'course', modulename: '', timestart: is26 ? 5000 : 4000, timeduration: 0, description: '<p>Room <i>A1</i></p>' }] };
		case 'core_course_get_contents':
			return [
				{
					id: 1,
					name: 'General',
					visible: 1,
					summary: '<p>Welcome <b>all</b></p>',
					modules: [
						{ id: 100, instance: 7, name: 'Announcements', modname: 'forum', visible: 1, url: 'https://x', description: '<p>News</p>' },
						{
							id: 101,
							instance: 8,
							name: 'Slides',
							modname: 'resource',
							visible: 1,
							contents: [{ type: 'file', filename: 'slides.pdf', filesize: 10, mimetype: 'application/pdf', timemodified: 1, fileurl: 'https://moodle.srce.hr/pluginfile.php/1/slides.pdf' }],
						},
					],
				},
			];
		case 'mod_forum_get_forums_by_courses':
			return is26
				? [{ id: 7, course: 10, type: 'news', name: 'Obavijesti' }, { id: 70, course: 20, type: 'general', name: 'Q&A' }]
				: [{ id: 9, course: 10, type: 'news', name: 'Obavijesti (old)' }];
		case 'mod_forum_get_forum_discussions':
			return { discussions: [{ id: 1, discussion: 55, name: 'Exam date', subject: 'Exam date', userfullname: 'Test Teacher', created: 1, timemodified: 2, pinned: false, numreplies: 0, message: '<p>Exam on <b>Friday</b></p>' }] };
		case 'mod_forum_get_discussion_posts':
			return is26
				? { posts: [{ id: 1, author: { fullname: 'Test Teacher' }, subject: 'Re', message: '<p>See <a href="x">link</a></p>', timecreated: 1, timemodified: 2 }] }
				: { exception: 'moodle_exception', message: 'Discussion not found' };
		case 'core_message_get_conversations':
			return {
				conversations: [
					{
						id: 1,
						type: 1,
						unreadcount: 2,
						members: [{ id: 777, fullname: 'Test Recipient' }],
						messages: [{ id: 5, useridfrom: 777, text: '<p>Hi <b>there</b></p>', timecreated: is26 ? 3000 : 100 }],
					},
				],
			};
		case 'core_message_get_conversation_messages':
			return { members: [{ id: 777, fullname: 'Test Recipient' }], messages: [{ id: 6, useridfrom: 42, text: '<p>Hello</p>', timecreated: 3100 }] };
		case 'gradereport_user_get_grade_items':
			return { usergrades: [{ gradeitems: [{ itemtype: 'course', itemname: '', graderaw: 90, gradeformatted: '<b>90</b>', percentageformatted: '90 %', feedback: '<p>Well <b>done</b></p>' }] }] };
		case 'core_calendar_get_action_events_by_timesort':
			return { events: [{ id: 1, name: is26 ? 'Essay due' : 'Old due', course: { id: 10, fullname: 'Test Course 101' }, modulename: 'assign', timesort: is26 ? 9000 : 8000, url: 'https://x', overdue: false, description: '<p>Hand in <b>PDF</b></p>' }] };
		case 'mod_assign_get_assignments':
			return {
				courses: [
					{
						id: 10,
						fullname: 'Test Course 101',
						assignments: [{ id: is26 ? 5 : 4, name: is26 ? 'Essay' : 'Old essay', duedate: is26 ? 9000 : 8000, cutoffdate: 0, intro: '<p>Write <b>it</b></p>' }],
					},
				],
			};
		case 'mod_assign_get_submission_status':
			return {
				lastattempt: { submission: { status: 'submitted' } },
				feedback: { gradefordisplay: '<b>8 / 10</b>', plugins: [{ type: 'comments', editorfields: [{ name: 'comments', text: '<p>Good <i>work</i></p>' }] }] },
			};
		case 'mod_quiz_get_quizzes_by_courses':
			return {
				quizzes: is26
					? [{ id: 3, course: 10, coursemodule: 300, name: 'Samoprovjera', timeopen: 8000, timeclose: 9500, timelimit: 900, attempts: 2, grademethod: 1, grade: 10, sumgrades: 20 }]
					: [{ id: 99, course: 10, coursemodule: 990, name: 'Old quiz', timeopen: 0, timeclose: 0, timelimit: 0, attempts: 0, grademethod: 4, grade: 5 }],
			};
		case 'core_group_get_course_user_groups':
			return { groups: is26 ? [{ id: 501, name: 'G2', courseid: 10, idnumber: '', description: '<p>Lab <b>2</b></p>' }] : [], warnings: [] };
		case 'mod_choice_get_choices_by_courses':
			return {
				choices: is26
					? [
							{ id: 61, coursemodule: 600, course: 20, name: 'Prijava za vježbe', intro: '<p>Pick a slot</p>', timeopen: 0, timeclose: 4102444800, allowupdate: 1, allowmultiple: 0 },
							{ id: 62, coursemodule: 601, course: 20, name: 'Closed poll', timeopen: 0, timeclose: 1000, allowupdate: 0, allowmultiple: 0 },
						]
					: [],
			};
		case 'mod_choice_get_choice_options':
			return {
				options: [
					{ id: 1, text: 'Grupa 1 (10:15)', maxanswers: 20, countanswers: 20, checked: false, disabled: true },
					{ id: 2, text: 'Grupa 2 (12:00)', maxanswers: 20, countanswers: 5, checked: true, disabled: false },
				],
			};
		case 'mod_quiz_get_user_attempts':
			return { attempts: [{ id: 31, attempt: 1, state: 'finished', timestart: 1, timefinish: 2, sumgrades: 7 }] };
		case 'mod_quiz_get_attempt_review':
			return is26
				? { grade: 7, questions: [{ number: 1, slot: 1, type: 'multichoice', state: 'gradedright', status: 'Correct', mark: '1.00', maxmark: 1, html: '<div class="q"><p>2+2 = <b>4</b></p></div>' }] }
				: { exception: 'moodle_exception', message: 'Attempt not found' };
		case 'core_course_get_updates_since':
			return { instances: [{ contextlevel: 'module', id: 100, updates: [{ name: 'configuration', timeupdated: 1 }] }], warnings: [] };
		default:
			throw new Error(`unmocked wsfunction ${fn} (${p.toString()})`);
	}
}

let files: Record<string, { body: BodyInit; headers: Record<string, string> }> = {};
let fileFetches: URL[] = [];

beforeEach(() => {
	__resetCaches();
	calls = [];
	overrides = {};
	files = {};
	fileFetches = [];
	fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
		const u = new URL(input);
		if (u.pathname.includes('/pluginfile.php/')) {
			fileFetches.push(u);
			const f = files[u.pathname];
			return f ? new Response(f.body, { status: 200, headers: f.headers }) : new Response('<html>not found token=' + u.searchParams.get('token') + '</html>', { status: 404 });
		}
		const fn = u.searchParams.get('wsfunction') ?? '';
		const year = u.pathname.split('/')[1];
		const params = new URLSearchParams(u.searchParams);
		const body = init?.body;
		if (body instanceof URLSearchParams) for (const [k, v] of body) params.set(k, v);
		calls.push({ year, fn, params });
		seenFunctions.add(fn);
		const data = (overrides[fn] ?? ((y, p) => fixture(y, fn, p)))(year, params);
		return jsonResponse(data);
	});
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

async function callTool(name: string, args: Record<string, unknown> = {}, env: any = ENV) {
	const res = await worker.fetch(rpc('tools/call', { name, arguments: args }), env, ctx);
	expect(res.status).toBe(200);
	const body = (await res.json()) as any;
	const text: string = body.result?.content?.[0]?.text ?? '';
	let data: any;
	try {
		data = JSON.parse(text);
	} catch {
		data = undefined;
	}
	return { isError: Boolean(body.result?.isError), text, data };
}

const fnsCalled = () => calls.map((c) => c.fn);
const yearsCalled = (fn: string) => calls.filter((c) => c.fn === fn).map((c) => c.year).sort();

describe('list tools default to year="all" and read both active years', () => {
	it('moodle_get_notifications: merges, tags year, strips HTML, drops duplicate HTML body', async () => {
		const { data, isError } = await callTool('moodle_get_notifications');
		expect(isError).toBe(false);
		expect(data.years).toEqual([Y26, Y25]);
		expect(data.items.map((n: any) => n.year)).toEqual([Y26, Y25]); // newest first
		expect(data.items[0].fullmessage).toBe('Hello Test Student');
		expect(data.items[0]).not.toHaveProperty('fullmessagehtml');
		expect(data.items[0]).toHaveProperty('timecreated_local');
		expect(data.truncated).toBeUndefined();
		expect(yearsCalled('message_popup_get_popup_notifications')).toEqual([Y25, Y26]);
	});

	it('moodle_get_notifications: an explicit year reads only that year', async () => {
		const { data } = await callTool('moodle_get_notifications', { year: Y25, unread_only: true });
		expect(data.items.map((n: any) => n.year)).toEqual([Y25]);
		expect(yearsCalled('message_popup_get_popup_notifications')).toEqual([Y25]);
	});

	it('moodle_get_calendar_events: passes enrolled course ids, sorts by start, tags year', async () => {
		const { data } = await callTool('moodle_get_calendar_events', { days_ahead: 7 });
		expect(data.items.map((e: any) => [e.year, e.name])).toEqual([[Y25, 'Old exam'], [Y26, 'Lecture']]);
		expect(data.items[1].description).toBe('Room A1');
		expect(data.items[1].course).toBe('Test Course 101');
		expect(yearsCalled('core_calendar_get_calendar_events')).toEqual([Y25, Y26]);
		const call26 = calls.find((c) => c.fn === 'core_calendar_get_calendar_events' && c.year === Y26)!;
		expect(call26.params.get('events[courseids][0]')).toBe('10');
		expect(call26.params.get('events[courseids][1]')).toBe('20');
		expect(call26.params.has('options[timestart]')).toBe(true);
		expect(data.truncated).toBeUndefined();
	});

	it('moodle_get_courses: lists courses of both years, tagged', async () => {
		const { data } = await callTool('moodle_get_courses');
		expect(data.years).toEqual([Y26, Y25]);
		const rows = data.items.map((c: any) => `${c.year}:${c.id}:${c.shortname}`).sort();
		expect(rows).toEqual([`${Y25}:10:TEST101`, `${Y26}:10:TEST101`, `${Y26}:20:TEST202`]);
		expect(data.truncated).toBeUndefined();
	});

	it('moodle_get_grades: one entry per enrolled course, HTML stripped, "Course total" label', async () => {
		const { data } = await callTool('moodle_get_grades');
		expect(data.items.map((i: any) => `${i.year}:${i.courseid}`).sort()).toEqual([`${Y25}:10`, `${Y26}:10`, `${Y26}:20`]);
		const item = data.items.find((i: any) => i.year === Y26 && i.courseid === 10);
		expect(item.gradeitems[0]).toMatchObject({ itemname: 'Course total', gradeformatted: '90', feedback: 'Well done' });
		expect(fnsCalled().filter((f) => f === 'gradereport_user_get_grade_items')).toHaveLength(3);
	});

	it('moodle_get_grades: course_id resolves its year from the id (only course 20 is in 2026-2027)', async () => {
		const { data } = await callTool('moodle_get_grades', { course_id: 20 });
		expect(data.items).toHaveLength(1);
		expect(data.items[0]).toMatchObject({ year: Y26, courseid: 20 });
		expect(yearsCalled('gradereport_user_get_grade_items')).toEqual([Y26]);
	});

	it('moodle_get_upcoming_deadlines: sorted by time, tagged, HTML stripped', async () => {
		const { data } = await callTool('moodle_get_upcoming_deadlines');
		expect(data.items.map((e: any) => [e.year, e.name])).toEqual([[Y25, 'Old due'], [Y26, 'Essay due']]);
		expect(data.items[1]).toMatchObject({ course: 'Test Course 101', courseid: 10, description: 'Hand in PDF' });
		expect(yearsCalled('core_calendar_get_action_events_by_timesort')).toEqual([Y25, Y26]);
	});

	it('moodle_get_messages: lists conversations of both years, strips HTML, hides self notes', async () => {
		overrides.core_message_get_conversations = (y) => ({
			conversations: [
				{ id: 1, type: 1, unreadcount: 2, members: [{ id: 777, fullname: 'Test Recipient' }], messages: [{ id: 5, useridfrom: 777, text: '<p>Hi <b>there</b></p>', timecreated: y === Y26 ? 3000 : 100 }] },
				{ id: 9, type: 3, unreadcount: 0, members: [{ id: 42, fullname: 'Test Student' }], messages: [] },
			],
		});
		const { data } = await callTool('moodle_get_messages');
		expect(data.items).toHaveLength(1); // same conversation in both years collapses, self note dropped
		expect(data.items[0]).toMatchObject({ year: Y26, conversation_id: 1, unread: 2 });
		expect(data.items[0].with).toEqual([{ user_id: 777, fullname: 'Test Recipient' }]);
		expect(data.items[0].latest[0].text).toBe('Hi there');
		expect(yearsCalled('core_message_get_conversations')).toEqual([Y25, Y26]);
	});

	it('moodle_get_messages: conversation_id returns the thread via core_message_get_conversation_messages', async () => {
		const { data } = await callTool('moodle_get_messages', { conversation_id: 1 });
		expect(data.conversation_id).toBe(1);
		expect(data.members).toEqual([{ id: 777, fullname: 'Test Recipient' }]);
		expect(data.messages[0]).toMatchObject({ text: 'Hello', from: 'me' });
		expect(fnsCalled()).toContain('core_message_get_conversation_messages');
	});

	it('moodle_whoami: one entry per year, no private access key, functions collapsed to a count', async () => {
		const { data, text } = await callTool('moodle_whoami');
		expect(data.items.map((i: any) => i.year).sort()).toEqual([Y25, Y26]);
		expect(data.items[0].fullname).toBe('Test Student');
		expect(data.items[0].functions_count).toBe(2);
		expect(text).not.toContain('PRIVKEY');
		expect(text).not.toContain('the-moodle-token');
	});
});

describe('moodle_get_assignments', () => {
	it('does NOT call mod_assign_get_submission_status by default', async () => {
		const { data } = await callTool('moodle_get_assignments');
		expect(data.items.map((a: any) => [a.year, a.name])).toEqual([[Y26, 'Essay'], [Y25, 'Old essay']]); // newest due first
		expect(data.items[0].intro).toBe('Write it');
		expect(data.items[0]).not.toHaveProperty('submission_status');
		expect(yearsCalled('mod_assign_get_assignments')).toEqual([Y25, Y26]);
		expect(fnsCalled()).not.toContain('mod_assign_get_submission_status');
		expect(data.truncated).toBeUndefined();
	});

	it('include_feedback=true calls mod_assign_get_submission_status per assignment and strips HTML', async () => {
		const { data } = await callTool('moodle_get_assignments', { include_feedback: true });
		expect(fnsCalled().filter((f) => f === 'mod_assign_get_submission_status')).toHaveLength(2);
		expect(data.items[0]).toMatchObject({ submission_status: 'submitted', grade: '8 / 10', grader_comment: 'Good work' });
		const status = calls.find((c) => c.fn === 'mod_assign_get_submission_status' && c.year === Y26)!;
		expect(status.params.get('assignid')).toBe('5');
	});

	it('course_ids are filtered per year to the courses enrolled there', async () => {
		await callTool('moodle_get_assignments', { course_ids: [20] });
		expect(yearsCalled('mod_assign_get_assignments')).toEqual([Y26]); // course 20 does not exist in 2025-2026
		const c = calls.find((x) => x.fn === 'mod_assign_get_assignments')!;
		expect(c.params.get('courseids[0]')).toBe('20');
	});
});

describe('id tools', () => {
	it('moodle_get_course_contents: id in one year resolves it; HTML stripped, noise dropped', async () => {
		const { data, isError } = await callTool('moodle_get_course_contents', { course_id: 20 });
		expect(isError).toBe(false);
		expect(data.year).toBe(Y26);
		expect(data.sections[0].summary).toBe('Welcome all');
		const [forum, file] = data.sections[0].modules;
		expect(forum).toMatchObject({ id: 100, instance: 7, modname: 'forum', description: 'News' });
		expect(file.contents[0].api_file_url).toBe(`/api/file?url=${encodeURIComponent('https://moodle.srce.hr/pluginfile.php/1/slides.pdf')}`);
		expect(file.contents[0]).not.toHaveProperty('fileurl');
		const c = calls.find((x) => x.fn === 'core_course_get_contents')!;
		expect(c.year).toBe(Y26);
		expect(c.params.get('courseid')).toBe('20');
		expect(data.truncated).toBeUndefined();
	});

	it('an id present in two years returns an error asking for year', async () => {
		const { isError, text } = await callTool('moodle_get_course_contents', { course_id: 10 });
		expect(isError).toBe(true);
		expect(text).toMatch(/more than one Merlin year/);
		expect(text).toMatch(/Pass year/);
		expect(fnsCalled()).not.toContain('core_course_get_contents');
	});

	it('the same error applies to moodle_list_files and moodle_get_updates_since', async () => {
		for (const name of ['moodle_list_files', 'moodle_get_updates_since']) {
			const { isError, text } = await callTool(name, { course_id: 10 });
			expect(isError).toBe(true);
			expect(text).toMatch(/Pass year/);
		}
	});

	it('an explicit year settles the collision', async () => {
		const { data, isError } = await callTool('moodle_get_course_contents', { course_id: 10, year: Y25 });
		expect(isError).toBe(false);
		expect(data.year).toBe(Y25);
	});

	it('an unknown id is an error naming the years searched', async () => {
		const { isError, text } = await callTool('moodle_get_course_contents', { course_id: 12345 });
		expect(isError).toBe(true);
		expect(text).toMatch(/not found in any active Merlin year/);
	});

	it('moodle_list_files: flat file list with a relative download url', async () => {
		const { data } = await callTool('moodle_list_files', { course_id: 20 });
		expect(data.year).toBe(Y26);
		expect(data.files).toHaveLength(1);
		expect(data.files[0]).toMatchObject({ section: 'General', module: 'Slides', filename: 'slides.pdf', filesize: 10 });
		expect(data.files[0].api_file_url).toMatch(/^\/api\/file\?url=/);
	});

	it('moodle_get_updates_since: calls core_course_get_updates_since with a since timestamp', async () => {
		const { data } = await callTool('moodle_get_updates_since', { course_id: 20, hours_ago: 2 });
		expect(data).toMatchObject({ year: Y26, course_id: 20 });
		expect(data.instances).toHaveLength(1);
		const c = calls.find((x) => x.fn === 'core_course_get_updates_since')!;
		const age = Date.now() / 1000 - Number(c.params.get('since'));
		expect(age).toBeGreaterThan(7100);
		expect(age).toBeLessThan(7300);
	});

	it('moodle_get_recent_forum_posts: forum_id resolves via mod_forum_get_forums_by_courses', async () => {
		const { data } = await callTool('moodle_get_recent_forum_posts', { forum_id: 7, limit: 5 });
		expect(data.year).toBe(Y26); // forum 7 only exists in 2026-2027
		expect(data.discussions[0]).toMatchObject({ discussion: 55, author: 'Test Teacher', message: 'Exam on Friday' });
		const c = calls.find((x) => x.fn === 'mod_forum_get_forum_discussions')!;
		expect(c.params.get('forumid')).toBe('7');
		expect(c.params.get('perpage')).toBe('5');
		expect(fnsCalled()).toContain('mod_forum_get_forums_by_courses');
	});

	it('moodle_get_forum_discussion: uses mod_forum_get_discussion_posts, strips HTML, finds the one year that has it', async () => {
		const { data, isError } = await callTool('moodle_get_forum_discussion', { discussion_id: 55 });
		expect(isError).toBe(false);
		expect(data.year).toBe(Y26);
		expect(data.posts[0]).toMatchObject({ author: 'Test Teacher', message: 'See link' });
		expect(yearsCalled('mod_forum_get_discussion_posts')).toEqual([Y25, Y26]);
		expect(fnsCalled()).not.toContain('mod_forum_get_forum_discussions');
		expect(calls.find((x) => x.fn === 'mod_forum_get_discussion_posts')!.params.get('discussionid')).toBe('55');
	});

	it('moodle_get_forum_discussion: found in both years returns an error asking for year', async () => {
		overrides.mod_forum_get_discussion_posts = () => ({ posts: [{ id: 1, author: { fullname: 'Test Teacher' }, message: 'x' }] });
		const { isError, text } = await callTool('moodle_get_forum_discussion', { discussion_id: 55 });
		expect(isError).toBe(true);
		expect(text).toMatch(/more than one Merlin year/);
		expect(text).toMatch(/Pass year/);
	});

	it('moodle_get_quiz_attempts: quiz_id resolves its year, passes status', async () => {
		const { data } = await callTool('moodle_get_quiz_attempts', { quiz_id: 3 });
		expect(data).toMatchObject({ year: Y26, quiz_id: 3 });
		expect(data.attempts[0]).toMatchObject({ id: 31, state: 'finished', sumgrades: 7 });
		const c = calls.find((x) => x.fn === 'mod_quiz_get_user_attempts')!;
		expect(c.params.get('quizid')).toBe('3');
		expect(c.params.get('status')).toBe('finished');
	});

	it('moodle_get_quiz_attempt_review: strips the question html blob, finds the one year with the attempt', async () => {
		const { data, isError } = await callTool('moodle_get_quiz_attempt_review', { attempt_id: 31 });
		expect(isError).toBe(false);
		expect(data).toMatchObject({ year: Y26, attempt_id: 31, grade: 7 });
		expect(data.questions[0]).toMatchObject({ number: 1, state: 'gradedright', mark: '1.00', text: '2+2 = 4' });
		expect(yearsCalled('mod_quiz_get_attempt_review')).toEqual([Y25, Y26]);
		expect(calls.find((x) => x.fn === 'mod_quiz_get_attempt_review')!.params.get('page')).toBe('-1');
	});
});

describe('moodle_send_message through tools/call', () => {
	const created: any[] = [];
	const env = () => ({
		...ENV,
		APPROVALS: {
			idFromName: () => 'a',
			get: () => ({
				create: async (input: any) => {
					created.push(input);
					return { ok: true, existing: false, item: { id: 'abc123', expires: Date.now() + 30 * 60_000 } };
				},
			}),
		},
	});

	it('only creates a pending send: nothing is sent, no send function is called', async () => {
		const { data, isError } = await callTool('moodle_send_message', { to_user_id: 777, text: 'Bok!' }, env());
		expect(isError).toBe(false);
		expect(data).toMatchObject({ status: 'pending_approval', sent: false, to_user_id: 777, to_name: 'Test Recipient', year: Y26 });
		expect(created).toEqual([{ year: Y26, to_user_id: 777, to_name: 'Test Recipient', text: 'Bok!' }]);
		expect(fnsCalled()).not.toContain('core_message_send_instant_messages');
	});

	it('refuses someone the owner has no conversation with', async () => {
		const { isError, text } = await callTool('moodle_send_message', { to_user_id: 999, text: 'hi' }, env());
		expect(isError).toBe(true);
		expect(text).toMatch(/no existing Merlin conversation/);
		expect(fnsCalled()).not.toContain('core_message_send_instant_messages');
	});
});

describe('guard: the MCP surface stays read-only', () => {
	const KNOWN_TOOLS = [
		'moodle_get_all_updates_since',
		'moodle_get_assignments',
		'moodle_get_calendar_events',
		'moodle_get_choices',
		'moodle_get_course_contents',
		'moodle_get_courses',
		'moodle_get_forum_discussion',
		'moodle_get_grades',
		'moodle_get_messages',
		'moodle_get_my_groups',
		'moodle_get_new_forum_posts',
		'moodle_get_notifications',
		'moodle_get_quiz_attempt_review',
		'moodle_get_quiz_attempts',
		'moodle_get_quiz_details',
		'moodle_get_recent_forum_posts',
		'moodle_get_upcoming_deadlines',
		'moodle_get_updates_since',
		'moodle_list_files',
		'moodle_read_file',
		'moodle_send_message',
		'moodle_whoami',
	];

	it('tools/list returns exactly the 22 known tools (adding one forces updating this list and its tests)', async () => {
		const body = (await (await worker.fetch(rpc('tools/list'), ENV, ctx)).json()) as any;
		const names: string[] = body.result.tools.map((t: { name: string }) => t.name).sort();
		expect(names).toEqual([...KNOWN_TOOLS].sort());
		expect(names).toHaveLength(22);
	});

	it('every tool, called with realistic arguments, only sends read-only wsfunctions', async () => {
		const sweep: Array<[string, Record<string, unknown>]> = [
			['moodle_get_assignments', { include_feedback: true }],
			['moodle_get_calendar_events', {}],
			['moodle_get_course_contents', { course_id: 20 }],
			['moodle_get_courses', {}],
			['moodle_get_forum_discussion', { discussion_id: 55 }],
			['moodle_get_grades', {}],
			['moodle_get_messages', {}],
			['moodle_get_messages', { conversation_id: 1 }],
			['moodle_get_notifications', {}],
			['moodle_get_quiz_attempt_review', { attempt_id: 31 }],
			['moodle_get_quiz_attempts', { quiz_id: 3 }],
			['moodle_get_recent_forum_posts', { forum_id: 7 }],
			['moodle_get_upcoming_deadlines', {}],
			['moodle_get_updates_since', { course_id: 20 }],
			['moodle_list_files', { course_id: 20 }],
			['moodle_send_message', { to_user_id: 777, text: 'Bok!' }],
			['moodle_whoami', {}],
			['moodle_get_quiz_details', {}],
			['moodle_get_my_groups', {}],
			['moodle_get_new_forum_posts', { forums: 'all', since: 1 }],
			['moodle_get_choices', { include_closed: true }],
			['moodle_get_all_updates_since', { since: 1 }],
		];
		const env = {
			...ENV,
			APPROVALS: {
				idFromName: () => 'a',
				get: () => ({ create: async () => ({ ok: true, existing: false, item: { id: 'abc', expires: Date.now() + 1000 } }) }),
			},
		};
		for (const [name, args] of sweep) {
			const { isError, text } = await callTool(name, args, env);
			expect(isError, `${name}: ${text.slice(0, 200)}`).toBe(false);
		}
		const sent = new Set(fnsCalled());
		// Cover the whole file too, not just this sweep.
		for (const f of seenFunctions) sent.add(f);
		expect(sent.size).toBeGreaterThan(10);

		const WRITE_VERB = /_(save|submit|update|delete|create|add|set|mark|send|process|start|view)_/;
		const offenders = [...sent].filter((f) => WRITE_VERB.test(f));
		expect(offenders).toEqual([]);
		expect(sent.has('core_message_send_instant_messages')).toBe(false);
		// Every function a tool calls is a getter.
		expect([...sent].filter((f) => !/_get_/.test(f))).toEqual([]);
	});
});

// ---------- moodle_read_file ----------

/** Smallest valid PDF with one text line per page (xref offsets computed). */
function makePdf(pages: string[]): Uint8Array {
	const objs: string[] = [];
	const kids = pages.map((_, i) => `${3 + i * 2} 0 R`).join(' ');
	objs.push('<< /Type /Catalog /Pages 2 0 R >>');
	objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
	const fontId = 3 + pages.length * 2;
	pages.forEach((t, i) => {
		const stream = `BT /F1 12 Tf 72 720 Td (${t}) Tj ET`;
		objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${4 + i * 2} 0 R >>`);
		objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
	});
	objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
	let out = '%PDF-1.4\n';
	const offsets: number[] = [];
	objs.forEach((o, i) => {
		offsets.push(out.length);
		out += `${i + 1} 0 obj\n${o}\nendobj\n`;
	});
	const xref = out.length;
	out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
	for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
	out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
	return new TextEncoder().encode(out);
}

describe('moodle_read_file', () => {
	const PATH = '/2026-2027/webservice/pluginfile.php/1/mod_resource/content/0/';
	const raw = (name: string) => `https://moodle.srce.hr${PATH}${encodeURIComponent(name)}`;
	const api = (name: string) => `/api/file?url=${encodeURIComponent(raw(name))}`;

	it('reads a PDF page range from the api_file_url form, adding the token server-side only', async () => {
		files[PATH + '6.pdf'] = { body: makePdf(['Model procesa', 'Dijagram toka podataka', 'Balans']), headers: { 'Content-Type': 'application/pdf' } };
		const { isError, text, data } = await callTool('moodle_read_file', { url: api('6.pdf'), pages: '2-3' });
		expect(isError, text).toBe(false);
		expect(data).toMatchObject({ filename: '6.pdf', kind: 'pdf', total_pages: 3, pages: '2-3' });
		expect(data.bytes).toBeGreaterThan(100);
		expect(data.text).toContain('--- page 2 ---');
		expect(data.text).toContain('Dijagram toka podataka');
		expect(data.text).toContain('Balans');
		expect(data.text).not.toContain('Model procesa');
		expect(fileFetches[0].searchParams.get('token')).toBeTruthy();
		expect(text).not.toContain(fileFetches[0].searchParams.get('token')!);
	});

	it('reads plain text and strips HTML', async () => {
		files[PATH + 'notes.md'] = { body: '# DTP\nproces = glagol', headers: { 'Content-Type': 'application/octet-stream' } };
		files[PATH + 'page.html'] = { body: '<p>Tok <b>podataka</b></p><script>x()</script>', headers: { 'Content-Type': 'text/html' } };
		expect((await callTool('moodle_read_file', { url: raw('notes.md') })).data).toMatchObject({ kind: 'text', text: '# DTP\nproces = glagol' });
		const html = (await callTool('moodle_read_file', { url: raw('page.html') })).data;
		expect(html.kind).toBe('html');
		expect(html.text).toContain('Tok podataka');
		expect(html.text).not.toContain('<b>');
	});

	it('cuts long text at max_chars and says so', async () => {
		files[PATH + 'long.txt'] = { body: 'a'.repeat(5000), headers: { 'Content-Type': 'text/plain' } };
		const { data } = await callTool('moodle_read_file', { url: raw('long.txt'), max_chars: 1000 });
		expect(data.text).toHaveLength(1000);
		expect(data.truncated).toBe(true);
	});

	it('refuses other hosts, unsupported types, oversized files and Moodle error pages', async () => {
		const evil = await callTool('moodle_read_file', { url: 'https://evil.example/2026-2027/pluginfile.php/1/x.pdf' });
		expect(evil.isError).toBe(true);
		expect(fileFetches).toHaveLength(0);

		files[PATH + 'a.docx'] = { body: 'PK..', headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' } };
		const docx = await callTool('moodle_read_file', { url: raw('a.docx') });
		expect(docx.isError).toBe(true);
		expect(docx.text).toMatch(/Can't read text/);

		files[PATH + 'big.pdf'] = { body: 'x', headers: { 'Content-Type': 'application/pdf', 'Content-Length': String(40 * 1024 * 1024) } };
		const big = await callTool('moodle_read_file', { url: raw('big.pdf') });
		expect(big.isError).toBe(true);
		expect(big.text).toMatch(/over 30 MB/);

		const missing = await callTool('moodle_read_file', { url: raw('nope.pdf') });
		expect(missing.isError).toBe(true);
		expect(missing.text).toMatch(/Moodle answered 404/);
		expect(missing.text).not.toMatch(/token=/);
	});

	it('stops reading PDF pages once max_chars is reached', async () => {
		files[PATH + 'many.pdf'] = { body: makePdf(Array.from({ length: 40 }, (_, i) => `Page ${i + 1} ` + 'x'.repeat(60))), headers: { 'Content-Type': 'application/pdf' } };
		const { data } = await callTool('moodle_read_file', { url: raw('many.pdf'), max_chars: 1000 });
		expect(data.total_pages).toBe(40);
		expect(data.truncated).toBe(true);
		const last = Number(String(data.pages).split('-')[1]);
		expect(last).toBeLessThan(40);
		expect(data.hint).toMatch(/next pages/);
	});

	it('rejects a page outside the PDF', async () => {
		files[PATH + 'one.pdf'] = { body: makePdf(['only']), headers: { 'Content-Type': 'application/pdf' } };
		const r = await callTool('moodle_read_file', { url: raw('one.pdf'), pages: '5' });
		expect(r.isError).toBe(true);
		expect(r.text).toMatch(/has 1 page/);
	});
});

// ---------- Collage feature batch (15 Nov 2026) ----------

describe('moodle_get_quiz_details', () => {
	it('returns the rules and attempts left without touching an attempt', async () => {
		overrides.mod_quiz_get_user_attempts = () => ({ attempts: [{ id: 31, attempt: 1, state: 'finished' }] });
		const { data } = await callTool('moodle_get_quiz_details', { year: Y26 });
		expect(data.items).toHaveLength(1);
		expect(data.items[0]).toMatchObject({
			quiz_id: 3,
			course: 'Test Course 101',
			time_limit_minutes: 15,
			attempts_allowed: 2,
			attempts_used: 1,
			attempts_left: 1,
			grading_method: 'highest',
			max_grade: 10,
		});
		const fns = fnsCalled();
		expect(fns).toContain('mod_quiz_get_user_attempts');
		expect(calls.find((c) => c.fn === 'mod_quiz_get_user_attempts')!.params.get('status')).toBe('all');
		expect(fns.filter((f) => /attempt_access|start_attempt|view_quiz|get_attempt_data|get_attempt_summary/.test(f))).toEqual([]);
	});

	it('reports unlimited attempts and no time limit', async () => {
		overrides.mod_quiz_get_user_attempts = () => ({ attempts: [] });
		const { data } = await callTool('moodle_get_quiz_details', { year: Y25 });
		expect(data.items[0]).toMatchObject({ attempts_allowed: 'unlimited', attempts_left: 'unlimited', time_limit_minutes: null, grading_method: 'last' });
	});
});

describe('moodle_get_my_groups', () => {
	it('lists groups across courses with course names', async () => {
		const { data } = await callTool('moodle_get_my_groups', { year: Y26 });
		expect(data.items).toEqual([expect.objectContaining({ group_id: 501, name: 'G2', course: 'Test Course 101', description: 'Lab 2' })]);
		const c = calls.find((x) => x.fn === 'core_group_get_course_user_groups')!;
		expect(c.params.get('courseid')).toBe('0');
		expect(c.params.get('userid')).toBe('42');
	});
});

describe('moodle_get_new_forum_posts', () => {
	it('defaults to announcement forums, filters by time, never reads posts', async () => {
		overrides.mod_forum_get_forum_discussions = (_y, p) => ({
			discussions: [
				{ id: 1, discussion: 55, subject: 'New exam room', userfullname: 'Test Teacher', created: 5000, timemodified: 5000, numreplies: 0, message: '<p>Room <b>028</b></p>' },
				{ id: 2, discussion: 56, subject: 'Old news', userfullname: 'Test Teacher', created: 10, timemodified: 10, numreplies: 0, message: 'x' },
			].map((d) => ({ ...d, forumid: p.get('forumid') })),
		});
		const { data } = await callTool('moodle_get_new_forum_posts', { year: Y26, since: 1000 });
		expect(data.items).toHaveLength(1);
		expect(data.items[0]).toMatchObject({ forum: 'Obavijesti', course: 'Test Course 101', subject: 'New exam room', message: 'Room 028' });
		const forumsRead = calls.filter((c) => c.fn === 'mod_forum_get_forum_discussions').map((c) => c.params.get('forumid'));
		expect(forumsRead).toEqual(['7']);
		expect(fnsCalled()).not.toContain('mod_forum_get_discussion_posts');
	});

	it('forums="all" reads every forum', async () => {
		await callTool('moodle_get_new_forum_posts', { year: Y26, forums: 'all', since: 1 });
		expect(calls.filter((c) => c.fn === 'mod_forum_get_forum_discussions').map((c) => c.params.get('forumid')).sort()).toEqual(['7', '70']);
	});
});

describe('moodle_get_choices', () => {
	it('lists open choices with options and my pick, without answering', async () => {
		const { data } = await callTool('moodle_get_choices', { year: Y26 });
		expect(data.items).toHaveLength(1);
		expect(data.items[0]).toMatchObject({ name: 'Prijava za vježbe', course: 'Test Course 202', open_now: true, can_change_answer: true, my_pick: ['Grupa 2 (12:00)'] });
		expect(data.items[0].options[0]).toMatchObject({ text: 'Grupa 1 (10:15)', taken: 20, max: 20, full: true });
		expect(fnsCalled().filter((f) => /submit|delete|view/.test(f))).toEqual([]);
	});

	it('include_closed adds closed ones', async () => {
		const { data } = await callTool('moodle_get_choices', { year: Y26, include_closed: true });
		expect(data.items.map((c: any) => c.name)).toEqual(['Closed poll', 'Prijava za vježbe']);
	});
});

describe('moodle_get_all_updates_since', () => {
	it('names changed modules per course and falls back to file times when Merlin errors', async () => {
		overrides.core_course_get_updates_since = (_y, p) =>
			p.get('courseid') === '20'
				? { exception: 'dml_read_exception', message: 'Pogreška pri čitanju iz baze podataka' }
				: { instances: [{ contextlevel: 'module', id: 100, updates: [{ name: 'posts', timeupdated: 4000 }] }], warnings: [] };
		const { data } = await callTool('moodle_get_all_updates_since', { year: Y26, since: 1 });
		const c10 = data.items.find((c: any) => c.courseid === 10);
		expect(c10.changes[0]).toMatchObject({ cmid: 100, name: 'Announcements', type: 'forum', section: 'General', what: ['posts'] });
		const c20 = data.items.find((c: any) => c.courseid === 20);
		expect(c20.partial).toMatch(/only new or changed files/);
		expect(c20.changes[0]).toMatchObject({ cmid: 101, name: 'Slides', files: ['slides.pdf'] });
		expect(data.errors).toBeUndefined();
	});

	it('lists partial courses with no file changes once instead of as empty items', async () => {
		overrides.core_course_get_updates_since = () => ({ exception: 'dml_read_exception', message: 'Pogreška pri čitanju iz baze podataka' });
		const { data } = await callTool('moodle_get_all_updates_since', { year: Y26, since: 10 });
		expect(data.items).toEqual([]);
		expect(data.not_fully_checked).toEqual(['Test Course 101 (2026-2027)', 'Test Course 202 (2026-2027)']);
	});
});

describe('moodle_get_upcoming_deadlines quiz context', () => {
	it('adds time limit and attempts left to quiz items', async () => {
		overrides.core_calendar_get_action_events_by_timesort = () => ({
			events: [
				{ id: 9, name: 'Samoprovjera closes', course: { id: 10, fullname: 'Test Course 101' }, modulename: 'quiz', instance: 300, timesort: 9500, url: 'https://x' },
				{ id: 8, name: 'Essay due', course: { id: 10, fullname: 'Test Course 101' }, modulename: 'assign', instance: 5, timesort: 9000, url: 'https://x' },
			],
		});
		overrides.mod_quiz_get_user_attempts = () => ({ attempts: [] });
		const { data } = await callTool('moodle_get_upcoming_deadlines', { year: Y26 });
		const quiz = data.items.find((e: any) => e.activity === 'quiz');
		expect(quiz.quiz).toEqual({ quiz_id: 3, time_limit_minutes: 15, attempts_allowed: 2, attempts_used: 0, attempts_left: 2 });
		expect(data.items.find((e: any) => e.activity === 'assign').quiz).toBeUndefined();
	});
});
