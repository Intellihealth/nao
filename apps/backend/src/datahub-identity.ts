import { createHash } from 'node:crypto';

export type DataHubCorpUser = {
	username: string;
	urn: string;
	displayName: string;
	email: string | null;
	active: boolean;
};

export function datahubUserId(username: string): string {
	return `dh_${createHash('sha256').update(username).digest('hex').slice(0, 24)}`;
}

const SYNTHETIC_EMAIL_SUFFIX = '@users.datahub.local';

/** Langfuse user id for the SQL agent: the DataHub username, not the nao user id. */
export function datahubTraceUserId(email: string | null | undefined): string | undefined {
	if (!email) {
		return undefined;
	}
	if (email.endsWith(SYNTHETIC_EMAIL_SUFFIX)) {
		const username = email.slice(0, -SYNTHETIC_EMAIL_SUFFIX.length);
		return username || undefined;
	}
	return email;
}

export function datahubUserEmail(username: string, profileEmail: string | null | undefined): string {
	const candidate = (profileEmail ?? '').trim().toLowerCase();
	if (candidate.includes('@')) {
		return candidate;
	}
	const name = username.trim().toLowerCase();
	if (name.includes('@')) {
		return name;
	}
	return `${name}${SYNTHETIC_EMAIL_SUFFIX}`;
}

export function corpUserFromGraphql(body: unknown): DataHubCorpUser | null {
	if (!body || typeof body !== 'object') {
		return null;
	}
	const data = (body as { data?: { me?: { corpUser?: unknown } } }).data;
	const corpUser = data?.me?.corpUser;
	if (!corpUser || typeof corpUser !== 'object') {
		return null;
	}
	const record = corpUser as {
		username?: unknown;
		urn?: unknown;
		properties?: { displayName?: unknown; email?: unknown; active?: unknown } | null;
	};
	if (typeof record.username !== 'string' || record.username.length === 0) {
		return null;
	}
	if (typeof record.urn !== 'string' || record.urn.length === 0) {
		return null;
	}
	if (record.properties?.active === false) {
		return null;
	}
	const displayName =
		typeof record.properties?.displayName === 'string' && record.properties.displayName.trim().length > 0
			? record.properties.displayName.trim()
			: record.username;
	const email = typeof record.properties?.email === 'string' ? record.properties.email : null;
	return {
		username: record.username,
		urn: record.urn,
		displayName,
		email,
		active: record.properties?.active !== false,
	};
}
