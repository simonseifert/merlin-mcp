/**
 * Cloudflare Workers entry. All routing and tools live in src/app.ts; this
 * file only adds what is Workers-specific: the Durable Object that holds the
 * one approval store.
 *
 * /mcp is stateless (one MCP server per request, src/app.ts handleMcp), so the
 * old per-session MerlinMCP Durable Object is no longer used. Its class stays
 * as an empty stub so a rollback to a pre-0.4 version still finds it; delete it
 * with a `deleted_classes` migration once 0.4 has run for a while.
 */

import { DurableObject } from 'cloudflare:workers';
import { handle, type Env } from './app.js';
import { Approvals, type ApprovalsApi, type CreateResult, type ClaimResult, type KvStorage, type PendingSend } from './approvals.js';

export class ApprovalStore extends DurableObject implements ApprovalsApi {
	private readonly logic = new Approvals(this.ctx.storage as unknown as KvStorage);

	create(input: { year: string; to_user_id: number; to_name?: string; text: string }): Promise<CreateResult> {
		return this.logic.create(input);
	}
	list(): Promise<PendingSend[]> {
		return this.logic.list();
	}
	claim(id: string, key: string, action: 'approve' | 'reject'): Promise<ClaimResult> {
		return this.logic.claim(id, key, action);
	}
	finish(id: string, result: { msgid: number } | { error: string; ambiguous?: boolean }): Promise<void> {
		return this.logic.finish(id, result);
	}
}

/** Unused since 0.4 (stateless /mcp). Kept only so rollbacks keep working. */
export class MerlinMCP extends DurableObject {}

export default {
	fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		return handle(request, env, ctx);
	},
};
