import { existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getPostHogDistinctId, persistPostHogId } from '../../src/utils/posthog.utils';

const TEST_HOME_DIR = join(tmpdir(), `posthog-test-${Date.now()}`);

vi.mock('os', async (importOriginal) => {
	const actual = await importOriginal<typeof import('os')>();
	return {
		...actual,
		homedir: () => TEST_HOME_DIR,
	};
});

describe('getPostHogDistinctId', () => {
	beforeEach(removeTestHomeDir);
	afterEach(removeTestHomeDir);

	it('should create a new UUID when no file exists', () => {
		const id = getPostHogDistinctId();

		expect(id).toBeTruthy();
	});

	it('should return the same ID on subsequent calls (persistence)', () => {
		const firstId = getPostHogDistinctId();
		const secondId = getPostHogDistinctId();
		const thirdId = getPostHogDistinctId();

		expect(secondId).toBe(firstId);
		expect(thirdId).toBe(firstId);
	});

	it('should return existing valid UUID from file', () => {
		const existingId = crypto.randomUUID();
		persistPostHogId(existingId);

		const id = getPostHogDistinctId();

		expect(id).toBe(existingId);
	});

	it('should generate new ID when file contains invalid UUID', () => {
		persistPostHogId('not-a-valid-uuid');

		const id = getPostHogDistinctId();

		expect(id).not.toBe('not-a-valid-uuid');
	});
});

function removeTestHomeDir() {
	if (existsSync(TEST_HOME_DIR)) {
		rmSync(TEST_HOME_DIR, { recursive: true, force: true });
	}
}
