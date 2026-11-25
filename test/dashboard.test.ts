import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index.js';
import { __resetCaches } from '../src/app.js';
import { __resetDashboardCache, classifyItem, cleanTitle, isMerlinToken, parsePercent, tokenId } from '../src/dashboard.js';
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
			return { events: [{ id: 3, name: 'Seminar: Tržište is due', modulename: 'assign', instance: 7, timesort: NOW + 5 * 86400, course: { id: 10, fullname: 'Test Course 101' } }] };
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
	])('%s -> %s', (name, kind) => expect(classifyItem(name)).toBe(kind));

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

	it('folds grades, calendar, exams, seminars and announcements into one answer', async () => {
		const res = await get('/api/dashboard', 'the-dashboard-key');
		expect(res.headers.get('Cache-Control')).toBe('no-store');
		const d = (await res.json()) as any;
		expect(d.user.fullname).toBe('Test Student');
		expect(d.courses).toHaveLength(1);
		expect(d.courses[0].total).toMatchObject({ raw: 18, max: 100, percent: 18 });
		expect(d.courses[0].items).toEqual([expect.objectContaining({ name: 'Kolokvij 1', raw: 18, max: 25, percent: 72, feedback: 'Dobro' })]);
		expect(d.exams.map((e: any) => e.title)).toEqual(['Međuispit']);
		expect(d.events.find((e: any) => e.title === 'Seminar: Tržište')).toMatchObject({ kind: 'seminar', todo: true });
		expect(d.seminars).toEqual([expect.objectContaining({ title: 'Seminar: Tržište', intro: '10 stranica', source: 'assignment' })]);
		expect(d.announcements[0]).toMatchObject({ subject: 'Termin kolokvija', kind: 'exam', message: 'Utorak u 10' });
		// Never logs a teacher-visible feedback view, never marks a thread read, never leaks a key.
		expect(seen).not.toContain('mod_assign_get_submission_status');
		expect(seen).not.toContain('mod_forum_get_discussion_posts');
		expect(JSON.stringify(d)).not.toMatch(/PRIVKEY|the-moodle-token/);
	});

	it('caches, and fresh=1 reloads', async () => {
		await get('/api/dashboard', 'the-dashboard-key');
		const first = seen.length;
		await get('/api/dashboard', 'the-dashboard-key');
		expect(seen.length).toBe(first);
		await get('/api/dashboard?fresh=1', 'the-dashboard-key');
		expect(seen.length).toBeGreaterThan(first);
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
		const res = await worker.fetch(new Request('https://merlin.example/api/dashboard'), { ...ENV, DASHBOARD_OPEN: '1' }, ctx);
		expect(res.status).toBe(200);
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

describe('multi-user (DASHBOARD_MULTIUSER)', () => {
	const MU = { ...ENV, DASHBOARD_MULTIUSER: '1' } as any;
	const h = (token?: string) => (token ? { 'X-Merlin-Token': token } : {});
	const call = (path: string, token?: string) => worker.fetch(new Request(`https://merlin.example${path}`, { headers: h(token) }), MU, ctx);
	const USER = 'a'.repeat(32);

	it('isMerlinToken / tokenId', () => {
		expect(isMerlinToken(' ' + 'A'.repeat(32) + ' ')).toBe(true);
		expect(isMerlinToken('nope')).toBe(false);
		expect(tokenId('x')).not.toBe(tokenId('y'));
	});

	it('requires a token and rejects a malformed one', async () => {
		expect((await call('/api/dashboard')).status).toBe(401);
		expect((await call('/api/dashboard', 'short')).status).toBe(401);
		expect(seen).toEqual([]);
	});

	it('merlin-login validates a token via whoami', async () => {
		const res = await call('/api/merlin-login', USER);
		expect(res.status).toBe(200);
		expect((await res.json()).fullname).toBe('Test Student');
	});

	it('builds the dashboard with the caller token, not the shared one', async () => {
		const res = await call('/api/dashboard', USER);
		expect(res.status).toBe(200);
		const d = (await res.json()) as any;
		expect(d.user.fullname).toBe('Test Student');
		// the shared MOODLE_TOKEN must never go to Merlin in multi-user mode
		expect(JSON.stringify(d)).not.toMatch(/the-moodle-token/);
	});

	it('a user token does not open /api/call, /api/notifications or /mcp', async () => {
		expect((await call('/api/call?wsfunction=core_webservice_get_site_info', USER)).status).toBe(401);
		expect((await call('/api/notifications', USER)).status).toBe(401);
		expect((await worker.fetch(new Request('https://merlin.example/mcp', { method: 'POST', headers: h(USER) }), MU, ctx)).status).toBe(401);
	});

	it('separates the cache per token', async () => {
		await call('/api/dashboard', 'a'.repeat(32));
		const n1 = seen.length;
		await call('/api/dashboard', 'a'.repeat(32)); // cached
		expect(seen.length).toBe(n1);
		await call('/api/dashboard', 'b'.repeat(32)); // different user -> fresh fetch
		expect(seen.length).toBeGreaterThan(n1);
	});

	it('rejects a token Merlin refuses', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => json({ exception: 'moodle_exception', errorcode: 'invalidtoken', message: 'Invalid token' })));
		const login = await call('/api/merlin-login', USER);
		expect(login.status).toBe(401);
		const dash = await call('/api/dashboard', USER);
		expect(dash.status).toBe(401);
		expect(((await dash.json()) as any).login).toBe(true);
	});
});
