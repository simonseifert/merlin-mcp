import { AnimatePresence, motion, MotionConfig, useReducedMotion } from 'motion/react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLite } from './lite';
import { AuthError, DIRECT, fetchDashboard, getMerlin, getSessions, isDemo, lastDashboard, setActiveYear, signIn, signOut, tokenFromHash } from './api';
import Login from './views/Login';
import type { Dashboard } from './types';
import { ROUTES, routeFromHash, type Route } from './routes';
import { partWords, relative } from './format';
import { LangToggle, Rich, requestHeadingFocus, spring, useNow } from './components/ui';
import { t, useLang } from './i18n';
import Intro, { Wordmark } from './components/brand';
import Overview from './views/Overview';
import Courses from './views/Courses';
import Calendar from './views/Calendar';
import Exams from './views/Exams';

const Scene = lazy(() => import('./three/Scene'));

function useDark(): boolean {
	const q = '(prefers-color-scheme: dark)';
	// ?theme=light or ?theme=dark pins the theme; otherwise follow the system.
	const pinned = new URLSearchParams(location.search).get('theme');
	const [dark, setDark] = useState(() => (pinned ? pinned === 'dark' : matchMedia(q).matches));
	useEffect(() => {
		if (pinned) return;
		const m = matchMedia(q);
		const on = () => setDark(m.matches);
		m.addEventListener('change', on);
		return () => m.removeEventListener('change', on);
	}, [pinned]);
	return dark;
}

/** WebGL can be missing (old GPU, disabled); then the CSS background carries the look alone. */
const webgl = (() => {
	try {
		return !!document.createElement('canvas').getContext('webgl2');
	} catch {
		return false;
	}
})();

const ADD_YEAR = '+add';

export default function App() {
	useLang(); // re-render everything when the language changes
	const [route, setRoute] = useState<Route>(routeFromHash);
	const [data, setData] = useState<Dashboard | undefined>(lastDashboard);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string>();
	// 'key': this server wants its #key= link. 'merlin': direct mode, sign in with your own Merlin account.
	const [auth, setAuth] = useState<'key' | 'merlin' | undefined>(() => (DIRECT && !isDemo() && !getMerlin() ? 'merlin' : undefined));
	// Direct mode: a token the browser handed back after SRCE sign-in (#tok=…), signed in with on load.
	const hashToken = useMemo(() => (DIRECT ? tokenFromHash() : null), []);
	const [intro, setIntro] = useState(() => { try { return !localStorage.getItem('marlon.introSeen'); } catch { return true; } });
	const introShown = useRef(intro).current;
	const endIntro = useCallback(() => {
		setIntro(false);
		try { localStorage.setItem('marlon.introSeen', '1'); } catch { /* private mode */ }
	}, []);
	const [lite, toggleLite] = useLite();
	// Direct mode: every academic year signed in to (each its own token), and the Login screen opened to add one.
	const [sessions, setSessions] = useState(getSessions);
	const [adding, setAdding] = useState(false);
	const inflight = useRef(false);
	const loadedAt = useRef(Date.now());
	const dark = useDark();
	const reduce = useReducedMotion();
	const now = useNow(60_000);

	useEffect(() => {
		const on = () => {
			requestHeadingFocus();
			setRoute(routeFromHash());
		};
		window.addEventListener('hashchange', on);
		return () => window.removeEventListener('hashchange', on);
	}, []);
	const go = useCallback((r: Route) => {
		location.hash = `/${r}`;
		window.scrollTo({ top: 0, behavior: 'smooth' });
	}, []);

	/** `quiet`: a background refresh (coming back to the tab). No spinner, and a failure keeps what is on screen. */
	const load = useCallback(async (fresh = false, quiet = false) => {
		inflight.current = true;
		if (!quiet) {
			setLoading(true);
			setError(undefined);
		}
		try {
			// Each part (main, points, announcements) shows as soon as it lands.
			await fetchDashboard(fresh, setData);
			loadedAt.current = Date.now();
		} catch (err) {
			if (err instanceof AuthError) {
				setData(undefined);
				setAuth(err.kind);
			} else if (!quiet) setError(err instanceof Error ? err.message : t('err.generic'));
		} finally {
			inflight.current = false;
			if (!quiet) setLoading(false);
		}
	}, []);
	useEffect(() => {
		if (!auth && !hashToken) void load();
	}, [load, auth, hashToken]);

	// Back on the tab after a while: refresh quietly when the page is more than 5 minutes old.
	useEffect(() => {
		if (auth) return;
		const on = () => {
			if (document.visibilityState !== 'visible' || inflight.current) return;
			if (Date.now() - loadedAt.current > 5 * 60_000) void load(false, true);
		};
		document.addEventListener('visibilitychange', on);
		return () => document.removeEventListener('visibilitychange', on);
	}, [load, auth]);

	/** Signed in (first time, a dead token renewed, or another year added): show that year's page. */
	const loginDone = useCallback(() => {
		setError(undefined);
		setSessions(getSessions());
		setData(lastDashboard());
		setAdding(false);
		// Coming from the sign-in screen the effect above loads; adding a year from the page does not.
		if (auth) setAuth(undefined);
		else void load();
	}, [auth, load]);

	/** Switch to another signed-in year: its saved page at once, then a normal (cache-aware) load. */
	const switchYear = useCallback(
		(year: string) => {
			setActiveYear(year);
			setSessions(getSessions());
			setError(undefined);
			setData(lastDashboard());
			void load();
		},
		[load]
	);

	// Auto-return from SRCE (desktop): the token came back in the URL, so validate it and go in.
	useEffect(() => {
		if (!hashToken) return;
		signIn(hashToken.token, hashToken.year)
			.then(() => {
				setSessions(getSessions());
				setAuth(undefined);
				return load(true);
			})
			.catch((err) => {
				setError(err instanceof Error ? err.message : t('err.login'));
				setAuth('merlin');
			});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [hashToken]);

	return (
		<MotionConfig reducedMotion="user">
			<div className={`app ${dark ? 'is-dark' : ''}`}>
				<div className="backdrop" aria-hidden>
					<span className={`orb orb--a orb--${route}`} />
					<span className={`orb orb--b orb--${route}`} />
					<span className={`orb orb--c orb--${route}`} />
				</div>
				{!reduce && !lite && webgl && (
					<Suspense fallback={null}>
						<Scene route={route} dark={dark} />
					</Suspense>
				)}
				<div className="grain" aria-hidden />

				<AnimatePresence>
					{intro && <Intro key="intro" onDone={endIntro} />}
				</AnimatePresence>

				{auth === 'merlin' || adding ? (
					<Login notice={error} initialYear={adding ? undefined : getMerlin()?.year} onCancel={adding ? () => setAdding(false) : undefined} onDone={loginDone} />
				) : auth === 'key' ? (
					<NoKey />
				) : (
					<motion.div className="shell" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: reduce || !introShown ? 0 : 0.9, duration: 0.6 }}>
						<header className="topbar">
							<div className="brand">
								<Wordmark className="brand__name" />
								{isDemo() && <span className="pill pill--demo">{t('demo')}</span>}
							</div>
							<nav className="segmented nav" aria-label={t('nav.aria')}>
								{ROUTES.map((r) => (
									<button key={r.id} className={route === r.id ? 'is-active' : ''} onClick={() => go(r.id)} aria-current={route === r.id ? 'page' : undefined}>
										{route === r.id && <motion.span layoutId="nav-pill" className="segmented__pill" transition={spring} />}
										<span>{t(`nav.${r.id}`)}</span>
									</button>
								))}
							</nav>
							<div className="topbar__right">
								{data && <span className="muted small updated">{t('top.updated', { when: relative(Math.min(data.generated_at, now), now) })}</span>}
								<LangToggle />
								{DIRECT && sessions.length > 0 && (
									<select
										className="year-select"
										aria-label={t('top.year')}
										value={getMerlin()?.year ?? ''}
										onChange={(e) => (e.target.value === ADD_YEAR ? setAdding(true) : switchYear(e.target.value))}
									>
										{sessions.map((s) => (
											<option key={s.year} value={s.year}>{s.year}</option>
										))}
										<option value={ADD_YEAR}>{t('top.addYear')}</option>
									</select>
								)}
								{!reduce && (
									<button type="button" className="icon-btn" onClick={toggleLite} aria-pressed={lite} aria-label={t('top.lite')} title={lite ? t('top.liteOn') : t('top.liteOff')}>
										<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
											{lite ? <path d="M8 2l5 2.8v5.4L8 13 3 10.2V4.8L8 2z" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinejoin="round" /> : <path d="M8 2l5 2.8v5.4L8 13 3 10.2V4.8L8 2zM8 7.9V13M3 4.8l5 3.1 5-3.1" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinejoin="round" />}
										</svg>
									</button>
								)}
								<button className={`icon-btn ${loading ? 'is-spinning' : ''}`} onClick={() => load(true)} aria-label={t('top.refresh')} disabled={loading}>
									<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5V5h-2.5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
								</button>
								{DIRECT && getMerlin() && (
									<button className="icon-btn" onClick={() => { signOut(); setSessions([]); setData(undefined); setAuth('merlin'); }} aria-label={t('top.signOut')} title={t('top.signOutTitle')}>
										<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 2H3v12h3M10 11l3-3-3-3M13 8H6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
									</button>
								)}
							</div>
						</header>

						<AnimatePresence>
							{error && data && (
								<motion.div className="toast glass" role="alert" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
									{error}
									{data ? t('toast.cached') : ''}
									<button className="link" onClick={() => load(true)}>{t('retry')}</button>
								</motion.div>
							)}
						</AnimatePresence>
						{data?.errors && data.errors.length > 0 && <p className="partial muted small">{t('partial', { parts: partWords(data.errors) })}</p>}

						<main className="main">
							{!data ? (
								loading || !error ? <Skeleton /> : <ErrorState message={error} onRetry={() => load(true)} />
							) : (
								<AnimatePresence mode="wait">
									<motion.div key={route} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.18 } }}>
										{route === 'pregled' && <Overview data={data} go={go} />}
										{route === 'predmeti' && <Courses data={data} onRetry={() => load(true)} />}
										{route === 'kalendar' && <Calendar data={data} />}
										{route === 'ispiti' && <Exams data={data} />}
									</motion.div>
								</AnimatePresence>
							)}
						</main>
						<footer className="foot muted small">{t('foot')}</footer>
					</motion.div>
				)}
			</div>
		</MotionConfig>
	);
}

/** Shown instead of the skeleton when the first load failed and there is nothing saved to show. */
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
	return (
		<div className="page">
			<div className="glass errorstate" role="alert">
				<h1>{t('loadFailed')}</h1>
				<p className="muted">{message}</p>
				<button className="btn" onClick={onRetry} type="button">{t('retry')}</button>
			</div>
		</div>
	);
}

function Skeleton() {
	return (
		<div className="page">
			<div className="hero">
				<div className="skel skel--line" style={{ width: 160 }} />
				<div className="skel skel--title" />
			</div>
			<div className="grid grid--overview">
				{[2, 1, 2, 1, 2, 1].map((s, i) => (
					<div key={i} className={`glass skel-card ${s === 2 ? 'span-2' : ''}`}>
						<div className="skel skel--line" style={{ width: '40%' }} />
						<div className="skel skel--block" />
					</div>
				))}
			</div>
		</div>
	);
}

function NoKey() {
	return (
		<motion.div className="nokey" initial={{ opacity: 0, y: 20, filter: 'blur(10px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} transition={{ delay: 1, ...spring }}>
			<div className="glass nokey__card">
				<h1><Wordmark className="wordmark--xl" /></h1>
				<p className="muted"><Rich text={t('nokey.a')} /></p>
				<a className="btn" href="?demo">{t('nokey.demo')}</a>
				<LangToggle />
			</div>
		</motion.div>
	);
}
