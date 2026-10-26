import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Approvals } from '../src/approvals.js';
import { envFromProcess, sqliteKv, startHttp } from '../src/node.js';
import { request as httpRequest } from 'node:http';

const db = () => join(mkdtempSync(join(tmpdir(), 'merlin-')), 'm.sqlite');

describe('Node: SQLite approval store', () => {
	it('get / put / delete / list with a prefix', async () => {
		const kv = sqliteKv(db());
		await kv.put('p:1', { a: 1 });
		await kv.put('p:2', { a: 2 });
		await kv.put('count:x', 3);
		expect(await kv.get('p:1')).toEqual({ a: 1 });
		expect([...(await kv.list({ prefix: 'p:' })).keys()]).toEqual(['p:1', 'p:2']);
		expect(await kv.delete('p:1')).toBe(true);
		expect(await kv.delete('p:1')).toBe(false);
		expect(await kv.get('p:1')).toBeUndefined();
	});

	it('a full approval round trip survives a restart (new store on the same file)', async () => {
		const path = db();
		const first = new Approvals(sqliteKv(path));
		const made = await first.create({ year: '2026-2027', to_user_id: 7, text: 'Bok' });
		if (!made.ok) throw new Error(made.error);
		const again = new Approvals(sqliteKv(path));
		const claim = await again.claim(made.item.id, made.item.key, 'approve');
		expect(claim.ok).toBe(true);
		await again.finish(made.item.id, { msgid: 99 });
		expect((await again.list())[0]).toMatchObject({ status: 'sent', msgid: 99 });
		// A second tap after the restart is refused.
		expect((await again.claim(made.item.id, made.item.key, 'approve')).ok).toBe(false);
	});

	it('env defaults: legacy bearer off, empty values treated as unset', () => {
		const env = envFromProcess({ MOODLE_TOKEN: 't', MCP_BEARER: 'b', API_BEARER: '' }, new Approvals(sqliteKv(db())));
		expect(env.LEGACY_API_BEARER).toBe('0');
		expect(env.API_BEARER).toBeUndefined();
	});

	it('approval links never follow a forged Host header', async () => {
		const approvals = new Approvals(sqliteKv(db()));
		const made = await approvals.create({ year: '2026-2027', to_user_id: 7, text: 'Bok' });
		if (!made.ok) throw new Error(made.error);
		const env = envFromProcess({ MOODLE_TOKEN: 't', MCP_BEARER: 'm', RELAY_BEARER: 'relay' }, approvals);
		const server = startHttp(env, 0);
		await new Promise((r) => server.once('listening', r));
		const port = (server.address() as { port: number }).port;
		const get = (path: string): Promise<string> => new Promise((resolve, reject) => {
			const req = httpRequest({ host: '127.0.0.1', port, path, headers: { Host: 'evil.example', Authorization: 'Bearer relay' } }, (res) => {
				let d = '';
				res.on('data', (c) => (d += c));
				res.on('end', () => resolve(d));
			});
			req.on('error', reject);
			req.end();
		});
		const body = await get('/api/pending');
		const absolute = await get('http://evil.example/api/pending'); // absolute-form request target
		server.close();
		expect(absolute).not.toContain('evil.example');
		expect(absolute).toContain(`http://localhost:${port}/api/approve/`);
		expect(body).not.toContain('evil.example');
		expect(body).toContain(`http://localhost:${port}/api/approve/`);
	});
});
