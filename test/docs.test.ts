import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { API_CALL_ALLOWLIST, VERSION } from '../src/lib.js';

// The docs state numbers and names that drift silently when the code changes. These keep them honest.

const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const app = read('src/app.ts');
const node = read('src/node.ts');
const readme = read('README.md');

describe('docs match the code', () => {
	it('package.json, VERSION and the changelog agree', () => {
		expect(JSON.parse(read('package.json')).version).toBe(VERSION);
		const registry = JSON.parse(read('server.json'));
		expect(registry.version).toBe(VERSION);
		expect(registry.packages[0].identifier).toBe(`ghcr.io/simonseifert/merlin-mcp:v${VERSION}`);
		expect(read('CHANGELOG.md')).toMatch(new RegExp(`^## ${VERSION.replaceAll('.', '\\.')} \\(\\d{4}-\\d{2}-\\d{2}\\)$`, 'm'));
	});

	it('README states the real number of tools', () => {
		const tools = new Set([...app.matchAll(/(?:readTool|server\.tool)\(\s*'(moodle_[a-z_]+)'/g)].map((m) => m[1]));
		expect(tools.size).toBeGreaterThan(20);
		expect(readme).toContain(`There are ${tools.size} tools.`);
	});

	it('README and SECURITY.md state the real size of the /api/call allow-list', () => {
		const phrase = `list of ${API_CALL_ALLOWLIST.size} functions`;
		expect(readme).toContain(phrase);
		expect(read('SECURITY.md')).toContain(phrase);
	});

	it('every setting the server reads is documented and in merlin.env.example', () => {
		const vars = new Set([...node.matchAll(/pick\('([A-Z_]+)'\)/g), ...node.matchAll(/process\.env\.([A-Z][A-Z_]+)/g)].map((m) => m[1]));
		vars.delete('NODE_ENV');
		expect(vars.size).toBeGreaterThan(15);
		const table = readme.slice(readme.indexOf('## Configuration'));
		const example = read('merlin.env.example');
		const missing = [...vars].filter((v) => !table.includes(`\`${v}\``) || !new RegExp(`^#? ?${v}=`, 'm').test(example));
		expect(missing).toEqual([]);
	});
});
