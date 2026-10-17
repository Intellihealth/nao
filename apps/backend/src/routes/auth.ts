import { App } from '../app';
import { getAuth } from '../auth';
import { sessionFromDataHub } from '../datahub-session';
import { env } from '../env';
import { convertHeaders } from '../utils/utils';

function serializeBody(body: unknown, contentType: string | undefined): string | undefined {
	if (!body) {
		return undefined;
	}
	if (contentType?.includes('application/x-www-form-urlencoded') && typeof body === 'object') {
		return new URLSearchParams(body as Record<string, string>).toString();
	}
	return JSON.stringify(body);
}

export const authRoutes = async (app: App) => {
	app.route({
		method: ['GET', 'POST'],
		url: '/auth/*',
		async handler(request, reply) {
			try {
				// Construct request URL
				const url = new URL(request.url, `http://${request.headers.host}`);

				const headers = convertHeaders(request.headers);
				if (env.DATAHUB_FRONTEND_URL && url.pathname.endsWith('/auth/get-session')) {
					const session = await sessionFromDataHub(headers);
					reply.type('application/json');
					reply.send(session ? { session: session.session, user: session.user } : null);
					return;
				}
				// Create Fetch API-compatible request
				const req = new Request(url.toString(), {
					method: request.method,
					headers,
					body: serializeBody(request.body, request.headers['content-type']),
				});
				// Process authentication request
				const auth = await getAuth();
				const response = await auth.handler(req);
				// Forward response to client
				reply.status(response.status);
				response.headers.forEach((value, key) => reply.header(key, value));
				reply.send(response.body ? await response.text() : null);
			} catch (error) {
				app.log.error(error, 'Authentication Error');
				reply.status(500).send({
					error: 'Internal authentication error',
					code: 'AUTH_FAILURE',
				});
			}
		},
	});
};
