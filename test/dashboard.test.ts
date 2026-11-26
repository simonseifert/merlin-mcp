import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index.js';
import { __resetCaches } from '../src/app.js';
import { __resetDashboardCache, classifyItem, cleanTitle, configureClassification, parsePercent } from '../src/dashboard.js';
import { dashboardFile, dashboardOpen } from '../src/node.js';

// GET /api/dashboard through the real Worker entry, with a mocked Merlin. All data is fake.

const Y = '2026-2027';
const ENV = {
	MOODLE_TOKEN: 'the-moodle-token',
	MCP_BEARER: 'the-mcp-secret',
	API_BEARER: 'the-api-secret',
	DASHBOARD_KEY: 'the-dashboard-key',
	LEGACY_API_BEARER: '0',
	MERLIN_YEARS: Y,
	MOODLE_URL: `https://moodle.srce.hr/${Y}`,
} as any;
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
const NOW = Math.floor(Date.now() / 1000);
const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { 'Content-Type': 'application/json' } });

const seen: string[] = [];
function merlin(fn: string): unknown {
	switch (fn) {
		case 'core_webservice_get_site_info':
			return { userid: 42, fullname: 'Test Student', firstname: 'Test', sitename: 'Merlin', userprivateaccesskey: 'PRIVKEY' };
		case 'core_enrol_get_users_courses':
			return [{ id: 10, shortname: 'TEST101', fullname: 'Test Course 101', visible: 1 }];
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
			return {
				events: [
					{ id: 1, name: 'Međuispit', courseid: 10, eventtype: 'course', timestart: NOW + 86400, timeduration: 5400, location: 'A-1' },
					{ id: 2, name: 'Predavanje', courseid: 10, eventtype: 'course', timestart: NOW + 3600 },
				],
			};
		case 'core_calendar_get_action_events_by_timesort':
			return {
				events: [
					{ id: 3, name: 'Seminar: Tržište is due', modulename: 'assign', instance: 7, timesort: NOW + 5 * 86400, course: { id: 10, fullname: 'Test Course 101' } },
					{ id: 4, name: 'Kviz 2 closes', modulename: 'quiz', instance: 70, timesort: NOW + 6 * 86400, course: { id: 10, fullname: 'Test Course 101' } },
				],
			};
		case 'mod_assign_get_assignments':
			return { courses: [{ id: 10, fullname: 'Test Course 101', assignments: [{ id: 7, name: 'Seminar: Tržište', duedate: NOW + 5 * 86400, intro: '<p>10 stranica</p>' }, { id: 8, name: 'Zadaća 1', duedate: NOW + 86400 }] }] };
		case 'mod_forum_get_forums_by_courses':
			return [{ id: 5, course: 10, name: 'Obavijesti', type: 'news' }];
		case 'mod_forum_get_forum_discussions':
			return { discussions: [{ discussion: 99, subject: 'Termin kolokvija', userfullname: 'Prof', created: NOW - 3600, timemodified: NOW - 3600, message: '<p>Utorak u 10</p>' }] };
		default:
			return { exception: 'moodle_exception', errorcode: 'unexpected', message: fn };
	}
}

beforeEach(() => {
	__resetCaches();
	__resetDashboardCache();
	seen.length = 0;
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: string, init?: RequestInit) => {
			const params = new URLSearchParams(new URL(input).search);
			if (init?.body instanceof URLSearchParams) for (const [k, v] of init.body) params.set(k, v);
			const fn = params.get('wsfunction') ?? '';
			seen.push(fn);
			return json(merlin(fn));
		})
	);
});
afterEach(() => vi.unstubAllGlobals());

const get = (path: string, bearer?: string) =>
	worker.fetch(new Request(`https://merlin.example${path}`, { headers: bearer ? { Authorization: `Bearer ${bearer}` } : {} }), ENV, ctx);

describe('classifyItem', () => {
	it.each([
		['Prvi kolokvij', 'exam'],
		['Međuispit', 'exam'],
		['Završni ispit (pismeni)', 'exam'],
		['Usmeni ispit', 'exam'],
		['Seminar: ER dijagram is due', 'seminar'],
		['Esej: Business ethics', 'seminar'],
		['Prezentacija case studyja', 'seminar'],
		['Predavanje', 'event'],
		['MID TERM 1 - REVISION', 'exam'],
		['Results - 1st midterm exam', 'exam'],
		['Rok za Submitting the presentation deadline', 'seminar'],
		['Term project', 'seminar'],
		['Projekt: Kalkulator', 'seminar'],
		['Projektni zadatak 2', 'seminar'],
		['Pismeni test iz statistike', 'exam'],
		['Kolokviji - rezultati', 'exam'],
		// Not exams or seminars, though the old patterns said so.
		['Ispitivanje softvera - predavanje', 'event'],
		['Projektni menadžment - predavanje', 'event'],
		['Završni rad: konzultacije', 'event'],
		['Finalna verzija prezentacije uploadana', 'seminar'],
		['Testiranje aplikacije', 'event'],
	])('%s -> %s', (name, kind) => expect(classifyItem(name)).toBe(kind));

	it('a weekly Moodle quiz called "Test" is a deadline, not an exam', () => {
		expect(classifyItem('Test 3 closes', { activity: 'quiz', eventtype: 'close' })).toBe('deadline');
		expect(classifyItem('Test iz matematike', { eventtype: 'course' })).toBe('exam');
	});

	it('takes a faculty\'s own words', () => {
		expect(classifyItem('Praktikum 2')).toBe('event');
		configureClassification({ examWords: 'praktikum, lab test', seminarWords: 'izvještaj' });
		try {
			expect(classifyItem('Praktikum 2')).toBe('exam');
			expect(classifyItem('Lab test A')).toBe('exam');
			expect(classifyItem('Laboratorijski izvještaj 1')).toBe('seminar');
			expect(classifyItem('Superpraktikum')).toBe('event');
		} finally {
			configureClassification({});
		}
	});

	it('uses Moodle types when the name says nothing', () => {
		expect(classifyItem('Zadaća 3 is due', { activity: 'assign', eventtype: 'due' })).toBe('deadline');
		expect(classifyItem('Predavanje', { eventtype: 'course' })).toBe('class');
	});
	it('does not call a lecture an exam because its notes mention one', () => {
		expect(classifyItem('Predavanje 5', { eventtype: 'course', description: 'priprema za kolokvij' })).toBe('class');
	});
});

describe('cleanTitle', () => {
	it("drops Moodle's due wording", () => {
		expect(cleanTitle('Rok za Submitting the presentation deadline')).toBe('Submitting the presentation');
		expect(cleanTitle('Zadaća 3 is due')).toBe('Zadaća 3');
	});
});

describe('parsePercent', () => {
	it('reads Croatian formatting', () => {
		expect(parsePercent('90,00 %')).toBe(90);
		expect(parsePercent('-')).toBeUndefined();
		expect(parsePercent(undefined)).toBeUndefined();
	});
});

describe('GET /api/dashboard', () => {
	it('needs a key', async () => {
		expect((await get('/api/dashboard')).status).toBe(401);
		expect((await get('/api/dashboard', 'wrong')).status).toBe(401);
		expect(seen).toEqual([]);
	});

	it('DASHBOARD_KEY opens the dashboard and nothing else', async () => {
		expect((await get('/api/call?wsfunction=core_webservice_get_site_info', 'the-dashboard-key')).status).toBe(401);
		expect((await get('/api/notifications', 'the-dashboard-key')).status).toBe(401);
		expect((await worker.fetch(new Request('https://merlin.example/mcp', { method: 'POST', headers: { Authorization: 'Bearer the-dashboard-key' } }), ENV, ctx)).status).toBe(401);
		expect((await get('/api/dashboard', 'the-dashboard-key')).status).toBe(200);
		expect((await get('/api/dashboard', 'the-api-secret')).status).toBe(200);
	});

	it('part=main: account, courses, calendar, exams and seminars in about 5 calls', async () => {
		const res = await get('/api/dashboard', 'the-dashboard-key');
		expect(res.headers.get('Cache-Control')).toBe('no-store');
		const d = (await res.json()) as any;
		expect(d.user.fullname).toBe('Test Student');
		expect(d.courses).toEqual([expect.objectContaining({ key: `${Y}:10`, name: 'Test Course 101', items: [] })]);
		expect(d.exams.map((e: any) => e.title)).toEqual(['Međuispit']);
		expect(d.events.find((e: any) => e.title === 'Seminar: Tržište')).toMatchObject({ kind: 'seminar', todo: true });
		expect(d.seminars).toEqual([expect.objectContaining({ title: 'Seminar: Tržište', intro: '10 stranica', source: 'assignment' })]);
		expect(d.announcements).toEqual([]);
		// One site_info for whoami and the user id, no quiz lookups, no grades, no forums.
		expect(seen.filter((f) => f === 'core_webservice_get_site_info')).toHaveLength(1);
		expect(seen.some((f) => f.startsWith('mod_quiz_') || f.startsWith('gradereport_') || f.startsWith('mod_forum_'))).toBe(false);
		expect(seen).toHaveLength(5);
		// Never logs a teacher-visible feedback view, never leaks a key.
		expect(seen).not.toContain('mod_assign_get_submission_status');
		expect(JSON.stringify(d)).not.toMatch(/PRIVKEY|the-moodle-token/);
	});

	it('part=grades: points and every graded item per course', async () => {
		const d = (await (await get('/api/dashboard?part=grades', 'the-dashboard-key')).json()) as any;
		expect(d.courses).toHaveLength(1);
		expect(d.courses[0]).toMatchObject({ key: `${Y}:10`, total: { raw: 18, max: 100, percent: 18 } });
		expect(d.courses[0].items).toEqual([expect.objectContaining({ name: 'Kolokvij 1', raw: 18, max: 25, percent: 72, feedback: 'Dobro' })]);
		expect(seen.filter((f) => f === 'gradereport_user_get_grade_items')).toHaveLength(1);
		expect(JSON.stringify(d)).not.toMatch(/PRIVKEY|the-moodle-token/);
	});

	it('part=announcements: announcement forums only, never marks a thread read', async () => {
		const d = (await (await get('/api/dashboard?part=announcements', 'the-dashboard-key')).json()) as any;
		expect(d.announcements[0]).toMatchObject({ subject: 'Termin kolokvija', kind: 'exam', message: 'Utorak u 10' });
		expect(seen).not.toContain('mod_forum_get_discussion_posts');
		expect(seen).not.toContain('gradereport_user_get_grade_items');
	});

	it('never serves one token\'s data to another (caches are keyed by token as well as year)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: string, init?: RequestInit) => {
				const params = new URLSearchParams(new URL(input).search);
				if (init?.body instanceof URLSearchParams) for (const [k, v] of init.body) params.set(k, v);
				const fn = params.get('wsfunction') ?? '';
				const who = params.get('wstoken') === 'token-b' ? 'B' : 'A';
				if (fn === 'core_webservice_get_site_info') return json({ userid: who === 'A' ? 1 : 2, fullname: `Student ${who}` });
				if (fn === 'core_enrol_get_users_courses') return json([{ id: who === 'A' ? 10 : 20, fullname: `Course of ${who}` }]);
				return json(merlin(fn));
			})
		);
		const as = async (token: string) =>
			(await (await worker.fetch(new Request('https://merlin.example/api/dashboard', { headers: { Authorization: 'Bearer the-dashboard-key' } }), { ...ENV, MOODLE_TOKEN: token }, ctx)).json()) as any;
		const a = await as('token-a');
		const b = await as('token-b');
		expect(a.user.fullname).toBe('Student A');
		expect(b.user.fullname).toBe('Student B');
		expect(b.courses.map((c: any) => c.name)).toEqual(['Course of B']);
	});

	it('rejects an unknown part', async () => {
		expect((await get('/api/dashboard?part=everything', 'the-dashboard-key')).status).toBe(400);
		expect(seen).toEqual([]);
	});

	it('caches each part on its own, and fresh=1 reloads', async () => {
		await get('/api/dashboard', 'the-dashboard-key');
		const first = seen.length;
		await get('/api/dashboard', 'the-dashboard-key');
		expect(seen.length).toBe(first);
		await get('/api/dashboard?part=grades', 'the-dashboard-key');
		expect(seen.length).toBeGreaterThan(first);
		const second = seen.length;
		await get('/api/dashboard?part=grades', 'the-dashboard-key');
		expect(seen.length).toBe(second);
		await get('/api/dashboard?fresh=1', 'the-dashboard-key');
		expect(seen.length).toBeGreaterThan(second);
	});

	it('reports a failing part instead of failing the page', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: string, init?: RequestInit) => {
				const params = new URLSearchParams(new URL(input).search);
				if (init?.body instanceof URLSearchParams) for (const [k, v] of init.body) params.set(k, v);
				const fn = params.get('wsfunction') ?? '';
				if (fn === 'mod_assign_get_assignments') return new Response('boom', { status: 500 });
				return json(merlin(fn));
			})
		);
		const d = (await (await get('/api/dashboard', 'the-dashboard-key')).json()) as any;
		expect(d.courses).toHaveLength(1);
		expect(d.errors.map((e: any) => e.part).join(' ')).toMatch(/assignments/);
	});

	it('needs no key only when the Node server says it is loopback-only', async () => {
		const local = (host: string, origin?: string) =>
			worker.fetch(new Request('http://127.0.0.1:8787/api/dashboard', { headers: { host, ...(origin ? { origin } : {}) } }), { ...ENV, DASHBOARD_OPEN: '1' }, ctx);
		expect((await local('127.0.0.1:8787')).status).toBe(200);
		expect((await local('localhost:8787', 'http://localhost:5173')).status).toBe(200);
		expect((await local('[::1]:8787')).status).toBe(200);
		// DNS rebinding: a foreign name pointed at 127.0.0.1, or a foreign page asking, gets no free pass.
		expect((await local('evil.example:8787')).status).toBe(401);
		expect((await local('127.0.0.1:8787', 'http://evil.example')).status).toBe(401);
		expect((await local('127.0.0.1.evil.example')).status).toBe(401);
		expect((await worker.fetch(new Request('https://merlin.example/api/dashboard'), { ...ENV, DASHBOARD_OPEN: '1' }, ctx)).status).toBe(401);
		// Open mode opens the dashboard route only.
		expect((await worker.fetch(new Request('https://merlin.example/api/call?wsfunction=core_webservice_get_site_info'), { ...ENV, DASHBOARD_OPEN: '1' }, ctx)).status).toBe(401);
		expect(dashboardOpen('127.0.0.1')).toBe(true);
		expect(dashboardOpen('::1')).toBe(true);
		expect(dashboardOpen('0.0.0.0')).toBe(false);
		expect(dashboardOpen('127.0.0.1', 'https://merlin.example')).toBe(false);
		expect(dashboardOpen('127.0.0.1', undefined, '0')).toBe(false);
	});

	it('rejects a malformed year', async () => {
		expect((await get('/api/dashboard?year=../x', 'the-dashboard-key')).status).toBe(400);
	});
});

describe('dashboardFile (Node static serving)', () => {
	it('only serves under /dashboard/ and cannot climb out', async () => {
		expect(await dashboardFile('/api/dashboard')).toBeUndefined();
		expect((await dashboardFile('/dashboard'))?.status).toBe(308);
		expect((await dashboardFile('/dashboard/..%2f..%2fpackage.json', '/nonexistent/dist/'))?.status).toBe(404);
		expect((await dashboardFile('/dashboard/%2e%2e/%2e%2e/src/app.ts'))?.status).toBe(404);
	});
});
