import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import * as organizationQueries from '../queries/organization.queries';
import {
	getActiveWarehouseProvisioningJob,
	getWarehouseProvisioningJob,
	startWarehouseProvisioning,
	validateWarehouseCredentials,
} from '../services/warehouse-provisioning';
import { warehouseCredentialsSchema, warehouseProvisioningInputSchema } from '../types/warehouse';
import { protectedProcedure, router } from './trpc';

export const onboardingRoutes = router({
	validateWarehouseCredentials: protectedProcedure
		.input(warehouseCredentialsSchema)
		.output(z.object({ valid: z.literal(true) }))
		.mutation(async ({ ctx, input }) => {
			await getOrgMembershipOrThrow(ctx.user.id, ctx.selectedOrganizationId);
			return validateWarehouseCredentials(input);
		}),

	startWarehouseProvisioning: protectedProcedure
		.input(warehouseProvisioningInputSchema)
		.output(
			z.object({
				jobId: z.string(),
				status: z.literal('queued'),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const membership = await getOrgMembershipOrThrow(ctx.user.id, ctx.selectedOrganizationId);
			return startWarehouseProvisioning({
				userId: ctx.user.id,
				orgId: membership.orgId,
				projectName: buildOnboardingProjectName(ctx.user.name),
				...input,
			});
		}),

	getWarehouseProvisioningStatus: protectedProcedure
		.input(z.object({ jobId: z.uuid() }))
		.query(async ({ ctx, input }) => {
			const job = await getWarehouseProvisioningJob(input.jobId, ctx.user.id);
			if (!job) {
				throw new TRPCError({
					code: 'NOT_FOUND',
					message: 'Warehouse setup job not found',
				});
			}
			return job;
		}),

	getActiveWarehouseProvisioningJob: protectedProcedure
		.input(z.object({ onboardingChatId: z.uuid() }))
		.query(({ ctx, input }) => getActiveWarehouseProvisioningJob(ctx.user.id, input.onboardingChatId)),
});

async function getOrgMembershipOrThrow(userId: string, selectedOrganizationId?: string | null) {
	const membership = await organizationQueries.getUserOrgMembership(userId, selectedOrganizationId);
	if (!membership) {
		throw new TRPCError({
			code: 'NOT_FOUND',
			message: 'You are not a member of an organization',
		});
	}
	return membership;
}

function buildOnboardingProjectName(userName: string): string {
	const name = userName.trim();
	return name ? `${name}'s project` : 'My project';
}
