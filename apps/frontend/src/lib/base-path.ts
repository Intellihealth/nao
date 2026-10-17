const rawBase = import.meta.env.BASE_URL ?? '/';

/** Empty at the domain root. `/nao` when the app is served under that path. */
export const naoBase = rawBase === '/' ? '' : rawBase.replace(/\/$/, '');

export function withBase(path: string): string {
	const suffix = path.startsWith('/') ? path : `/${path}`;
	return `${naoBase}${suffix}`;
}
