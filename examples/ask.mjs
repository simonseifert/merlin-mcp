#!/usr/bin/env node
// Tiny MCP client for the demo: calls a few merlin-mcp tools over /mcp and pretty-prints them.
//   node examples/ask.mjs                      # whoami + deadlines + grades
//   node examples/ask.mjs moodle_get_courses   # any single tool, optional JSON args as 2nd argument
// Env: MERLIN_URL (default http://127.0.0.1:8787), MCP_BEARER (default demo-mcp-bearer).
const URL_BASE = process.env.MERLIN_URL ?? 'http://127.0.0.1:8787';
const BEARER = process.env.MCP_BEARER ?? 'demo-mcp-bearer';

const c = process.stdout.isTTY || process.env.FORCE_COLOR ? { b: '\x1b[1m', d: '\x1b[2m', g: '\x1b[32m', y: '\x1b[33m', c: '\x1b[36m', r: '\x1b[0m' } : { b: '', d: '', g: '', y: '', c: '', r: '' };

let id = 0;
async function rpc(method, params) {
	const res = await fetch(`${URL_BASE}/mcp`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${BEARER}` },
		body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
	});
	if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
	const text = await res.text();
	// The server may answer as plain JSON or as one server-sent event.
	const json = text.trimStart().startsWith('{') ? text : text.split('\n').find((l) => l.startsWith('data:'))?.slice(5);
	const msg = JSON.parse(json ?? '{}');
	if (msg.error) throw new Error(msg.error.message);
	return msg.result;
}

async function tool(name, args = {}) {
	const result = await rpc('tools/call', { name, arguments: args });
	const text = result.content?.[0]?.text ?? '{}';
	if (result.isError) throw new Error(text);
	return JSON.parse(text);
}

const title = (s) => console.log(`\n${c.b}${c.c}${s}${c.r}`);
const money = (s) => `${c.g}${s}${c.r}`;

async function demo() {
	console.log(`${c.d}merlin-mcp at ${URL_BASE}, talking to a fake Merlin (all data invented)${c.r}`);

	title('moodle_whoami');
	const who = await tool('moodle_whoami');
	for (const w of who.items) console.log(`  ${w.year}  ${c.b}${w.fullname}${c.r}  ${c.d}${w.sitename}${c.r}`);

	title('moodle_get_upcoming_deadlines');
	const dl = await tool('moodle_get_upcoming_deadlines', { days_ahead: 14 });
	for (const e of dl.items) console.log(`  ${c.y}${e.timesort_local}${c.r}  ${e.name}  ${c.d}${String(e.course).split(' ')[0]} ${e.year}${c.r}`);

	title('moodle_get_grades');
	const gr = await tool('moodle_get_grades');
	for (const course of gr.items) {
		console.log(`  ${c.b}${course.coursename}${c.r}  ${c.d}(${course.year})${c.r}`);
		for (const g of course.gradeitems) console.log(`    ${(g.itemname ?? 'Course total').padEnd(24)} ${money(g.gradeformatted)}  ${c.d}${g.percentageformatted}${c.r}`);
	}
	console.log('');
}

const [, , name, rawArgs] = process.argv;
try {
	if (name) console.log(JSON.stringify(await tool(name, rawArgs ? JSON.parse(rawArgs) : {}), null, 2));
	else await demo();
} catch (err) {
	console.error(`ask.mjs: ${err instanceof Error ? err.message : err}`);
	process.exit(1);
}
