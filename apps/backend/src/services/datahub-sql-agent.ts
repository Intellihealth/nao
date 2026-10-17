import { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } from '@aws-sdk/client-bedrock-agentcore';

export interface DataHubSqlAgentReply {
	response: string;
}

/**
 * One turn of the existing datahub_sql_agent runtime.
 * Payload matches the /chat path: {"prompt", "datahub_user_id"?} -> {"response"}.
 * runtimeSessionId is the nao chat id so follow-ups stay in the same agent session.
 */
export class DataHubSqlAgent {
	private readonly client: BedrockAgentCoreClient;

	constructor(
		private readonly agentRuntimeArn: string,
		region: string,
		private readonly invokeTimeoutMs = 120_000,
	) {
		this.client = new BedrockAgentCoreClient({ region });
	}

	async invoke(prompt: string, runtimeSessionId: string, datahubUserId?: string): Promise<DataHubSqlAgentReply> {
		const payload = new TextEncoder().encode(
			JSON.stringify({
				prompt,
				...(datahubUserId ? { datahub_user_id: datahubUserId } : {}),
			}),
		);

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), this.invokeTimeoutMs);

		try {
			const out = await this.client.send(
				new InvokeAgentRuntimeCommand({
					agentRuntimeArn: this.agentRuntimeArn,
					runtimeSessionId,
					contentType: 'application/json',
					accept: 'application/json',
					payload,
				}),
				{ abortSignal: controller.signal },
			);

			const text = await collectResponse(out.response);
			return parseReply(text);
		} finally {
			clearTimeout(timer);
		}
	}
}

function parseReply(text: string): DataHubSqlAgentReply {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return { response: text };
	}

	const obj = parsed as { response?: unknown; error?: unknown };
	if (typeof obj.error === 'string' && obj.error) {
		throw new Error(obj.error);
	}
	if (typeof obj.response !== 'string') {
		throw new Error('DataHub SQL agent returned no response');
	}
	return { response: obj.response };
}

async function collectResponse(response: unknown): Promise<string> {
	if (response == null) {
		return '';
	}

	const maybeStream = response as { transformToString?: () => Promise<string> };
	if (typeof maybeStream.transformToString === 'function') {
		return maybeStream.transformToString();
	}

	if (response instanceof Uint8Array) {
		return new TextDecoder().decode(response);
	}

	const asyncIterable = response as AsyncIterable<Uint8Array>;
	if (typeof asyncIterable[Symbol.asyncIterator] === 'function') {
		const chunks: Uint8Array[] = [];
		for await (const chunk of asyncIterable) {
			chunks.push(chunk);
		}
		return Buffer.concat(chunks).toString('utf8');
	}

	return String(response);
}
