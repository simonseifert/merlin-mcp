import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Approvals, DAILY_SEND_CAP, MAX_OPEN_PENDING, PENDING_TTL_MS, type KvStorage } from '../src/approvals.js';
import worker from '../src/index.js';
import { __resetCaches, requestSend } from '../src/app.js';

// Map-backed stand-in for DurableObjectStorage (only the calls Approvals makes).
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

function newStore(): Approvals {
	return new Approvals(fakeStorage());
}

const INPUT = { year: '2026-2027', to_user_id: 777, to_name: 'Test Recipient', text: 'Bok, hvala!' };

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-10-05T10:00:00Z'));
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('Approvals', () => {
	it('creates a pending item with a random id and key', async () => {
		const s = newStore();
		const r = await s.create(INPUT);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.item.status).toBe('pending');
		expect(r.item.id).toMatch(/^[0-9a-f]{16}$/);
		expect(r.item.key).toMatch(/^[0-9a-f]{48}$/);
		expect(r.item.expires - r.item.created).toBe(PENDING_TTL_MS);
	});

	it('returns the same item for an identical open request (client retry)', async () => {
		const s = newStore();
		const a = await s.create(INPUT);
		const b = await s.create(INPUT);
		expect(a.ok && b.ok && a.item.id === b.item.id && b.existing).toBe(true);
	});

	it('limits open items so a looping agent cannot flood the phone', async () => {
		const s = newStore();
		for (let i = 0; i < MAX_OPEN_PENDING; i++) expect((await s.create({ ...INPUT, text: `m${i}` })).ok).toBe(true);
		expect((await s.create({ ...INPUT, text: 'one too many' })).ok).toBe(false);
	});

	it('concurrent requests cannot pass the open-limit or duplicate checks together', async () => {
		const s = newStore();
		const many = await Promise.all(Array.from({ length: MAX_OPEN_PENDING + 3 }, (_, i) => s.create({ ...INPUT, text: `m${i}` })));
		expect(many.filter((r) => r.ok).length).toBe(MAX_OPEN_PENDING);
		const same = await Promise.all([s.create({ ...INPUT, text: 'x' }), s.create({ ...INPUT, text: 'x' })]);
		expect(same.every((r) => !r.ok)).toBe(true); // already at the limit
		const t = newStore();
		const dup = await Promise.all([t.create(INPUT), t.create(INPUT)]);
		expect(dup[0].ok && dup[1].ok && dup[0].item.id === dup[1].item.id).toBe(true);
	});

	it('rejects with a wrong key and leaves the item pending', async () => {
		const s = newStore();
		const r = await s.create(INPUT);
		if (!r.ok) throw new Error();
		const c = await s.claim(r.item.id, 'wrong', 'approve');
		expect(c).toMatchObject({ ok: false, status: 404 });
		expect((await s.list())[0].status).toBe('pending');
	});

	it('reject is final: a later approve is refused', async () => {
		const s = newStore();
		const r = await s.create(INPUT);
		if (!r.ok) throw new Error();
		expect((await s.claim(r.item.id, r.item.key, 'reject')).ok).toBe(true);
		expect(await s.claim(r.item.id, r.item.key, 'approve')).toMatchObject({ ok: false, status: 409 });
	});

	it('approve works once only', async () => {
		const s = newStore();
		const r = await s.create(INPUT);
		if (!r.ok) throw new Error();
		expect((await s.claim(r.item.id, r.item.key, 'approve')).ok).toBe(true);
		expect(await s.claim(r.item.id, r.item.key, 'approve')).toMatchObject({ ok: false, status: 409 });
	});

	it('two simultaneous approve taps send once (claim is serialized)', async () => {
		const s = newStore();
		const r = await s.create(INPUT);
		if (!r.ok) throw new Error();
		const results = await Promise.all([s.claim(r.item.id, r.item.key, 'approve'), s.claim(r.item.id, r.item.key, 'approve')]);
		expect(results.filter((c) => c.ok)).toHaveLength(1);
		expect(results.filter((c) => !c.ok)[0]).toMatchObject({ status: 409 });
	});

	it('an ambiguous failure keeps its daily-cap slot and is marked ambiguous', async () => {
		const s = newStore();
		for (let i = 0; i < DAILY_SEND_CAP; i++) {
			const r = await s.create({ ...INPUT, text: `m${i}` });
			if (!r.ok) throw new Error();
			expect((await s.claim(r.item.id, r.item.key, 'approve')).ok).toBe(true);
			await s.finish(r.item.id, i === 0 ? { error: 'TimeoutError', ambiguous: true } : { msgid: i });
		}
		expect((await s.list()).find((x) => x.text === 'm0')).toMatchObject({ status: 'failed', ambiguous: true });
		// The ambiguous send still counts, so the cap is reached.
		expect(await s.create({ ...INPUT, text: 'one more' })).toMatchObject({ ok: false, error: expect.stringMatching(/Daily cap/) });
	});

	it('expires after 30 minutes', async () => {
		const s = newStore();
		const r = await s.create(INPUT);
		if (!r.ok) throw new Error();
		vi.setSystemTime(new Date(Date.now() + PENDING_TTL_MS + 1000));
		expect(await s.claim(r.item.id, r.item.key, 'approve')).toMatchObject({ ok: false, status: 410 });
		expect((await s.list())[0].status).toBe('expired');
	});

	it(`caps approvals at ${DAILY_SEND_CAP} per Zagreb day, and a failed send gives its slot back`, async () => {
		const s = newStore();
		for (let i = 0; i < DAILY_SEND_CAP; i++) {
			const r = await s.create({ ...INPUT, text: `m${i}` });
			if (!r.ok) throw new Error(r.error);
			expect((await s.claim(r.item.id, r.item.key, 'approve')).ok).toBe(true);
			await s.finish(r.item.id, i === 0 ? { error: 'moodle down' } : { msgid: i });
		}
		// one failure refunded: exactly one more send allowed today
		const extra = await s.create({ ...INPUT, text: 'extra' });
		if (!extra.ok) throw new Error(extra.error);
		expect((await s.claim(extra.item.id, extra.item.key, 'approve')).ok).toBe(true);
		await s.finish(extra.item.id, { msgid: 99 });
		expect(await s.create({ ...INPUT, text: 'over' })).toMatchObject({ ok: false });
		// next Zagreb day resets
		vi.setSystemTime(new Date('2026-10-06T10:00:00Z'));
		expect((await s.create({ ...INPUT, text: 'tomorrow' })).ok).toBe(true);
	});
});

// ---------- Worker routes ----------

const AUTH = { Authorization: 'Bearer the-bearer-secret' };
const RELAY = { Authorization: 'Bearer the-relay-secret' };

function makeEnv(store: Approvals) {
	return {
		MOODLE_TOKEN: 'the-moodle-token',
		MCP_BEARER: 'the-bearer-secret',
		RELAY_BEARER: 'the-relay-secret',
		APPROVALS: { idFromName: () => 'approvals', get: () => store },
	} as any;
}
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Moodle mock: the owner (42) has a conversation with 777 in 2026-2027; records every wsfunction called. */
function moodleMock(calls: string[]) {
	return vi.fn(async (input: string, init?: RequestInit) => {
		const u = new URL(input);
		const fn = u.searchParams.get('wsfunction')!;
		const year = u.pathname.split('/')[1];
		calls.push(`${year} ${fn}`);
		if (fn === 'core_webservice_get_site_info') return json({ userid: 42 });
		if (fn === 'core_message_get_conversations') {
			return json({
				conversations:
					year === '2026-2027'
						? [{ id: 1, type: 1, members: [{ id: 777, fullname: 'Test Recipient' }], messages: [{ id: 5, timecreated: 100 }] }]
						: [],
			});
		}
		if (fn === 'core_message_send_instant_messages') {
			const body = new URLSearchParams(String(init?.body));
			return json([{ msgid: 555, text: body.get('messages[0][text]') }]);
		}
		return new Response('nope', { status: 404 });
	});
}

describe('send approval flow', () => {
	let calls: string[];
	beforeEach(() => {
		__resetCaches();
		calls = [];
		vi.stubGlobal('fetch', moodleMock(calls));
	});

	it('requestSend only stores a pending send: no Moodle send call, no key in the result', async () => {
		const store = newStore();
		const out = await requestSend(makeEnv(store), { to_user_id: 777, text: 'Bok!' });
		expect(out).toMatchObject({ status: 'pending_approval', sent: false, year: '2026-2027', to_name: 'Test Recipient' });
		expect(calls.some((c) => c.endsWith('core_message_send_instant_messages'))).toBe(false);
		const [item] = await store.list();
		expect(JSON.stringify(out)).not.toContain(item.key);
	});

	it('requestSend refuses someone the owner has no conversation with', async () => {
		await expect(requestSend(makeEnv(newStore()), { to_user_id: 999, text: 'hi' })).rejects.toThrow(/no existing Merlin conversation/);
	});

	it('/api/pending needs the relay bearer; the MCP bearer is not enough', async () => {
		const env = makeEnv(newStore());
		expect((await worker.fetch(new Request('https://w.example/api/pending', { headers: AUTH }), env, ctx)).status).toBe(401);
		expect((await worker.fetch(new Request('https://w.example/api/pending'), env, ctx)).status).toBe(401);
		const ok = await worker.fetch(new Request('https://w.example/api/pending', { headers: RELAY }), env, ctx);
		expect(ok.status).toBe(200);
	});

	it('/api/pending is 503 when no relay secret is configured', async () => {
		const env = { ...makeEnv(newStore()), RELAY_BEARER: undefined };
		expect((await worker.fetch(new Request('https://w.example/api/pending', { headers: AUTH }), env, ctx)).status).toBe(503);
	});

	async function pendingLinks(env: any) {
		await requestSend(env, { to_user_id: 777, text: 'Točno ovaj tekst' });
		const res = await worker.fetch(new Request('https://w.example/api/pending', { headers: RELAY }), env, ctx);
		const [item] = (await res.json()) as Array<Record<string, any>>;
		expect(item).not.toHaveProperty('key');
		return item;
	}

	it('reject sends nothing, and the item cannot be approved afterwards', async () => {
		const env = makeEnv(newStore());
		const item = await pendingLinks(env);
		const rej = await worker.fetch(new Request(item.reject_url, { method: 'POST' }), env, ctx);
		expect(rej.status).toBe(200);
		expect(await rej.text()).toContain('Nothing was sent');
		const app = await worker.fetch(new Request(item.approve_url, { method: 'POST' }), env, ctx);
		expect(app.status).toBe(409);
		expect(calls.some((c) => c.endsWith('core_message_send_instant_messages'))).toBe(false);
	});

	it('GET on an approve link shows a confirm page and never sends', async () => {
		const env = makeEnv(newStore());
		const item = await pendingLinks(env);
		expect((await worker.fetch(new Request(item.approve_url), env, ctx)).status).toBe(200);
		expect(calls.some((c) => c.endsWith('core_message_send_instant_messages'))).toBe(false);
	});

	it('a wrong key sends nothing', async () => {
		const env = makeEnv(newStore());
		const item = await pendingLinks(env);
		const bad = item.approve_url.replace(/k=[0-9a-f]+/, 'k=' + '0'.repeat(48));
		expect((await worker.fetch(new Request(bad, { method: 'POST' }), env, ctx)).status).toBe(404);
		expect(calls.some((c) => c.endsWith('core_message_send_instant_messages'))).toBe(false);
	});

	it('approve sends exactly the stored text to the stored recipient in the stored year, once', async () => {
		const env = makeEnv(newStore());
		const item = await pendingLinks(env);
		const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
		const res = await worker.fetch(new Request(item.approve_url, { method: 'POST' }), env, ctx);
		expect(res.status).toBe(200);
		const sendCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('core_message_send_instant_messages'))!;
		expect(String(sendCall[0])).toContain('/2026-2027/');
		const body = new URLSearchParams(String((sendCall[1] as RequestInit).body));
		expect(body.get('messages[0][text]')).toBe('Točno ovaj tekst');
		expect(body.get('messages[0][touserid]')).toBe('777');
		expect((await worker.fetch(new Request(item.approve_url, { method: 'POST' }), env, ctx)).status).toBe(409);
		expect(calls.filter((c) => c.endsWith('core_message_send_instant_messages'))).toHaveLength(1);
		const after = (await (await worker.fetch(new Request('https://w.example/api/pending', { headers: RELAY }), env, ctx)).json()) as any[];
		expect(after[0]).toMatchObject({ status: 'sent', msgid: 555 });
		expect(after[0]).not.toHaveProperty('approve_url');
	});
});
