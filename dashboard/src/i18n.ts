import { useSyncExternalStore } from 'react';

/**
 * A tiny i18n layer, no library. Croatian is the default; English is picked by the toggle (remembered
 * in localStorage) or, with no choice made, by an English browser language. Merlin's own content
 * (course names, announcements, feedback) is never translated.
 *
 * Strings may hold {name} placeholders. A `backtick` pair marks code (see Rich in components/ui).
 * Plural entries come as `key.one`, `key.few`, `key.many` (Croatian) and use `key.one` / `key.many` in English;
 * all three exist in both dictionaries and `tn` picks one.
 */
export type Lang = 'hr' | 'en';

const KEY = 'marlon.lang';

const hr = {
	// navigation and chrome
	'nav.aria': 'Stranice',
	'nav.pregled': 'Pregled',
	'nav.predmeti': 'Predmeti',
	'nav.kalendar': 'Kalendar',
	'nav.ispiti': 'Ispiti i seminari',
	'top.updated': 'ažurirano {when}',
	'top.refresh': 'Osvježi',
	'top.lite': 'Lagani način (bez 3D pozadine)',
	'top.liteOn': 'Lagani način je uključen',
	'top.liteOff': 'Lagani način: isključi 3D pozadinu',
	'top.year': 'Akademska godina',
	'top.addYear': '+ Dodaj godinu…',
	'top.signOut': 'Odjava i brisanje tokena',
	'top.signOutTitle': 'Odjava (briše tokene svih godina iz ovog preglednika)',
	'lang.switch': 'Prebaci na engleski',
	'lang.label': 'EN',
	'demo': 'demo',
	'foot': 'Samo čita iz Merlina · bodovi se osvježavaju najviše svakih 15 minuta, ostalo svakih 5',
	'close': 'Zatvori',
	'retry': 'Pokušaj ponovo',
	'openInMerlin': 'Otvori u Merlinu',
	'newTab': ' (otvara se u novoj kartici)',
	'loadFailed': 'Podaci se nisu učitali',
	'toast.cached': ' Prikazujem zadnje spremljene podatke.',
	'partial': 'Dio podataka nije stigao iz Merlina ({parts}).',
	'err.generic': 'Nešto je pošlo krivo.',
	'err.rate': 'Merlin traži malo pauze. Probaj opet za minutu.',
	'err.server': 'Server je vratio {n}',
	'err.login': 'Prijava nije uspjela.',
	'nokey.a': 'Ovaj server je javan, pa traži tvoj link s ključem (onaj s `#key=` na kraju). Otvori ga jednom i ovaj preglednik će ga zapamtiti.',
	'nokey.demo': 'Pogledaj demo',

	// data parts named in the partial-data banner
	'part.whoami': 'račun',
	'part.courses': 'predmeti',
	'part.calendar': 'kalendar',
	'part.deadlines': 'rokovi',
	'part.assignments': 'zadaće',
	'part.grades': 'bodovi',
	'part.announcements': 'obavijesti',
	'part.main': 'osnovni podaci',

	// event kinds
	'kind.exam': 'Ispit',
	'kind.seminar': 'Seminar',
	'kind.deadline': 'Rok',
	'kind.class': 'Nastava',
	'kind.event': 'Događaj',

	// numbers, time
	'ring.none': 'nema podataka',
	'ring.pct': '{n} posto',
	'rel.now': 'upravo',
	'rel.inMin': 'za {n} min',
	'rel.minAgo': 'prije {n} min',
	'rel.todayAt': 'danas u {time}',
	'rel.today': 'danas',
	'rel.tomorrowAt': 'sutra u {time}',
	'rel.yesterday': 'jučer',
	'rel.inDays.one': 'za {n} dan',
	'rel.inDays.few': 'za {n} dana',
	'rel.inDays.many': 'za {n} dana',
	'rel.daysAgo.one': 'prije {n} dan',
	'rel.daysAgo.few': 'prije {n} dana',
	'rel.daysAgo.many': 'prije {n} dana',
	'unit.day.one': 'dan',
	'unit.day.few': 'dana',
	'unit.day.many': 'dana',
	'unit.hour.one': 'sat',
	'unit.hour.few': 'sata',
	'unit.hour.many': 'sati',
	'unit.min': 'min',
	'n.items.one': '{n} stavka',
	'n.items.few': '{n} stavke',
	'n.items.many': '{n} stavki',
	'n.courses.one': '{n} predmet',
	'n.courses.few': '{n} predmeta',
	'n.courses.many': '{n} predmeta',
	'n.events.one': '{n} događaj',
	'n.events.few': '{n} događaja',
	'n.events.many': '{n} događaja',
	'greet.night': 'Laku noć',
	'greet.morning': 'Dobro jutro',
	'greet.day': 'Dobar dan',
	'greet.evening': 'Dobra večer',
	'head.ofMax': ' / {max} bodova',
	'head.points': ' bodova',
	'head.none': ' još nema bodova',
	'head.graded': ' od ocijenjenog',

	// overview
	'ov.openExams': 'Otvori Ispiti i seminari',
	'ov.openCourses': 'Otvori Predmeti',
	'ov.quiet': 'Ovaj tjedan je miran.',
	'ov.week': 'Ovaj tjedan: {items}',
	'ov.nextExamSub': ' · sljedeći ispit {when}',
	'ov.nextExam': 'Sljedeći ispit',
	'ov.noExam': 'Nema ispita na vidiku',
	'ov.noExamHint': 'U Merlin kalendaru nema ispita za sljedeća 4 mjeseca.',
	'ov.success': 'Uspješnost',
	'ov.ofGraded': 'od ocijenjenog · {courses}',
	'ov.next7': 'Sljedećih 7 dana',
	'ov.calendarLink': 'Kalendar →',
	'ov.nothing': 'Ništa u kalendaru',
	'ov.nothingHint': 'Uživaj u slobodnom tjednu.',
	'ov.today': 'Danas',
	'ov.points': 'Bodovi',
	'ov.noCourses': 'Nema predmeta',
	'ov.news': 'Obavijesti',
	'ov.noNews': 'Nema novih obavijesti',
	'ov.noNewsHint': 'U zadnjih 45 dana nema novih objava.',
	'ov.seminars': 'Seminari',
	'ov.noSeminars': 'Nema seminara',
	'ov.noDue': 'bez roka',

	// courses
	'co.title': 'Predmeti',
	'co.sub': 'Bodovi iz Merlina, akademska godina {year}',
	'co.sortPoints': 'Po bodovima',
	'co.sortName': 'Po imenu',
	'co.sortAria': 'Redoslijed',
	'co.none': 'Nema upisanih predmeta',
	'co.noneHint': 'Merlin za ovu godinu nije vratio nijedan kolegij.',
	'co.noPoints': 'Još nema bodova',
	'co.gradesFailed': 'Bodovi se nisu učitali.',
	'co.gradesStale': 'Bodovi se nisu osvježili.',
	'co.gradesStaleDetail': 'Bodovi se nisu osvježili, prikazujem zadnje spremljene.',
	'co.ofGradedPill': '{n}% od ocijenjenog',
	'co.total': 'Ukupno',
	'co.sofar': 'Od ocijenjenog',
	'co.gradedCount': 'Ocijenjenih stavki',
	'co.noGrades': 'Još nema ocjena',
	'co.noGradesHint': 'Profesor još nije unio bodove u Merlin.',
	'co.weight': 'Težina {w}',
	'co.gradedAt': 'Ocijenjeno {date}',

	// calendar
	'cal.title': 'Kalendar',
	'cal.sub': 'Nastava, rokovi i ispiti iz Merlina: dva tjedna unatrag i četiri mjeseca unaprijed',
	'cal.all': 'Sve',
	'cal.exams': 'Ispiti',
	'cal.seminars': 'Seminari',
	'cal.deadlines': 'Rokovi',
	'cal.classes': 'Nastava',
	'cal.filterAria': 'Vrsta događaja',
	'cal.prev': 'Prethodni mjesec',
	'cal.next': 'Sljedeći mjesec',
	'cal.today': 'Danas',
	'cal.noEvents': 'nema događaja',
	'cal.dayToday': 'Danas',
	'cal.dayPast': 'Prošli dan',
	'cal.daySelected': 'Odabrani dan',
	'cal.pastEmpty': 'Ništa nije bilo upisano',
	'cal.pastEmptyHint': 'Merlin za taj dan nema događaja.',
	'cal.free': 'Slobodan dan',
	'cal.freeHint': 'Nema ničega u Merlin kalendaru.',
	'cal.personal': 'Osobni događaj',

	// exams
	'ex.title': 'Ispiti i seminari',
	'ex.sub': 'Ispiti iz Merlin kalendara, seminari iz zadaća i najave profesora',
	'ex.showPast': 'Prikaži prošle',
	'ex.exams': 'Ispiti',
	'ex.noExams': 'Nema ispita u kalendaru',
	'ex.noUpcoming': 'Nema nadolazećih ispita',
	'ex.noExamsHint': 'Merlin ne označava ispite posebno: ovdje su događaji s riječima poput „ispit”, „kolokvij” ili „međuispit” u nazivu.',
	'ex.seminars': 'Seminari i projekti',
	'ex.noSeminars': 'Nema seminara',
	'ex.noUpcomingSem': 'Nema nadolazećih seminara',
	'ex.noSeminarsHint': 'Ovdje se pojavljuju zadaće sa „seminar”, „esej”, „projekt” ili „prezentacija” u nazivu.',
	'ex.due': ' · rok {date} u {time}',
	'ex.noDue': ' · bez roka',
	'ex.announce': 'Najave profesora',
	'ex.noAnnounce': 'Nema najava',
	'ex.noAnnounceHint': 'U obavijestima zadnjih 45 dana nema spomena ispita ni seminara.',

	// login
	'li.hero': 'Tvoj Merlin: bodovi, kalendar, ispiti i seminari na jednom mjestu. Prijavi se svojim Merlin računom. Lozinku upisuješ samo na stranici SRCE-a, mi je nikad ne vidimo.',
	'li.year': 'Akademska godina',
	'li.signedYear': 'prijavljen',
	'li.open': 'Prijavi se preko Merlina →',
	'li.openHint': 'Otvorit će se službena SRCE prijava. Nakon prijave browser će pokazati stranicu s adresom koja počinje `merlin-token://`. To je u redu, vrati se ovamo i zalijepi je.',
	'li.have': 'Već imam token / adresu',
	'li.pasteHint': 'Prijavio si se? Kopiraj adresu koja počinje `merlin-token://`, vrati se ovamo i klikni gumb (međuspremnik se čita samo kad klikneš) ili je zalijepi dolje.',
	'li.checking': 'Provjeravam…',
	'li.fromClipboard': 'Zalijepi iz međuspremnika i prijavi se',
	'li.placeholder': '…ili ručno zalijepi adresu merlin-token://token=…  (ili sam token)',
	'li.fromField': 'Prijavi se iz polja',
	'li.reopen': 'Otvori Merlin prijavu ponovno',
	'li.cancel': 'Odustani i vrati se',
	'li.errLaunch': 'To je link za prijavu, ne adresa s tokenom. Prvo se prijavi, pa kopiraj adresu koja se pokaže nakon toga (počinje s merlin-token:// ili web+marlon://).',
	'li.errToken': 'Ne mogu pročitati token. Zalijepi cijelu adresu koja se pokazala nakon prijave, ili sam token (32 znaka).',
	'li.errClipboard': 'Preglednik ne da pročitati međuspremnik. Zalijepi adresu ručno u polje ispod.',
	'li.errNoToken': 'U međuspremniku nema adrese s tokenom. Kopiraj adresu koja počinje s merlin-token:// pa pokušaj ponovno.',
	'li.errRejected': 'Token nije prihvaćen. Provjeri da je za točnu godinu i da nije istekao.',
	'li.errPause': 'Merlin je zatražio pauzu. Pokušaj za koju minutu.',
	'li.helpTitle': 'Kako doći do adrese (i na mobitelu)?',
	'li.help1': 'Klikni „Prijavi se preko Merlina” i prijavi se kao i inače (AAI@EduHr).',
	'li.help2': 'Na kraju browser otvori adresu koja počinje s `merlin-token://` i najčešće pokaže grešku „stranica se ne može otvoriti”. To je očekivano.',
	'li.help3': 'Kopiraj tu cijelu adresu: na računalu iz trake s adresom; na mobitelu dugo pritisni traku s adresom pa „Kopiraj”.',
	'li.help4': 'Vrati se ovamo i zalijepi je u polje iznad.',
	'li.foot': 'Token ostaje samo u ovom pregledniku. Podatke dohvaća tvoj preglednik izravno iz Merlina, nijedan server ih ne vidi.',
} as const;

type Key = keyof typeof hr;

const en: Record<Key, string> = {
	'nav.aria': 'Pages',
	'nav.pregled': 'Overview',
	'nav.predmeti': 'Courses',
	'nav.kalendar': 'Calendar',
	'nav.ispiti': 'Exams',
	'top.updated': 'updated {when}',
	'top.refresh': 'Refresh',
	'top.lite': 'Lite mode (no 3D background)',
	'top.liteOn': 'Lite mode is on',
	'top.liteOff': 'Lite mode: turn off the 3D background',
	'top.year': 'Academic year',
	'top.addYear': '+ Add a year…',
	'top.signOut': 'Sign out and delete tokens',
	'top.signOutTitle': 'Sign out (removes the tokens of all years from this browser)',
	'lang.switch': 'Prebaci na hrvatski',
	'lang.label': 'HR',
	'demo': 'demo',
	'foot': 'Read-only access to Merlin · points refresh at most every 15 minutes, everything else every 5',
	'close': 'Close',
	'retry': 'Try again',
	'openInMerlin': 'Open in Merlin',
	'newTab': ' (opens in a new tab)',
	'loadFailed': 'The data could not be loaded',
	'toast.cached': ' Showing the last saved data.',
	'partial': 'Part of the data did not arrive from Merlin ({parts}).',
	'err.generic': 'Something went wrong.',
	'err.rate': 'Merlin is asking for a short break. Try again in a minute.',
	'err.server': 'The server answered {n}',
	'err.login': 'Sign-in failed.',
	'nokey.a': 'This server is public, so it needs your link with the key (the one ending in `#key=`). Open it once and this browser will remember it.',
	'nokey.demo': 'See the demo',

	'part.whoami': 'account',
	'part.courses': 'courses',
	'part.calendar': 'calendar',
	'part.deadlines': 'deadlines',
	'part.assignments': 'assignments',
	'part.grades': 'points',
	'part.announcements': 'announcements',
	'part.main': 'core data',

	'kind.exam': 'Exam',
	'kind.seminar': 'Seminar',
	'kind.deadline': 'Deadline',
	'kind.class': 'Class',
	'kind.event': 'Event',

	'ring.none': 'no data',
	'ring.pct': '{n} percent',
	'rel.now': 'just now',
	'rel.inMin': 'in {n} min',
	'rel.minAgo': '{n} min ago',
	'rel.todayAt': 'today at {time}',
	'rel.today': 'today',
	'rel.tomorrowAt': 'tomorrow at {time}',
	'rel.yesterday': 'yesterday',
	'rel.inDays.one': 'in {n} day',
	'rel.inDays.few': 'in {n} days',
	'rel.inDays.many': 'in {n} days',
	'rel.daysAgo.one': '{n} day ago',
	'rel.daysAgo.few': '{n} days ago',
	'rel.daysAgo.many': '{n} days ago',
	'unit.day.one': 'day',
	'unit.day.few': 'days',
	'unit.day.many': 'days',
	'unit.hour.one': 'hour',
	'unit.hour.few': 'hours',
	'unit.hour.many': 'hours',
	'unit.min': 'min',
	'n.items.one': '{n} item',
	'n.items.few': '{n} items',
	'n.items.many': '{n} items',
	'n.courses.one': '{n} course',
	'n.courses.few': '{n} courses',
	'n.courses.many': '{n} courses',
	'n.events.one': '{n} event',
	'n.events.few': '{n} events',
	'n.events.many': '{n} events',
	'greet.night': 'Good night',
	'greet.morning': 'Good morning',
	'greet.day': 'Good afternoon',
	'greet.evening': 'Good evening',
	'head.ofMax': ' / {max} points',
	'head.points': ' points',
	'head.none': ' no points yet',
	'head.graded': ' of what is graded',

	'ov.openExams': 'Open Exams and seminars',
	'ov.openCourses': 'Open Courses',
	'ov.quiet': 'A quiet week.',
	'ov.week': 'This week: {items}',
	'ov.nextExamSub': ' · next exam {when}',
	'ov.nextExam': 'Next exam',
	'ov.noExam': 'No exams in sight',
	'ov.noExamHint': 'There are no exams in the Merlin calendar for the next 4 months.',
	'ov.success': 'Performance',
	'ov.ofGraded': 'of graded work · {courses}',
	'ov.next7': 'Next 7 days',
	'ov.calendarLink': 'Calendar →',
	'ov.nothing': 'Nothing in the calendar',
	'ov.nothingHint': 'Enjoy the free week.',
	'ov.today': 'Today',
	'ov.points': 'Points',
	'ov.noCourses': 'No courses',
	'ov.news': 'Announcements',
	'ov.noNews': 'No new announcements',
	'ov.noNewsHint': 'Nothing was posted in the last 45 days.',
	'ov.seminars': 'Seminars',
	'ov.noSeminars': 'No seminars',
	'ov.noDue': 'no deadline',

	'co.title': 'Courses',
	'co.sub': 'Points from Merlin, academic year {year}',
	'co.sortPoints': 'By points',
	'co.sortName': 'By name',
	'co.sortAria': 'Sort order',
	'co.none': 'No enrolled courses',
	'co.noneHint': 'Merlin returned no courses for this year.',
	'co.noPoints': 'No points yet',
	'co.gradesFailed': 'The points could not be loaded.',
	'co.gradesStale': 'The points were not refreshed.',
	'co.gradesStaleDetail': 'The points were not refreshed, showing the last saved ones.',
	'co.ofGradedPill': '{n}% of graded work',
	'co.total': 'Total',
	'co.sofar': 'Of graded work',
	'co.gradedCount': 'Graded items',
	'co.noGrades': 'No grades yet',
	'co.noGradesHint': 'The professor has not entered any points in Merlin yet.',
	'co.weight': 'Weight {w}',
	'co.gradedAt': 'Graded {date}',

	'cal.title': 'Calendar',
	'cal.sub': 'Classes, deadlines and exams from Merlin: two weeks back and four months ahead',
	'cal.all': 'All',
	'cal.exams': 'Exams',
	'cal.seminars': 'Seminars',
	'cal.deadlines': 'Deadlines',
	'cal.classes': 'Classes',
	'cal.filterAria': 'Kind of event',
	'cal.prev': 'Previous month',
	'cal.next': 'Next month',
	'cal.today': 'Today',
	'cal.noEvents': 'no events',
	'cal.dayToday': 'Today',
	'cal.dayPast': 'Past day',
	'cal.daySelected': 'Selected day',
	'cal.pastEmpty': 'Nothing was recorded',
	'cal.pastEmptyHint': 'Merlin has no events for that day.',
	'cal.free': 'A free day',
	'cal.freeHint': 'Nothing in the Merlin calendar.',
	'cal.personal': 'Personal event',

	'ex.title': 'Exams and seminars',
	'ex.sub': 'Exams from the Merlin calendar, seminars from assignments, and announcements from professors',
	'ex.showPast': 'Show past',
	'ex.exams': 'Exams',
	'ex.noExams': 'No exams in the calendar',
	'ex.noUpcoming': 'No upcoming exams',
	'ex.noExamsHint': 'Merlin does not mark exams as such: events with words like "ispit", "kolokvij" or "međuispit" in the title are listed here.',
	'ex.seminars': 'Seminars and projects',
	'ex.noSeminars': 'No seminars',
	'ex.noUpcomingSem': 'No upcoming seminars',
	'ex.noSeminarsHint': 'Assignments with "seminar", "esej", "projekt" or "prezentacija" in the title show up here.',
	'ex.due': ' · due {date} at {time}',
	'ex.noDue': ' · no deadline',
	'ex.announce': 'Professor announcements',
	'ex.noAnnounce': 'No announcements',
	'ex.noAnnounceHint': 'Announcements from the last 45 days do not mention exams or seminars.',

	'li.hero': 'Your Merlin: points, calendar, exams and seminars in one place. Sign in with your own Merlin account. You type your password only on the SRCE page, we never see it.',
	'li.year': 'Academic year',
	'li.signedYear': 'signed in',
	'li.open': 'Sign in with Merlin →',
	'li.openHint': 'The official SRCE sign-in opens. After signing in, the browser shows a page with an address that starts with `merlin-token://`. That is fine: come back here and paste it.',
	'li.have': 'I already have a token / address',
	'li.pasteHint': 'Signed in? Copy the address that starts with `merlin-token://`, come back here and click the button (the clipboard is only read when you click) or paste it below.',
	'li.checking': 'Checking…',
	'li.fromClipboard': 'Paste from clipboard and sign in',
	'li.placeholder': '…or paste the address merlin-token://token=… by hand (or just the token)',
	'li.fromField': 'Sign in from the field',
	'li.reopen': 'Open the Merlin sign-in again',
	'li.cancel': 'Cancel and go back',
	'li.errLaunch': 'That is the sign-in link, not the address with the token. Sign in first, then copy the address that appears afterwards (it starts with merlin-token:// or web+marlon://).',
	'li.errToken': 'Cannot read a token. Paste the whole address that appeared after signing in, or just the token (32 characters).',
	'li.errClipboard': 'The browser does not allow reading the clipboard. Paste the address into the field below by hand.',
	'li.errNoToken': 'The clipboard holds no address with a token. Copy the address that starts with merlin-token:// and try again.',
	'li.errRejected': 'The token was not accepted. Check that it is for the right year and has not expired.',
	'li.errPause': 'Merlin asked for a pause. Try again in a few minutes.',
	'li.helpTitle': 'How do I get the address (on a phone too)?',
	'li.help1': 'Click "Sign in with Merlin" and sign in as usual (AAI@EduHr).',
	'li.help2': 'At the end the browser opens an address that starts with `merlin-token://` and usually shows a "page cannot be opened" error. That is expected.',
	'li.help3': 'Copy that whole address: on a computer from the address bar; on a phone long-press the address bar and choose "Copy".',
	'li.help4': 'Come back here and paste it into the field above.',
	'li.foot': 'The token stays in this browser only. Your browser fetches the data from Merlin directly, no server sees it.',
};

const dict: Record<Lang, Record<Key, string>> = { hr, en };

function initial(): Lang {
	try {
		const v = localStorage.getItem(KEY);
		if (v === 'hr' || v === 'en') return v;
	} catch {
		/* private mode */
	}
	return typeof navigator !== 'undefined' && /^en\b/i.test(navigator.language) ? 'en' : 'hr';
}

let lang: Lang = initial();
if (typeof document !== 'undefined') document.documentElement.lang = lang;
const listeners = new Set<() => void>();

export const getLang = (): Lang => lang;
/** 'hr-HR' or 'en-GB': the locale for dates and numbers. Always paired with timeZone 'Europe/Zagreb'. */
export const locale = (): string => (lang === 'hr' ? 'hr-HR' : 'en-GB');

export function setLang(next: Lang): void {
	if (next === lang) return;
	lang = next;
	try {
		localStorage.setItem(KEY, next);
	} catch {
		/* lasts for this page */
	}
	if (typeof document !== 'undefined') document.documentElement.lang = next;
	for (const l of listeners) l();
}

/** Re-renders the component when the language changes. Call once near the root (everything below re-renders with it). */
export function useLang(): Lang {
	return useSyncExternalStore(
		(cb) => {
			listeners.add(cb);
			return () => listeners.delete(cb);
		},
		getLang,
		getLang
	);
}

export type TKey = Key;
type Plural<K> = K extends `${infer B}.one` ? B : never;
export type PluralKey = Plural<Key>;

/** Translate by key, filling {name} placeholders. */
export function t(key: Key, vars?: Record<string, string | number>): string {
	const s = dict[lang][key];
	return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}

/** Plural form of `key` for n ({n} is filled in). Croatian: 1, 2-4, 5+ (11-14 the exception). English: 1, other. */
export function tn(key: PluralKey, n: number, vars?: Record<string, string | number>): string {
	let form: 'one' | 'few' | 'many';
	if (lang === 'en') form = n === 1 ? 'one' : 'many';
	else {
		const m10 = n % 10;
		const m100 = n % 100;
		form = m10 === 1 && m100 !== 11 ? 'one' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'few' : 'many';
	}
	return t(`${key}.${form}` as Key, { n, ...vars });
}
