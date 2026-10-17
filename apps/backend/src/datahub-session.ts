import type { Session, User as AuthUser } from 'better-auth';
import { eq } from 'drizzle-orm';

import { corpUserFromGraphql, type DataHubCorpUser, datahubUserEmail, datahubUserId } from './datahub-identity';
import s from './db/abstractSchema';
import { db } from './db/db';
import { env } from './env';
import * as orgQueries from './queries/organization.queries';
import * as userQueries from './queries/user.queries';
import { initializeSelfHostedUserAfterCreation } from './services/auth-user-onboarding.service';

const ME_QUERY = `
	query DataHubMe {
		me {
			corpUser {
				username
				urn
				properties {
					displayName
					email
					active
				}
			}
		}
	}
`;

const CACHE_TTL_MS = 30_000;

type CachedSession = {
	value: { user: AuthUser; session: Session };
	expiresAt: number;
};

const cache = new Map<string, CachedSession>();
const usernamesByUserId = new Map<string, string>();

export function datahubUsernameForUser(userId: string): string | undefined {
	return usernamesByUserId.get(userId);
}

export async function sessionFromDataHub(headers: Headers): Promise<{ user: AuthUser; session: Session } | null> {
	const frontendUrl = env.DATAHUB_FRONTEND_URL;
	if (!frontendUrl) {
		return null;
	}

	const cookie = headers.get('cookie');
	if (!cookie || !cookie.includes('PLAY_SESSION=')) {
		return null;
	}

	const cacheKey = datahubUserId(cookie);
	const hit = cache.get(cacheKey);
	if (hit && hit.expiresAt > Date.now()) {
		return hit.value;
	}

	const corpUser = await fetchCorpUser(frontendUrl, cookie);
	if (!corpUser) {
		return null;
	}

	const row = await upsertUser(corpUser);
	usernamesByUserId.set(row.id, corpUser.username);
	const value = {
		user: row as AuthUser,
		session: syntheticSession(row.id),
	};
	cache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL_MS });
	return value;
}

async function fetchCorpUser(frontendUrl: string, cookie: string): Promise<DataHubCorpUser | null> {
	const url = `${frontendUrl.replace(/\/$/, '')}/api/v2/graphql`;
	let response: Response;
	try {
		response = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Cookie: cookie,
			},
			body: JSON.stringify({ query: ME_QUERY }),
			signal: AbortSignal.timeout(5_000),
		});
	} catch {
		throw new Error('DataHub session check failed');
	}

	if (response.status === 401 || response.status === 403) {
		return null;
	}
	if (!response.ok) {
		throw new Error(`DataHub session check failed (${response.status})`);
	}

	return corpUserFromGraphql(await response.json());
}

async function upsertUser(corpUser: DataHubCorpUser) {
	const id = datahubUserId(corpUser.username);
	const email = datahubUserEmail(corpUser.username, corpUser.email);
	const name = corpUser.displayName;
	const existing = await userQueries.getUser({ id });
	if (existing) {
		if (existing.name !== name || existing.email !== email) {
			await db.update(s.user).set({ name, email }).where(eq(s.user.id, id)).execute();
			return { ...existing, name, email };
		}
		return existing;
	}

	try {
		const [created] = await db
			.insert(s.user)
			.values({
				id,
				name,
				email,
				emailVerified: true,
				requiresPasswordReset: false,
				memoryEnabled: true,
				messagingProviderCode: userQueries.createMessagingProviderCode(),
			})
			.returning()
			.execute();

		await initializeSelfHostedUserAfterCreation(created.id, 'datahub', false);
		await orgQueries.addUserToDefaultProjectIfExists(created.id);
		return created;
	} catch (error) {
		const existing = await userQueries.getUser({ id });
		if (existing) {
			return existing;
		}
		throw error;
	}
}

function syntheticSession(userId: string): Session {
	const now = new Date();
	return {
		id: `dh-session-${userId}`,
		userId,
		token: `datahub-${userId}`,
		expiresAt: new Date(now.getTime() + 8 * 60 * 60 * 1000),
		createdAt: now,
		updatedAt: now,
		ipAddress: null,
		userAgent: null,
	} as Session;
}
