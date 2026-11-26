// Invented data for `?demo`: lets the design be seen without a Merlin account. Dates are relative to now.
import type { Dashboard, DashCourse, DashEvent } from './types';

const DAY = 86400;

export function demoDashboard(): Dashboard {
	const now = Math.floor(Date.now() / 1000);
	const at = (days: number, h = 10, m = 0) => {
		const d = new Date((now + days * DAY) * 1000);
		d.setHours(h, m, 0, 0);
		return Math.floor(d.getTime() / 1000);
	};
	const Y = '2026-2027';
	const course = (id: number, name: string, short: string, items: Array<[string, number, number, string?]>, totalMax: number): DashCourse => {
		const raw = items.reduce((s, [, r]) => s + r, 0);
		return {
			key: `${Y}:${id}`,
			id,
			year: Y,
			name,
			shortname: short,
			total: { raw, max: totalMax, percent: Math.round((raw / totalMax) * 1000) / 10, formatted: raw.toFixed(2).replace('.', ',') },
			items: items.map(([n, r, max, fb], i) => ({
				name: n,
				module: n.toLowerCase().includes('kviz') ? 'quiz' : 'assign',
				raw: r,
				min: 0,
				max,
				formatted: r.toFixed(2).replace('.', ','),
				percent: Math.round((r / max) * 1000) / 10,
				weight: `${Math.round((max / totalMax) * 100)},00 %`,
				feedback: fb,
				graded_at: at(-30 + i * 6),
			})),
		};
	};
	const courses: DashCourse[] = [
		course(301, 'Mikroekonomija', 'MIKRO', [['1. kolokvij', 21, 25, 'Dobro riješen zadatak s elastičnošću.'], ['Aktivnost na nastavi', 8, 10], ['Kviz 1: Ponuda i potražnja', 9, 10]], 100),
		course(302, 'Poslovna statistika', 'STAT', [['Kviz 1', 7, 10], ['Kviz 2', 9.5, 10], ['Seminarski rad', 14, 20, 'Analiza je dobra, popravi grafove.']], 100),
		course(303, 'Marketing', 'MKT', [['Prezentacija case studyja', 18, 20, 'Odličan nastup!'], ['1. kolokvij', 26, 35]], 100),
		course(304, 'Poslovna informatika', 'PI', [['Laboratorijska vježba 1', 5, 5], ['Laboratorijska vježba 2', 4, 5], ['Projekt: baza podataka', 22, 30]], 100),
		course(305, 'Financijsko računovodstvo', 'FR', [['1. kolokvij', 12, 30]], 100),
		course(306, 'Poslovni engleski jezik', 'ENG', [['Esej', 17, 20], ['Usmena prezentacija', 9, 10]], 100),
	];
	const ev = (key: string, title: string, kind: DashEvent['kind'], course: string, start: number, extra: Partial<DashEvent> = {}): DashEvent => ({ key: `${Y}:${key}`, year: Y, title, kind, course, start, ...extra });
	const events: DashEvent[] = [
		ev('e1', 'Predavanje', 'class', 'Mikroekonomija', at(0, 8, 15), { duration: 5400, location: 'Dvorana A-1' }),
		ev('e2', 'Kviz 3: Monopol', 'deadline', 'Mikroekonomija', at(1, 23, 59), { todo: true }),
		ev('e3', '2. kolokvij', 'exam', 'Poslovna statistika', at(3, 12), { duration: 5400, location: 'Dvorana B-4', description: 'Gradivo: poglavlja 4 do 7. Dopušten kalkulator.' }),
		ev('e4', 'Seminar: Analiza tržišta', 'seminar', 'Marketing', at(5, 23, 59), { todo: true }),
		ev('e5', 'Laboratorijska vježba 3', 'deadline', 'Poslovna informatika', at(6, 20), { todo: true }),
		ev('e6', 'Vježbe', 'class', 'Financijsko računovodstvo', at(2, 14), { duration: 5400, location: 'Učionica 12' }),
		ev('e7', 'Međuispit', 'exam', 'Financijsko računovodstvo', at(10, 9), { duration: 7200, location: 'Dvorana A-1' }),
		ev('e8', 'Esej: Business ethics', 'seminar', 'Poslovni engleski jezik', at(12, 23, 59), { todo: true }),
		ev('e9', 'Završni ispit (pismeni)', 'exam', 'Mikroekonomija', at(24, 10), { duration: 7200, location: 'Velika dvorana' }),
		ev('e10', 'Usmeni ispit', 'exam', 'Marketing', at(31, 9), { location: 'Kabinet 214' }),
		ev('e11', 'Konzultacije', 'event', 'Poslovna statistika', at(4, 11), { location: 'Kabinet 108' }),
		ev('e12', 'Predavanje', 'class', 'Marketing', at(7, 10), { duration: 5400, location: 'Dvorana C-2' }),
		ev('e13', 'Projekt: baza podataka (2. dio)', 'seminar', 'Poslovna informatika', at(17, 23, 59), { todo: true }),
		ev('e14', '1. kolokvij', 'exam', 'Poslovni engleski jezik', at(19, 8, 30), { location: 'Dvorana B-1' }),
	].sort((a, b) => a.start - b.start);
	return {
		generated_at: now,
		year: Y,
		years: [Y],
		user: { fullname: 'Ana Test', firstname: 'Ana', site: 'Merlin 2026-2027' },
		courses,
		events,
		exams: events.filter((e) => e.kind === 'exam'),
		seminars: events
			.filter((e) => e.kind === 'seminar')
			.map((e) => ({ key: e.key, year: Y, title: e.title, course: e.course, due: e.start, intro: 'Rad predati u PDF formatu, 8 do 10 stranica, APA citiranje.', source: 'assignment' as const })),
		announcements: [
			{ key: `${Y}:d1`, year: Y, course: 'Poslovna statistika', forum: 'Obavijesti', subject: 'Raspored za 2. kolokvij', author: 'doc. dr. sc. Iva Primjer', created: at(-1, 9), message: 'Kolokvij se piše u dvorani B-4. Studenti s prezimenom A–K u 12:00, L–Ž u 13:30.', kind: 'exam' },
			{ key: `${Y}:d2`, year: Y, course: 'Marketing', forum: 'Obavijesti', subject: 'Teme seminara su objavljene', author: 'izv. prof. dr. sc. Marko Probni', created: at(-2, 15), message: 'Odaberite temu do petka. Seminar se predaje u PDF-u, a izlaže se 10 minuta.', kind: 'seminar' },
			{ key: `${Y}:d3`, year: Y, course: 'Mikroekonomija', forum: 'Obavijesti', subject: 'Rezultati 1. kolokvija', author: 'prof. dr. sc. Lana Lažić', created: at(-4, 11), message: 'Rezultati su u Merlinu. Uvid u radove u srijedu u 12:00.' },
			{ key: `${Y}:d4`, year: Y, course: 'Poslovna informatika', forum: 'Obavijesti', subject: 'Nova laboratorijska vježba', author: 'asist. Ivo Studentić', created: at(-6, 8), message: 'Vježba 3 je objavljena, rok je za tjedan dana.' },
		],
	};
}
