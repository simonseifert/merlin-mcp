import { motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { extractToken, getSessions, isLaunchLink, launchUrl, registerAuthHandler, signIn, yearOptions, type MerlinSession } from '../api';
import { MarlonMascot, Wordmark } from '../components/brand';
import { spring } from '../components/ui';


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
					? 'To je link za prijavu, ne adresa s tokenom. Prvo se prijavi, pa kopiraj adresu koja se pokaže nakon toga (počinje s merlin-token:// ili web+marlon://).'
					: 'Ne mogu pročitati token. Zalijepi cijelu adresu koja se pokazala nakon prijave, ili sam token (32 znaka).'
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
			setError('Preglednik ne da pročitati međuspremnik. Zalijepi adresu ručno u polje ispod.');
			return;
		}
		const token = extractToken(text);
		if (!token) {
			setError('U međuspremniku nema adrese s tokenom. Kopiraj adresu koja počinje s merlin-token:// pa pokušaj ponovno.');
			return;
		}
		void loginWith(token);
	}, [loginWith]);

	return (
		<div className="login">
			<motion.div className="login__card glass" initial={{ opacity: 0, y: 24, filter: 'blur(12px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} transition={{ delay: 0.15, ...spring }}>
				<div className="login__hero">
					<motion.div className="login__mascot" initial={{ scale: 0.6, opacity: 0, y: 10 }} animate={{ scale: 1, opacity: 1, y: 0 }} transition={{ delay: 0.25, ...spring }}>
						<MarlonMascot />
					</motion.div>
					<h1><Wordmark className="wordmark--xl" /></h1>
					<p className="muted">Tvoj Merlin: bodovi, kalendar, ispiti i seminari na jednom mjestu. Prijavi se svojim Merlin računom — lozinku upisuješ samo na stranici SRCE-a, mi je nikad ne vidimo.</p>
				</div>

				{notice && <p className="login__error" role="alert">{notice}</p>}

				<div className="login__year" role="group" aria-labelledby="login-year-label">
					<span className="small muted" id="login-year-label">Akademska godina</span>
					<div className="segmented segmented--small">
						{years.map((y) => (
							<button key={y} className={year === y ? 'is-active' : ''} onClick={() => setYear(y)} aria-pressed={year === y} type="button">
								{year === y && <motion.span layoutId="year-pill" className="segmented__pill" transition={spring} />}
								<span>{y}{signed.has(y) ? ' ✓' : ''}</span>
							</button>
						))}
					</div>
				</div>

				{step === 'intro' ? (
					<>
						<button className="btn btn--block" onClick={openMerlin} type="button">Prijavi se preko Merlina →</button>
						<p className="small muted login__hint">Otvorit će se službena SRCE prijava. Nakon prijave browser će pokazati stranicu s adresom koja počinje <code>merlin-token://</code> — to je u redu, vrati se ovamo i zalijepi je.</p>
						<button className="link login__alt" onClick={() => setStep('paste')} type="button">Već imam token / adresu</button>
					</>
				) : (
					<>
						<p className="small muted login__hint">Prijavio si se? Kopiraj adresu koja počinje <code>merlin-token://</code>, vrati se ovamo i klikni gumb (čita međuspremnik samo kad klikneš) ili je zalijepi dolje.</p>
						<button className="btn btn--block" onClick={() => void fromClipboard()} disabled={busy} type="button">
							{busy ? 'Provjeravam…' : 'Zalijepi iz međuspremnika i prijavi se'}
						</button>
						<textarea
							className="login__paste"
							placeholder="…ili ručno zalijepi adresu merlin-token://token=…  (ili sam token)"
							value={value}
							onChange={(e) => setValue(e.target.value)}
							rows={2}
							spellCheck={false}
						/>
						<button className="btn btn--soft btn--block" onClick={submit} disabled={busy} type="button">Prijavi se iz polja</button>
						<button className="link login__alt" onClick={openMerlin} type="button">Otvori Merlin prijavu ponovno</button>
					</>
				)}

				{error && (
					<motion.p className="login__error" role="alert" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}>
						{error}
					</motion.p>
				)}

				<details className="login__help">
					<summary>Kako doći do adrese (i na mobitelu)?</summary>
					<ol className="small muted">
						<li>Klikni „Prijavi se preko Merlina" i prijavi se kao i inače (AAI@EduHr).</li>
						<li>Na kraju browser otvori adresu koja počinje s <code>merlin-token://</code> i najčešće pokaže grešku „stranica se ne može otvoriti". To je očekivano.</li>
						<li>Kopiraj tu cijelu adresu: na računalu iz trake s adresom; na mobitelu dugo pritisni traku s adresom pa „Kopiraj".</li>
						<li>Vrati se ovamo i zalijepi je u polje iznad.</li>
					</ol>
				</details>
			</motion.div>
			{onCancel && (
				<button className="link" onClick={onCancel} type="button">
					Odustani i vrati se
				</button>
			)}
			<p className="login__foot small muted">Token ostaje samo u ovom pregledniku. Server ga koristi za dohvat tvojih podataka i ne sprema ga.</p>
		</div>
	);
}
