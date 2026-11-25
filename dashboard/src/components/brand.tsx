import { motion, useReducedMotion } from 'motion/react';
import { useEffect } from 'react';

export const LOGO = `${import.meta.env.BASE_URL}marlon.png`;

/** The wordmark: "Marl", the Marlon badge as the "o", then "n". */
export function Wordmark({ className = '', logoClass = '' }: { className?: string; logoClass?: string }) {
	return (
		<span className={`wordmark ${className}`}>
			Marl<img src={LOGO} alt="o" className={`wordmark__o ${logoClass}`} draggable={false} />n
		</span>
	);
}

/**
 * Opening animation: a blue glass disc forms, Marlon rises out of it and gives the banana
 * a wave, then the word "Marlon" assembles with the badge dropping into place as the "o".
 * Skipped (quick fade) for prefers-reduced-motion. Calls onDone when it finishes.
 */
export default function Intro({ onDone }: { onDone: () => void }) {
	const reduce = useReducedMotion();

	useEffect(() => {
		const t = setTimeout(onDone, reduce ? 450 : 3200);
		return () => clearTimeout(t);
	}, [onDone, reduce]);

	if (reduce) {
		return (
			<motion.div className="intro" initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ duration: 0.45 }}>
				<Wordmark className="wordmark--xl" />
			</motion.div>
		);
	}

	return (
		<motion.div className="intro" initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ delay: 2.75, duration: 0.45, ease: 'easeIn' }}>
			<motion.div className="intro__stage" initial={{ scale: 1 }} animate={{ scale: 1.05 }} transition={{ delay: 2.75, duration: 0.45 }}>
				{/* the blue disc */}
				<motion.span
					className="intro__disc"
					initial={{ scale: 0, opacity: 0 }}
					animate={{ scale: [0, 1.15, 1], opacity: [0, 1, 1] }}
					transition={{ duration: 0.75, times: [0, 0.7, 1], ease: [0.22, 1, 0.36, 1] }}
				/>
				{/* Marlon rising out of the disc; his banana waves on its own */}
				<motion.div
					className="intro__marlon"
					initial={{ scale: 0.1, opacity: 0, y: 24, rotate: 0 }}
					animate={{
						scale: [0.1, 1.08, 1, 1, 0.62],
						opacity: [0, 1, 1, 1, 0],
						y: [24, -10, -6, -6, 26],
						rotate: [0, -2, 5, -3, 0],
					}}
					transition={{ duration: 1.9, delay: 0.5, times: [0, 0.3, 0.45, 0.72, 1], ease: 'easeInOut' }}
				>
					<MarlonMascot />
				</motion.div>
				{/* the word assembles; the badge above has lifted, these are the letters */}
				<div className="intro__word" aria-label="Marlon">
					<motion.span initial={{ opacity: 0, x: 26, filter: 'blur(8px)' }} animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }} transition={{ delay: 2.05, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}>
						Marl
					</motion.span>
					<motion.img
						src={LOGO}
						alt="o"
						className="intro__o"
						draggable={false}
						initial={{ opacity: 0, scale: 0.4, y: -40 }}
						animate={{ opacity: 1, scale: 1, y: 0 }}
						transition={{ delay: 1.95, duration: 0.6, ease: [0.34, 1.4, 0.64, 1] }}
					/>
					<motion.span initial={{ opacity: 0, x: -26, filter: 'blur(8px)' }} animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }} transition={{ delay: 2.05, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}>
						n
					</motion.span>
				</div>
			</motion.div>
		</motion.div>
	);
}

export const BASE_IMG = `${import.meta.env.BASE_URL}marlon-base.png`;
export const BANANA_IMG = `${import.meta.env.BASE_URL}marlon-banana.png`;

// Banana placement within the square logo (fractions of the full image), measured from the art.
const BANANA = { left: 65.33, top: 22.27, width: 17.19, height: 19.92, pivotX: 33.52, pivotY: 90.69 };

/**
 * The Marlon mascot with a banana that actually waves: the base (banana removed, hole inpainted)
 * plus the banana as its own sprite, rotated around the stick tip. `wave` runs the loop;
 * stopped for prefers-reduced-motion. Size is set by the parent (width/height on the element).
 */
export function MarlonMascot({ className = '', wave = true }: { className?: string; wave?: boolean }) {
	const reduce = useReducedMotion();
	const on = wave && !reduce;
	return (
		<span className={`mascot ${className}`}>
			<img src={BASE_IMG} alt="Marlon" className="mascot__base" draggable={false} />
			<motion.img
				src={BANANA_IMG}
				alt=""
				aria-hidden
				className="mascot__banana"
				draggable={false}
				style={{ left: `${BANANA.left}%`, top: `${BANANA.top}%`, width: `${BANANA.width}%`, transformOrigin: `${BANANA.pivotX}% ${BANANA.pivotY}%` }}
				animate={on ? { rotate: [0, -16, 7, -11, 2, 0] } : { rotate: 0 }}
				transition={on ? { duration: 2.4, times: [0, 0.2, 0.42, 0.62, 0.82, 1], ease: 'easeInOut', repeat: Infinity, repeatDelay: 1.1 } : { duration: 0.3 }}
			/>
		</span>
	);
}
