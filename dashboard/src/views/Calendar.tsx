import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState } from 'react';
import type { Dashboard, DashEvent, EventKind } from '../types';
import { Dot, Empty, Glass, KindBadge, MerlinLink, listVariants, spring, useNow, usePageHeading } from '../components/ui';
import { courseColor, dayKey, fmtDayLong, fmtMonth, fmtTime, plural, shortCourse } from '../format';

const WEEKDAYS = ['Pon', 'Uto', 'Sri', 'Čet', 'Pet', 'Sub', 'Ned'];
const FILTERS: Array<{ id: 'all' | EventKind; label: string }> = [
	{ id: 'all', label: 'Sve' },
	{ id: 'exam', label: 'Ispiti' },
	{ id: 'seminar', label: 'Seminari' },
	{ id: 'deadline', label: 'Rokovi' },
	{ id: 'class', label: 'Nastava' },
];

/*
 * The grid is built in UTC at noon, never in the browser's zone: a calendar day is just a yyyy-mm-dd key
 * (the Zagreb day, from dayKey), so a phone in another time zone still shows the right day. Noon keeps
 * every cell on the same date when it is formatted back in Europe/Zagreb.
 */
const utcDay = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d, 12));
const keyOf = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
const monthOf = (key: string) => utcDay(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 1);
const epoch = (d: Date) => Math.floor(d.getTime() / 1000);

export default function Calendar({ data }: { data: Dashboard }) {
	const now = useNow();
	const heading = usePageHeading<HTMLHeadingElement>();
	const todayKey = dayKey(now);
	const [month, setMonth] = useState(() => monthOf(todayKey));
	const [dir, setDir] = useState(0);
	const [selected, setSelected] = useState(todayKey);
	const [filter, setFilter] = useState<'all' | EventKind>('all');
	const names = data.courses.map((c) => c.name);

	const byDay = useMemo(() => {
		const m = new Map<string, DashEvent[]>();
		for (const e of data.events) {
			if (filter !== 'all' && e.kind !== filter) continue;
			const k = dayKey(e.start);
			m.set(k, [...(m.get(k) ?? []), e]);
		}
		return m;
	}, [data.events, filter]);

	// Six Monday-first weeks around the month.
	const cells = useMemo(() => {
		const y = month.getUTCFullYear();
		const m = month.getUTCMonth();
		const offset = (month.getUTCDay() + 6) % 7;
		return Array.from({ length: 42 }, (_, i) => utcDay(y, m, 1 - offset + i));
	}, [month]);

	const shift = (n: number) => {
		setDir(n);
		setMonth((m) => utcDay(m.getUTCFullYear(), m.getUTCMonth() + n, 1));
	};
	const today = () => {
		setDir(0);
		setMonth(monthOf(todayKey));
		setSelected(todayKey);
	};

	const dayEvents = byDay.get(selected) ?? [];
	const selDate = utcDay(Number(selected.slice(0, 4)), Number(selected.slice(5, 7)) - 1, Number(selected.slice(8, 10)));
	const selPast = selected < todayKey;

	return (
		<motion.div className="page" variants={listVariants} initial="hidden" animate="show" exit="hidden">
			<motion.header className="page-head" variants={listVariants}>
				<div>
					<h1 ref={heading} tabIndex={-1}>Kalendar</h1>
					<p className="muted">Nastava, rokovi i ispiti iz Merlina: dva tjedna unatrag i četiri mjeseca unaprijed</p>
				</div>
				<div className="chips">
					{FILTERS.map((f) => (
						<button key={f.id} type="button" aria-pressed={filter === f.id} className={`chip ${filter === f.id ? 'is-active' : ''} ${f.id !== 'all' ? `chip--${f.id}` : ''}`} onClick={() => setFilter(f.id)}>
							{f.label}
						</button>
					))}
				</div>
			</motion.header>

			<div className="grid grid--calendar">
				<Glass className="month">
					<div className="month__head">
						<h2 className="month__title">{fmtMonth(month)}</h2>
						<div className="month__nav">
							<button type="button" className="icon-btn" onClick={() => shift(-1)} aria-label="Prethodni mjesec">
								<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
							</button>
							<button type="button" className="btn-soft" onClick={today}>Danas</button>
							<button type="button" className="icon-btn" onClick={() => shift(1)} aria-label="Sljedeći mjesec">
								<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M5 2l5 5-5 5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
							</button>
						</div>
					</div>
					<div className="month__weekdays" aria-hidden="true">
						{WEEKDAYS.map((w) => (
							<span key={w}>{w}</span>
						))}
					</div>
					<AnimatePresence mode="popLayout" initial={false} custom={dir}>
						<motion.div
							key={keyOf(month)}
							className="month__grid"
							custom={dir}
							initial={{ opacity: 0, x: dir * 40, filter: 'blur(6px)' }}
							animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
							exit={{ opacity: 0, x: dir * -40, filter: 'blur(6px)' }}
							transition={spring}
						>
							{cells.map((d) => {
								const k = keyOf(d);
								const evs = byDay.get(k) ?? [];
								const inMonth = d.getUTCMonth() === month.getUTCMonth();
								const hasExam = evs.some((e) => e.kind === 'exam');
								const count = evs.length === 0 ? 'nema događaja' : `${evs.length} ${plural(evs.length, 'događaj', 'događaja', 'događaja')}`;
								return (
									<button
										key={k}
										type="button"
										className={`cell ${inMonth ? '' : 'cell--out'} ${k < todayKey ? 'cell--past' : ''} ${k === todayKey ? 'cell--today' : ''} ${k === selected ? 'cell--sel' : ''} ${hasExam ? 'cell--exam' : ''}`}
										onClick={() => setSelected(k)}
										aria-label={`${fmtDayLong(epoch(d))}, ${count}`}
										aria-pressed={k === selected}
										aria-current={k === todayKey ? 'date' : undefined}
									>
										{k === selected && <motion.span layoutId="cell-sel" className="cell__sel" transition={spring} />}
										<span className="cell__num" aria-hidden="true">{d.getUTCDate()}</span>
										<span className="cell__events" aria-hidden="true">
											{evs.slice(0, 3).map((e) => (
												<span key={e.key} className={`cell__ev cell__ev--${e.kind}`} style={{ '--accent': courseColor(e.course, names) } as React.CSSProperties}>
													<span className="cell__ev-text">{e.title}</span>
												</span>
											))}
											{evs.length > 3 && <span className="cell__more">+{evs.length - 3}</span>}
										</span>
										<span className="cell__dots" aria-hidden="true">
											{evs.slice(0, 4).map((e) => (
												<i key={e.key} style={{ background: courseColor(e.course, names) }} />
											))}
										</span>
									</button>
								);
							})}
						</motion.div>
					</AnimatePresence>
				</Glass>

				<Glass className="day">
					<AnimatePresence mode="wait">
						<motion.div key={selected + filter} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25 }}>
							<p className="muted small upper">{selected === todayKey ? 'Danas' : selPast ? 'Prošli dan' : 'Odabrani dan'}</p>
							<h2 className="day__title">{fmtDayLong(epoch(selDate))}</h2>
							{dayEvents.length === 0 ? (
								selPast ? (
									<Empty title="Ništa nije bilo upisano">Merlin za taj dan nema događaja.</Empty>
								) : (
									<Empty title="Slobodan dan">Nema ničega u Merlin kalendaru.</Empty>
								)
							) : (
								<div className="timeline">
									{dayEvents.map((e) => (
										<div key={e.key} className={`timeline__item ${e.start + (e.duration ?? 0) < now ? 'is-past' : ''}`} style={{ '--accent': courseColor(e.course, names) } as React.CSSProperties}>
											<div className="timeline__time">
												<strong>{fmtTime(e.start)}</strong>
												{e.duration ? <span className="muted small">{fmtTime(e.start + e.duration)}</span> : null}
											</div>
											<div className="timeline__card">
												<div className="timeline__row">
													<strong>{e.title}</strong>
													<KindBadge kind={e.kind} />
												</div>
												<span className="muted small">
													<Dot color={courseColor(e.course, names)} /> {shortCourse(e.course) || 'Osobni događaj'}
													{e.location ? ` · ${e.location}` : ''}
												</span>
												{e.description && <p className="small muted clamp-3">{e.description}</p>}
												<MerlinLink url={e.url} />
											</div>
										</div>
									))}
								</div>
							)}
						</motion.div>
					</AnimatePresence>
				</Glass>
			</div>
		</motion.div>
	);
}
