import { useCallback, useEffect, useState } from 'react';

/**
 * Lite mode: no 3D backdrop (its code is never downloaded), just the CSS one. On by default for narrow
 * screens and data-saver connections; the student can flip it and the choice is remembered.
 */
const KEY = 'marlon.lite';
const NARROW = '(max-width: 700px)';

function stored(): boolean | undefined {
	try {
		const v = localStorage.getItem(KEY);
		return v === '1' ? true : v === '0' ? false : undefined;
	} catch {
		return undefined;
	}
}

const saveData = () => !!(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
const automatic = () => matchMedia(NARROW).matches || saveData();

export function useLite(): [boolean, () => void] {
	const [pref, setPref] = useState<boolean | undefined>(stored);
	const [auto, setAuto] = useState(automatic);
	useEffect(() => {
		const m = matchMedia(NARROW);
		const on = () => setAuto(automatic());
		m.addEventListener('change', on);
		return () => m.removeEventListener('change', on);
	}, []);
	const lite = pref ?? auto;
	const toggle = useCallback(() => {
		const next = !lite;
		setPref(next);
		try {
			localStorage.setItem(KEY, next ? '1' : '0');
		} catch {
			/* private mode: lasts for this page */
		}
	}, [lite]);
	return [lite, toggle];
}
