import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index.js';
import { __resetCaches, MAX_CALLS_PER_MIN } from '../src/app.js';

// The worker's default fetch handler is exercised directly here (no workerd
// sandbox) for every route except /mcp and /sse, which delegate to the
// MerlinMCP Durable Object via `env.MCP_OBJECT`: that binding only exists in
// a real Workers runtime, so DO-backed routing is verified live in
// production instead (see the deploy checklist in AUDIT.md/README.md).
//
// Outbound calls to Moodle go through the global `fetch`, which is stubbed
// per test below.

// Most route tests call /api/* with the one bearer, so they run in legacy single-bearer mode.
// The bearer-split tests below use SPLIT, or unset LEGACY_API_BEARER, to check the closed default.
const ENV = {
	MOODLE_TOKEN: 'the-moodle-token',
	MCP_BEARER: 'the-bearer-secret',
	LEGACY_API_BEARER: '1',
} as any;

const AUTH = { Authorization: 'Bearer the-bearer-secret' };

function fakeCtx(): ExecutionContext {
	return { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	__resetCaches();
	fetchMock = vi.fn();
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});


/** The wstoken a mocked Moodle call carried (POST body since 2026-10-23). */
function tokenOf(call: unknown[]): string | null {
	const body = (call[1] as RequestInit | undefined)?.body;
	return body instanceof URLSearchParams ? body.get('wstoken') : null;
}

describe('bearer auth', () => {
	it('401s with no Authorization header', async () => {
		const req = new Request('https://merlin-mcp.example/api/notifications');
		const res = await worker.fetch(req, ENV, fakeCtx());
		expect(res.status).toBe(401);
	});

	it('401s with the wrong bearer', async () => {
		const req = new Request('https://merlin-mcp.example/api/notifications', {
			headers: { Authorization: 'Bearer wrong' },
		});
		const res = await worker.fetch(req, ENV, fakeCtx());
		expect(res.status).toBe(401);
	});

	it('never reaches fetch() when unauthorized', async () => {
		const req = new Request('https://merlin-mcp.example/api/notifications');
		await worker.fetch(req, ENV, fakeCtx());
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe('split bearers (MCP_BEARER for /mcp, API_BEARER for /api/*)', () => {
	const SPLIT = { ...ENV, API_BEARER: 'the-api-secret' };
	const API = { Authorization: 'Bearer the-api-secret' };
	const notif = () => {
		fetchMock.mockResolvedValueOnce(jsonResponse({ userid: 42 })).mockResolvedValueOnce(jsonResponse({ notifications: [] }));
	};

	it('API_BEARER opens /api/*', async () => {
		notif();
		const res = await worker.fetch(new Request('https://merlin-mcp.example/api/notifications', { headers: API }), SPLIT, fakeCtx());
		expect(res.status).toBe(200);
	});

	it('API_BEARER does not open /mcp', async () => {
		const res = await worker.fetch(new Request('https://merlin-mcp.example/mcp', { method: 'POST', headers: API }), SPLIT, fakeCtx());
		expect(res.status).toBe(401);
	});

	it('the legacy /sse route is gone', async () => {
		const res = await worker.fetch(new Request('https://merlin-mcp.example/sse', { headers: AUTH }), SPLIT, fakeCtx());
		expect(res.status).toBe(404);
	});

	it('MCP_BEARER opens /api/* only when LEGACY_API_BEARER is explicitly "1"', async () => {
		notif();
		const res = await worker.fetch(new Request('https://merlin-mcp.example/api/notifications', { headers: AUTH }), { ...SPLIT, LEGACY_API_BEARER: '1' }, fakeCtx());
		expect(res.status).toBe(200);
	});

	it('with LEGACY_API_BEARER unset, MCP_BEARER does not open /api/*', async () => {
		const env = { ...SPLIT, LEGACY_API_BEARER: undefined };
		for (const path of ['/api/notifications', '/api/call?wsfunction=core_webservice_get_site_info', '/api/file?url=x']) {
			const res = await worker.fetch(new Request(`https://merlin-mcp.example${path}`, { headers: AUTH }), env, fakeCtx());
			expect(res.status).toBe(401);
		}
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('LEGACY_API_BEARER="0" stops MCP_BEARER on /api/*', async () => {
		const env = { ...SPLIT, LEGACY_API_BEARER: '0' };
		for (const path of ['/api/notifications', '/api/call?wsfunction=core_course_get_courses', '/api/file?url=x']) {
			const res = await worker.fetch(new Request(`https://merlin-mcp.example${path}`, { headers: AUTH }), env, fakeCtx());
			expect(res.status).toBe(401);
		}
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('with no API_BEARER set, /api/* is closed unless legacy mode is on', async () => {
		notif();
		expect((await worker.fetch(new Request('https://merlin-mcp.example/api/notifications', { headers: AUTH }), { ...ENV, LEGACY_API_BEARER: undefined }, fakeCtx())).status).toBe(401);
		expect((await worker.fetch(new Request('https://merlin-mcp.example/api/notifications', { headers: AUTH }), { ...ENV, LEGACY_API_BEARER: '1' }, fakeCtx())).status).toBe(200);
		expect((await worker.fetch(new Request('https://merlin-mcp.example/api/notifications', { headers: API }), ENV, fakeCtx())).status).toBe(401);
	});

	it('neither API nor MCP bearer opens /api/pending', async () => {
		const env = { ...SPLIT, RELAY_BEARER: 'relay' };
		for (const h of [API, AUTH]) {
			expect((await worker.fetch(new Request('https://merlin-mcp.example/api/pending', { headers: h }), env, fakeCtx())).status).toBe(401);
		}
	});
});

describe('/api/notifications', () => {
	it('returns a JSON array (n8n contract)', async () => {
		fetchMock
			.mockResolvedValueOnce(jsonResponse({ userid: 42 })) // core_webservice_get_site_info
			.mockResolvedValueOnce(
				jsonResponse({
					notifications: [
						{ id: 1, read: false, subject: 'a' },
						{ id: 2, read: true, subject: 'b' },
					],
				})
			);
		const req = new Request('https://merlin-mcp.example/api/notifications', { headers: AUTH });
		const res = await worker.fetch(req, ENV, fakeCtx());
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(Array.isArray(body)).toBe(true);
		expect(body).toHaveLength(2);
	});

	it('filters to unread_only=true', async () => {
		fetchMock
			.mockResolvedValueOnce(jsonResponse({ userid: 42 }))
			.mockResolvedValueOnce(
				jsonResponse({
					notifications: [
						{ id: 1, read: false },
						{ id: 2, read: true },
					],
				})
			);
		const req = new Request('https://merlin-mcp.example/api/notifications?unread_only=true', { headers: AUTH });
		const body = (await (await worker.fetch(req, ENV, fakeCtx())).json()) as unknown[];
		expect(body).toHaveLength(1);
	});

	it('clamps an absurd limit instead of passing it straight to Moodle', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse({ userid: 42 })).mockResolvedValueOnce(jsonResponse({ notifications: [] }));
		const req = new Request('https://merlin-mcp.example/api/notifications?limit=999999999', { headers: AUTH });
		await worker.fetch(req, ENV, fakeCtx());
		const secondCallUrl = new URL(fetchMock.mock.calls[1][0] as string);
		expect(Number(secondCallUrl.searchParams.get('limit'))).toBeLessThanOrEqual(100);
	});

	it('maps a Moodle-side error to a 502 without leaking the token', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse({ userid: 42 })).mockResolvedValueOnce(
			jsonResponse({ exception: 'moodle_exception', message: 'invalidtoken, wstoken=the-moodle-token' })
		);
		const req = new Request('https://merlin-mcp.example/api/notifications', { headers: AUTH });
		const res = await worker.fetch(req, ENV, fakeCtx());
		expect(res.status).toBe(502);
		const body = await res.json();
		expect(JSON.stringify(body)).not.toContain('the-moodle-token');
	});
});

/** Routes mocked Moodle calls by year + wsfunction, since years are fetched in parallel. */
function moodleRouter(handlers: Record<string, (params: URLSearchParams) => Response>) {
	return async (input: string) => {
		const u = new URL(input);
		const year = u.pathname.split('/')[1];
		const fn = u.searchParams.get('wsfunction');
		const h = handlers[`${year} ${fn}`] ?? handlers[`* ${fn}`];
		if (!h) return new Response('not found', { status: 404 });
		return h(u.searchParams);
	};
}

describe('/api/notifications?year=all', () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-10-05T10:00:00Z'));
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('stays an array, merges both years newest first and tags _year', async () => {
		fetchMock.mockImplementation(
			moodleRouter({
				'* core_webservice_get_site_info': () => jsonResponse({ userid: 42 }),
				'2026-2027 message_popup_get_popup_notifications': () =>
					jsonResponse({ notifications: [{ id: 5, timecreated: 300, subject: 'new', read: false }] }),
				'2025-2026 message_popup_get_popup_notifications': () =>
					jsonResponse({ notifications: [{ id: 5, timecreated: 400, subject: 'old-year, same id', read: false }] }),
			})
		);
		const req = new Request('https://merlin-mcp.example/api/notifications?year=all', { headers: AUTH });
		const res = await worker.fetch(req, ENV, fakeCtx());
		expect(res.status).toBe(200);
		const body = (await res.json()) as Array<Record<string, unknown>>;
		expect(Array.isArray(body)).toBe(true);
		expect(body.map((n) => [n._year, n.timecreated])).toEqual([
			['2025-2026', 400],
			['2026-2027', 300],
		]);
		expect(body[0]).not.toHaveProperty('year');
	});

	it('serves the other year and reports the failure in a header when one year is down', async () => {
		fetchMock.mockImplementation(
			moodleRouter({
				'* core_webservice_get_site_info': () => jsonResponse({ userid: 42 }),
				'2026-2027 message_popup_get_popup_notifications': () => jsonResponse({ notifications: [{ id: 1, timecreated: 1 }] }),
				'2025-2026 message_popup_get_popup_notifications': () => new Response('boom', { status: 503 }),
			})
		);
		const req = new Request('https://merlin-mcp.example/api/notifications?year=all', { headers: AUTH });
		const res = await worker.fetch(req, ENV, fakeCtx());
		expect(res.status).toBe(200);
		expect(await res.json()).toHaveLength(1);
		expect(res.headers.get('X-Merlin-Errors')).toContain('2025-2026');
	});

	it('uses per-year tokens from MOODLE_TOKENS', async () => {
		fetchMock.mockImplementation(
			moodleRouter({
				'* core_webservice_get_site_info': () => jsonResponse({ userid: 42 }),
				'* message_popup_get_popup_notifications': () => jsonResponse({ notifications: [] }),
			})
		);
		const env = { ...ENV, MOODLE_TOKENS: JSON.stringify({ '2025-2026': 'old-token' }) };
		await worker.fetch(new Request('https://merlin-mcp.example/api/notifications?year=all', { headers: AUTH }), env, fakeCtx());
		const tokens = fetchMock.mock.calls.map((c) => {
			const u = new URL(c[0] as string);
			return `${u.pathname.split('/')[1]}=${tokenOf(c)}`;
		});
		expect(tokens).toContain('2025-2026=old-token');
		expect(tokens).toContain('2026-2027=the-moodle-token');
	});

	it('default (no year) is unchanged: one year, no _year field', async () => {
		fetchMock.mockImplementation(
			moodleRouter({
				'* core_webservice_get_site_info': () => jsonResponse({ userid: 42 }),
				'2026-2027 message_popup_get_popup_notifications': () => jsonResponse({ notifications: [{ id: 1 }] }),
			})
		);
		const res = await worker.fetch(new Request('https://merlin-mcp.example/api/notifications', { headers: AUTH }), ENV, fakeCtx());
		expect(await res.json()).toEqual([{ id: 1 }]);
	});

	it('400s on a malformed year instead of 502', async () => {
		const res = await worker.fetch(
			new Request('https://merlin-mcp.example/api/notifications?year=2026-2025', { headers: AUTH }),
			ENV,
			fakeCtx()
		);
		expect(res.status).toBe(400);
	});
});

describe('/api/call allow-list', () => {
	it('rejects a write function', async () => {
		const req = new Request('https://merlin-mcp.example/api/call?wsfunction=mod_assign_save_submission', { headers: AUTH });
		const res = await worker.fetch(req, ENV, fakeCtx());
		expect(res.status).toBe(400);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('rejects a view/logging function', async () => {
		const req = new Request('https://merlin-mcp.example/api/call?wsfunction=core_course_view_course', { headers: AUTH });
		const res = await worker.fetch(req, ENV, fakeCtx());
		expect(res.status).toBe(400);
	});

	it('allows an explicitly-safe get function and forwards params', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse([{ id: 1, fullname: 'Course' }]));
		const req = new Request('https://merlin-mcp.example/api/call?wsfunction=core_course_get_contents&courseid=1', {
			headers: AUTH,
		});
		const res = await worker.fetch(req, ENV, fakeCtx());
		expect(res.status).toBe(200);
		const calledUrl = new URL(fetchMock.mock.calls[0][0] as string);
		expect(calledUrl.searchParams.get('wsfunction')).toBe('core_course_get_contents');
		expect(calledUrl.searchParams.get('courseid')).toBe('1');
		expect(tokenOf(fetchMock.mock.calls[0])).toBe('the-moodle-token');
	});

	it('POSTs with the token in the body (never the URL) and an identifying User-Agent', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse([]));
		await worker.fetch(new Request('https://merlin-mcp.example/api/call?wsfunction=core_enrol_get_users_courses', { headers: AUTH }), ENV, fakeCtx());
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(init.method).toBe('POST');
		expect(new URL(url).searchParams.has('wstoken')).toBe(false);
		expect(url).not.toContain('the-moodle-token');
		expect(new Headers(init.headers).get('User-Agent')).toBe('merlin-mcp/1.0 (personal read-only student client)');
	});

	it('puts the MOODLE_CONTACT address in the User-Agent when it is set', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse([]));
		const env = { ...ENV, MOODLE_CONTACT: 'ops@example.org' };
		await worker.fetch(new Request('https://merlin-mcp.example/api/call?wsfunction=core_enrol_get_users_courses', { headers: AUTH }), env, fakeCtx());
		const init = fetchMock.mock.calls[0][1] as RequestInit;
		expect(new Headers(init.headers).get('User-Agent')).toBe('merlin-mcp/1.0 (personal read-only student client; contact: ops@example.org)');
	});

	it('never returns userprivateaccesskey through /api/call', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse({ userid: 5, userprivateaccesskey: 'never-expires' }));
		const res = await worker.fetch(new Request('https://merlin-mcp.example/api/call?wsfunction=core_webservice_get_site_info', { headers: AUTH }), ENV, fakeCtx());
		expect(await res.json()).toEqual({ userid: 5 });
	});

	it('refuses to follow a redirect from Moodle (the token is in the body)', async () => {
		fetchMock.mockResolvedValueOnce(new Response(null, { status: 307, headers: { Location: 'https://evil.example/' } }));
		const res = await worker.fetch(new Request('https://merlin-mcp.example/api/call?wsfunction=core_enrol_get_users_courses', { headers: AUTH }), ENV, fakeCtx());
		expect(res.status).toBeGreaterThanOrEqual(400);
		expect((fetchMock.mock.calls[0][1] as RequestInit).redirect).toBe('manual');
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('does not let a caller override wstoken via query params', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse([]));
		const req = new Request('https://merlin-mcp.example/api/call?wsfunction=core_enrol_get_users_courses&wstoken=attacker-supplied', {
			headers: AUTH,
		});
		await worker.fetch(req, ENV, fakeCtx());
		expect(tokenOf(fetchMock.mock.calls[0])).toBe('the-moodle-token');
	});

	it('honors an explicit year override for the academic-year URL', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse([]));
		const req = new Request('https://merlin-mcp.example/api/call?wsfunction=core_enrol_get_users_courses&year=2020-2021', {
			headers: AUTH,
		});
		await worker.fetch(req, ENV, fakeCtx());
		const calledUrl = new URL(fetchMock.mock.calls[0][0] as string);
		expect(calledUrl.origin + calledUrl.pathname).toContain('/2020-2021/webservice/rest/server.php');
	});
});

describe('/api/file', () => {
	it('rejects a non-moodle host', async () => {
		const req = new Request('https://merlin-mcp.example/api/file?url=' + encodeURIComponent('https://evil.example/x.pdf'), {
			headers: AUTH,
		});
		const res = await worker.fetch(req, ENV, fakeCtx());
		expect(res.status).toBe(400);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('rejects a lookalike host', async () => {
		const req = new Request(
			'https://merlin-mcp.example/api/file?url=' + encodeURIComponent('https://moodle.srce.hr.evil.com/x.pdf'),
			{ headers: AUTH }
		);
		const res = await worker.fetch(req, ENV, fakeCtx());
		expect(res.status).toBe(400);
	});

	it('drops caller-supplied token params and never streams a Moodle error page back', async () => {
		fetchMock.mockResolvedValueOnce(new Response('error page echoing ?token=the-moodle-token', { status: 403 }));
		const target = 'https://moodle.srce.hr/2025-2026/webservice/pluginfile.php/1/x.pdf?token=attacker&wstoken=x&wsfunction=core_user_update_users';
		const res = await worker.fetch(new Request(`https://merlin-mcp.example/api/file?url=${encodeURIComponent(target)}`, { headers: AUTH }), ENV, fakeCtx());
		const called = new URL(fetchMock.mock.calls[0][0] as string);
		expect(called.searchParams.getAll('token')).toEqual(['the-moodle-token']);
		expect(called.searchParams.has('wstoken') || called.searchParams.has('wsfunction')).toBe(false);
		expect(res.status).toBe(502);
		expect(await res.text()).not.toContain('the-moodle-token');
	});

	it('rejects non-file Moodle paths before any fetch', async () => {
		const target = 'https://moodle.srce.hr/2025-2026/webservice/rest/server.php?wsfunction=core_user_update_users';
		const res = await worker.fetch(new Request(`https://merlin-mcp.example/api/file?url=${encodeURIComponent(target)}`, { headers: AUTH }), ENV, fakeCtx());
		expect(res.status).toBe(400);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('fetches a genuine moodle file URL with the token appended server-side', async () => {
		fetchMock.mockResolvedValueOnce(new Response('file-bytes', { status: 200, headers: { 'Content-Type': 'application/pdf' } }));
		const target = 'https://moodle.srce.hr/2025-2026/pluginfile.php/1/mod_resource/content/1/x.pdf';
		const req = new Request(`https://merlin-mcp.example/api/file?url=${encodeURIComponent(target)}`, { headers: AUTH });
		const res = await worker.fetch(req, ENV, fakeCtx());
		expect(res.status).toBe(200);
		const calledUrl = new URL(fetchMock.mock.calls[0][0] as string);
		expect(calledUrl.searchParams.get('token')).toBe('the-moodle-token');
		const init = fetchMock.mock.calls[0][1] as RequestInit;
		expect(new Headers(init.headers).get('User-Agent')).toMatch(/^merlin-mcp\//);
		const calledInit = fetchMock.mock.calls[0][1] as RequestInit;
		expect(calledInit.redirect).toBe('manual');
	});

	it('refuses to follow a redirect off moodle.srce.hr', async () => {
		fetchMock.mockResolvedValueOnce(
			new Response(null, { status: 302, headers: { Location: 'https://evil.example/steal?token=x' } })
		);
		const target = 'https://moodle.srce.hr/2025-2026/pluginfile.php/1/mod_resource/content/1/x.pdf';
		const req = new Request(`https://merlin-mcp.example/api/file?url=${encodeURIComponent(target)}`, { headers: AUTH });
		const res = await worker.fetch(req, ENV, fakeCtx());
        expect(res.status).toBe(502);
	});
});

describe('unknown routes', () => {
	it('404s', async () => {
		const req = new Request('https://merlin-mcp.example/nope', { headers: AUTH });
		const res = await worker.fetch(req, ENV, fakeCtx());
		expect(res.status).toBe(404);
	});
});

// /mcp is stateless since 0.4 (no Durable Object), so the real MCP route is testable here.
describe('/mcp (stateless Streamable HTTP)', () => {
	const SPLIT = { ...ENV, API_BEARER: 'the-api-secret', LEGACY_API_BEARER: '0', APPROVALS: { idFromName: () => 'a', get: () => ({}) } };
	const rpc = (method: string, params: unknown = {}, id = 1) =>
		new Request('https://merlin-mcp.example/mcp', {
			method: 'POST',
			headers: { ...AUTH, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
			body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
		});

	it('initialize answers with the server info', async () => {
		const res = await worker.fetch(
			rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } }),
			SPLIT,
			fakeCtx()
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as any;
		expect(body.result.serverInfo.name).toBe('merlin-mcp');
	});

	it('tools/list has the 16 tools, including the approval-gated send, when a relay is configured', async () => {
		const body = (await (await worker.fetch(rpc('tools/list'), { ...SPLIT, RELAY_BEARER: 'relay' }, fakeCtx())).json()) as any;
		const names = body.result.tools.map((t: { name: string }) => t.name);
		expect(names).toHaveLength(16);
		expect(names).toContain('moodle_send_message');
	});

	it('without RELAY_BEARER the send tool is left out (nobody could approve it)', async () => {
		const body = (await (await worker.fetch(rpc('tools/list'), SPLIT, fakeCtx())).json()) as any;
		const names = body.result.tools.map((t: { name: string }) => t.name);
		expect(names).toHaveLength(15);
		expect(names).not.toContain('moodle_send_message');
	});

	it('MERLIN_ENABLE_SEND="0" leaves the send tool out', async () => {
		const body = (await (await worker.fetch(rpc('tools/list'), { ...SPLIT, RELAY_BEARER: 'relay', MERLIN_ENABLE_SEND: '0' }, fakeCtx())).json()) as any;
		const names = body.result.tools.map((t: { name: string }) => t.name);
		expect(names).toHaveLength(15);
		expect(names).not.toContain('moodle_send_message');
	});

	it('tools/call runs a tool against (mocked) Moodle and never leaks the token', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ userid: 42, fullname: 'Test Owner', sitename: 'Merlin' }));
		const res = await worker.fetch(rpc('tools/call', { name: 'moodle_whoami', arguments: { year: '2026-2027' } }), SPLIT, fakeCtx());
		const text = JSON.stringify(await res.json());
		expect(text).toContain('Test Owner');
		expect(text).not.toContain('the-moodle-token');
		expect(tokenOf(fetchMock.mock.calls[0])).toBe('the-moodle-token');
	});

	it('the MCP bearer is required', async () => {
		const req = new Request('https://merlin-mcp.example/mcp', { method: 'POST', body: '{}' });
		expect((await worker.fetch(req, SPLIT, fakeCtx())).status).toBe(401);
	});
});

describe('exact /api/call allow-list and rate brakes', () => {
	it('refuses a get function that is not on the reviewed list', async () => {
		const res = await worker.fetch(new Request('https://merlin-mcp.example/api/call?wsfunction=core_user_get_users_by_field', { headers: AUTH }), ENV, fakeCtx());
		expect(res.status).toBe(400);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('after a Moodle 503, pauses calls and answers 429 with Retry-After', async () => {
		fetchMock.mockResolvedValueOnce(new Response('busy', { status: 503, headers: { 'Retry-After': '30' } }));
		const first = await worker.fetch(new Request('https://merlin-mcp.example/api/call?wsfunction=core_webservice_get_site_info', { headers: AUTH }), ENV, fakeCtx());
		expect(first.status).toBe(502);
		const second = await worker.fetch(new Request('https://merlin-mcp.example/api/call?wsfunction=core_webservice_get_site_info', { headers: AUTH }), ENV, fakeCtx());
		expect(second.status).toBe(429);
		expect(Number(second.headers.get('Retry-After'))).toBeGreaterThan(25);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('caps Moodle calls per minute', async () => {
		fetchMock.mockImplementation(async () => jsonResponse({ userid: 1 }));
		const call = () => worker.fetch(new Request('https://merlin-mcp.example/api/call?wsfunction=core_webservice_get_site_info', { headers: AUTH }), ENV, fakeCtx());
		for (let i = 0; i < MAX_CALLS_PER_MIN; i++) expect((await call()).status).toBe(200);
		const over = await call();
		expect(over.status).toBe(429);
		expect(fetchMock).toHaveBeenCalledTimes(MAX_CALLS_PER_MIN);
	});
});

describe('approval responses stay out of caches and Referer headers', () => {
	it('decision pages are no-store, no-referrer', async () => {
		const env = { ...ENV, APPROVALS: { idFromName: () => 'a', get: () => ({ claim: async () => ({ ok: false, status: 404, error: 'Unknown' }) }) } };
		const res = await worker.fetch(new Request('https://merlin-mcp.example/api/approve/0123456789abcdef?k=x', { method: 'POST' }), env, fakeCtx());
		expect(res.headers.get('Cache-Control')).toBe('no-store');
		expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
	});
});

describe('state-changing params are forced off', () => {
	it('core_message_get_messages always goes out with markasread=0', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse({ messages: [] }));
		const req = new Request('https://merlin-mcp.example/api/call?wsfunction=core_message_get_messages&useridto=1&markasread=1', { headers: AUTH });
		expect((await worker.fetch(req, ENV, fakeCtx())).status).toBe(200);
		expect(new URL(fetchMock.mock.calls[0][0] as string).searchParams.get('markasread')).toBe('0');
	});

	it('array and PHP-mangled forms of a forced or reserved name are dropped or refused', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ messages: [] }));
		const ok = new Request('https://merlin-mcp.example/api/call?wsfunction=core_message_get_messages&useridto=1&markasread[0]=1&wstoken[x]=evil', { headers: AUTH });
		expect((await worker.fetch(ok, ENV, fakeCtx())).status).toBe(200);
		const sent = new URL(fetchMock.mock.calls[0][0] as string).searchParams;
		expect([...sent.keys()].filter((k) => k.startsWith('markasread'))).toEqual(['markasread']);
		expect([...sent.keys()].some((k) => k.startsWith('wstoken'))).toBe(false);
		for (const bad of ['mark.asread=1', 'mark%20asread=1', '%20markasread=1', 'a]b=1']) {
			const req = new Request(`https://merlin-mcp.example/api/call?wsfunction=core_message_get_messages&${bad}`, { headers: AUTH });
			expect((await worker.fetch(req, ENV, fakeCtx())).status, bad).toBe(400);
		}
	});

	it("the archive's array params still pass", async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse({ events: [] }));
		const req = new Request('https://merlin-mcp.example/api/call?wsfunction=core_calendar_get_calendar_events&events[courseids][0]=5&options[timestart]=1', { headers: AUTH });
		expect((await worker.fetch(req, ENV, fakeCtx())).status).toBe(200);
	});
});
