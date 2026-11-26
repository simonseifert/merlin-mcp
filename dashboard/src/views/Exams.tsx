import { motion } from 'motion/react';
import { useState } from 'react';
import type { Dashboard } from '../types';
import { CardTitle, Dot, Empty, Glass, KindBadge, MerlinLink, listVariants, useNow, usePageHeading } from '../components/ui';
import { t } from '../i18n';
import { courseColor, fmtDate, fmtDayNum, fmtMonthShort, fmtTime, relative, shortCourse } from '../format';


function urgency(at: number, now: number): 'hot' | 'warm' | 'calm' {
	const d = (at - now) / 86400;
	return d < 3 ? 'hot' : d < 8 ? 'warm' : 'calm';
}

export default function Exams({ data }: { data: Dashboard }) {
	const now = useNow();
	const heading = usePageHeading<HTMLHeadingElement>();
	const [showPast, setShowPast] = useState(false);
	const names = data.courses.map((c) => c.name);
	const color = (n?: string) => courseColor(n, names);
	const exams = data.exams.filter((e) => showPast || e.start + (e.duration ?? 0) >= now);
	const seminars = data.seminars.filter((s) => showPast || !s.due || s.due >= now - 86400);
	const news = data.announcements.filter((a) => a.kind === 'exam' || a.kind === 'seminar');

	return (
		<motion.div className="page" variants={listVariants} initial="hidden" animate="show" exit="hidden">
			<motion.header className="page-head" variants={listVariants}>
				<div>
					<h1 ref={heading} tabIndex={-1}>{t('ex.title')}</h1>
					<p className="muted">{t('ex.sub')}</p>
				</div>
				<label className="toggle">
					<input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} />
					<span className="toggle__track"><span className="toggle__thumb" /></span>
					<span className="small">{t('ex.showPast')}</span>
				</label>
			</motion.header>

			<div className="grid grid--exams">
				<Glass className="exams">
					<CardTitle aside={<span className="pill">{exams.length}</span>}>{t('ex.exams')}</CardTitle>
					{exams.length === 0 ? (
						<Empty title={showPast ? t('ex.noExams') : t('ex.noUpcoming')}>
							{t('ex.noExamsHint')}
						</Empty>
					) : (
						<div className="exam-list">
							{exams.map((e, i) => {
								const past = e.start + (e.duration ?? 0) < now;
								const u = urgency(e.start, now);
								return (
									<motion.div key={e.key} className={`exam exam--${u} ${past ? 'is-past' : ''}`} style={{ '--accent': color(e.course) } as React.CSSProperties} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 + i * 0.05, type: 'spring', stiffness: 220, damping: 26 }}>
										<div className="exam__date">
											<span className="exam__day">{fmtDayNum(e.start)}</span>
											<span className="exam__month">{fmtMonthShort(e.start)}</span>
										</div>
										<div className="exam__body">
											<strong>{e.title}</strong>
											<span className="muted small">
												<Dot color={color(e.course)} /> {shortCourse(e.course)}
											</span>
											<span className="small">
												{fmtTime(e.start)}
												{e.duration ? `–${fmtTime(e.start + e.duration)}` : ''}
												{e.location ? ` · ${e.location}` : ''}
											</span>
											<MerlinLink url={e.url} />
										</div>
										<span className={`countdown-chip countdown-chip--${past ? 'past' : u}`}>{relative(e.start, now)}</span>
									</motion.div>
								);
							})}
						</div>
					)}
				</Glass>

				<Glass className="seminars">
					<CardTitle aside={<span className="pill">{seminars.length}</span>}>{t('ex.seminars')}</CardTitle>
					{seminars.length === 0 ? (
						<Empty title={showPast ? t('ex.noSeminars') : t('ex.noUpcomingSem')}>{t('ex.noSeminarsHint')}</Empty>
					) : (
						<div className="sem-list">
							{seminars.map((s, i) => (
								<motion.article key={s.key} className={`sem ${s.due && s.due < now ? 'is-past' : ''}`} style={{ '--accent': color(s.course) } as React.CSSProperties} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.05, type: 'spring', stiffness: 220, damping: 26 }}>
									<div className="sem__head">
										<strong>{s.title}</strong>
										{s.due && <span className={`countdown-chip countdown-chip--${s.due < now ? 'past' : urgency(s.due, now)}`}>{relative(s.due, now)}</span>}
									</div>
									<span className="muted small">
										<Dot color={color(s.course)} /> {shortCourse(s.course)}
										{s.due ? t('ex.due', { date: fmtDate(s.due), time: fmtTime(s.due) }) : t('ex.noDue')}
									</span>
									{s.intro && <p className="small muted clamp-3">{s.intro}</p>}
								</motion.article>
							))}
						</div>
					)}
				</Glass>

				<Glass className="span-2 announce">
					<CardTitle>{t('ex.announce')}</CardTitle>
					{news.length === 0 ? (
						<Empty title={t('ex.noAnnounce')}>{t('ex.noAnnounceHint')}</Empty>
					) : (
						<div className="news__list news__list--wide">
							{news.map((a) => (
								<article key={a.key} className="news__item">
									<div className="news__head">
										<Dot color={color(a.course)} />
										<strong className="ellipsis">{a.subject}</strong>
										{a.kind && <KindBadge kind={a.kind} />}
										<span className="muted small nowrap">{relative(a.created, now)}</span>
									</div>
									<p className="muted clamp-3">{a.message}</p>
									<span className="small muted">
										{shortCourse(a.course)}
										{a.author ? ` · ${a.author}` : ''}
									</span>
								</article>
							))}
						</div>
					)}
				</Glass>
			</div>
		</motion.div>
	);
}
