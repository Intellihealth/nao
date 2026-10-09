// @vitest-environment jsdom

import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RequestWarehouseCredentialsToolCall } from './request-warehouse-credentials';
import type { ToolCallComponentProps } from '.';

const mocks = vi.hoisted(() => ({
	isRunning: true,
	jobStatus: 'awaiting_context',
	activeJobId: 'job-1' as string | undefined,
	activeJobIsFetched: true,
	messages: [] as never[],
	queueOrSendMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tanstack/react-query', () => ({
	useMutation: () => ({
		error: null,
		isPending: false,
		mutateAsync: vi.fn(),
		reset: vi.fn(),
	}),
	useQuery: (options: { queryKey: string[] }) =>
		options.queryKey[0] === 'active-job'
			? {
					data: mocks.activeJobId ? { id: mocks.activeJobId } : undefined,
					isFetched: mocks.activeJobIsFetched,
				}
			: { data: { status: mocks.jobStatus }, isError: false },
	useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock('@/contexts/agent.provider', () => ({
	useAgentContext: () => ({
		chatId: 'chat-1',
		isRunning: mocks.isRunning,
		queueOrSendMessage: mocks.queueOrSendMessage,
	}),
	useAgentMessagesSelector: (selector: (messages: never[]) => unknown) => selector(mocks.messages),
}));

vi.mock('@/main', () => ({
	trpc: {
		onboarding: {
			getActiveWarehouseProvisioningJob: {
				queryOptions: () => ({ queryKey: ['active-job'] }),
			},
			getWarehouseProvisioningStatus: {
				queryOptions: () => ({ queryKey: ['job'] }),
			},
			startWarehouseProvisioning: {
				mutationOptions: () => ({}),
			},
		},
	},
}));

vi.mock('./warehouse-credentials-form', () => ({
	WarehouseCredentialsForm: () => null,
}));

afterEach(() => {
	cleanup();
	mocks.isRunning = true;
	mocks.jobStatus = 'awaiting_context';
	mocks.activeJobId = 'job-1';
	mocks.activeJobIsFetched = true;
	mocks.messages = [];
	vi.clearAllMocks();
});

describe('RequestWarehouseCredentialsToolCall', () => {
	it('waits for the current turn to finish before requesting business context', async () => {
		const toolPart = {
			type: 'tool-request_warehouse_credentials',
			toolCallId: 'tool-1',
			state: 'output-available',
			input: { provider: 'postgres' },
			output: { provider: 'postgres', status: 'credentials-required' },
		} as ToolCallComponentProps<'request_warehouse_credentials'>['toolPart'];
		const view = render(<RequestWarehouseCredentialsToolCall toolPart={toolPart} />);

		await waitFor(() => expect(mocks.queueOrSendMessage).not.toHaveBeenCalled());

		mocks.isRunning = false;
		view.rerender(<RequestWarehouseCredentialsToolCall toolPart={toolPart} />);

		await waitFor(() =>
			expect(mocks.queueOrSendMessage).toHaveBeenCalledWith({
				text: '[internal:onboarding-context-request] jobId=job-1',
			}),
		);
	});

	it('hides the credentials request after provisioning completes', async () => {
		mocks.jobStatus = 'ready';
		const toolPart = {
			type: 'tool-request_warehouse_credentials',
			toolCallId: 'tool-1',
			state: 'output-available',
			input: { provider: 'postgres' },
			output: { provider: 'postgres', status: 'credentials-required' },
		} as ToolCallComponentProps<'request_warehouse_credentials'>['toolPart'];
		const view = render(<RequestWarehouseCredentialsToolCall toolPart={toolPart} />);

		await waitFor(() => expect(view.queryByText('Action required')).toBeNull());
	});

	it('waits for the active job before falling back to a persisted job ID', async () => {
		mocks.isRunning = false;
		mocks.activeJobId = undefined;
		mocks.activeJobIsFetched = false;
		mocks.messages = [
			{
				role: 'assistant',
				parts: [
					{
						type: 'tool-generate_onboarding_rules',
						state: 'output-available',
						output: { jobId: 'old-job' },
					},
				],
			},
		] as never[];
		const toolPart = {
			type: 'tool-request_warehouse_credentials',
			toolCallId: 'tool-1',
			state: 'output-available',
			input: { provider: 'postgres' },
			output: { provider: 'postgres', status: 'credentials-required' },
		} as ToolCallComponentProps<'request_warehouse_credentials'>['toolPart'];
		const view = render(<RequestWarehouseCredentialsToolCall toolPart={toolPart} />);

		await waitFor(() => expect(mocks.queueOrSendMessage).not.toHaveBeenCalled());

		mocks.activeJobId = 'new-job';
		mocks.activeJobIsFetched = true;
		view.rerender(<RequestWarehouseCredentialsToolCall toolPart={toolPart} />);

		await waitFor(() =>
			expect(mocks.queueOrSendMessage).toHaveBeenCalledWith({
				text: '[internal:onboarding-context-request] jobId=new-job',
			}),
		);
	});
});
