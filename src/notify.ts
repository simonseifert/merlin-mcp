/**
 * Built-in notifier for moodle_send_message approvals.
 *
 * When a NEW pending send is created, the owner gets the recipient and the full
 * text, plus Send / Reject links, through every configured channel:
 *
 *   NOTIFY_NTFY_URL (+ NOTIFY_NTFY_TOKEN)   ntfy topic URL; Send / Reject are `http` actions that POST
 *   NOTIFY_WEBHOOK_URL (+ NOTIFY_WEBHOOK_FORMAT=json|discord)   links open the confirm page (GET shows, never acts)
 *
 * The approval key appears only inside the approve/reject URLs (that is the
 * design). No Moodle token and no bearer is ever put in a payload. Every send
 * has a 5 s timeout; errors are swallowed and logged without URLs or secrets,
 * so a failed notification never fails the request that triggered it.
 */

export interface NotifyEnv {
	NOTIFY_NTFY_URL?: string;
	NOTIFY_NTFY_TOKEN?: string;
	NOTIFY_WEBHOOK_URL?: string;
	NOTIFY_WEBHOOK_FORMAT?: string;
}

export const NOTIFY_TIMEOUT_MS = 5000;

export interface ApprovalNotice {
	id: string;
	year: string;
	to: string;
	text: string;
	approve_url: string;
	reject_url: string;
	expires_at: string; // ISO
	expires_local: string;
}

export interface OutcomeNotice {
	id: string;
	year: string;
	to: string;
	result: 'sent' | 'failed' | 'unclear';
}

function parsed(url: string | undefined): URL | undefined {
	if (!url) return undefined;
	try {
		const u = new URL(url);
		return u.protocol === 'https:' || u.protocol === 'http:' ? u : undefined;
	} catch {
		return undefined;
	}
}

/** True when at least one channel has a usable URL. */
export function notifierConfigured(env: NotifyEnv): boolean {
	return !!parsed(env.NOTIFY_NTFY_URL) || !!parsed(env.NOTIFY_WEBHOOK_URL);
}

async function post(kind: string, url: string, body: unknown, headers: Record<string, string> = {}): Promise<void> {
	try {
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', ...headers },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
		});
		if (!res.ok) console.error(`merlin-mcp: ${kind} notification failed: HTTP ${res.status}`);
	} catch (err) {
		// Never log the error text or URL: the topic and webhook URL are secrets.
		console.error(`merlin-mcp: ${kind} notification failed: ${err instanceof Error ? err.name : 'error'}`);
	}
}

/** ntfy JSON publish: POST to the server root with the topic in the body (keeps non-ASCII text out of headers). */
function ntfy(env: NotifyEnv, msg: { title: string; message: string; priority: number; tags: string[]; actions?: unknown[] }): Promise<void> {
	const u = parsed(env.NOTIFY_NTFY_URL);
	if (!u) return Promise.resolve();
	const parts = u.pathname.split('/').filter(Boolean);
	const topic = parts.pop();
	if (!topic) return Promise.resolve();
	const root = `${u.origin}${parts.length ? `/${parts.join('/')}` : ''}/`;
	const auth: Record<string, string> = env.NOTIFY_NTFY_TOKEN ? { Authorization: `Bearer ${env.NOTIFY_NTFY_TOKEN}` } : {};
	return post('ntfy', root, { topic, ...msg }, auth);
}

function webhook(env: NotifyEnv, json: unknown, discord: unknown): Promise<void> {
	const u = parsed(env.NOTIFY_WEBHOOK_URL);
	if (!u) return Promise.resolve();
	const isDiscord = (env.NOTIFY_WEBHOOK_FORMAT ?? 'json').toLowerCase() === 'discord';
	return post(isDiscord ? 'discord' : 'webhook', u.toString(), isDiscord ? discord : json);
}

/** A new send is waiting for approval. Never throws. */
export async function notifyPending(env: NotifyEnv, n: ApprovalNotice): Promise<void> {
	const title = `Merlin: approve message to ${n.to}?`;
	const message = `To: ${n.to} (Merlin ${n.year})\nExpires: ${n.expires_local}\n\n${n.text}`;
	await Promise.all([
		ntfy(env, {
			title,
			message,
			priority: 4,
			tags: ['speech_balloon'],
			actions: [
				{ action: 'http', label: 'Send', url: n.approve_url, method: 'POST', clear: true },
				{ action: 'http', label: 'Reject', url: n.reject_url, method: 'POST', clear: true },
			],
		}),
		webhook(
			env,
			{
				event: 'approval_requested',
				id: n.id,
				year: n.year,
				to: n.to,
				text: n.text,
				approve_url: n.approve_url,
				reject_url: n.reject_url,
				expires_at: n.expires_at,
			},
			{
				content: `**${title}**\n[Review and send](${n.approve_url}) | [Review and reject](${n.reject_url})`,
				embeds: [
					{
						title: `To ${n.to} (Merlin ${n.year})`,
						description: n.text,
						footer: { text: `Expires ${n.expires_local}. The links open a confirm page; nothing happens until you press the button.` },
					},
				],
				allowed_mentions: { parse: [] },
			}
		),
	]);
}

/** What happened after the owner approved. Short on purpose: no message text, no links. Never throws. */
export async function notifyOutcome(env: NotifyEnv, n: OutcomeNotice): Promise<void> {
	const word = n.result === 'sent' ? 'Sent' : n.result === 'failed' ? 'FAILED, not sent' : 'UNCLEAR if sent, check Merlin before retrying';
	const message = `${word}: message to ${n.to} (Merlin ${n.year})`;
	await Promise.all([
		ntfy(env, { title: 'Merlin send result', message, priority: n.result === 'sent' ? 3 : 4, tags: [n.result === 'sent' ? 'white_check_mark' : 'warning'] }),
		webhook(env, { event: 'send_outcome', id: n.id, year: n.year, to: n.to, result: n.result }, { content: message, allowed_mentions: { parse: [] } }),
	]);
}
