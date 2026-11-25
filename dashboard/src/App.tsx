import { AnimatePresence, motion, MotionConfig, useReducedMotion } from 'motion/react';
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { AuthError, fetchDashboard, isDemo, lastDashboard } from './api';
import type { Dashboard } from './types';
import { ROUTES, routeFromHash, type Route } from './routes';
import { relative } from './format';
import { spring, useNow } from './components/ui';
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

export default function App() {
	const [route, setRoute] = useState<Route>(routeFromHash);
	const [data, setData] = useState<Dashboard | undefined>(lastDashboard);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string>();
	const [noKey, setNoKey] = useState(false);
	const [intro, setIntro] = useState(() => { try { return !sessionStorage.getItem('marlon.introSeen'); } catch { return true; } });
	const dark = useDark();
	const reduce = useReducedMotion();
	const now = useNow(60_000);

	useEffect(() => {
		const on = () => setRoute(routeFromHash());
		window.addEventListener('hashchange', on);
		return () => window.removeEventListener('hashchange', on);
	}, []);
	const go = useCallback((r: Route) => {
		location.hash = `/${r}`;
		window.scrollTo({ top: 0, behavior: 'smooth' });
	}, []);

	const load = useCallback(async (fresh = false) => {
		setLoading(true);
		setError(undefined);
		try {
			// Each part (main, points, announcements) shows as soon as it lands.
			await fetchDashboard(fresh, setData);
		} catch (err) {
			if (err instanceof AuthError) {
				setData(undefined);
				setNoKey(true);
			} else setError(err instanceof Error ? err.message : 'Nešto je pošlo krivo.');
		} finally {
			setLoading(false);
		}
	}, []);
	useEffect(() => {
		void load();
	}, [load]);

	return (
		<MotionConfig reducedMotion="user">
			<div className={`app ${dark ? 'is-dark' : ''}`}>
				<div className="backdrop" aria-hidden>
					<span className={`orb orb--a orb--${route}`} />
					<span className={`orb orb--b orb--${route}`} />
					<span className={`orb orb--c orb--${route}`} />
				</div>
				{!reduce && webgl && (
					<Suspense fallback={null}>
						<Scene route={route} dark={dark} />
					</Suspense>
				)}
				<div className="grain" aria-hidden />

				<AnimatePresence>
					{intro && <Intro key="intro" onDone={() => { setIntro(false); try { sessionStorage.setItem('marlon.introSeen', '1'); } catch { /* private mode */ } }} />}
				</AnimatePresence>

				{noKey ? (
					<NoKey />
				) : (
					<motion.div className="shell" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: reduce ? 0 : 0.9, duration: 0.6 }}>
						<header className="topbar">
							<div className="brand">
								<Wordmark className="brand__name" />
								{isDemo() && <span className="pill pill--demo">demo</span>}
							</div>
							<nav className="segmented nav" aria-label="Stranice">
								{ROUTES.map((r) => (
									<button key={r.id} className={route === r.id ? 'is-active' : ''} onClick={() => go(r.id)} aria-current={route === r.id ? 'page' : undefined}>
										{route === r.id && <motion.span layoutId="nav-pill" className="segmented__pill" transition={spring} />}
										<span>{r.label}</span>
									</button>
								))}
							</nav>
							<div className="topbar__right">
								{data && <span className="muted small updated">ažurirano {relative(Math.min(data.generated_at, now), now)}</span>}
								<button className={`icon-btn ${loading ? 'is-spinning' : ''}`} onClick={() => load(true)} aria-label="Osvježi" disabled={loading}>
									<svg width="16" height="16" viewBox="0 0 16 16"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5V5h-2.5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
								</button>
							</div>
						</header>

						<AnimatePresence>
							{error && (
								<motion.div className="toast glass" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
									{error}
									{data ? ' Prikazujem zadnje spremljene podatke.' : ''}
									<button className="link" onClick={() => load(true)}>Pokušaj ponovo</button>
								</motion.div>
							)}
						</AnimatePresence>
						{data?.errors && data.errors.length > 0 && <p className="partial muted small">Dio podataka nije stigao iz Merlina ({data.errors.map((e) => e.part).join(', ')}).</p>}

						<main className="main">
							{!data ? (
								<Skeleton />
							) : (
								<AnimatePresence mode="wait">
									<motion.div key={route} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.18 } }}>
										{route === 'pregled' && <Overview data={data} go={go} />}
										{route === 'predmeti' && <Courses data={data} />}
										{route === 'kalendar' && <Calendar data={data} />}
										{route === 'ispiti' && <Exams data={data} />}
									</motion.div>
								</AnimatePresence>
							)}
						</main>
						<footer className="foot muted small">Samo čita iz Merlina · bodovi se osvježavaju najviše svakih 15 minuta, ostalo svakih 5</footer>
					</motion.div>
				)}
			</div>
		</MotionConfig>
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
				<p className="muted">Ovaj server je javan, pa traži tvoj link s ključem (onaj s <code>#key=</code> na kraju). Otvori ga jednom i ovaj preglednik će ga zapamtiti.</p>
				<a className="btn" href="?demo">Pogledaj demo</a>
			</div>
		</motion.div>
	);
}
