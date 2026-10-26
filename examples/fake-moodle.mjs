#!/usr/bin/env node
// A tiny fake Moodle ("Merlin") for trying merlin-mcp without an account.
// Dependency-free, answers on localhost only by default, never contacts the internet.
// All people, courses and grades below are invented. Any token is accepted.
//
//   node examples/fake-moodle.mjs            # http://127.0.0.1:8790
//   PORT=9000 HOST=0.0.0.0 node examples/fake-moodle.mjs
//
// Point merlin-mcp at it with:
//   MOODLE_BASE=http://127.0.0.1:8790 MERLIN_YEARS=2025-2026,2026-2027 MOODLE_TOKEN=anything
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT ?? 8790);
const HOST = process.env.HOST ?? '127.0.0.1';
const QUIET = process.env.FAKE_MOODLE_QUIET === '1';
const YEARS = ['2025-2026', '2026-2027'];

const DAY = 86400;
const now = () => Math.floor(Date.now() / 1000);
const at = (days, hour = 12) => {
	const d = new Date((now() + days * DAY) * 1000);
	d.setUTCHours(hour - 1, 0, 0, 0); // roughly Zagreb time
	return Math.floor(d.getTime() / 1000);
};

const ANA = { userid: 42, username: 'ana.test', firstname: 'Ana', lastname: 'Test', fullname: 'Ana Test' };
const PROF = { id: 7, fullname: 'Prof. Marko Probni' };
const ASSISTANT = { id: 8, fullname: 'Asistentica Lana Lažić' };

// Ids are only unique within a year, like on the real Merlin. Here they are disjoint on
// purpose so id tools work out the year by themselves. Functions are evaluated per request,
// so dates are always relative to "now".
const DATA = {
	'2026-2027': {
		course: { id: 101, shortname: 'TEST101', fullname: 'TEST101 Uvod u programiranje' },
		forumId: 11,
		discussions: [
			{ id: 1101, discussion: 1101, name: 'Termin prvog kolokvija', subject: 'Termin prvog kolokvija', userfullname: PROF.fullname, created: () => at(-1, 9), message: '<p>Poštovani, prvi kolokvij je u <b>utorak u 10:00</b>, dvorana A-12. Ponesite iskaznicu.</p>', replies: 1 },
			{ id: 1102, discussion: 1102, name: 'Dobrodošli na kolegij', subject: 'Dobrodošli na kolegij', userfullname: PROF.fullname, created: () => at(-20, 8), message: '<p>Dobrodošli! Materijali su u sekciji Predavanja.</p>', replies: 0 },
		],
		posts: {
			1101: [
				{ id: 9001, author: { fullname: PROF.fullname }, subject: 'Termin prvog kolokvija', message: '<p>Poštovani, prvi kolokvij je u <b>utorak u 10:00</b>, dvorana A-12. Ponesite iskaznicu.</p>', created: () => at(-1, 9) },
				{ id: 9002, author: { fullname: 'Ivo Studentić' }, subject: 'Re: Termin prvog kolokvija', message: '<p>Hvala! Je li dopušten podsjetnik na A4 papiru?</p>', created: () => at(-1, 11) },
			],
			1102: [{ id: 9003, author: { fullname: PROF.fullname }, subject: 'Dobrodošli na kolegij', message: '<p>Dobrodošli! Materijali su u sekciji Predavanja.</p>', created: () => at(-20, 8) }],
		},
		assignments: [
			{ id: 31, name: 'Zadaća 3: Petlje', due: 2, intro: '<p>Riješite zadatke 1 do 5 o petljama <i>for</i> i <i>while</i>.</p>', status: 'new' },
			{ id: 32, name: 'Projekt: Kalkulator', due: 9, intro: '<p>Napravite jednostavan kalkulator u Pythonu.</p>', status: 'new' },
			{ id: 30, name: 'Zadaća 2: Uvjeti', due: -12, intro: '<p>Zadaci o naredbi <i>if</i>.</p>', status: 'graded', grade: '9,00 / 10,00', comment: '<p>Odlično, pazite na imena varijabli.</p>' },
		],
		quiz: { id: 51, name: 'Kviz 1: Varijable', attempts: [{ id: 701, attempt: 1, state: 'finished', timestart: () => at(-14, 10), timefinish: () => at(-14, 10) + 900, sumgrades: 8 }] },
		files: [{ name: 'Predavanje 1 - Uvod.pdf', size: 1024, modified: () => at(-25, 9) }],
		grades: [
			{ itemname: 'Zadaća 1: Varijable', itemtype: 'mod', itemmodule: 'assign', graderaw: 10, gradeformatted: '10,00', percentageformatted: '100,00 %', feedback: '<p>Bravo!</p>', gradedategraded: () => at(-20) },
			{ itemname: 'Zadaća 2: Uvjeti', itemtype: 'mod', itemmodule: 'assign', graderaw: 9, gradeformatted: '9,00', percentageformatted: '90,00 %', feedback: '<p>Odlično, pazite na imena varijabli.</p>', gradedategraded: () => at(-10) },
			{ itemname: 'Kviz 1: Varijable', itemtype: 'mod', itemmodule: 'quiz', graderaw: 8, gradeformatted: '8,00', percentageformatted: '80,00 %', gradedategraded: () => at(-14) },
			{ itemtype: 'course', graderaw: 27, gradeformatted: '27,00', percentageformatted: '90,00 %' },
		],
		notifications: [
			{ id: 501, subject: 'Nova zadaća: Zadaća 3: Petlje', smallmessage: 'Zadaća 3 je objavljena.', fullmessage: 'Zadaća 3: Petlje je objavljena, rok za predaju je za dva dana.', read: false, timecreated: () => at(-1, 8), contexturl: 'http://merlin.example/2026-2027/mod/assign/view.php?id=2031' },
			{ id: 502, subject: 'Ocjena: Zadaća 2: Uvjeti', smallmessage: 'Ocijenjeno.', fullmessage: 'Vaša zadaća je ocijenjena: 9,00 / 10,00.', read: true, timecreated: () => at(-10, 14), contexturl: 'http://merlin.example/2026-2027/mod/assign/view.php?id=2030' },
		],
		events: [
			{ id: 801, name: 'Zadaća 3: Petlje is due', modulename: 'assign', instance: 31, eventtype: 'due', timestart: () => at(2, 23), timesort: () => at(2, 23), duration: 0, description: '<p>Rok za predaju zadaće.</p>' },
			{ id: 802, name: 'Prvi kolokvij', modulename: '', instance: 0, eventtype: 'course', timestart: () => at(5, 10), timesort: () => at(5, 10), duration: 5400, location: 'A-12', description: '<p>Prvi kolokvij.</p>', notAction: true },
			{ id: 803, name: 'Projekt: Kalkulator is due', modulename: 'assign', instance: 32, eventtype: 'due', timestart: () => at(9, 23), timesort: () => at(9, 23), duration: 0, description: '<p>Rok za predaju projekta.</p>' },
		],
		conversations: [
			{ id: 1, type: 1, unreadcount: 1, members: [{ id: PROF.id, fullname: PROF.fullname }], messages: [
				{ id: 3002, useridfrom: PROF.id, text: '<p>Ana, vaš projekt možete predati do petka.</p>', timecreated: () => at(-1, 15) },
				{ id: 3001, useridfrom: ANA.userid, text: '<p>Poštovani, mogu li dobiti produljenje roka za projekt?</p>', timecreated: () => at(-2, 12) },
			] },
		],
	},
	'2025-2026': {
		course: { id: 202, shortname: 'TEST202', fullname: 'TEST202 Baze podataka' },
		forumId: 21,
		discussions: [
			{ id: 2101, discussion: 2101, name: 'Ispitni rok i rezultati', subject: 'Ispitni rok i rezultati', userfullname: ASSISTANT.fullname, created: () => at(-3, 13), message: '<p>Rezultati ispita objavljeni su u sekciji Ispiti. Uvid u radove je u četvrtak u 12:00.</p>', replies: 0 },
		],
		posts: {
			2101: [{ id: 9101, author: { fullname: ASSISTANT.fullname }, subject: 'Ispitni rok i rezultati', message: '<p>Rezultati ispita objavljeni su u sekciji Ispiti. Uvid u radove je u četvrtak u 12:00.</p>', created: () => at(-3, 13) }],
		},
		assignments: [{ id: 41, name: 'Seminar: ER dijagram', due: 5, intro: '<p>Nacrtajte ER dijagram za zadanu knjižnicu.</p>', status: 'submitted' }],
		quiz: null,
		files: [{ name: 'SQL podsjetnik.pdf', size: 1024, modified: () => at(-60, 9) }],
		grades: [
			{ itemname: 'Seminar: ER dijagram', itemtype: 'mod', itemmodule: 'assign', graderaw: 18, gradeformatted: '18,00', percentageformatted: '90,00 %', feedback: '<p>Dobar dijagram, dodajte kardinalnosti.</p>', gradedategraded: () => at(-30) },
			{ itemtype: 'course', graderaw: 18, gradeformatted: '18,00', percentageformatted: '90,00 %' },
		],
		notifications: [
			{ id: 601, subject: 'Rezultati ispita', smallmessage: 'Rezultati su objavljeni.', fullmessage: 'Rezultati ispita iz kolegija Baze podataka su objavljeni.', read: false, timecreated: () => at(-3, 13), contexturl: 'http://merlin.example/2025-2026/mod/forum/discuss.php?d=2101' },
		],
		events: [
			{ id: 811, name: 'Seminar: ER dijagram is due', modulename: 'assign', instance: 41, eventtype: 'due', timestart: () => at(5, 23), timesort: () => at(5, 23), duration: 0, description: '<p>Rok za predaju seminara.</p>' },
		],
		conversations: [
			{ id: 5, type: 1, unreadcount: 0, members: [{ id: ASSISTANT.id, fullname: ASSISTANT.fullname }], messages: [
				{ id: 4002, useridfrom: ASSISTANT.id, text: '<p>Uvid u radove je u četvrtak u 12:00, soba 218.</p>', timecreated: () => at(-3, 14) },
				{ id: 4001, useridfrom: ANA.userid, text: '<p>Dobar dan, kada je uvid u rad?</p>', timecreated: () => at(-3, 13) },
			] },
		],
	},
};

// ---------- helpers ----------
const resolve = (v) => (typeof v === 'function' ? v() : v);
const deep = (o) => (Array.isArray(o) ? o.map(deep) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, deep(resolve(v))])) : resolve(o));

function fail(errorcode, message) {
	return { exception: 'moodle_exception', errorcode, message };
}

function tinyPdf() {
	const stream = 'BT /F1 14 Tf 20 60 Td (Fake lecture notes. Not real.) Tj ET';
	const objs = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
		'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 120] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
		`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
		'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
	];
	let out = '%PDF-1.4\n';
	const offsets = [];
	objs.forEach((o, i) => {
		offsets.push(out.length);
		out += `${i + 1} 0 obj\n${o}\nendobj\n`;
	});
	const xref = out.length;
	out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
	out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return Buffer.from(out, 'latin1');
}
const PDF = tinyPdf();

function contentsFor(year, d, origin) {
	const file = (f) => ({ type: 'file', filename: f.name, filesize: f.size, mimetype: 'application/pdf', timemodified: f.modified, fileurl: `${origin}/${year}/webservice/pluginfile.php/${d.course.id}/mod_resource/content/1/${encodeURIComponent(f.name)}` });
	const mods = [
		{ id: 1000 + d.forumId, instance: d.forumId, name: 'Obavijesti', modname: 'forum', visible: 1, url: `${origin}/${year}/mod/forum/view.php?id=${1000 + d.forumId}`, description: '<p>Obavijesti kolegija.</p>' },
		...d.assignments.map((a) => ({ id: 2000 + a.id, instance: a.id, name: a.name, modname: 'assign', visible: 1, url: `${origin}/${year}/mod/assign/view.php?id=${2000 + a.id}`, description: a.intro })),
		...(d.quiz ? [{ id: 3000 + d.quiz.id, instance: d.quiz.id, name: d.quiz.name, modname: 'quiz', visible: 1, url: `${origin}/${year}/mod/quiz/view.php?id=${3000 + d.quiz.id}` }] : []),
	];
	return [
		{ id: 1, name: 'Općenito', visible: 1, summary: '<p>Dobrodošli na kolegij.</p>', modules: [mods[0]] },
		{ id: 2, name: 'Predavanja', visible: 1, summary: '', modules: d.files.map((f, i) => ({ id: 4000 + i, instance: 4000 + i, name: f.name.replace('.pdf', ''), modname: 'resource', visible: 1, url: `${origin}/${year}/mod/resource/view.php?id=${4000 + i}`, contents: [file(f)] })) },
		{ id: 3, name: 'Zadaće i kvizovi', visible: 1, summary: '', modules: mods.slice(1) },
	];
}

// ---------- the Moodle web-service functions ----------
function call(fn, p, year, origin) {
	const d = deep(DATA[year]);
	const c = d.course;
	switch (fn) {
		case 'core_webservice_get_site_info':
			return { sitename: `Merlin (FAKE, ${year})`, ...ANA, siteurl: `${origin}/${year}`, release: '5.2 (fake)', version: '2026010100', userprivateaccesskey: 'FAKE-NOT-A-REAL-KEY', functions: [{ name: 'core_webservice_get_site_info', version: '1' }] };
		case 'core_enrol_get_users_courses':
			return [{ ...c, visible: 1, startdate: at(-40), enddate: at(120), lastaccess: at(-1) }];
		case 'core_course_get_contents':
			return Number(p.courseid) === c.id ? contentsFor(year, d, origin) : fail('invalidcourse', 'Course not found in this fake year');
		case 'mod_forum_get_forums_by_courses':
			return [{ id: d.forumId, course: c.id, name: 'Obavijesti', type: 'news' }];
		case 'mod_forum_get_forum_discussions':
			return Number(p.forumid) === d.forumId ? { discussions: d.discussions.map((x) => ({ ...x, timemodified: x.created, pinned: false, numreplies: x.replies })) } : fail('invalidparameter', 'Forum not found in this fake year');
		case 'mod_forum_get_discussion_posts': {
			const posts = d.posts[Number(p.discussionid)];
			return posts ? { posts: posts.map((x) => ({ ...x, timecreated: x.created, timemodified: x.created })) } : fail('invalidrecord', 'Discussion not found in this fake year');
		}
		case 'core_calendar_get_action_events_by_timesort':
			return { events: d.events.filter((e) => !e.notAction).map((e) => ({ ...e, course: { id: c.id, fullname: c.fullname }, url: `${origin}/${year}/mod/assign/view.php?id=${2000 + e.instance}`, overdue: false })) };
		case 'core_calendar_get_calendar_events':
			return { events: d.events.map((e) => ({ ...e, courseid: c.id, timeduration: e.duration })) };
		case 'message_popup_get_popup_notifications':
			return { notifications: d.notifications, unreadcount: d.notifications.filter((n) => !n.read).length };
		case 'mod_assign_get_assignments':
			return { courses: [{ id: c.id, fullname: c.fullname, shortname: c.shortname, assignments: d.assignments.map((a) => ({ id: a.id, name: a.name, duedate: at(a.due, 23), cutoffdate: at(a.due + 3, 23), intro: a.intro })) }] };
		case 'mod_assign_get_submission_status': {
			const a = d.assignments.find((x) => x.id === Number(p.assignid));
			if (!a) return fail('invalidrecord', 'Assignment not found in this fake year');
			return { lastattempt: { submission: { status: a.status === 'new' ? 'new' : 'submitted' } }, feedback: a.grade ? { gradefordisplay: a.grade, plugins: [{ type: 'comments', editorfields: [{ name: 'comments', text: a.comment }] }] } : undefined };
		}
		case 'gradereport_user_get_grade_items':
			return Number(p.courseid) === c.id ? { usergrades: [{ courseid: c.id, userid: ANA.userid, gradeitems: d.grades }] } : fail('invalidcourse', 'Course not found in this fake year');
		case 'mod_quiz_get_quizzes_by_courses':
			return { quizzes: d.quiz ? [{ id: d.quiz.id, course: c.id, name: d.quiz.name }] : [] };
		case 'mod_quiz_get_user_attempts':
			return d.quiz && Number(p.quizid) === d.quiz.id ? { attempts: d.quiz.attempts } : fail('invalidrecord', 'Quiz not found in this fake year');
		case 'mod_quiz_get_attempt_review':
			return d.quiz && d.quiz.attempts.some((a) => a.id === Number(p.attemptid))
				? { grade: '8,00', questions: [
					{ number: 1, slot: 1, type: 'multichoice', state: 'gradedright', status: 'Correct', mark: '1,00', maxmark: 1, html: '<div>Koji je tip podatka za cijele brojeve? <b>Odgovor: int</b>. Točno.</div>' },
					{ number: 2, slot: 2, type: 'shortanswer', state: 'gradedwrong', status: 'Incorrect', mark: '0,00', maxmark: 1, html: '<div>Kako se zove petlja s brojačem? Vaš odgovor: while. Točan odgovor: for.</div>' },
				] }
				: fail('invalidrecord', 'Attempt not found in this fake year');
		case 'core_message_get_conversations':
			return { conversations: d.conversations };
		case 'core_message_get_conversation_messages': {
			const conv = d.conversations.find((x) => x.id === Number(p.convid));
			return conv ? { id: conv.id, members: [...conv.members, { id: ANA.userid, fullname: ANA.fullname }], messages: conv.messages } : fail('invalidconversationid', 'Conversation not found in this fake year');
		}
		case 'core_course_get_updates_since':
			return { instances: [{ contextlevel: 'module', id: 2000 + d.assignments[0].id, updates: [{ name: 'configuration', timeupdated: at(0, 8) }] }], warnings: [] };
		case 'core_course_get_courses_by_field':
			return { courses: [{ ...c }], warnings: [] };
		case 'core_message_get_messages':
			return { messages: [], warnings: [] };
		case 'mod_workshop_get_workshops_by_courses':
			return { workshops: [], warnings: [] };
		default:
			return fail('accessexception', `Access control exception: function ${fn} is not available in the fake Merlin`);
	}
}

// ---------- HTTP ----------
async function readBody(req) {
	const chunks = [];
	for await (const ch of req) chunks.push(ch);
	return Buffer.concat(chunks).toString('utf8');
}

const server = createServer(async (req, res) => {
	try {
		const origin = `http://${req.headers.host ?? `${HOST}:${PORT}`}`;
		const url = new URL(req.url ?? '/', origin);
		const rest = /^\/(\d{4}-\d{4})\/webservice\/rest\/server\.php$/.exec(url.pathname);
		if (rest) {
			const year = rest[1];
			const params = Object.fromEntries(url.searchParams);
			if (req.method === 'POST') Object.assign(params, Object.fromEntries(new URLSearchParams(await readBody(req))));
			const out = !DATA[year]
				? fail('invalidurl', `No fake Merlin site for ${year}`)
				: !params.wstoken
					? fail('invalidtoken', 'Invalid token - token not found')
					: call(String(params.wsfunction ?? ''), params, year, origin);
			if (!QUIET) console.error(`[fake-moodle] ${year} ${params.wsfunction ?? '?'}${out?.exception ? ` -> ${out.errorcode}` : ''}`);
			res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(out));
			return;
		}
		if (/\/pluginfile\.php\//.test(url.pathname)) {
			if (!QUIET) console.error(`[fake-moodle] file ${url.pathname}`);
			res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': PDF.length, 'Content-Disposition': 'attachment' }).end(PDF);
			return;
		}
		if (url.pathname === '/') {
			res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end(`Fake Merlin for merlin-mcp demos. Years: ${YEARS.join(', ')}. Student: Ana Test.\n`);
			return;
		}
		res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
	} catch (err) {
		console.error('[fake-moodle] error:', err instanceof Error ? err.message : err);
		res.writeHead(500).end('error');
	}
});

server.listen(PORT, HOST, () => console.error(`fake Merlin on http://${HOST}:${PORT} (years ${YEARS.join(', ')}; any token works)`));
