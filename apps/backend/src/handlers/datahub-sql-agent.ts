import { createUIMessageStream } from 'ai';

import { datahubTraceUserId } from '../datahub-identity';
import { datahubUsernameForUser } from '../datahub-session';
import { env, noProjectMessage } from '../env';
import * as chatQueries from '../queries/chat.queries';
import type { AgentManager } from '../services/agent';
import { DataHubSqlAgent } from '../services/datahub-sql-agent';
import type { AgentRequest, UIMessage } from '../types/chat';
import { createChatTitle } from '../utils/ai';
import { HandlerError } from '../utils/error';
import { logger } from '../utils/logger';

const MODEL_ID = 'datahub_sql_agent';

interface HandleDataHubSqlAgentInput extends AgentRequest {
	userId: string;
	userEmail: string | null | undefined;
	projectId: string | undefined;
}

interface HandleDataHubSqlAgentResult {
	chatId: string;
	modelId: string;
	stream: ReadableStream;
	agent: Pick<AgentManager, 'isStopped' | 'waitUntilFinished'>;
}

export const handleDataHubSqlAgentRoute = async (
	opts: HandleDataHubSqlAgentInput,
): Promise<HandleDataHubSqlAgentResult> => {
	const runtimeArn = env.AGENT_RUNTIME_ARN;
	if (!runtimeArn) {
		throw new HandlerError('BAD_REQUEST', 'The DataHub SQL agent is not configured.');
	}
	if (!opts.projectId) {
		throw new HandlerError('BAD_REQUEST', noProjectMessage());
	}

	const projectId = opts.projectId;
	const { chatId, newMessageId, isNewChat } = await persistUserMessage(opts, projectId);
	const [chat] = await chatQueries.getChat(chatId);
	if (!chat) {
		throw new HandlerError('NOT_FOUND', `Chat with id ${chatId} not found.`);
	}

	const datahubUserId = datahubUsernameForUser(opts.userId) ?? datahubTraceUserId(opts.userEmail);
	const agentClient = new DataHubSqlAgent(runtimeArn, env.AWS_REGION || 'us-east-2');

	let finished = false;
	let resolveFinished: () => void = () => {};
	const finishedPromise = new Promise<void>((resolve) => {
		resolveFinished = () => {
			finished = true;
			resolve();
		};
	});

	let answer = '';
	let error: unknown;

	const stream = createUIMessageStream<UIMessage>({
		generateId: () => crypto.randomUUID(),
		execute: async ({ writer }) => {
			writer.write({ type: 'start' });
			if (isNewChat) {
				writer.write({
					type: 'data-newChat',
					data: {
						id: chat.id,
						projectId,
						title: chat.title,
						isStarred: chat.isStarred,
						createdAt: chat.createdAt,
						updatedAt: chat.updatedAt,
					},
				});
			}
			writer.write({
				type: 'data-newUserMessage',
				data: { newId: newMessageId },
			});

			try {
				const reply = await agentClient.invoke(opts.message.text, chatId, datahubUserId);
				answer = reply.response;
			} catch (err) {
				error = err;
				logger.error(`DataHub SQL agent failed: ${String(err)}`, {
					source: 'agent',
					projectId,
					context: { chatId },
				});
				answer = 'The DataHub agent could not answer that question. Try again in a moment.';
			}

			const textId = crypto.randomUUID();
			writer.write({ type: 'text-start', id: textId });
			writer.write({ type: 'text-delta', id: textId, delta: answer });
			writer.write({ type: 'text-end', id: textId });
			writer.write({ type: 'finish', finishReason: error ? 'error' : 'stop' });
		},
		onFinish: async () => {
			try {
				await chatQueries.upsertMessage({
					role: 'assistant',
					parts: [{ type: 'text', text: answer }],
					chatId,
					senderUserId: opts.userId,
					source: 'web',
					stopReason: error ? 'error' : 'stop',
					error,
					llmProvider: 'bedrock',
					llmModelId: MODEL_ID,
				});
			} finally {
				resolveFinished();
			}
		},
	});

	return {
		chatId,
		modelId: MODEL_ID,
		stream,
		agent: {
			get isStopped() {
				return false;
			},
			waitUntilFinished: () => (finished ? Promise.resolve() : finishedPromise),
		},
	};
};

async function persistUserMessage(
	opts: HandleDataHubSqlAgentInput,
	projectId: string,
): Promise<{ chatId: string; newMessageId: string; isNewChat: boolean }> {
	if (!opts.chatId) {
		const [createdChat, createdMessage] = await chatQueries.createChat(
			{ title: createChatTitle(opts.message), userId: opts.userId, projectId },
			{ text: opts.message.text, citation: opts.message.citation, source: 'web' },
		);
		return { chatId: createdChat.id, newMessageId: createdMessage.id, isNewChat: true };
	}

	const ownerId = await chatQueries.getChatOwnerId(opts.chatId);
	if (!ownerId) {
		throw new HandlerError('NOT_FOUND', `Chat with id ${opts.chatId} not found.`);
	}
	if (ownerId !== opts.userId) {
		throw new HandlerError('FORBIDDEN', 'You are not authorized to access this chat.');
	}

	let versionGroupId: string | undefined;
	if (opts.messageToEditId) {
		versionGroupId = await chatQueries.resolveVersionGroupIdForEdit(opts.chatId, opts.messageToEditId);
		await chatQueries.supersedeMessagesFrom(opts.chatId, opts.messageToEditId);
	}

	const saved = await chatQueries.upsertMessage({
		role: 'user',
		parts: [{ type: 'text', text: opts.message.text }],
		chatId: opts.chatId,
		senderUserId: opts.userId,
		source: 'web',
		citation: opts.message.citation,
		versionGroupId,
	});

	return { chatId: opts.chatId, newMessageId: saved.messageId, isNewChat: false };
}
