import { motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { extractToken, isLaunchLink, launchUrl, registerAuthHandler, signIn, type MerlinSession } from '../api';
import { MarlonMascot, Wordmark } from '../components/brand';
import { spring } from '../components/ui';

/** Academic years to offer: the current one (rolls over 1 Oct) first, plus the two around it. */
function yearOptions(now = new Date()): string[] {
	const y = now.getFullYear();
	const start = now.getMonth() >= 9 ? y : y - 1;
	return [start, start - 1, start + 1].map((s) => `${s}-${s + 1}`);
}

type Step = 'intro' | 'paste';

export default function Login({ onDone, notice }: { onDone: (s: MerlinSession) => void; notice?: string }) {
	const years = useMemo(() => yearOptions(), []);
	const [year, setYear] = useState(years[0]);
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

	/** Read the clipboard, find a token, and sign in. `auto` keeps quiet when nothing is there (focus retries). */
	const fromClipboard = useCallback(
		async (auto = false) => {
			if (busyRef.current) return;
			let text = '';
			try {
				text = await navigator.clipboard.readText();
			} catch {
				if (!auto) setError('Preglednik ne da pročitati međuspremnik. Zalijepi adresu ručno u polje ispod.');
				return;
			}
			const token = extractToken(text);
			if (!token) {
				if (!auto) setError('U međuspremniku nema tokena. Kopiraj adresu koja počinje s merlin-token:// pa pokušaj ponovno.');
				return;
			}
			void loginWith(token);
		},
		[loginWith]
	);

	// Coming back from the SRCE tab with the address copied: try to pick it up automatically.
	useEffect(() => {
		if (step !== 'paste') return;
		const on = () => void fromClipboard(true);
		window.addEventListener('focus', on);
		return () => window.removeEventListener('focus', on);
	}, [step, fromClipboard]);

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

				{notice && <p className="login__error">{notice}</p>}

				<label className="login__year">
					<span className="small muted">Akademska godina</span>
					<div className="segmented segmented--small">
						{years.map((y) => (
							<button key={y} className={year === y ? 'is-active' : ''} onClick={() => setYear(y)} type="button">
								{year === y && <motion.span layoutId="year-pill" className="segmented__pill" transition={spring} />}
								<span>{y}</span>
							</button>
						))}
					</div>
				</label>

				{step === 'intro' ? (
					<>
						<button className="btn btn--block" onClick={openMerlin} type="button">Prijavi se preko Merlina →</button>
						<p className="small muted login__hint">Otvorit će se službena SRCE prijava. Nakon prijave browser će pokazati stranicu s adresom koja počinje <code>merlin-token://</code> — to je u redu, vrati se ovamo i zalijepi je.</p>
						<button className="link login__alt" onClick={() => setStep('paste')} type="button">Već imam token / adresu</button>
					</>
				) : (
					<>
						<p className="small muted login__hint">Prijavio si se? Kopiraj adresu koja počinje <code>merlin-token://</code> i vrati se ovamo — pokušat ću je uzeti sam. Ako ne uspije, klikni gumb ili je zalijepi dolje.</p>
						<button className="btn btn--block" onClick={() => void fromClipboard(false)} disabled={busy} type="button">
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
					<motion.p className="login__error" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}>
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
			<p className="login__foot small muted">Token ostaje samo u ovom pregledniku. Server ga koristi za dohvat tvojih podataka i ne sprema ga.</p>
		</div>
	);
}
