/**
 * Text extraction for moodle_read_file: PDF text layers (via unpdf, which runs
 * on Workers and Node), plain text formats and HTML. Everything else is refused
 * with a pointer to /api/file. Pure functions so they test without Moodle.
 *
 * Bounded on purpose: at most READ_FILE_MAX_BYTES in, at most
 * PDF_MAX_PAGES_PER_CALL pages parsed, and text decoded only as far as
 * maxChars needs.
 */
import { stripHtml } from './lib.js';

/** Files above this are refused before extraction (fits a Worker's 128 MB with the PDF parser on top). */
export const READ_FILE_MAX_BYTES = 20 * 1024 * 1024;
/** Pages parsed per call, even when they hold no text (scanned PDFs). */
export const PDF_MAX_PAGES_PER_CALL = 200;

export interface FileText {
	kind: 'pdf' | 'text' | 'html';
	total_pages?: number;
	/** PDF pages included, e.g. "3-7". */
	pages?: string;
	text: string;
	/** True when the text stops before the end of what was asked for. */
	truncated?: boolean;
	/** PDF: the page to pass as the start of `pages` to continue. */
	next_page?: number;
	note?: string;
}

const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|xml|tex|py|java|c|cpp|h|js|ts|sql|r|m|log)$/i;

/** "3" or "2-9" -> clamped 1-based inclusive range; undefined -> all pages. */
export function parsePageRange(range: string | undefined, total: number): [number, number] {
	if (total < 1) return [1, 0];
	if (!range) return [1, total];
	const m = /^(\d+)(?:-(\d+))?$/.exec(range.trim());
	if (!m) throw new Error('pages must look like "3" or "2-9"');
	const from = Number(m[1]);
	if (from < 1) throw new Error('pages start at 1');
	if (from > total) throw new Error(`The file has ${total} page(s); page ${from} doesn't exist.`);
	const end = m[2] ? Number(m[2]) : from;
	if (end < from) throw new Error('pages: the end comes before the start');
	return [from, Math.min(total, end)];
}

function isPdf(buf: Uint8Array, type: string, name: string): boolean {
	if (type === 'application/pdf' || /\.pdf$/i.test(name)) return true;
	return buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46; // %PDF
}

/** Decode at most what maxChars can use (a UTF-8 char is at most 4 bytes), then cut to maxChars. */
function decodeCapped(buf: Uint8Array, maxChars: number, html: boolean): { text: string; truncated: boolean } {
	const byteCap = Number.isFinite(maxChars) ? Math.min(buf.byteLength, maxChars * 4 + 4) : buf.byteLength;
	// HTML loses most of its bytes to markup, so give it more room before stripping.
	const cap = html && Number.isFinite(maxChars) ? Math.min(buf.byteLength, byteCap * 4) : byteCap;
	let text = new TextDecoder('utf-8').decode(buf.subarray(0, cap));
	if (html) text = stripHtml(text);
	const cutBytes = cap < buf.byteLength;
	if (text.length > maxChars) return { text: text.slice(0, maxChars), truncated: true };
	return { text, truncated: cutBytes };
}

export async function extractFileText(buf: Uint8Array, contentType: string, filename: string, pages?: string, maxChars = Infinity): Promise<FileText> {
	const type = contentType.split(';')[0].trim().toLowerCase();
	if (isPdf(buf, type, filename)) {
		const { getDocumentProxy } = await import('unpdf');
		const pdf = await getDocumentProxy(buf);
		try {
			const totalPages = pdf.numPages;
			const [from, to] = parsePageRange(pages, totalPages);
			const parts: string[] = [];
			let used = 0;
			let last = from - 1;
			let nextPage: number | undefined;
			let empty = true;
			for (let p = from; p <= to; p++) {
				if (p - from >= PDF_MAX_PAGES_PER_CALL) {
					nextPage = p;
					break;
				}
				const page = await pdf.getPage(p);
				const content = await page.getTextContent();
				const text = content.items.map((it) => ('str' in it ? it.str + (it.hasEOL ? '\n' : '') : '')).join('').trim();
				page.cleanup();
				if (text) empty = false;
				const part = `${parts.length ? '\n\n' : ''}--- page ${p} ---\n${text}`;
				if (used + part.length > maxChars) {
					// Keep what fits of this page, and resume from this same page next time.
					const room = maxChars - used;
					if (room > 40) {
						parts.push(part.slice(0, room));
						last = p;
					}
					nextPage = p;
					break;
				}
				parts.push(part);
				used += part.length;
				last = p;
			}
			const result: FileText = {
				kind: 'pdf',
				total_pages: totalPages,
				pages: last >= from ? (last === from ? `${from}` : `${from}-${last}`) : undefined,
				text: parts.join(''),
				note: empty && parts.length ? 'No text layer on these pages (a scanned or image-only PDF). Download it with /api/file and use OCR instead.' : undefined,
			};
			if (nextPage !== undefined) {
				result.truncated = true;
				result.next_page = nextPage;
			}
			return result;
		} finally {
			await pdf.cleanup();
		}
	}
	if (type === 'text/html' || /\.html?$/i.test(filename)) {
		const { text, truncated } = decodeCapped(buf, maxChars, true);
		return { kind: 'html', text, truncated: truncated || undefined };
	}
	if (type.startsWith('text/') || type === 'application/json' || type === 'application/xml' || TEXT_EXT.test(filename)) {
		const { text, truncated } = decodeCapped(buf, maxChars, false);
		return { kind: 'text', text, truncated: truncated || undefined };
	}
	throw new Error(
		`Can't read text from ${type || 'this file type'} (${filename || 'unnamed file'}). Text works for PDF, plain text, Markdown, CSV, JSON and HTML; download other files with /api/file.`
	);
}
