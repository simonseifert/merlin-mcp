export type Route = 'pregled' | 'predmeti' | 'kalendar' | 'ispiti';
export const ROUTES: Array<{ id: Route; label: string }> = [
	{ id: 'pregled', label: 'Pregled' },
	{ id: 'predmeti', label: 'Predmeti' },
	{ id: 'kalendar', label: 'Kalendar' },
	{ id: 'ispiti', label: 'Ispiti i seminari' },
];
export function routeFromHash(): Route {
	const h = location.hash.replace(/^#\/?/, '');
	return (ROUTES.find((r) => r.id === h)?.id ?? 'pregled') as Route;
}
