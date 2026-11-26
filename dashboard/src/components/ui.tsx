import { motion, useIsPresent, useReducedMotion, type HTMLMotionProps } from 'motion/react';
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { EventKind } from '../types';
import { kindLabel, safeUrl } from '../format';
import { getLang, setLang, t } from '../i18n';

export const spring = { type: 'spring', stiffness: 260, damping: 30, mass: 0.9 } as const;

/** Stagger children in: up, unblur, fade. */
export const listVariants = {
	hidden: {},
	show: { transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
};
export const itemVariants = {
	hidden: { opacity: 0, y: 18, scale: 0.985, filter: 'blur(8px)' },
	show: { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)', transition: spring },
};

/** What a clickable card does. Rendered as a real button (or a link when `href` is set) stretched over the card. */
export interface CardHit {
	label: string;
	onClick?: () => void;
	href?: string;
}

export function Glass({ className = '', children, hit, ...rest }: HTMLMotionProps<'div'> & { hit?: CardHit; children?: ReactNode }) {
	return (
		<motion.div
			variants={itemVariants}
			className={`glass ${hit ? 'glass--interactive' : ''} ${className}`}
			whileHover={hit ? { y: -3, scale: 1.006 } : undefined}
			whileTap={hit ? { scale: 0.99 } : undefined}
			transition={spring}
			{...rest}
		>
			{children}
			{hit &&
				(hit.href ? (
					<a
						className="glass__hit"
						href={hit.href}
						aria-label={hit.label}
						onClick={(e) => {
							// Plain click: act in-page. Modified clicks keep the browser's own link behaviour.
							if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
							e.preventDefault();
							hit.onClick?.();
						}}
					/>
				) : (
					<button type="button" className="glass__hit" aria-label={hit.label} onClick={hit.onClick} />
				))}
		</motion.div>
	);
}

export function CardTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
	return (
		<div className="card-title">
			<h2>{children}</h2>
			{aside}
		</div>
	);
}

/** Progress ring with a gradient stroke that draws itself in. */
export function Ring({ value, size = 76, stroke = 8, color = '#0a84ff', label, sub, name }: { value?: number; size?: number; stroke?: number; color?: string; label?: ReactNode; sub?: ReactNode; name?: string }) {
	const id = useId();
	const reduce = useReducedMotion();
	const r = (size - stroke) / 2;
	const c = 2 * Math.PI * r;
	const v = value === undefined ? 0 : Math.max(0, Math.min(100, value));
	const spoken = value === undefined ? t('ring.none') : t('ring.pct', { n: Math.round(v) });
	return (
		<div className="ring" style={{ width: size, height: size }} role="img" aria-label={name ? `${name}: ${spoken}` : spoken}>
			<svg aria-hidden="true" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
				<defs>
					<linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
						<stop offset="0%" stopColor={color} stopOpacity={0.65} />
						<stop offset="100%" stopColor={color} />
					</linearGradient>
				</defs>
				<circle cx={size / 2} cy={size / 2} r={r} className="ring__track" strokeWidth={stroke} fill="none" />
				<motion.circle
					cx={size / 2}
					cy={size / 2}
					r={r}
					fill="none"
					stroke={`url(#${id})`}
					strokeWidth={stroke}
					strokeLinecap="round"
					strokeDasharray={c}
					initial={{ strokeDashoffset: c }}
					animate={{ strokeDashoffset: c * (1 - v / 100) }}
					transition={reduce ? { duration: 0 } : { duration: 1.4, ease: [0.22, 1, 0.36, 1], delay: 0.25 }}
					transform={`rotate(-90 ${size / 2} ${size / 2})`}
					style={{ filter: `drop-shadow(0 0 6px ${color}55)` }}
				/>
			</svg>
			<div className="ring__label">
				<span>{label ?? (value === undefined ? '–' : `${Math.round(v)}%`)}</span>
				{sub && <small>{sub}</small>}
			</div>
		</div>
	);
}

export function Bar({ value, color, label }: { value?: number; color: string; label?: string }) {
	const v = value === undefined ? 0 : Math.max(0, Math.min(100, value));
	const spoken = value === undefined ? t('ring.none') : t('ring.pct', { n: Math.round(v) });
	return (
		<div className="bar" role="img" aria-label={label ? `${label}: ${spoken}` : spoken}>
			<motion.div className="bar__fill" style={{ background: `linear-gradient(90deg, ${color}aa, ${color})` }} initial={{ width: 0 }} animate={{ width: `${v}%` }} transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1], delay: 0.2 }} />
		</div>
	);
}

export function KindBadge({ kind }: { kind: EventKind }) {
	return <span className={`badge badge--${kind}`}>{kindLabel(kind)}</span>;
}

export function Dot({ color }: { color: string }) {
	return <span className="dot" style={{ background: color, boxShadow: `0 0 0 3px ${color}22` }} />;
}

/** A translated string where `backtick` pairs become <code>. */
export function Rich({ text }: { text: string }) {
	return (
		<>
			{text.split('`').map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part))}
		</>
	);
}

/** Switches the interface between Croatian and English (the label shows the language it switches to). */
export function LangToggle({ className = '' }: { className?: string }) {
	const next = getLang() === 'hr' ? 'en' : 'hr';
	return (
		<button type="button" className={`icon-btn lang-btn ${className}`} onClick={() => setLang(next)} aria-label={t('lang.switch')} title={t('lang.switch')} lang={next}>
			{t('lang.label')}
		</button>
	);
}

/** "Open in Merlin": a new tab, no opener, only for plain http(s) addresses. */
export function MerlinLink({ url }: { url?: string }) {
	const href = safeUrl(url);
	if (!href) return null;
	return (
		<a className="link link--merlin" href={href} target="_blank" rel="noopener noreferrer">
			{t('openInMerlin')}<span className="sr-only">{t('newTab')}</span>
		</a>
	);
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
	return (
		<div className="empty">
			<div className="empty__orb" />
			<strong>{title}</strong>
			{children && <p>{children}</p>}
		</div>
	);
}

/** Re-renders every `ms` so countdowns and "prije 5 min" stay true. */
export function useNow(ms = 30_000): number {
	const [now, setNow] = useState(() => Date.now() / 1000);
	useEffect(() => {
		const t = setInterval(() => setNow(Date.now() / 1000), ms);
		return () => clearInterval(t);
	}, [ms]);
	return now;
}

/** Set by the app when the route changes; the next page heading to mount then takes focus. */
let focusHeadingNext = false;
export const requestHeadingFocus = () => {
	focusHeadingNext = true;
};
/** Put the returned ref on a page's h1: after a navigation (not the first load) it gets focus, so screen readers announce the new page. */
export function usePageHeading<T extends HTMLElement>() {
	const ref = useRef<T>(null);
	useEffect(() => {
		if (!focusHeadingNext) return;
		focusHeadingNext = false;
		ref.current?.focus({ preventScroll: true });
	}, []);
	return ref;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/**
 * A modal dialog: labelled by its title, focus moves in and is trapped, Escape closes, focus goes back
 * to whatever opened it, and the rest of the page is inert while it is open. Rendered into the app
 * root (not body) so the theme variables still apply.
 */
export function Sheet({ open, onClose, children, title, accent }: { open: boolean; onClose: () => void; children: ReactNode; title: ReactNode; accent?: string }) {
	const titleId = useId();
	const ref = useRef<HTMLDivElement>(null);
	const present = useIsPresent();
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;
	const [opener] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));
	const inerted = useRef<HTMLElement[]>([]);

	const release = useCallback(() => {
		for (const el of inerted.current) el.inert = false;
		inerted.current = [];
	}, []);

	useEffect(() => {
		if (!open) return;
		const dialog = ref.current;
		if (dialog) {
			for (const el of Array.from(dialog.closest('.app')?.children ?? [])) {
				if (el instanceof HTMLElement && !el.contains(dialog)) {
					el.inert = true;
					inerted.current.push(el);
				}
			}
			dialog.focus({ preventScroll: true });
		}
		const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseRef.current();
		window.addEventListener('keydown', onKey);
		return () => {
			window.removeEventListener('keydown', onKey);
			release();
			if (opener?.isConnected) opener.focus({ preventScroll: true });
		};
	}, [open, opener, release]);

	// The exit animation keeps the sheet mounted for a moment: hand the page back right away.
	useEffect(() => {
		if (present) return;
		release();
		if (opener?.isConnected) opener.focus({ preventScroll: true });
	}, [present, opener, release]);

	const trap = (e: ReactKeyboardEvent) => {
		if (e.key !== 'Tab' || !ref.current) return;
		const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
		if (items.length === 0) {
			e.preventDefault();
			return;
		}
		const first = items[0];
		const last = items[items.length - 1];
		const active = document.activeElement;
		if (e.shiftKey && (active === first || active === ref.current)) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && active === last) {
			e.preventDefault();
			first.focus();
		}
	};

	if (!open) return null;
	// The sheet is the last child of .app, so everything else there can be made inert.
	const host = document.querySelector('.app') ?? document.body;
	return createPortal(
		<motion.div className="sheet-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
			<motion.div
				ref={ref}
				className="sheet glass"
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				tabIndex={-1}
				onKeyDown={trap}
				initial={{ opacity: 0, y: 40, scale: 0.96, filter: 'blur(10px)' }}
				animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
				exit={{ opacity: 0, y: 30, scale: 0.97, filter: 'blur(8px)' }}
				transition={spring}
				onClick={(e) => e.stopPropagation()}
				style={accent ? ({ '--accent': accent } as React.CSSProperties) : undefined}
			>
				<div className="sheet__head">
					<h2 id={titleId}>{title}</h2>
					<button type="button" className="icon-btn" onClick={onClose} aria-label={t('close')}>
						<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
					</button>
				</div>
				<div className="sheet__body">{children}</div>
			</motion.div>
		</motion.div>,
		host
	);
}
