import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState } from 'react';
import type { Dashboard, DashEvent, EventKind } from '../types';
import { Dot, Empty, Glass, KindBadge, listVariants, spring, useNow } from '../components/ui';
import { courseColor, dayKey, fmtDayLong, fmtMonth, fmtTime, shortCourse } from '../format';

const WEEKDAYS = ['Pon', 'Uto', 'Sri', 'Čet', 'Pet', 'Sub', 'Ned'];
const FILTERS: Array<{ id: 'all' | EventKind; label: string }> = [
	{ id: 'all', label: 'Sve' },
	{ id: 'exam', label: 'Ispiti' },
	{ id: 'seminar', label: 'Seminari' },
	{ id: 'deadline', label: 'Rokovi' },
	{ id: 'class', label: 'Nastava' },
];

/** Local-midnight Date for a yyyy-mm-dd key (the grid is built in the browser's calendar, keyed in Zagreb time). */
const keyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default function Calendar({ data }: { data: Dashboard }) {
	const now = useNow();
	const todayKey = dayKey(now);
	const [month, setMonth] = useState(() => {
		const d = new Date();
		return new Date(d.getFullYear(), d.getMonth(), 1);
	});
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
		const first = new Date(month);
		const offset = (first.getDay() + 6) % 7;
		const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
		return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
	}, [month]);

	const shift = (n: number) => {
		setDir(n);
		setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));
	};
	const today = () => {
		const d = new Date();
		setDir(0);
		setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
		setSelected(todayKey);
	};

	const dayEvents = byDay.get(selected) ?? [];
	const selDate = new Date(`${selected}T12:00:00`);

	return (
		<motion.div className="page" variants={listVariants} initial="hidden" animate="show" exit="hidden">
			<motion.header className="page-head" variants={listVariants}>
				<div>
					<h1>Kalendar</h1>
					<p className="muted">Nastava, rokovi i ispiti iz Merlina za sljedeća 4 mjeseca</p>
				</div>
				<div className="chips">
					{FILTERS.map((f) => (
						<button key={f.id} className={`chip ${filter === f.id ? 'is-active' : ''} ${f.id !== 'all' ? `chip--${f.id}` : ''}`} onClick={() => setFilter(f.id)}>
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
							<button className="icon-btn" onClick={() => shift(-1)} aria-label="Prethodni mjesec">
								<svg width="14" height="14" viewBox="0 0 14 14"><path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
							</button>
							<button className="btn-soft" onClick={today}>Danas</button>
							<button className="icon-btn" onClick={() => shift(1)} aria-label="Sljedeći mjesec">
								<svg width="14" height="14" viewBox="0 0 14 14"><path d="M5 2l5 5-5 5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
							</button>
						</div>
					</div>
					<div className="month__weekdays">
						{WEEKDAYS.map((w) => (
							<span key={w}>{w}</span>
						))}
					</div>
					<AnimatePresence mode="popLayout" initial={false} custom={dir}>
						<motion.div
							key={month.toISOString()}
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
								const inMonth = d.getMonth() === month.getMonth();
								const hasExam = evs.some((e) => e.kind === 'exam');
								return (
									<button key={k} className={`cell ${inMonth ? '' : 'cell--out'} ${k === todayKey ? 'cell--today' : ''} ${k === selected ? 'cell--sel' : ''} ${hasExam ? 'cell--exam' : ''}`} onClick={() => setSelected(k)}>
										{k === selected && <motion.span layoutId="cell-sel" className="cell__sel" transition={spring} />}
										<span className="cell__num">{d.getDate()}</span>
										<span className="cell__events">
											{evs.slice(0, 3).map((e) => (
												<span key={e.key} className={`cell__ev cell__ev--${e.kind}`} style={{ '--accent': courseColor(e.course, names) } as React.CSSProperties}>
													<span className="cell__ev-text">{e.title}</span>
												</span>
											))}
											{evs.length > 3 && <span className="cell__more">+{evs.length - 3}</span>}
										</span>
										<span className="cell__dots">
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
							<p className="muted small upper">{selected === todayKey ? 'Danas' : 'Odabrani dan'}</p>
							<h2 className="day__title">{fmtDayLong(Math.floor(selDate.getTime() / 1000))}</h2>
							{dayEvents.length === 0 ? (
								<Empty title="Slobodan dan">Nema ničega u Merlin kalendaru.</Empty>
							) : (
								<div className="timeline">
									{dayEvents.map((e) => (
										<div key={e.key} className="timeline__item" style={{ '--accent': courseColor(e.course, names) } as React.CSSProperties}>
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
