import { motion, useReducedMotion, type HTMLMotionProps } from 'motion/react';
import { useEffect, useId, useState, type ReactNode } from 'react';
import type { EventKind } from '../types';
import { KIND_LABEL } from '../format';

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

export function Glass({ className = '', children, interactive, ...rest }: HTMLMotionProps<'div'> & { interactive?: boolean; children?: ReactNode }) {
	return (
		<motion.div
			variants={itemVariants}
			className={`glass ${interactive ? 'glass--interactive' : ''} ${className}`}
			whileHover={interactive ? { y: -3, scale: 1.006 } : undefined}
			whileTap={interactive ? { scale: 0.99 } : undefined}
			transition={spring}
			{...rest}
		>
			{children}
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
export function Ring({ value, size = 76, stroke = 8, color = '#0a84ff', label, sub }: { value?: number; size?: number; stroke?: number; color?: string; label?: ReactNode; sub?: ReactNode }) {
	const id = useId();
	const reduce = useReducedMotion();
	const r = (size - stroke) / 2;
	const c = 2 * Math.PI * r;
	const v = value === undefined ? 0 : Math.max(0, Math.min(100, value));
	return (
		<div className="ring" style={{ width: size, height: size }}>
			<svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
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

export function Bar({ value, color }: { value?: number; color: string }) {
	const v = value === undefined ? 0 : Math.max(0, Math.min(100, value));
	return (
		<div className="bar">
			<motion.div className="bar__fill" style={{ background: `linear-gradient(90deg, ${color}aa, ${color})` }} initial={{ width: 0 }} animate={{ width: `${v}%` }} transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1], delay: 0.2 }} />
		</div>
	);
}

export function KindBadge({ kind }: { kind: EventKind }) {
	return <span className={`badge badge--${kind}`}>{KIND_LABEL[kind]}</span>;
}

export function Dot({ color }: { color: string }) {
	return <span className="dot" style={{ background: color, boxShadow: `0 0 0 3px ${color}22` }} />;
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

export function Sheet({ open, onClose, children, title, accent }: { open: boolean; onClose: () => void; children: ReactNode; title: ReactNode; accent?: string }) {
	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [open, onClose]);
	if (!open) return null;
	return (
		<motion.div className="sheet-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
			<motion.div
				className="sheet glass"
				role="dialog"
				aria-modal="true"
				initial={{ opacity: 0, y: 40, scale: 0.96, filter: 'blur(10px)' }}
				animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
				exit={{ opacity: 0, y: 30, scale: 0.97, filter: 'blur(8px)' }}
				transition={spring}
				onClick={(e) => e.stopPropagation()}
				style={accent ? ({ '--accent': accent } as React.CSSProperties) : undefined}
			>
				<div className="sheet__head">
					<h2>{title}</h2>
					<button className="icon-btn" onClick={onClose} aria-label="Zatvori">
						<svg width="14" height="14" viewBox="0 0 14 14"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
					</button>
				</div>
				<div className="sheet__body">{children}</div>
			</motion.div>
		</motion.div>
	);
}
