import { motion } from 'motion/react';
import type { Dashboard } from '../types';
import type { Route } from '../routes';
import { Bar, CardTitle, Dot, Empty, Glass, KindBadge, Ring, listVariants, useNow } from '../components/ui';
import { countdown, courseColor, courseHeadline, coursePercent, dayKey, gradedSoFar, fmtDay, fmtDayLong, fmtTime, greeting, nfmt, plural, relative, shortCourse } from '../format';

export default function Overview({ data, go }: { data: Dashboard; go: (r: Route) => void }) {
	const now = useNow();
	const names = data.courses.map((c) => c.name);
	const color = (n?: string) => courseColor(n, names);
	const upcoming = data.events.filter((e) => e.start + (e.duration ?? 0) >= now);
	const nextExam = data.exams.find((e) => e.start >= now);
	const week = upcoming.filter((e) => e.start < now + 7 * 86400);
	// Success rate on what has been graded so far, averaged over courses: fairer mid-semester than points out of 100.
	const graded = data.courses.map(gradedSoFar).filter((g) => g.percent !== undefined);
	const avg = graded.length ? graded.reduce((s, g) => s + g.percent!, 0) / graded.length : undefined;
	const seminars = data.seminars.filter((s) => !s.due || s.due >= now).slice(0, 3);

	// Group this week's agenda by day.
	const days = new Map<string, typeof week>();
	for (const e of week) days.set(dayKey(e.start), [...(days.get(dayKey(e.start)) ?? []), e]);

	const first = data.user?.firstname;
	return (
		<motion.div className="page" variants={listVariants} initial="hidden" animate="show" exit="hidden">
			<motion.header className="hero" variants={listVariants}>
				<motion.p className="hero__eyebrow" variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}>
					{fmtDayLong(now)}
				</motion.p>
				<motion.h1 variants={{ hidden: { opacity: 0, y: 16, filter: 'blur(10px)' }, show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.8, ease: [0.22, 1, 0.36, 1] } } }}>
					{greeting()}
					{first ? `, ${first}` : ''}.
				</motion.h1>
				<motion.p className="hero__sub" variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}>
					{week.length === 0 ? 'Ovaj tjedan je miran.' : `Ovaj tjedan: ${week.length} ${plural(week.length, 'stavka', 'stavke', 'stavki')}`}
					{nextExam ? ` · sljedeći ispit ${relative(nextExam.start, now)}` : ''}
				</motion.p>
			</motion.header>

			<div className="grid grid--overview">
				<Glass className="span-2 next-exam" interactive onClick={() => go('ispiti')} style={nextExam ? ({ '--accent': color(nextExam.course) } as React.CSSProperties) : undefined}>
					<CardTitle aside={nextExam && <KindBadge kind="exam" />}>Sljedeći ispit</CardTitle>
					{nextExam ? (
						<div className="next-exam__body">
							<div>
								<div className="next-exam__title">{nextExam.title}</div>
								<div className="muted">
									<Dot color={color(nextExam.course)} /> {shortCourse(nextExam.course)}
								</div>
								<div className="next-exam__meta">
									{fmtDayLong(nextExam.start)} · {fmtTime(nextExam.start)}
									{nextExam.location ? ` · ${nextExam.location}` : ''}
								</div>
							</div>
							<Countdown at={nextExam.start} now={now} />
						</div>
					) : (
						<Empty title="Nema ispita na vidiku">U Merlin kalendaru nema ispita za sljedeća 4 mjeseca.</Empty>
					)}
				</Glass>

				<Glass className="avg" interactive onClick={() => go('predmeti')}>
					<CardTitle>Uspješnost</CardTitle>
					<div className="avg__body">
						<Ring value={avg} size={124} stroke={11} color="#5e5ce6" sub={`od ocijenjenog · ${graded.length} ${plural(graded.length, 'predmet', 'predmeta', 'predmeta')}`} />
					</div>
				</Glass>

				<Glass className="span-2 row-2 week">
					<CardTitle aside={<button className="link" onClick={() => go('kalendar')}>Kalendar →</button>}>Sljedećih 7 dana</CardTitle>
					{week.length === 0 ? (
						<Empty title="Ništa u kalendaru">Uživaj u slobodnom tjednu.</Empty>
					) : (
						<div className="agenda">
							{[...days.entries()].map(([k, items]) => (
								<div key={k} className="agenda__day">
									<div className="agenda__date">{dayKey(now) === k ? 'Danas' : fmtDay(items[0].start)}</div>
									<div className="agenda__items">
										{items.map((e) => (
											<div key={e.key} className="agenda__item" style={{ '--accent': color(e.course) } as React.CSSProperties}>
												<span className="agenda__time">{fmtTime(e.start)}</span>
												<div className="agenda__text">
													<strong>{e.title}</strong>
													<span className="muted">
														{shortCourse(e.course)}
														{e.location ? ` · ${e.location}` : ''}
													</span>
												</div>
												{e.kind !== 'class' && e.kind !== 'event' && <KindBadge kind={e.kind} />}
											</div>
										))}
									</div>
								</div>
							))}
						</div>
					)}
				</Glass>

				<Glass className="points" interactive onClick={() => go('predmeti')}>
					<CardTitle>Bodovi</CardTitle>
					<div className="mini-courses">
						{[...data.courses].sort((a, b) => (coursePercent(b) ?? -1) - (coursePercent(a) ?? -1)).slice(0, 5).map((c) => (
							<div key={c.key} className="mini-course">
								<div className="mini-course__head">
									<span className="ellipsis">{shortCourse(c.name)}</span>
									<span className="num">{courseHeadline(c).value}</span>
								</div>
								<Bar value={coursePercent(c)} color={color(c.name)} />
							</div>
						))}
						{data.courses.length === 0 && <Empty title="Nema predmeta" />}
					</div>
				</Glass>

				<Glass className="span-2 news">
					<CardTitle>Obavijesti</CardTitle>
					{data.announcements.length === 0 ? (
						<Empty title="Nema novih obavijesti">U zadnjih 45 dana nema novih objava.</Empty>
					) : (
						<div className="news__list">
							{data.announcements.slice(0, 3).map((a) => (
								<article key={a.key} className="news__item">
									<div className="news__head">
										<Dot color={color(a.course)} />
										<strong className="ellipsis">{a.subject}</strong>
										{a.kind && <KindBadge kind={a.kind} />}
										<span className="muted small nowrap">{relative(a.created, now)}</span>
									</div>
									<p className="muted clamp-2">{a.message}</p>
									<span className="small muted">
										{shortCourse(a.course)}
										{a.author ? ` · ${a.author}` : ''}
									</span>
								</article>
							))}
						</div>
					)}
				</Glass>

				<Glass className="seminars-mini" interactive onClick={() => go('ispiti')}>
					<CardTitle>Seminari</CardTitle>
					{seminars.length === 0 ? (
						<Empty title="Nema seminara" />
					) : (
						<div className="sem-mini">
							{seminars.map((s) => (
								<div key={s.key} className="sem-mini__item">
									<Dot color={color(s.course)} />
									<div className="sem-mini__text">
										<strong className="ellipsis">{s.title}</strong>
										<span className="muted small">{s.due ? relative(s.due, now) : 'bez roka'}</span>
									</div>
								</div>
							))}
						</div>
					)}
				</Glass>
			</div>
		</motion.div>
	);
}

function Countdown({ at, now }: { at: number; now: number }) {
	const c = countdown(at, now);
	const cells: Array<[number, string]> = [
		[c.days, plural(c.days, 'dan', 'dana', 'dana')],
		[c.hours, plural(c.hours, 'sat', 'sata', 'sati')],
		[c.minutes, 'min'],
	];
	return (
		<div className="countdown">
			{cells.map(([n, l], i) => (
				<div key={i} className="countdown__cell">
					<motion.span key={n} initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
						{n}
					</motion.span>
					<small>{l}</small>
				</div>
			))}
		</div>
	);
}
