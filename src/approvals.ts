/**
 * Out-of-band approval for moodle_send_message.
 *
 * The MCP tool never sends. It stores a *pending send* here and returns its
 * id. A relay (on the owner's own machine) polls GET /api/pending (its own
 * RELAY_BEARER, never the MCP bearer) and posts a notification to the owner's
 * phone with "Send" / "Reject" buttons. Those buttons POST to
 * /api/approve/<id>?k=<key> or /api/reject/<id>?k=<key>, and only then does
 * the worker send the stored text, exactly as stored. The per-item key is
 * random, single-use, never returned to the model, and the item expires
 * after 30 minutes.
 *
 * There is exactly one store. On Workers it lives in one Durable Object
 * (idFromName('approvals'), see src/index.ts); on Node, in one process over
 * SQLite (src/node.ts). Both can interleave requests at any await (the key
 * comparison hashes with crypto.subtle), so claim() and finish() run under
 * serial(): two taps at once can never both pass the "pending" check.
 */

import { constantTimeEqual, zagrebDateParts } from './lib.js';

export const PENDING_TTL_MS = 30 * 60_000;
/** Finished items are kept this long so the relay can report the outcome and retries dedupe. */
const RETAIN_MS = 24 * 60 * 60_000;
export const DAILY_SEND_CAP = 10;
/** Open (undecided) items at once; stops a looping agent from flooding the phone. */
export const MAX_OPEN_PENDING = 5;

export type SendStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'rejected' | 'expired';

export interface PendingSend {
	id: string;
	key: string;
	status: SendStatus;
	year: string;
	to_user_id: number;
	to_name?: string;
	text: string;
	created: number; // ms epoch
	expires: number; // ms epoch
	decided?: number;
	msgid?: number;
	error?: string;
	/** The send failed in a way where Moodle may still have delivered it (timeout, network). */
	ambiguous?: boolean;
}

export type CreateResult = { ok: true; item: PendingSend; existing: boolean } | { ok: false; error: string };
export type ClaimResult = { ok: true; item: PendingSend } | { ok: false; status: number; error: string };

function randomHex(bytes: number): string {
	const buf = new Uint8Array(bytes);
	crypto.getRandomValues(buf);
	return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function zagrebDay(ms: number): string {
	const { year, month, day } = zagrebDateParts(new Date(ms));
	return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Status as the outside world sees it: an undecided item past its expiry is "expired". */
export function effectiveStatus(item: PendingSend, now: number): SendStatus {
	return item.status === 'pending' && now > item.expires ? 'expired' : item.status;
}

/** Minimal slice of DurableObjectStorage this class uses (SQLite on Node, a Map-backed fake in tests). */
export interface KvStorage {
	get<T>(key: string): Promise<T | undefined>;
	put<T>(key: string, value: T): Promise<void>;
	delete(key: string): Promise<boolean>;
	list<T>(options: { prefix: string }): Promise<Map<string, T>>;
}

/** What the routes and tools call. A Durable Object stub and an Approvals instance both satisfy it. */
export interface ApprovalsApi {
	create(input: { year: string; to_user_id: number; to_name?: string; text: string }): Promise<CreateResult>;
	list(): Promise<PendingSend[]>;
	claim(id: string, key: string, action: 'approve' | 'reject'): Promise<ClaimResult>;
	finish(id: string, result: { msgid: number } | { error: string; ambiguous?: boolean }): Promise<void>;
}

export class Approvals implements ApprovalsApi {
	private queue: Promise<unknown> = Promise.resolve();

	constructor(private readonly store: KvStorage) {}

	/** Runs fn after every earlier serial() call has finished (an in-object mutex). */
	private serial<T>(fn: () => Promise<T>): Promise<T> {
		const run = this.queue.then(fn, fn);
		this.queue = run.catch(() => undefined);
		return run;
	}

	private async items(): Promise<PendingSend[]> {
		const now = Date.now();
		const all = await this.store.list<PendingSend>({ prefix: 'p:' });
		const keep: PendingSend[] = [];
		for (const [k, item] of all) {
			if (now - item.created > RETAIN_MS) await this.store.delete(k);
			else keep.push(item);
		}
		return keep;
	}

	private async sentToday(now: number): Promise<number> {
		return (await this.store.get<number>(`count:${zagrebDay(now)}`)) ?? 0;
	}

	/** Records a pending send. Identical (year, recipient, text) while still open returns the existing item. */
	create(input: { year: string; to_user_id: number; to_name?: string; text: string }): Promise<CreateResult> {
		// Serialised like claim(): two requests at once must not both pass the duplicate and open-limit checks.
		return this.serial(() => this.createNow(input));
	}

	private async createNow(input: { year: string; to_user_id: number; to_name?: string; text: string }): Promise<CreateResult> {
		const now = Date.now();
		const items = await this.items();
		const open = items.filter((i) => effectiveStatus(i, now) === 'pending');
		const dup = open.find((i) => i.year === input.year && i.to_user_id === input.to_user_id && i.text === input.text);
		if (dup) return { ok: true, item: dup, existing: true };
		if ((await this.sentToday(now)) >= DAILY_SEND_CAP) {
			return { ok: false, error: `Daily cap reached: ${DAILY_SEND_CAP} Merlin messages already sent today.` };
		}
		if (open.length >= MAX_OPEN_PENDING) {
			return { ok: false, error: `${open.length} sends are already waiting for the owner's approval. Wait for them to decide or let them expire.` };
		}
		const item: PendingSend = {
			id: randomHex(8),
			key: randomHex(24),
			status: 'pending',
			year: input.year,
			to_user_id: input.to_user_id,
			to_name: input.to_name,
			text: input.text,
			created: now,
			expires: now + PENDING_TTL_MS,
		};
		await this.store.put(`p:${item.id}`, item);
		return { ok: true, item, existing: false };
	}

	/** Every item from the last 24 h, newest first, with its effective status (for the relay). */
	async list(): Promise<PendingSend[]> {
		const now = Date.now();
		return (await this.items())
			.map((i) => ({ ...i, status: effectiveStatus(i, now) }))
			.sort((a, b) => b.created - a.created);
	}

	/**
	 * Validates the key and moves a pending item to its next state in one
	 * step: "rejected", or "sending" (counted against the daily cap) for the
	 * worker to then actually send. Any second tap finds it no longer pending.
	 */
	claim(id: string, key: string, action: 'approve' | 'reject'): Promise<ClaimResult> {
		return this.serial(() => this.claimNow(id, key, action));
	}

	private async claimNow(id: string, key: string, action: 'approve' | 'reject'): Promise<ClaimResult> {
		const now = Date.now();
		const item = await this.store.get<PendingSend>(`p:${id}`);
		// Compare against a dummy when the id is unknown so timing doesn't reveal which ids exist.
		const keyOk = await constantTimeEqual(key, item?.key ?? `missing-${randomHex(8)}`);
		if (!item || !keyOk) return { ok: false, status: 404, error: 'Unknown or invalid approval link.' };
		const status = effectiveStatus(item, now);
		if (status === 'expired') return { ok: false, status: 410, error: 'This send expired (30 min). Nothing was sent.' };
		if (status !== 'pending') return { ok: false, status: 409, error: `Already ${status}. Nothing more was done.` };
		if (action === 'reject') {
			const updated = { ...item, status: 'rejected' as const, decided: now };
			await this.store.put(`p:${id}`, updated);
			return { ok: true, item: updated };
		}
		const day = `count:${zagrebDay(now)}`;
		const count = (await this.store.get<number>(day)) ?? 0;
		if (count >= DAILY_SEND_CAP) return { ok: false, status: 429, error: `Daily cap of ${DAILY_SEND_CAP} sends reached. Nothing was sent.` };
		await this.store.put(day, count + 1);
		const updated = { ...item, status: 'sending' as const, decided: now };
		await this.store.put(`p:${id}`, updated);
		return { ok: true, item: updated };
	}

	/**
	 * Records the outcome of a claimed send. A send Moodle clearly refused gives
	 * its slot in the daily cap back. An ambiguous one (timeout or network error:
	 * Moodle may have delivered it) keeps the slot and says so, so nobody retries
	 * blindly and sends it twice.
	 */
	finish(id: string, result: { msgid: number } | { error: string; ambiguous?: boolean }): Promise<void> {
		return this.serial(() => this.finishNow(id, result));
	}

	private async finishNow(id: string, result: { msgid: number } | { error: string; ambiguous?: boolean }): Promise<void> {
		const item = await this.store.get<PendingSend>(`p:${id}`);
		if (!item || item.status !== 'sending') return;
		if ('msgid' in result) {
			await this.store.put(`p:${id}`, { ...item, status: 'sent', msgid: result.msgid });
			return;
		}
		await this.store.put(`p:${id}`, { ...item, status: 'failed', error: result.error, ...(result.ambiguous ? { ambiguous: true } : {}) });
		if (result.ambiguous) return;
		const day = `count:${zagrebDay(item.decided ?? Date.now())}`;
		const count = (await this.store.get<number>(day)) ?? 0;
		if (count > 0) await this.store.put(day, count - 1);
	}
}
