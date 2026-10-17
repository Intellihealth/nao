import { describe, expect, it } from 'vitest';

import { corpUserFromGraphql, datahubTraceUserId, datahubUserEmail, datahubUserId } from '../src/datahub-identity';

describe('datahub identity', () => {
	it('derives a stable user id from the DataHub username', () => {
		expect(datahubUserId('oguz.akkas@flytehealth.com')).toBe(datahubUserId('oguz.akkas@flytehealth.com'));
		expect(datahubUserId('oguz.akkas@flytehealth.com')).not.toBe(datahubUserId('datahub'));
		expect(datahubUserId('datahub')).toMatch(/^dh_[a-f0-9]{24}$/);
	});

	it('uses the DataHub username as the SQL agent trace user', () => {
		expect(datahubTraceUserId('oguz.akkas@flytehealth.com')).toBe('oguz.akkas@flytehealth.com');
		expect(datahubTraceUserId('datahub@users.datahub.local')).toBe('datahub');
		expect(datahubTraceUserId(null)).toBeUndefined();
	});

	it('uses the profile email, then an email-shaped username, then a local placeholder', () => {
		expect(datahubUserEmail('datahub', 'ops@flytehealth.com')).toBe('ops@flytehealth.com');
		expect(datahubUserEmail('oguz.akkas@flytehealth.com', null)).toBe('oguz.akkas@flytehealth.com');
		expect(datahubUserEmail('datahub', null)).toBe('datahub@users.datahub.local');
	});

	it('reads the signed-in corp user and rejects an inactive account', () => {
		const body = {
			data: {
				me: {
					corpUser: {
						username: 'oguz.akkas@flytehealth.com',
						urn: 'urn:li:corpuser:oguz.akkas@flytehealth.com',
						properties: { displayName: 'Oguz Akkas', email: 'oguz.akkas@flytehealth.com', active: true },
					},
				},
			},
		};
		expect(corpUserFromGraphql(body)?.displayName).toBe('Oguz Akkas');
		expect(
			corpUserFromGraphql({
				data: {
					me: {
						corpUser: {
							username: 'datahub',
							urn: 'urn:li:corpuser:datahub',
							properties: { active: false },
						},
					},
				},
			}),
		).toBeNull();
		expect(corpUserFromGraphql({ data: { me: { corpUser: null } } })).toBeNull();
	});
});
