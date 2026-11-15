/**
 * Text extraction for moodle_read_file: PDF text layers (via unpdf, which runs
 * on Workers and Node), plain text formats and HTML. Everything else is refused
 * with a pointer to /api/file. Pure functions so they test without Moodle.
 */
import { stripHtml } from './lib.js';

/** Files above this are refused before extraction (a 30 MB PDF is ~1,000 slides). */
export const READ_FILE_MAX_BYTES = 30 * 1024 * 1024;

export interface FileText {
	kind: 'pdf' | 'text' | 'html';
	total_pages?: number;
	pages?: string;
	text: string;
	note?: string;
}

const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|xml|tex|py|java|c|cpp|h|js|ts|sql|r|m|log)$/i;

/** "3" or "2-9" -> clamped 1-based inclusive range; undefined -> all pages. */
export function parsePageRange(range: string | undefined, total: number): [number, number] {
	if (total < 1) return [1, 0];
	if (!range) return [1, total];
	const m = /^(\d+)(?:-(\d+))?$/.exec(range.trim());
	if (!m) throw new Error('pages must look like "3" or "2-9"');
	const from = Math.max(1, Number(m[1]));
	const to = Math.min(total, m[2] ? Number(m[2]) : from);
	if (from > total) throw new Error(`The file has ${total} page(s); page ${from} doesn't exist.`);
	if (to < from) throw new Error('pages: the end comes before the start');
	return [from, to];
}

function isPdf(buf: Uint8Array, type: string, name: string): boolean {
	if (type === 'application/pdf' || /\.pdf$/i.test(name)) return true;
	return buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46; // %PDF
}

export async function extractFileText(buf: Uint8Array, contentType: string, filename: string, pages?: string, maxChars = Infinity): Promise<FileText> {
	const type = contentType.split(';')[0].trim().toLowerCase();
	if (isPdf(buf, type, filename)) {
		const { getDocumentProxy } = await import('unpdf');
		const pdf = await getDocumentProxy(buf);
		try {
			const totalPages = pdf.numPages;
			const [from, to] = parsePageRange(pages, totalPages);
			// Only the requested pages, one at a time, stopping once the text passes maxChars.
			const parts: string[] = [];
			let chars = 0;
			let last = from - 1;
			let empty = true;
			for (let p = from; p <= to && chars <= maxChars; p++) {
				const page = await pdf.getPage(p);
				const content = await page.getTextContent();
				const text = content.items.map((it) => ('str' in it ? it.str + (it.hasEOL ? '\n' : '') : '')).join('').trim();
				page.cleanup();
				if (text) empty = false;
				const part = `--- page ${p} ---\n${text}`;
				parts.push(part);
				chars += part.length + 2;
				last = p;
			}
			return {
				kind: 'pdf',
				total_pages: totalPages,
				pages: `${from}-${last}`,
				text: parts.join('\n\n'),
				note: empty ? 'No text layer on these pages (a scanned or image-only PDF). Download it with /api/file and use OCR instead.' : undefined,
			};
		} finally {
			await pdf.cleanup();
		}
	}
	const decoded = () => new TextDecoder('utf-8').decode(buf);
	if (type === 'text/html' || /\.html?$/i.test(filename)) return { kind: 'html', text: stripHtml(decoded()) };
	if (type.startsWith('text/') || type === 'application/json' || type === 'application/xml' || TEXT_EXT.test(filename)) {
		return { kind: 'text', text: decoded() };
	}
	throw new Error(
		`Can't read text from ${type || 'this file type'} (${filename || 'unnamed file'}). Text works for PDF, plain text, Markdown, CSV, JSON and HTML; download other files with /api/file.`
	);
}
