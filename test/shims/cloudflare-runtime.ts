/**
 * Minimal stand-in for the `cloudflare:workers` built-in module, which only
 * exists inside workerd. src/index.ts (the Worker entry) imports DurableObject
 * from it; this lets the tests import that entry under plain Node + vitest and
 * exercise every route, /mcp included, with a mocked global fetch.
 */

export class DurableObject {
	ctx: unknown;
	env: unknown;
	constructor(ctx?: unknown, env?: unknown) {
		this.ctx = ctx;
		this.env = env;
	}
}
