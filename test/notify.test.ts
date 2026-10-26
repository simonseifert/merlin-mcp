import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index.js';
import { __resetCaches } from '../src/app.js';
import { Approvals, type KvStorage } from '../src/approvals.js';

function fakeStorage(): KvStorage {
	const m = new Map<string, unknown>();
	return {
		async get<T>(k: string) {
			return structuredClone(m.get(k)) as T | undefined;
		},
		async put<T>(k: string, v: T) {
			m.set(k, structuredClone(v));
		},
		async delete(k: string) {
			return m.delete(k);
		},
		async list<T>({ prefix }: { prefix: string }) {
			return new Map([...m].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k, structuredClone(v) as T]));
		},
	};
}

const SECRETS = ['the-moodle-token', 'mcp-secret', 'api-secret', 'relay-secret', 'ntfy-secret-token'];
const BASE = 'https://merlin.example';
const NTFY = 'https://ntfy.example/secret-topic-123';
const HOOK = 'https://hooks.example/webhook/abc';

function makeEnv(extra: Record<string, unknown> = {}) {
	const store = new Approvals(fakeStorage());
	return {
		MOODLE_TOKEN: 'the-moodle-token',
		MCP_BEARER: 'mcp-secret',
		API_BEARER: 'api-secret',
		LEGACY_API_BEARER: '0',
		APPROVALS: { idFromName: () => 'approvals', get: () => store },
		...extra,
	} as any;
}

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

let moodleCalls: string[];
let notifyCalls: Array<{ url: string; init: RequestInit; body: any }>;
let notifyBehaviour: () => Promise<Response>;
let pending: Promise<unknown>[];

function installFetch() {
	moodleCalls = [];
	notifyCalls = [];
	notifyBehaviour = async () => new Response('ok');
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: string, init?: RequestInit) => {
			const u = new URL(input);
			if (u.hostname !== 'moodle.srce.hr') {
				notifyCalls.push({ url: input, init: init ?? {}, body: JSON.parse(String(init?.body ?? 'null')) });
				return notifyBehaviour();
			}
			const fn = u.searchParams.get('wsfunction')!;
			const year = u.pathname.split('/')[1];
			moodleCalls.push(fn);
			if (fn === 'core_webservice_get_site_info') return json({ userid: 42 });
			if (fn === 'core_message_get_conversations') {
				return json({
					conversations:
						year === '2026-2027'
							? [{ id: 1, type: 1, members: [{ id: 777, fullname: 'Test Recipient' }], messages: [{ id: 5, timecreated: 100 }] }]
							: [],
				});
			}
			if (fn === 'core_message_send_instant_messages') return json([{ msgid: 555 }]);
			return new Response('nope', { status: 404 });
		})
	);
}

function ctx(): ExecutionContext {
	return { waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException() {} } as unknown as ExecutionContext;
}

async function flush() {
	await Promise.all(pending);
	pending = [];
}

const rpc = (method: string, params: unknown = {}) =>
	new Request(`${BASE}/mcp`, {
		method: 'POST',
		headers: { Authorization: 'Bearer mcp-secret', 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
	});

async function requestSend(env: any, text = 'Bok, hvala!') {
	const res = await worker.fetch(rpc('tools/call', { name: 'moodle_send_message', arguments: { to_user_id: 777, text } }), env, ctx());
	await flush();
	return (await res.json()) as any;
}

/** The approve/reject URLs the json webhook was given. */
function linksFrom(call: { body: any }) {
	return { approve: call.body.approve_url as string, reject: call.body.reject_url as string };
}

beforeEach(() => {
	__resetCaches();
	pending = [];
	installFetch();
	vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('ntfy notifier', () => {
	it('posts title, body, priority and POST actions to the topic, with the bearer only in the header', async () => {
		const env = makeEnv({ NOTIFY_NTFY_URL: NTFY, NOTIFY_NTFY_TOKEN: 'ntfy-secret-token' });
		const out = await requestSend(env);
		expect(out.result.isError).not.toBe(true);
		expect(notifyCalls).toHaveLength(1);
		const c = notifyCalls[0];
		expect(c.url).toBe('https://ntfy.example/');
		expect((c.init.headers as Record<string, string>).Authorization).toBe('Bearer ntfy-secret-token');
		expect(c.body.topic).toBe('secret-topic-123');
		expect(c.body.title).toContain('Test Recipient');
		expect(c.body.message).toContain('Bok, hvala!');
		expect(c.body.priority).toBe(4);
		const [send, reject] = c.body.actions;
		expect(send).toMatchObject({ action: 'http', label: 'Send', method: 'POST' });
		expect(reject).toMatchObject({ action: 'http', label: 'Reject', method: 'POST' });
		expect(send.url).toMatch(new RegExp(`^${BASE}/api/approve/[0-9a-f]{16}\\?k=[0-9a-f]{48}$`));
		expect(reject.url).toMatch(new RegExp(`^${BASE}/api/reject/[0-9a-f]{16}\\?k=[0-9a-f]{48}$`));
	});

	it('sends no Authorization header without a token', async () => {
		await requestSend(makeEnv({ NOTIFY_NTFY_URL: NTFY }));
		expect((notifyCalls[0].init.headers as Record<string, string>).Authorization).toBeUndefined();
	});

	it('keeps a path prefix on a self-hosted server', async () => {
		await requestSend(makeEnv({ NOTIFY_NTFY_URL: 'https://example.org/ntfy/mytopic' }));
		expect(notifyCalls[0].url).toBe('https://example.org/ntfy/');
		expect(notifyCalls[0].body.topic).toBe('mytopic');
	});
});

describe('webhook notifier', () => {
	it('json format has the documented fields and links to the confirm pages', async () => {
		const out = await requestSend(makeEnv({ NOTIFY_WEBHOOK_URL: HOOK }));
		expect(out.result.isError).not.toBe(true);
		const b = notifyCalls[0].body;
		expect(notifyCalls[0].url).toBe(HOOK);
		expect(Object.keys(b).sort()).toEqual(['approve_url', 'event', 'expires_at', 'id', 'reject_url', 'text', 'to', 'year']);
		expect(b).toMatchObject({ event: 'approval_requested', year: '2026-2027', to: 'Test Recipient', text: 'Bok, hvala!' });
		expect(b.id).toMatch(/^[0-9a-f]{16}$/);
		expect(new Date(b.expires_at).getTime()).toBeGreaterThan(Date.now());
		expect(b.approve_url).toContain(`${BASE}/api/approve/${b.id}?k=`);
		expect(b.reject_url).toContain(`${BASE}/api/reject/${b.id}?k=`);
	});

	it('discord format uses content, embeds and markdown links, with mentions disabled', async () => {
		await requestSend(makeEnv({ NOTIFY_WEBHOOK_URL: HOOK, NOTIFY_WEBHOOK_FORMAT: 'discord' }), '@everyone hello');
		const b = notifyCalls[0].body;
		expect(b.content).toMatch(/\[Review and send\]\(https:\/\/merlin\.example\/api\/approve\/[0-9a-f]{16}\?k=[0-9a-f]{48}\)/);
		expect(b.content).toMatch(/\[Review and reject\]\(https:\/\/merlin\.example\/api\/reject\//);
		expect(b.embeds[0].description).toBe('@everyone hello');
		expect(b.allowed_mentions).toEqual({ parse: [] });
		expect(b.event).toBeUndefined();
	});

	it('both channels fire when both are configured', async () => {
		await requestSend(makeEnv({ NOTIFY_NTFY_URL: NTFY, NOTIFY_WEBHOOK_URL: HOOK }));
		expect(notifyCalls.map((c) => new URL(c.url).hostname).sort()).toEqual(['hooks.example', 'ntfy.example']);
	});
});

describe('what a notification may contain', () => {
	it('never includes the Moodle token or any bearer, and the key only inside approve/reject URLs', async () => {
		const env = makeEnv({
			RELAY_BEARER: 'relay-secret',
			NOTIFY_NTFY_URL: NTFY,
			NOTIFY_NTFY_TOKEN: 'ntfy-secret-token',
			NOTIFY_WEBHOOK_URL: HOOK,
		});
		await requestSend(env);
		for (const c of notifyCalls) {
			const body = JSON.stringify(c.body);
			for (const s of SECRETS) expect(body, s).not.toContain(s);
			const stripped = body.replace(/https:\/\/merlin\.example\/api\/(approve|reject)\/[0-9a-f]{16}\?k=[0-9a-f]{48}/g, '');
			expect(stripped).not.toMatch(/[0-9a-f]{48}/);
		}
		// The ntfy bearer travels only to ntfy, never to the webhook.
		const hook = notifyCalls.find((c) => c.url === HOOK)!;
		expect(JSON.stringify(hook.init.headers)).not.toContain('ntfy-secret-token');
	});

	it('the tool result never contains the approval key', async () => {
		const out = await requestSend(makeEnv({ NOTIFY_WEBHOOK_URL: HOOK }));
		const key = new URL(notifyCalls[0].body.approve_url).searchParams.get('k')!;
		expect(JSON.stringify(out)).not.toContain(key);
	});
});

describe('when to notify', () => {
	it('an identical duplicate request does not notify twice', async () => {
		const env = makeEnv({ NOTIFY_WEBHOOK_URL: HOOK });
		await requestSend(env);
		const again = await requestSend(env);
		expect(JSON.stringify(again)).toContain('already_pending');
		expect(notifyCalls).toHaveLength(1);
	});

	it('a failing notifier (HTTP error) does not break the request', async () => {
		notifyBehaviour = async () => new Response('nope', { status: 500 });
		const out = await requestSend(makeEnv({ NOTIFY_WEBHOOK_URL: HOOK }));
		expect(out.result.isError).not.toBe(true);
		expect(JSON.stringify(out)).toContain('pending_approval');
	});

	it('a throwing notifier does not break the request and logs no URL or secret', async () => {
		notifyBehaviour = async () => {
			throw new Error(`connect failed to ${HOOK} secret-topic-123`);
		};
		const out = await requestSend(makeEnv({ NOTIFY_WEBHOOK_URL: HOOK, NOTIFY_NTFY_URL: NTFY }));
		expect(JSON.stringify(out)).toContain('pending_approval');
		const logged = JSON.stringify((console.error as any).mock.calls);
		expect(logged).toContain('notification failed');
		expect(logged).not.toContain('hooks.example');
		expect(logged).not.toContain('secret-topic-123');
	});

	it('uses a 5 s abort signal', async () => {
		await requestSend(makeEnv({ NOTIFY_WEBHOOK_URL: HOOK }));
		expect(notifyCalls[0].init.signal).toBeInstanceOf(AbortSignal);
	});

	it('works without ctx.waitUntil (Node style)', async () => {
		const env = makeEnv({ NOTIFY_WEBHOOK_URL: HOOK });
		const res = await worker.fetch(rpc('tools/call', { name: 'moodle_send_message', arguments: { to_user_id: 777, text: 'x' } }), env, {} as ExecutionContext);
		expect(res.status).toBe(200);
		await new Promise((r) => setTimeout(r, 20));
		expect(notifyCalls).toHaveLength(1);
	});
});

describe('confirm page', () => {
	async function setup(text = 'Bok, hvala!') {
		const env = makeEnv({ NOTIFY_WEBHOOK_URL: HOOK });
		await requestSend(env, text);
		return { env, links: linksFrom(notifyCalls[0]) };
	}
	const get = (env: any, url: string) => worker.fetch(new Request(url), env, ctx());

	it('GET shows recipient, year, text and one POST form, and changes nothing', async () => {
		const { env, links } = await setup();
		const res = await get(env, links.approve);
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).toContain('Test Recipient');
		expect(html).toContain('2026-2027');
		expect(html).toContain('Bok, hvala!');
		expect(html.match(/<form /g)).toHaveLength(1);
		expect(html).toContain('method="post"');
		expect(html).toContain(`action="/api/approve/${new URL(links.approve).pathname.split('/').pop()}?k=`);
		expect(moodleCalls).not.toContain('core_message_send_instant_messages');
		// Still pending after the GET (and after the reject page too): both links still work.
		await get(env, links.reject);
		const after = await worker.fetch(new Request(links.approve, { method: 'POST' }), env, ctx());
		expect(after.status).toBe(200);
		expect(await after.text()).toContain('Sent to Test Recipient');
	});

	it('HTML-escapes the message text', async () => {
		const { env, links } = await setup('<script>alert(1)</script> "q" & \'s\'');
		const html = await (await get(env, links.approve)).text();
		expect(html).not.toContain('<script>');
		expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &quot;q&quot; &amp; &#39;s&#39;');
	});

	it('carries the private and framing-protection headers', async () => {
		const { env, links } = await setup();
		const res = await get(env, links.approve);
		expect(res.headers.get('Cache-Control')).toBe('no-store');
		expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
		expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");
		expect(res.headers.get('X-Frame-Options')).toBe('DENY');
		expect(res.headers.get('Content-Type')).toContain('text/html');
	});

	it('an unknown id and a wrong key give the same 404', async () => {
		const { env, links } = await setup();
		const badKey = await get(env, links.approve.replace(/k=[0-9a-f]+/, 'k=' + '0'.repeat(48)));
		const noKey = await get(env, links.approve.replace(/\?k=.*/, ''));
		const unknownId = await get(env, `${BASE}/api/approve/${'0'.repeat(16)}?k=${'0'.repeat(48)}`);
		for (const r of [badKey, noKey, unknownId]) expect(r.status).toBe(404);
		const bodies = await Promise.all([badKey, noKey, unknownId].map((r) => r.text()));
		expect(new Set(bodies).size).toBe(1);
	});

	it('a decided item shows no button', async () => {
		const { env, links } = await setup();
		await worker.fetch(new Request(links.reject, { method: 'POST' }), env, ctx());
		const res = await get(env, links.approve);
		expect(res.status).toBe(409);
		expect(await res.text()).not.toContain('<form');
	});
});

describe('POST hardening', () => {
	async function setup() {
		const env = makeEnv({ NOTIFY_WEBHOOK_URL: HOOK });
		await requestSend(env);
		return { env, links: linksFrom(notifyCalls[0]) };
	}

	it('a POST from another origin (ntfy web/desktop) works with the key, and a wrong key is still refused', async () => {
		const { env, links } = await setup();
		const bad = await worker.fetch(new Request(links.approve.replace(/k=[0-9a-f]+/, 'k=' + '0'.repeat(48)), { method: 'POST', headers: { Origin: 'https://ntfy.example' } }), env, ctx());
		expect(bad.status).toBe(404);
		expect(moodleCalls).not.toContain('core_message_send_instant_messages');
		const ok = await worker.fetch(new Request(links.approve, { method: 'POST', headers: { Origin: 'https://ntfy.example' } }), env, ctx());
		expect(ok.status).toBe(200);
	});

	it('a POST with no Origin (the ntfy phone app) works', async () => {
		const { env, links } = await setup();
		const res = await worker.fetch(new Request(links.reject, { method: 'POST' }), env, ctx());
		expect(res.status).toBe(200);
		expect(await res.text()).toContain('Rejected');
	});

	it('a same-origin form POST (the confirm page button) works', async () => {
		const { env, links } = await setup();
		const res = await worker.fetch(new Request(links.approve, { method: 'POST', headers: { Origin: BASE } }), env, ctx());
		expect(res.status).toBe(200);
		expect(moodleCalls).toContain('core_message_send_instant_messages');
	});
});

describe('outcome notification', () => {
	it('reports sent after approve, with no text or links', async () => {
		const env = makeEnv({ NOTIFY_WEBHOOK_URL: HOOK });
		await requestSend(env, 'secret words');
		const links = linksFrom(notifyCalls[0]);
		await worker.fetch(new Request(links.approve, { method: 'POST' }), env, ctx());
		await flush();
		expect(notifyCalls).toHaveLength(2);
		expect(notifyCalls[1].body).toMatchObject({ event: 'send_outcome', result: 'sent', to: 'Test Recipient' });
		expect(JSON.stringify(notifyCalls[1].body)).not.toContain('secret words');
		expect(JSON.stringify(notifyCalls[1].body)).not.toContain('?k=');
	});

	it('reports UNCLEAR for an ambiguous failure', async () => {
		const env = makeEnv({ NOTIFY_NTFY_URL: NTFY });
		await requestSend(env);
		const links = { approve: notifyCalls[0].body.actions[0].url as string };
		const real = globalThis.fetch as any;
		vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
			if (String(input).includes('core_message_send_instant_messages')) throw new Error('network down');
			return real(input, init);
		});
		const res = await worker.fetch(new Request(links.approve, { method: 'POST' }), env, ctx());
		expect(res.status).toBe(502);
		await flush();
		expect(notifyCalls[1].body.message).toContain('UNCLEAR');
	});

	it('sends nothing when no notifier is configured', async () => {
		const env = makeEnv({ RELAY_BEARER: 'relay-secret' });
		await requestSend(env);
		expect(notifyCalls).toHaveLength(0);
	});
});

describe('send tool gate', () => {
	const names = async (env: any) => {
		const body = (await (await worker.fetch(rpc('tools/list'), env, ctx())).json()) as any;
		return body.result.tools.map((t: { name: string }) => t.name);
	};

	it('is offered with only a notifier configured (no RELAY_BEARER)', async () => {
		expect(await names(makeEnv({ NOTIFY_NTFY_URL: NTFY }))).toContain('moodle_send_message');
		expect(await names(makeEnv({ NOTIFY_WEBHOOK_URL: HOOK }))).toContain('moodle_send_message');
	});

	it('is still left out with neither, with an unusable URL, or with MERLIN_ENABLE_SEND=0', async () => {
		expect(await names(makeEnv())).not.toContain('moodle_send_message');
		expect(await names(makeEnv({ NOTIFY_NTFY_URL: 'not a url' }))).not.toContain('moodle_send_message');
		expect(await names(makeEnv({ NOTIFY_NTFY_URL: NTFY, MERLIN_ENABLE_SEND: '0' }))).not.toContain('moodle_send_message');
	});
});
