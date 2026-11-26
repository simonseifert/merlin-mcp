import { motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { extractToken, getSessions, isLaunchLink, launchUrl, registerAuthHandler, signIn, yearOptions, type MerlinSession } from '../api';
import { MarlonMascot, Wordmark } from '../components/brand';
import { LangToggle, Rich, spring } from '../components/ui';
import { t } from '../i18n';


type Step = 'intro' | 'paste';

/**
 * Sign in to Merlin. Also used to add another academic year (each year is its own site with its own token):
 * then `onCancel` is set, years already signed in are marked, and the first free year is preselected.
 */
export default function Login({ onDone, onCancel, notice, initialYear }: { onDone: (s: MerlinSession) => void; onCancel?: () => void; notice?: string; initialYear?: string }) {
	const years = useMemo(() => yearOptions(), []);
	const signed = useMemo(() => new Set(getSessions().map((s) => s.year)), []);
	const [year, setYear] = useState(() => (initialYear && years.includes(initialYear) ? initialYear : years.find((y) => !signed.has(y)) ?? years[0]));
	const [step, setStep] = useState<Step>('intro');
	const [value, setValue] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string>();

	// Register the web+marlon handler as soon as the screen opens, so the token can return automatically.
	useEffect(() => {
		registerAuthHandler();
	}, []);

	const busyRef = useRef(false);
	const loginWith = useCallback(
		async (token: string) => {
			if (busyRef.current) return;
			busyRef.current = true;
			setBusy(true);
			setError(undefined);
			try {
				onDone(await signIn(token, year));
			} catch (err) {
				setError(err instanceof Error ? err.message : 'Prijava nije uspjela.');
			} finally {
				busyRef.current = false;
				setBusy(false);
			}
		},
		[onDone, year]
	);

	const openMerlin = () => {
		// Ask the browser to hand our web+marlon:// link back to us, so the token can return without a copy.
		registerAuthHandler();
		window.open(launchUrl(year, true), '_blank', 'noopener');
		setStep('paste');
		setError(undefined);
	};

	const submit = () => {
		const token = extractToken(value);
		if (!token) {
			setError(
				isLaunchLink(value)
						? t('li.errLaunch')
						: t('li.errToken')
			);
			return;
		}
		void loginWith(token);
	};

	/**
	 * Read the clipboard, find a token, and sign in. Only ever called from the button: the clipboard
	 * is never read on its own (on focus, on load), so nothing the student copied for another reason leaves the browser.
	 */
	const fromClipboard = useCallback(async () => {
		if (busyRef.current) return;
		let text = '';
		try {
			text = await navigator.clipboard.readText();
		} catch {
			setError(t('li.errClipboard'));
			return;
		}
		const token = extractToken(text);
		if (!token) {
			setError(t('li.errNoToken'));
			return;
		}
		void loginWith(token);
	}, [loginWith]);

	return (
		<div className="login">
			<LangToggle className="login__lang" />
			<motion.div className="login__card glass" initial={{ opacity: 0, y: 24, filter: 'blur(12px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} transition={{ delay: 0.15, ...spring }}>
				<div className="login__hero">
					<motion.div className="login__mascot" initial={{ scale: 0.6, opacity: 0, y: 10 }} animate={{ scale: 1, opacity: 1, y: 0 }} transition={{ delay: 0.25, ...spring }}>
						<MarlonMascot />
					</motion.div>
					<h1><Wordmark className="wordmark--xl" /></h1>
					<p className="muted">{t('li.hero')}</p>
				</div>

				{notice && <p className="login__error" role="alert">{notice}</p>}

				<div className="login__year" role="group" aria-labelledby="login-year-label">
					<span className="small muted" id="login-year-label">{t('li.year')}</span>
					<div className="segmented segmented--small">
						{years.map((y) => (
							<button key={y} className={year === y ? 'is-active' : ''} onClick={() => setYear(y)} aria-pressed={year === y} type="button">
								{year === y && <motion.span layoutId="year-pill" className="segmented__pill" transition={spring} />}
								<span>{y}{signed.has(y) && <> ✓<span className="sr-only"> ({t('li.signedYear')})</span></>}</span>
							</button>
						))}
					</div>
				</div>

				{step === 'intro' ? (
					<>
						<button className="btn btn--block" onClick={openMerlin} type="button">{t('li.open')}</button>
						<p className="small muted login__hint"><Rich text={t('li.openHint')} /></p>
						<button className="link login__alt" onClick={() => setStep('paste')} type="button">{t('li.have')}</button>
					</>
				) : (
					<>
						<p className="small muted login__hint"><Rich text={t('li.pasteHint')} /></p>
						<button className="btn btn--block" onClick={() => void fromClipboard()} disabled={busy} type="button">
							{busy ? t('li.checking') : t('li.fromClipboard')}
						</button>
						<textarea
							className="login__paste"
							placeholder={t('li.placeholder')}
							aria-label={t('li.placeholder')}
							value={value}
							onChange={(e) => setValue(e.target.value)}
							rows={2}
							spellCheck={false}
						/>
						<button className="btn btn--soft btn--block" onClick={submit} disabled={busy} type="button">{t('li.fromField')}</button>
						<button className="link login__alt" onClick={openMerlin} type="button">{t('li.reopen')}</button>
					</>
				)}

				{error && (
					<motion.p className="login__error" role="alert" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}>
						{error}
					</motion.p>
				)}

				<details className="login__help">
					<summary>{t('li.helpTitle')}</summary>
					<ol className="small muted">
						<li>{t('li.help1')}</li>
						<li><Rich text={t('li.help2')} /></li>
						<li>{t('li.help3')}</li>
						<li>{t('li.help4')}</li>
					</ol>
				</details>
			</motion.div>
			{onCancel && (
				<button className="link" onClick={onCancel} type="button">
					{t('li.cancel')}
				</button>
			)}
			<p className="login__foot small muted">{t('li.foot')}</p>
		</div>
	);
}
