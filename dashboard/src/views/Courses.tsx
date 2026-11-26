import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import type { DashCourse, Dashboard } from '../types';
import { Bar, Empty, Glass, Ring, Sheet, listVariants, usePageHeading } from '../components/ui';
import { courseColor, courseHeadline, coursePercent, fmtDate, gradedSoFar, gradesFailed, nfmt, shortCourse } from '../format';

type Sort = 'name' | 'points';

export default function Courses({ data, onRetry }: { data: Dashboard; onRetry: () => void }) {
	const failedAll = gradesFailed(data.errors);
	const [open, setOpen] = useState<DashCourse | null>(null);
	const live = open ? data.courses.find((c) => c.key === open.key) : undefined;
	const heading = usePageHeading<HTMLHeadingElement>();
	const [sort, setSort] = useState<Sort>('points');
	const names = data.courses.map((c) => c.name);
	const list = [...data.courses].sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name, 'hr') : (coursePercent(b) ?? -1) - (coursePercent(a) ?? -1)));

	return (
		<motion.div className="page" variants={listVariants} initial="hidden" animate="show" exit="hidden">
			<motion.header className="page-head" variants={listVariants}>
				<div>
					<h1 ref={heading} tabIndex={-1}>Predmeti</h1>
					<p className="muted">
						Bodovi iz Merlina, akademska godina {data.year}
					</p>
				</div>
				<div className="segmented segmented--small">
					{(['points', 'name'] as Sort[]).map((s) => (
						<button key={s} className={sort === s ? 'is-active' : ''} onClick={() => setSort(s)}>
							{sort === s && <motion.span layoutId="sort-pill" className="segmented__pill" />}
							<span>{s === 'points' ? 'Po bodovima' : 'Po imenu'}</span>
						</button>
					))}
				</div>
			</motion.header>

			{list.length === 0 ? (
				<Glass>
					<Empty title="Nema upisanih predmeta">Merlin za ovu godinu nije vratio nijedan kolegij.</Empty>
				</Glass>
			) : (
				<motion.div className="grid grid--courses" layout>
					{list.map((c) => {
						const color = courseColor(c.name, names);
						const pct = coursePercent(c);
						const sofar = gradedSoFar(c);
						return (
							<Glass key={c.key} layout className="course" hit={{ label: `${shortCourse(c.name)}, ${courseHeadline(c).value}${courseHeadline(c).unit}`, onClick: () => setOpen(c) }} style={{ '--accent': color } as React.CSSProperties}>
								<div className="course__glow" />
								<div className="course__top">
									<Ring value={pct} color={color} size={84} stroke={8} name={shortCourse(c.name)} />
									<div className="course__name">
										<span className="course__short">{c.shortname ?? ''}</span>
										<strong>{shortCourse(c.name)}</strong>
									</div>
								</div>
								<div className="course__stats">
									<div>
										{courseHeadline(c).value === '–' ? (
											<span className="muted">{c.error || (failedAll && c.items.length === 0) ? 'Bodovi se nisu učitali.' : 'Još nema bodova'}</span>
										) : (
											<>
												<span className="num big">{courseHeadline(c).value}</span>
												<span className="muted">{courseHeadline(c).unit}</span>
											</>
										)}
									</div>
									{sofar.count > 0 && c.total?.raw !== undefined && (
										<span className="pill">
											{nfmt(sofar.percent, 0)}% od ocijenjenog
										</span>
									)}
								</div>
								<div className="course__spark" aria-hidden>
									{c.items.slice(0, 12).map((i, k) => (
										<motion.span key={k} initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ delay: 0.3 + k * 0.04, type: 'spring', stiffness: 200, damping: 20 }} style={{ height: `${Math.max(8, i.percent ?? 0)}%`, background: color }} />
									))}
								</div>
								{c.error && c.items.length > 0 && <p className="small warn">Bodovi se nisu osvježili.</p>}
							</Glass>
						);
					})}
				</motion.div>
			)}

			<AnimatePresence>
				{open && (
					<Sheet open onClose={() => setOpen(null)} title={shortCourse(open.name)} accent={courseColor(open.name, names)}>
						<CourseDetail c={live ?? open} color={courseColor(open.name, names)} failed={!!(live ?? open).error || failedAll} onRetry={onRetry} />
					</Sheet>
				)}
			</AnimatePresence>
		</motion.div>
	);
}

function CourseDetail({ c, color, failed, onRetry }: { c: DashCourse; color: string; failed: boolean; onRetry: () => void }) {
	const sofar = gradedSoFar(c);
	return (
		<div className="detail">
			<div className="detail__summary">
				<Ring value={coursePercent(c)} color={color} size={120} stroke={11} name="Ukupno" />
				<div className="detail__nums">
					<div>
						<span className="muted small">Ukupno</span>
						<strong className="num big">
							{nfmt(c.total?.raw)}
							{c.total?.max ? <span className="muted"> / {nfmt(c.total.max, 0)}</span> : null}
						</strong>
					</div>
					<div>
						<span className="muted small">Od ocijenjenog</span>
						<strong className="num">
							{sofar.max ? `${nfmt(sofar.raw)} / ${nfmt(sofar.max)}` : `${nfmt(sofar.percent, 0)}%`}
						</strong>
					</div>
					<div>
						<span className="muted small">Ocijenjenih stavki</span>
						<strong className="num">{sofar.count}</strong>
					</div>
				</div>
			</div>
			{c.items.length === 0 && failed ? (
				<Empty title="Bodovi se nisu učitali.">
					<button type="button" className="link" onClick={onRetry}>Pokušaj ponovo</button>
				</Empty>
			) : c.items.length === 0 ? (
				<Empty title="Još nema ocjena">Profesor još nije unio bodove u Merlin.</Empty>
			) : (
				<div className="items">
					{failed && (
						<p className="small warn" role="status">
							Bodovi se nisu osvježili, prikazujem zadnje spremljene. <button type="button" className="link" onClick={onRetry}>Pokušaj ponovo</button>
						</p>
					)}
					{c.items.map((i, k) => (
						<motion.div key={k} className="item" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 * k }}>
							<div className="item__head">
								<strong>{i.name}</strong>
								<span className="num">
									{i.raw !== undefined ? nfmt(i.raw) : '–'}
									{i.max ? <span className="muted"> / {nfmt(i.max)}</span> : null}
								</span>
							</div>
							<Bar value={i.percent ?? (i.raw !== undefined && i.max ? (i.raw / i.max) * 100 : undefined)} color={color} label={i.name} />
							<div className="item__meta muted small">
								{i.weight && <span>Težina {i.weight}</span>}
								{i.graded_at ? <span>Ocijenjeno {fmtDate(i.graded_at)}</span> : null}
							</div>
							{i.feedback && <blockquote className="item__feedback">{i.feedback}</blockquote>}
						</motion.div>
					))}
				</div>
			)}
		</div>
	);
}
