import { motion } from 'motion/react';
import type { Dashboard } from '../types';
import type { Route } from '../routes';
import { Bar, CardTitle, Dot, Empty, Glass, KindBadge, Ring, listVariants, useNow, usePageHeading } from '../components/ui';
import { countdown, courseColor, courseHeadline, coursePercent, dayKey, gradedSoFar, fmtDay, fmtDayLong, fmtTime, greeting, relative, shortCourse } from '../format';
import { t, tn } from '../i18n';

export default function Overview({ data, go }: { data: Dashboard; go: (r: Route) => void }) {
	const now = useNow();
	const heading = usePageHeading<HTMLHeadingElement>();
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
				<motion.h1 ref={heading} tabIndex={-1} variants={{ hidden: { opacity: 0, y: 16, filter: 'blur(10px)' }, show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.8, ease: [0.22, 1, 0.36, 1] } } }}>
					{greeting()}
					{first ? `, ${first}` : ''}.
				</motion.h1>
				<motion.p className="hero__sub" variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}>
					{week.length === 0 ? t('ov.quiet') : t('ov.week', { items: tn('n.items', week.length) })}
					{nextExam ? t('ov.nextExamSub', { when: relative(nextExam.start, now) }) : ''}
				</motion.p>
			</motion.header>

			<div className="grid grid--overview">
				<Glass className="span-2 next-exam" hit={{ label: t('ov.openExams'), href: '#/ispiti', onClick: () => go('ispiti') }} style={nextExam ? ({ '--accent': color(nextExam.course) } as React.CSSProperties) : undefined}>
					<CardTitle aside={nextExam && <KindBadge kind="exam" />}>{t('ov.nextExam')}</CardTitle>
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
						<Empty title={t('ov.noExam')}>{t('ov.noExamHint')}</Empty>
					)}
				</Glass>

				<Glass className="avg" hit={{ label: t('ov.openCourses'), href: '#/predmeti', onClick: () => go('predmeti') }}>
					<CardTitle>{t('ov.success')}</CardTitle>
					<div className="avg__body">
						<Ring value={avg} name={t('ov.success')} size={124} stroke={11} color="#5e5ce6" sub={t('ov.ofGraded', { courses: tn('n.courses', graded.length) })} />
					</div>
				</Glass>

				<Glass className="span-2 row-2 week">
					<CardTitle aside={<button type="button" className="link" onClick={() => go('kalendar')}>{t('ov.calendarLink')}</button>}>{t('ov.next7')}</CardTitle>
					{week.length === 0 ? (
						<Empty title={t('ov.nothing')}>{t('ov.nothingHint')}</Empty>
					) : (
						<div className="agenda">
							{[...days.entries()].map(([k, items]) => (
								<div key={k} className="agenda__day">
									<div className="agenda__date">{dayKey(now) === k ? t('ov.today') : fmtDay(items[0].start)}</div>
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

				<Glass className="points" hit={{ label: t('ov.openCourses'), href: '#/predmeti', onClick: () => go('predmeti') }}>
					<CardTitle>{t('ov.points')}</CardTitle>
					<div className="mini-courses">
						{[...data.courses].sort((a, b) => (coursePercent(b) ?? -1) - (coursePercent(a) ?? -1)).slice(0, 5).map((c) => (
							<div key={c.key} className="mini-course">
								<div className="mini-course__head">
									<span className="ellipsis">{shortCourse(c.name)}</span>
									<span className="num">{courseHeadline(c).value}</span>
								</div>
								<Bar value={coursePercent(c)} color={color(c.name)} label={shortCourse(c.name)} />
							</div>
						))}
						{data.courses.length === 0 && <Empty title={t('ov.noCourses')} />}
					</div>
				</Glass>

				<Glass className="span-2 news">
					<CardTitle>{t('ov.news')}</CardTitle>
					{data.announcements.length === 0 ? (
						<Empty title={t('ov.noNews')}>{t('ov.noNewsHint')}</Empty>
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

				<Glass className="seminars-mini" hit={{ label: t('ov.openExams'), href: '#/ispiti', onClick: () => go('ispiti') }}>
					<CardTitle>{t('ov.seminars')}</CardTitle>
					{seminars.length === 0 ? (
						<Empty title={t('ov.noSeminars')} />
					) : (
						<div className="sem-mini">
							{seminars.map((s) => (
								<div key={s.key} className="sem-mini__item">
									<Dot color={color(s.course)} />
									<div className="sem-mini__text">
										<strong className="ellipsis">{s.title}</strong>
										<span className="muted small">{s.due ? relative(s.due, now) : t('ov.noDue')}</span>
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
		[c.days, tn('unit.day', c.days)],
		[c.hours, tn('unit.hour', c.hours)],
		[c.minutes, t('unit.min')],
	];
	return (
		<div className="countdown">
			{cells.map(([n, l], i) => (
				<div key={i} className="countdown__cell">
					<motion.span key={n} initial={{ y: -8, opacity: 0 }} animate={{ opacity: 1, y: 0 }}>
						{n}
					</motion.span>
					<small>{l}</small>
				</div>
			))}
		</div>
	);
}
