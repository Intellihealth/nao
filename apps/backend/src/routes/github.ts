import crypto from 'node:crypto';

import type { App } from '../app';
import { getSession } from '../auth';
import { env } from '../env';
import * as userQueries from '../queries/user.queries';
import * as githubService from '../services/github';
import { logger } from '../utils/logger';
import { convertHeaders } from '../utils/utils';

function signState(payload: string): string {
	return crypto.createHmac('sha256', env.BETTER_AUTH_SECRET).update(payload).digest('base64url');
}

export const githubRoutes = async (app: App) => {
	app.get('/connect', async (request, reply) => {
		if (!githubService.isGithubIntegrationAvailable()) {
			return reply.status(400).send({ error: 'GitHub integration is not configured' });
		}

		const session = await getSession(convertHeaders(request.headers));
		if (!session?.user) {
			return reply.status(401).send({ error: 'Unauthorized' });
		}

		const { returnTo } = request.query as { returnTo?: string };
		const payload = Buffer.from(
			JSON.stringify({ userId: session.user.id, returnTo: normalizeReturnTo(returnTo) }),
		).toString('base64url');
		const signature = signState(payload);
		const state = `${payload}.${signature}`;
		const url = githubService.buildAuthorizationUrl(state);
		return reply.redirect(url);
	});

	app.get('/callback', async (request, reply) => {
		const { code, state, error, error_description } = request.query as {
			code?: string;
			state?: string;
			error?: string;
			error_description?: string;
		};
		if (!code || !state) {
			return reply.type('text/html').send(githubOAuthErrorPage(error ?? 'missing_params', error_description));
		}

		const session = await getSession(convertHeaders(request.headers));
		if (!session?.user) {
			return reply.type('text/html').send(githubOAuthErrorPage('unauthorized'));
		}

		let userId: string;
		let returnTo = '/settings/organization';
		try {
			const [payload, signature] = state.split('.');
			if (!payload || !signature) {
				throw new Error('malformed state');
			}
			const expectedSignature = signState(payload);
			if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
				throw new Error('invalid signature');
			}
			const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());
			userId = decoded.userId;
			returnTo = normalizeReturnTo(decoded.returnTo);
		} catch (error) {
			return reply.type('text/html').send(githubOAuthErrorPage('invalid_state', getErrorMessage(error)));
		}

		if (session.user.id !== userId) {
			return reply.type('text/html').send(githubOAuthErrorPage('user_mismatch'));
		}

		try {
			const token = await githubService.exchangeCodeForToken(code);
			await userQueries.updateGithubToken(userId, token);
			return reply.redirect(`${returnTo}?github=connected`);
		} catch (error) {
			const details = error instanceof Error ? error.message : String(error);
			logger.error('GitHub OAuth callback failed', {
				source: 'http',
				context: { error: details },
			});
			return reply.type('text/html').send(githubOAuthErrorPage('exchange_failed', details));
		}
	});
};

export function githubOAuthErrorPage(reason: string, details?: string): string {
	const message = details ? `${reason}: ${details}` : reason;
	return `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>GitHub connection failed</title>
</head>
<body style="margin:0;background:#0f0f12;color:#f5f5f5;font-family:system-ui,sans-serif">
	<main style="max-width:680px;margin:64px auto;padding:24px">
		<h1 style="font-size:20px;margin:0 0 12px">GitHub connection failed</h1>
		<p style="color:#a1a1aa;margin:0 0 16px">This temporary debug window will remain open.</p>
		<pre style="white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid #3f3f46;border-radius:10px;background:#18181b;padding:16px">${escapeHtml(message.slice(0, 2000))}</pre>
	</main>
</body>
</html>`;
}

function normalizeReturnTo(value: unknown): string {
	if (typeof value !== 'string' || (!value.startsWith('/settings/') && value !== '/onboarding')) {
		return '/settings/organization';
	}
	return value.split('?', 1)[0];
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (character) => {
		const entities: Record<string, string> = {
			'&': '&amp;',
			'<': '&lt;',
			'>': '&gt;',
			'"': '&quot;',
			"'": '&#39;',
		};
		return entities[character];
	});
}
