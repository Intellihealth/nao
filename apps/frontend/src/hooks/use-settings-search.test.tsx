// @vitest-environment jsdom

import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSettingsSearch } from './use-settings-search';

const mocks = vi.hoisted(() => ({
	permissions: {
		canViewUsage: false,
		isAdmin: false,
		isContextAdmin: false,
		isOrgAdmin: false,
		isViewer: true,
	},
}));

vi.mock('@tanstack/react-query', () => ({
	useQuery: () => ({ data: { betaSubagentsEnabled: false, cloudBillingEnabled: false } }),
}));

vi.mock('@/hooks/use-license', () => ({
	useLicenseFeatures: () => ({ data: {} }),
}));

vi.mock('@/hooks/use-nao-mode', () => ({
	useIsCloud: () => false,
}));

vi.mock('@/hooks/use-permissions', () => ({
	usePermissions: () => mocks.permissions,
}));

vi.mock('@/main', () => ({
	trpc: {
		system: {
			getPublicConfig: {
				queryOptions: () => ({}),
			},
		},
	},
}));

describe('useSettingsSearch', () => {
	beforeEach(() => {
		Object.assign(mocks.permissions, {
			canViewUsage: false,
			isAdmin: false,
			isContextAdmin: false,
			isOrgAdmin: false,
			isViewer: true,
		});
	});

	afterEach(cleanup);

	it.each(['Messages', 'Tokens', 'Cost'])('only returns %s to roles with usage access', (title) => {
		const { result, rerender } = renderHook(() => useSettingsSearch(title));

		expect(result.current.some((entry) => entry.title === title)).toBe(false);

		Object.assign(mocks.permissions, { canViewUsage: true, isViewer: false });
		rerender();

		expect(result.current.some((entry) => entry.title === title)).toBe(true);
	});
});
